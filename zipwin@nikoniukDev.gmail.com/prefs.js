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
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;
const Lang = imports.lang;

const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;
const N_ = function(e) { return e };

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

// constants
const SETTINGS_ZIP_MODE = 'settings-zip-mode';

const MODES = {
    'one-window': N_("Zip single window"),
    'all-windows': N_("Zip multiple windows (experimental)"),
};

/////////////////////////////////////////////////////////////
// Prefs classes
/////////////////////////////////////////////////////////////

const ZipWinSettingsWidget = new Lang.Class({
    Name: 'ZipWinSettingsWidget',
    Extends: Gtk.Grid,

    /**
     * Init widget
     */
    _init : function(params) {
        this.parent(params);
        this.margin = 10;
        this.orientation = Gtk.Orientation.VERTICAL;

        this._settings = Convenience.getSettings();

        let presentLabel = _("Select windows zip mode");
        this.add(new Gtk.Label({ label: presentLabel, sensitive: true,
                                 margin_bottom: 10, margin_top: 5 }));

        let top = 1;
        let radio = null;
        let currentMode = this._settings.get_string(SETTINGS_ZIP_MODE);
        for (let mode in MODES) {
            // copy the mode variable because it has function scope, not block scope
            // so cannot be used in a closure
            let modeCapture = mode;
            let name = Gettext.gettext(MODES[mode]);

            radio = new Gtk.RadioButton({ group: radio, label: name, valign: Gtk.Align.START });
            radio.connect('toggled', Lang.bind(this, function(widget) {
                if (widget.active)
                    this._settings.set_string(SETTINGS_ZIP_MODE, modeCapture);
            }));
            this.add(radio);

            if (mode == currentMode)
                radio.active = true;
            top += 1;
        }
    },
});

/**
* Init widtet handler
*/
function init() {
    Convenience.initTranslations();
}

/**
* Build prefs widget handler
*/
function buildPrefsWidget() {
    let widget = new ZipWinSettingsWidget();
    widget.show_all();

    return widget;
}
