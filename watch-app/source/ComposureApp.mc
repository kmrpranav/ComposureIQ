import Toybox.Application;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

class ComposureApp extends Application.AppBase {
    var engine as Engine;
    hidden var _timer as Timer.Timer?;
    hidden var _sub as Number = 0;
    var animFrame as Number = 0;

    function initialize() {
        AppBase.initialize();
        engine = new Engine();
    }

    function onStart(state as Dictionary?) as Void {
        engine.phaseListener = method(:onPhaseChanged);
        engine.start();
        // Single 250 ms timer: smooth primer animation + 1 Hz engine tick.
        _timer = new Timer.Timer();
        _timer.start(method(:onTimer), 250, true);
    }

    function onStop(state as Dictionary?) as Void {
        if (_timer != null) { _timer.stop(); }
        engine.stop();
    }

    function onTimer() as Void {
        animFrame++;
        _sub = (_sub + 1) % 4;
        if (_sub == 0) {
            engine.onTick();
        } else if (engine.phase.equals("PRIMER")) {
            WatchUi.requestUpdate();
        }
    }

    function onPhaseChanged(phase as String) as Void {
        WatchUi.switchToView(viewFor(phase), new ComposureDelegate(), WatchUi.SLIDE_UP);
    }

    function viewFor(phase as String) as WatchUi.View {
        if (phase.equals("PRIMER")) { return new PrimerView(); }
        if (phase.equals("LIVE")) { return new StealthView(); }
        if (phase.equals("DONE")) { return new SummaryView(); }
        return new IdleView();
    }

    function getInitialView() {
        return [new IdleView(), new ComposureDelegate()];
    }
}

function getApp() as ComposureApp {
    return Application.getApp() as ComposureApp;
}
