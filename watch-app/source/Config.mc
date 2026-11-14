import Toybox.Lang;
import Toybox.Math;

module Config {
    // Simulator -> laptop FastAPI. Disable "Use Device HTTPS Requirements" in the simulator.
    const TELEMETRY_URL = "http://127.0.0.1:8000/api/telemetry";

    const ACCEL_WINDOW = 75;              // 3 s @ 25 Hz
    const SPEAK_VAR_THRESHOLD = 2500.0;   // mg^2 (keep in sync with backend/physics.py)
    const LISTEN_HOLD_MS = 2500;          // stillness required before Listening gate
    const PACER_HR_DELTA = 15.0;          // BPM above baseline during answer -> pacer
    const GEOFENCE_M = 100.0;
    const PRIMER_LEAD_S = 900;            // 15 min before event
    const PRIMER_MAX_S = 90;
    const BASELINE_HR = 72.0;

    // Platform Calgary default (overwritten by the calendar event from FastAPI)
    const VENUE_LAT = 51.0447;
    const VENUE_LON = -114.0719;
}

module Geo {
    // Great-circle distance in metres.
    function haversine(lat1 as Float, lon1 as Float, lat2 as Float, lon2 as Float) as Float {
        var r = 6371000.0;
        var p1 = Math.toRadians(lat1);
        var p2 = Math.toRadians(lat2);
        var dp = p2 - p1;
        var dl = Math.toRadians(lon2 - lon1);
        var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
                Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return (2 * r * Math.asin(Math.sqrt(a))).toFloat();
    }
}

module Rnd {
    function range(a as Float, b as Float) as Float {
        return a + (b - a) * ((Math.rand() % 10000) / 10000.0);
    }
}
