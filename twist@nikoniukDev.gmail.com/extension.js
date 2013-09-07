const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const System = imports.system;
const Tweener = imports.ui.tweener;

const MAX_BEND_SIZE = 150;
const MOUSE_POOL_FREQUENCY = 100;
const X_TILES = 8;
const Y_TILES = 8;

let _beginGrabOpId;
let _endGrabOpId;
let _focusConnection;
let _focusedActor;
let _grabbingWindow;
let _mouseTrackingId;
let _tracker;

const TwistWindowEffect = new Lang.Class({
    Name: 'TwistWindowEffect',
    Extends: Clutter.DeformEffect,

    _init: function(params) {
	this.parent(params);
        this.stackingOrder = -1;
        this.animating = false;
    },

    _getActorDimensions: function() {
        let [x, y] = this.actor.get_position();
        let rect = this.window.get_input_rect();
        let [width, height] = this.actor.get_size();

        x += 9;
        y += 5;
        width -= 18;
        height -= 8;

        return [x, y, width, height];
    },

    _allocationChanged: function(actor, allocation, flags) {
        let [xWnd, yWnd, widthWnd, heightWnd] = this._getActorDimensions();

        this.realLeft = xWnd;
        this.realTop = yWnd;
        this.realRight = xWnd + widthWnd;
        this.realBottom = yWnd + heightWnd;
//log('left: ' + this.realLeft + ' top: ' + this.realTop + ' right: ' + this.realRight + ' bottom:' + this.realBottom);
//log('WORKAREA left: ' + this.workareaLeft + ' top: ' + this.workareaTop + ' right: ' + this.workareaRight + ' bottom:' + this.workareaBottom);
        if (_grabbingWindow) {
            this.outputLeft = Math.max(this.realLeft, this.workareaLeft);
            this.outputTop = Math.max(this.realTop, this.workareaTop);
            this.outputRight = Math.min(this.realRight, this.workareaRight);
            this.outputBottom = Math.min(this.realBottom, this.workareaBottom);
        }

        let horzBendSize = Math.min((this.outputRight - this.outputLeft) / 4, MAX_BEND_SIZE);
        let vertBendSize = Math.min((this.outputBottom - this.outputTop) / 4, MAX_BEND_SIZE);

        this.bendingBorderBottom = this.outputBottom - vertBendSize;
        this.bendingBorderTop = this.outputTop + vertBendSize;
        this.bendingBorderLeft = this.outputLeft + horzBendSize;
        this.bendingBorderRight = this.outputRight - horzBendSize; 

        this.kBottom = vertBendSize / (this.realBottom - this.bendingBorderBottom);
        this.kTop = vertBendSize / (this.bendingBorderTop - this.realTop);
        this.kLeft = horzBendSize / (this.bendingBorderLeft - this.realLeft);
        this.kRight = (horzBendSize) / (this.realRight - this.bendingBorderRight);
//log('kBottom: ' + this.kBottom + ' kTop: ' + this.kTop + ' kLeft: ' + this.kLeft + ' kRight:' + this.kRight);
    },

    ungrabbed: function() {
        this.remove();
    },

    remove: function() {
        let actor = this.get_actor();
        if (actor) {
            actor.remove_effect(this);
            this._stopTrackngMouse();
        }
    },

    uncompressAtPos: function(x, y) {
        let newX = this.realLeft;
        let newY = this.realTop;

        if (this.kBottom < 1 && this.kBottom > 0 &&
                y >= this.bendingBorderBottom && y <= this.outputBottom && 
                x >= this.outputLeft && x <= this.outputRight) { // if vertex is in bottom scaled area
            newY = this.realTop - (this.realBottom - this.outputBottom);
        } else if (this.kTop < 1 && this.kTop > 0 &&
                y <= this.bendingBorderTop && y >= this.outputTop &&
                x >= this.outputLeft && x <= this.outputRight) { // if vertex is in top scaled area
            newY = this.outputTop;
        }

        if (this.kRight < 1 && this.kRight > 0 &&
                x >= this.bendingBorderRight && x <= this.outputRight &&
                y >= this.outputTop && y <= this.outputBottom) { // if vertex is in right scaled area
            newX = this.realLeft - (this.realRight - this.outputRight);
            newY += 3;
        } else if (this.kLeft < 1 && this.kLeft > 0 &&
                x <= this.bendingBorderLeft && x >= this.outputLeft &&
                y >= this.outputTop && y <= this.outputBottom) { // if vertex is in left scaled area
            newX = this.outputLeft + 1;
            newY += 3;
        }

        if (!this.animating && newX != this.realLeft || newY != this.realTop) {
            //log('move '+ newX);
            this.animating = true;
            global.display.focus_window.move_frame(true, newX, newY);
            /*Tweener.addTween(_focusedActor,
              { time: 0.3,
                transition: 'easeOutQuad',
                x: newX,
                y: newY,
                onComplete: Lang.bind(this, function() {
                    //global.display.focus_window.get_xwindow().syncPosition();
                    global.display.focus_window.move_frame(false, newX, newY);
                    //global.display.get_xdisplay().XSync(false);
                    this.animating = false;
                })
            });*/
        }
    },

    vfunc_set_actor: function(actor) {
        if (actor) {
            actor.connect('allocation-changed', Lang.bind(this, this._allocationChanged));

            let stage = actor.get_stage();
            [this.workareaLeft, this.workareaTop] = stage.get_position();
            [this.workareaRight, this.workareaBottom] = stage.get_size();
            this.workareaTop += Main.panel.actor.get_size()[1];
        }
        this.parent(actor);
    },

    vfunc_deform_vertex: function(width, height, vertex) {
        if (this.kBottom < 1 && this.kBottom > 0 &&
                vertex.y + this.realTop > this.bendingBorderBottom) { // if vertex is in bottom scaled area
            vertex.y = this.bendingBorderBottom - this.realTop +
               (vertex.y - this.bendingBorderBottom + this.realTop) * this.kBottom;
        } else if (this.kTop < 1 && this.kTop > 0 &&
                vertex.y + this.realTop < this.bendingBorderTop) { // if vertex is in top scaled area
            vertex.y = this.bendingBorderTop - this.realTop + 
                (vertex.y - this.bendingBorderTop+ this.realTop) * this.kTop;
        }

        if (this.kRight < 1 && this.kRight > 0 &&
                vertex.x + this.realLeft > this.bendingBorderRight) { // if vertex is in right scaled area
            vertex.x = this.bendingBorderRight - this.realLeft + 
                (vertex.x - this.bendingBorderRight + this.realLeft) * this.kRight;
        } else if (this.kLeft < 1 && this.kLeft > 0 &&
                vertex.x + this.realLeft < this.bendingBorderLeft) { // if vertex is in left scaled area
            vertex.x = this.bendingBorderLeft - this.realLeft + 
                (vertex.x - this.bendingBorderLeft + this.realLeft) * this.kLeft;
        }

        vertex.z = this.stackingOrder;
    },
});

function _onBeginGrabOp(display, screen, window, op) {
    _grabbingWindow = true;
    let actor = window.get_compositor_private();
    if (actor) {
        let effect = actor.get_effect('twist');
        if (!effect) {
            effect = new TwistWindowEffect({ x_tiles: X_TILES, y_tiles: Y_TILES });
            effect.window = window;
            actor.add_effect_with_name('twist', effect);
        }
    }
}

function _onEndGrabOp(display, screen, window, op) {
    _grabbingWindow = false;
}

function _startTrackngMouse() {
    if (!_mouseTrackingId) {
        _mouseTrackingId = Mainloop.timeout_add(
            MOUSE_POOL_FREQUENCY,
            _mouseMoved);
    }
}

function _stopTrackingMouse() {
    if (_mouseTrackingId) {
        Mainloop.source_remove(_mouseTrackingId);
    }
    _mouseTrackingId = null;
}

function _mouseMoved() {
    let [xMouse, yMouse, mask] = global.get_pointer();

    // try to uncompress hovered window's compressed part
    if (_focusedActor) {
        let effect = _focusedActor.get_effect('twist');
        if (effect) {
            effect.uncompressAtPos(xMouse, yMouse);
        }
    }

    return true;
}

function _onWindowFocus() {
    if (global.display.focus_window) {
        let screen = global.screen;
        let display = screen.get_display();
        _focusedActor = global.display.focus_window.get_compositor_private();
        let sortedWindows = display.sort_windows_by_stacking(display.get_tab_list(Meta.TabList.NORMAL_ALL, screen, screen.get_active_workspace()));

	sortedWindows.forEach(function(window, index) {
            let actor = window.get_compositor_private();
            let effect = actor.get_effect('twist');
            if (effect) {
                effect.stackingOrder = index;
                effect.invalidate();
            }
        });
    }
}

function init() {
    _tracker = Shell.WindowTracker.get_default();
}

function enable() {
    _beginGrabOpId = global.display.connect('grab-op-begin', _onBeginGrabOp);
    _endGrabOpId = global.display.connect('grab-op-end', _onEndGrabOp);
    _focusConnection = _tracker.connect('notify::focus-app', _onWindowFocus);
    _startTrackngMouse();
}

function disable() {
    global.display.disconnect(_beginGrabOpId);
    global.display.disconnect(_endGrabOpId);

    _tracker.disconnect(_focusConnection);
    _stopTrackingMouse();

    global.get_window_actors().forEach(function(actor) {
        actor.remove_effect_by_name('twist');
    });
}
