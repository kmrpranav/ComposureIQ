import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

function fmtNum(v, digits as Number) as String {
    if (v == null) { return "--"; }
    return v.format("%." + digits + "f");
}

// ---------------------------------------------------------------- Phase 0: approach
class IdleView extends WatchUi.View {
    function initialize() { View.initialize(); }

    function onUpdate(dc as Dc) as Void {
        var e = getApp().engine;
        var w = dc.getWidth(); var cx = w / 2;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(0x38BDF8, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 34, Graphics.FONT_XTINY, "ComposureIQ", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 70, Graphics.FONT_XTINY, "NEXT EVENT", Graphics.TEXT_JUSTIFY_CENTER);
        var title = e.calTitle;
        if (title.length() > 22) { title = title.substring(0, 22); }
        dc.drawText(cx, 92, Graphics.FONT_XTINY, title, Graphics.TEXT_JUSTIFY_CENTER);

        var dist = e.distance == null ? "GPS --" : (e.distance > 1000 ? (e.distance / 1000).format("%.1f") + " km" : e.distance.format("%d") + " m");
        dc.drawText(cx, 122, Graphics.FONT_MEDIUM, dist, Graphics.TEXT_JUSTIFY_CENTER);

        var mins = "--";
        if (e.calStart != null) {
            var d = e.calStart - Time.now().value();
            mins = d > 0 ? "T-" + (d / 60).format("%d") + " min" : "now";
        }
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 165, Graphics.FONT_XTINY, mins + "  ·  fence 100 m", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(e.serverOk ? 0x22C55E : 0xEF4444, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 200, Graphics.FONT_XTINY, e.serverOk ? "spine linked" : "spine offline", Graphics.TEXT_JUSTIFY_CENTER);
    }
}

// ---------------------------------------------------------------- Phase 1: waiting-room primer
class PrimerView extends WatchUi.View {
    function initialize() { View.initialize(); }

    function onUpdate(dc as Dc) as Void {
        var e = getApp().engine;
        var w = dc.getWidth(); var h = dc.getHeight();
        var cx = w / 2; var cy = h / 2;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // 10 s physiological sigh: 0-2 s inhale, 2-3 s top-up, 3-10 s long exhale.
        var t = (getApp().animFrame % 40) / 4.0;
        var r; var label;
        if (t < 2.0) { r = 40 + 30 * (t / 2.0); label = "inhale"; }
        else if (t < 3.0) { r = 70 + 14 * (t - 2.0); label = "inhale more"; }
        else { r = 84 - 44 * ((t - 3.0) / 7.0); label = "slow exhale"; }

        dc.setColor(0x0E7490, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy, r.toNumber());
        dc.setColor(0x67E8F9, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        dc.drawCircle(cx, cy, r.toNumber());
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 12, Graphics.FONT_SMALL, label, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 22, Graphics.FONT_XTINY, "PRIMER " + e.primerElapsedS().format("%d") + "/90s", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, h - 62, Graphics.FONT_XTINY,
            "HRV " + fmtNum(e.rmssd, 0) + "ms  SpO2 " + fmtNum(e.spo2, 0) + "%", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, h - 42, Graphics.FONT_XTINY, "skin " + fmtNum(e.temp, 1) + "C", Graphics.TEXT_JUSTIFY_CENTER);
    }
}

// ---------------------------------------------------------------- Phase 2: stealth analog
// Dim, minimalist analog face — nothing an interviewer could read across the table.
class StealthView extends WatchUi.View {
    function initialize() { View.initialize(); }

    function onUpdate(dc as Dc) as Void {
        var e = getApp().engine;
        var w = dc.getWidth(); var cx = w / 2; var cy = dc.getHeight() / 2;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(0x2A2A2A, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(3);
        for (var i = 0; i < 12; i++) {
            var a = i * Math.PI / 6;
            var r1 = cx - 8; var r2 = (i % 3 == 0) ? cx - 26 : cx - 16;
            dc.drawLine(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a), cx + r2 * Math.sin(a), cy - r2 * Math.cos(a));
        }

        var ct = System.getClockTime();
        var hourA = ((ct.hour % 12) + ct.min / 60.0) * Math.PI / 6;
        var minA = (ct.min + ct.sec / 60.0) * Math.PI / 30;
        dc.setColor(0x6B6B6B, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(7);
        drawHand(dc, cx, cy, hourA, cx * 0.5);
        dc.setPenWidth(5);
        drawHand(dc, cx, cy, minA, cx * 0.78);
        dc.fillCircle(cx, cy, 6);

        // Barely-visible gate dot at 6 o'clock: dim teal when listening, dim amber when speaking.
        var col = e.gate.equals("SPEAKING") ? 0x3D2E0F : 0x0F2E2E;
        if (System.getTimer() - e.lastPacerMs < 2500) { col = 0x155E75; }
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy + cx - 40, 5);
    }

    hidden function drawHand(dc as Dc, cx as Number, cy as Number, a as Float, len as Float) as Void {
        dc.drawLine(cx, cy, cx + len * Math.sin(a), cy - len * Math.cos(a));
    }
}

// ---------------------------------------------------------------- Phase 3: done
class SummaryView extends WatchUi.View {
    function initialize() { View.initialize(); }

    function onUpdate(dc as Dc) as Void {
        var e = getApp().engine;
        var cx = dc.getWidth() / 2;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(0x38BDF8, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 50, Graphics.FONT_XTINY, "SESSION SAVED", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 90, Graphics.FONT_NUMBER_MEDIUM, e.composure.format("%d"), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 160, Graphics.FONT_XTINY, "composure index", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, 185, Graphics.FONT_XTINY, e.pacerCount.format("%d") + " pacer cues", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, 210, Graphics.FONT_XTINY, "review on dashboard", Graphics.TEXT_JUSTIFY_CENTER);
    }
}
