import Toybox.Lang;
import Toybox.WatchUi;

// Hardware buttons: MENU (hold UP) opens the stage override menu; START skips the primer.
class ComposureDelegate extends WatchUi.BehaviorDelegate {
    function initialize() { BehaviorDelegate.initialize(); }

    function onMenu() as Boolean {
        var m = new WatchUi.Menu2({ :title => "Stage" });
        m.addItem(new WatchUi.MenuItem("Venue Arrival", "geofence override", :arrive, {}));
        m.addItem(new WatchUi.MenuItem("High-Stress Q", "stress spike", :stress, {}));
        m.addItem(new WatchUi.MenuItem("Listening Pacer", "force 60 BPM cue", :pacer, {}));
        m.addItem(new WatchUi.MenuItem("Finish & Save", "write .FIT", :finish, {}));
        WatchUi.pushView(m, new StageMenuDelegate(), WatchUi.SLIDE_LEFT);
        return true;
    }

    function onSelect() as Boolean {
        var e = getApp().engine;
        if (e.phase.equals("PRIMER")) { e.setPhase("LIVE"); return true; }
        if (e.phase.equals("IDLE")) { e.geofenceOverride = true; return true; }
        return false;
    }

    function onBack() as Boolean {
        var e = getApp().engine;
        if (e.phase.equals("LIVE")) { e.setPhase("DONE"); return true; }
        return false; // exit app
    }
}

class StageMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var e = getApp().engine;
        var id = item.getId();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        if (id == :arrive) {
            e.geofenceOverride = true;
        } else if (id == :stress) {
            e.stress = 0.95;
            if (e.phase.equals("IDLE") || e.phase.equals("PRIMER")) { e.setPhase("LIVE"); }
        } else if (id == :pacer) {
            e.forcePacer();
        } else if (id == :finish) {
            e.setPhase("DONE");
        }
    }
}
