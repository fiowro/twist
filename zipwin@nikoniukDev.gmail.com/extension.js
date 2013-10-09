/* -*- mode: js; js-basic-offset: 4; indent-tabs-mode: nil -*- */
/* Copyright (C) 2013
 * Aleksandr Nikoniuk <nikoniukDev@gmail.com>, 
 * Dmitriy Kostiuk <dmitriykostiuk@gmail.com>
 * Licence: GPLv2+
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this extension; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 * 
 */

// imports
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const System = imports.system;
const Tweener = imports.ui.tweener;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

// constants
const SETTINGS_ZIP_MODE = 'settings-zip-mode';

const MAX_BEND_SIZE = 150;
const MOUSE_POOL_FREQUENCY = 100;
const X_TILES = 8;
const Y_TILES = 8;

// global variables
let _beginGrabOpId;
let _endGrabOpId;
let _focusConnection;
let _focusedActor;
let _grabbingWindow;
let _mouseTrackingId;
let _tracker;
let _settings;
let _singleWindowMode


/////////////////////////////////////////////////////////////
// Effect classes
/////////////////////////////////////////////////////////////

const ZipWinWindowEffect = new Lang.Class({
    Name: 'ZipWinWindowEffect',
    Extends: Clutter.DeformEffect,

    /**
     * Init effect
     */
    _init: function(params) {
        this.parent(params);
        this.stackingOrder = -1;
        this.toggle = false;
    },

    /////////////////////////////////////////////////////////////
    // Public methods
    /////////////////////////////////////////////////////////////

    /**
     * Remove effect
     */
    remove: function() {
        let actor = this.get_actor();
        if (actor) {
            actor.remove_effect(this);
            this._stopTrackngMouse();
        }
    },

    /**
     * Uncompress actor at position
     */
    uncompressAtPos: function(x, y) {
        let uncompress = false;

        let newX = this.realLeft;
        let newY = this.realTop;

        if (this.kBottom < 1 && this.kBottom > 0 &&
                y >= this.bendingBorderBottom && y <= this.outputBottom && 
                x >= this.outputLeft && x <= this.outputRight) {
            // if vertex is in bottom scaled area
            newY = this.realTop - (this.realBottom - this.outputBottom);
            uncompress = true;
        } else if (this.kTop < 1 && this.kTop > 0 &&
                y <= this.bendingBorderTop && y >= this.outputTop &&
                x >= this.outputLeft && x <= this.outputRight) {
            // if vertex is in top scaled area
            newY = this.outputTop;
            uncompress = true;
        }

        if (this.kRight < 1 && this.kRight > 0 &&
                x >= this.bendingBorderRight && x <= this.outputRight &&
                y >= this.outputTop && y <= this.outputBottom) {
            // if vertex is in right scaled area
            newX = this.realLeft - (this.realRight - this.outputRight);
            uncompress = true;
        } else if (this.kLeft < 1 && this.kLeft > 0 &&
                x <= this.bendingBorderLeft && x >= this.outputLeft &&
                y >= this.outputTop && y <= this.outputBottom) {
            // if vertex is in left scaled area
            newX = this.outputLeft;
            uncompress = true;
        }


        if (uncompress) {
                this.toggle = true;
               if (this.window.decorated) {
                    this.window.move_frame(true, newX, newY);
                } else {
                    this.window.move(true, newX, newY);
                }

        }
    },

    /////////////////////////////////////////////////////////////
    // Virtual methods overrides
    /////////////////////////////////////////////////////////////

    /**
     * Meta is attached or detached from actor
     */
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

    /**
     * Deform actor vertex
     */
    vfunc_deform_vertex: function(width, height, vertex) {
        let inputRect = this.window.get_input_rect();
        let outerRect = this.window.get_outer_rect();
        //let borderWidth = outerRect.x - inputRect.x;
        //let borderHeight = outerRect.y - inputRect.y;

        if (this.kBottom < 1 && this.kBottom > 0 &&
                vertex.y + this.realTop > this.bendingBorderBottom) {
            // if vertex is in bottom scaled area
            vertex.y = this.bendingBorderBottom - this.realTop +
               (vertex.y - this.bendingBorderBottom + this.realTop) * this.kBottom;
        } else if (this.kTop < 1 && this.kTop > 0 &&
                vertex.y + this.realTop < this.bendingBorderTop) {
            // if vertex is in top scaled area
            vertex.y = this.bendingBorderTop - this.realTop +
                (vertex.y - this.bendingBorderTop+ this.realTop) * this.kTop;
        }

        if (this.kRight < 1 && this.kRight > 0 &&
                vertex.x + this.realLeft > this.bendingBorderRight) {
            // if vertex is in right scaled area
            vertex.x = this.bendingBorderRight - this.realLeft +
                (vertex.x - this.bendingBorderRight + this.realLeft) * this.kRight;
        } else if (this.kLeft < 1 && this.kLeft > 0 &&
                vertex.x + this.realLeft < this.bendingBorderLeft) {
            // if vertex is in left scaled area
            vertex.x = this.bendingBorderLeft - this.realLeft +
                (vertex.x - this.bendingBorderLeft + this.realLeft) * this.kLeft;
        }

        vertex.z = this.stackingOrder;
    },

    /////////////////////////////////////////////////////////////
    // Private methods
    /////////////////////////////////////////////////////////////

    /**
     * Get actor dimensions
     */
    _getActorDimensions: function() {
        let rect = this.window.get_outer_rect();
        return [rect.x, rect.y, rect.width, rect.height];
    },

    /**
     * Actor allocation changed callback
     */
    _allocationChanged: function(actor, allocation, flags) {
        let toggle = this.toggle;
        let [xWnd, yWnd, widthWnd, heightWnd] = this._getActorDimensions();

        this.realLeft = xWnd;
        this.realTop = yWnd;
        this.realRight = xWnd + widthWnd;
        this.realBottom = yWnd + heightWnd;

        if (!toggle) {
            this.outputLeft = Math.max(this.realLeft, this.workareaLeft);
            this.outputTop = Math.max(this.realTop, this.workareaTop);
            this.outputRight = Math.min(this.realRight, this.workareaRight);
            this.outputBottom = Math.min(this.realBottom, this.workareaBottom);
        } else {
            this.toggle = false;
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
    }

});

/////////////////////////////////////////////////////////////
// global callbacks
/////////////////////////////////////////////////////////////

/**
 * Begin grab window
 */
function _onBeginGrabOp(display, screen, window, op) {
    _grabbingWindow = true;

    // init effect if it is not inited yet
    let actor = window.get_compositor_private();
    if (actor) {
        let effect = actor.get_effect('zipWin');
        if (!effect) {
            effect = new ZipWinWindowEffect({ x_tiles: X_TILES, y_tiles: Y_TILES });
            effect.window = window;
            actor.add_effect_with_name('zipWin', effect);
        }
    }
}

/**
 * End grab window
 */
function _onEndGrabOp(display, screen, window, op) {
    Mainloop.idle_add(function() {
        _grabbingWindow = false;
    });
}

/**
 * Start mouse polling
 */
function _startTrackngMouse() {
    if (!_mouseTrackingId) {
        _mouseTrackingId = Mainloop.timeout_add(
            MOUSE_POOL_FREQUENCY,
            break_loops(_mouseMoved));
    }
}

/**
 * End mouse polling
 */
function _stopTrackingMouse() {
    if (_mouseTrackingId) {
        Mainloop.source_remove(_mouseTrackingId);
    }
    _mouseTrackingId = null;
}

/**
 * Mouse moved callback
 */
function _mouseMoved() {
    // don't uncompress window under mouse while grabbing
    if (_grabbingWindow) {
        return true;
    }
    let [xMouse, yMouse, mask] = global.get_pointer();

    // try to uncompress hovered window's compressed part
    if (_focusedActor) {
        let effect = _focusedActor.get_effect('zipWin');
        if (effect) {
            effect.uncompressAtPos(xMouse, yMouse);
        }
    }

    return true;
}

/**
 * Window focused callback
 */
function _onWindowFocus() {
    let focusedWindow = global.display.focus_window;
    if (focusedWindow) {
         _focusedActor = focusedWindow.get_compositor_private();
	_repaintAllWindows();
    }
}

/////////////////////////////////////////////////////////////
// helper functions
/////////////////////////////////////////////////////////////

/**
 * Repaint all windows
 */
function _repaintAllWindows() {
    let screen = global.screen;
    let display = screen.get_display();

    if (_singleWindowMode) {
        global.get_window_actors().forEach(function(actor) {
            let effect = actor.get_effect('zipWin');
            if (effect) {
                effect.set_enabled(false);
            }
        });
    }

    let effect = _focusedActor? _focusedActor.get_effect('zipWin'): null;
    if (effect) {
        effect.set_enabled(true);
    }

    if (!_singleWindowMode) {
        let sortedWindows = display.sort_windows_by_stacking(
        display.get_tab_list(Meta.TabList.NORMAL_ALL, screen, screen.get_active_workspace()));
        sortedWindows.forEach(function(window, index) {
            let actor = window.get_compositor_private();
            let effect = actor.get_effect('zipWin');
            if (effect) {
               effect.stackingOrder = index;
               effect.invalidate();
            }
        });
    }
}

/**
 * Return 'synchronized' function
 */
function break_loops(func) {
    return function() {
        if(this.calling === true) return true;		
            this.calling = true;
            try {
                func.apply(this, arguments);
            } finally {
                this.calling = false;
            }
            return true;
    }
}

/////////////////////////////////////////////////////////////
// init plugin
/////////////////////////////////////////////////////////////

/**
 * Read effect settings
 */
function _readSettings() {
    _singleWindowMode = _settings.get_string(SETTINGS_ZIP_MODE) == "one-window";
    _repaintAllWindows();
}

/**
 * Init extension handler
 */
function init(extensionMeta) {
    _tracker = Shell.WindowTracker.get_default();
    _settings = Convenience.getSettings();
    _settings.connect('changed::' + SETTINGS_ZIP_MODE, function() {
        _readSettings();
    });
    _readSettings();
}

/**
 * Enable extension handler
 */
function enable() {
    _beginGrabOpId = global.display.connect('grab-op-begin', _onBeginGrabOp);
    _endGrabOpId = global.display.connect('grab-op-end', _onEndGrabOp);
    _focusConnection = _tracker.connect('notify::focus-app', _onWindowFocus);
    _startTrackngMouse();
}

/**
 * Disable extension handler
 */
function disable() {
    global.display.disconnect(_beginGrabOpId);
    global.display.disconnect(_endGrabOpId);

    _tracker.disconnect(_focusConnection);
    _stopTrackingMouse();

    global.get_window_actors().forEach(function(actor) {
        actor.remove_effect_by_name('zipWin');
    });
}
