import Toybox.Lang;
import Toybox.Math;
import Toybox.Sensor;
import Toybox.Position;
import Toybox.Communications;
import Toybox.Attention;
import Toybox.Time;
import Toybox.System;
import Toybox.WatchUi;
import Toybox.ActivityRecording;
import Toybox.FitContributor;
import Toybox.Activity;

// The 8-sensor collector, Stillness Gate, Hybrid Physics Modulator, Tactile Pacer,
// FIT developer fields and the 1 Hz bidirectional FastAPI sync.
class Engine {
    var phase as String = "IDLE";       // IDLE -> PRIMER -> LIVE -> DONE
    var gate as String = "LISTENING";   // SPEAKING | LISTENING
    var phaseListener = null;            // Method(phase as String) as Void

    // Motion (25 Hz)
    hidden var _mag as Array = new [Config.ACCEL_WINDOW];
    hidden var _magIdx as Number = 0;
    hidden var _magCount as Number = 0;
    var realAccelVar as Float = 0.0;
    var accelVar as Float = 0.0;
    var hfEnergy as Float = 0.0;         // mean |d(mag)| -> fidget signal
    var gyroMag as Float = 0.0;
    var gyroJerk as Float = 0.0;
    var pitch as Float = 0.0;
    var roll as Float = 0.0;
    var fidget as Float = 0.0;

    // Physiology
    var hr = null;
    var rmssd = null;
    var spo2 = null;
    var temp = null;
    var heading = null;
    var magField = null;
    hidden var _rr as Array = [];
    var baselineHr as Float = Config.BASELINE_HR;
    hidden var _baseSum as Float = 0.0;
    hidden var _baseN as Number = 0;
    var composure as Float = 100.0;

    // GPS / calendar
    var lat = null;
    var lon = null;
    var distance = null;
    var calTitle as String = "Interview";
    var calLat as Float = Config.VENUE_LAT;
    var calLon as Float = Config.VENUE_LON;
    var calStart = null;

    // Stage state from FastAPI response
    var micSpeaking as Boolean = false;
    var stress as Float = 0.0;
    var geofenceOverride as Boolean = false;
    var serverOk as Boolean = false;
    hidden var _inFlight as Boolean = false;
    hidden var _sentAt as Number = 0;

    // Gate / pacer bookkeeping
    hidden var _stillSince = null;
    hidden var _peakHr as Float = 0.0;
    var pacerFired as Boolean = false;
    var pacerForced as Boolean = false;
    var pacerCount as Number = 0;
    var lastPacerMs as Number = -100000;
    var primerStart as Number = 0;
    var tick as Number = 0;

    // Hybrid physics (used when simulator sensors are null/static)
    hidden var _synHr as Float = Config.BASELINE_HR;
    hidden var _synRmssd as Float = 58.0;
    hidden var _synSpo2 as Float = 98.0;
    hidden var _synTemp as Float = 33.4;
    hidden var _synHeading as Float = 182.0;

    // FIT
    hidden var _session = null;
    hidden var _fComposure = null;
    hidden var _fFidget = null;

    function start() as Void {
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE, Sensor.SENSOR_PULSE_OXIMETRY, Sensor.SENSOR_TEMPERATURE]);
        Sensor.registerSensorDataListener(method(:onSensorData), {
            :period => 1,
            :accelerometer => { :enabled => true, :sampleRate => 25, :includePitch => true, :includeRoll => true },
            :gyroscope => { :enabled => true, :sampleRate => 25 },
            :heartBeatIntervals => { :enabled => true }
        });
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
    }

    function stop() as Void {
        Sensor.unregisterSensorDataListener();
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
        finishSession(true);
    }

    // ------------------------------------------------------------ 25 Hz batch (1/s)
    function onSensorData(data as Sensor.SensorData) as Void {
        var a = data.accelerometerData;
        if (a != null && a.x != null) {
            var xs = a.x; var ys = a.y; var zs = a.z;
            var prev = 0.0; var hf = 0.0;
            for (var i = 0; i < xs.size(); i++) {
                var m = Math.sqrt(xs[i] * xs[i] + ys[i] * ys[i] + zs[i] * zs[i]).toFloat();
                if (i > 0) { hf += (m - prev).abs(); }
                prev = m;
                _mag[_magIdx] = m;
                _magIdx = (_magIdx + 1) % Config.ACCEL_WINDOW;
                if (_magCount < Config.ACCEL_WINDOW) { _magCount++; }
            }
            hfEnergy = xs.size() > 1 ? hf / (xs.size() - 1) : 0.0;
            realAccelVar = variance();
            if (a.pitch != null && a.pitch.size() > 0) { pitch = a.pitch[a.pitch.size() - 1].toFloat(); }
            if (a.roll != null && a.roll.size() > 0) { roll = a.roll[a.roll.size() - 1].toFloat(); }
        }
        var g = data.gyroscopeData;
        if (g != null && g.x != null && g.x.size() > 0) {
            var sum = 0.0; var jerk = 0.0; var prevG = 0.0;
            for (var j = 0; j < g.x.size(); j++) {
                var w = Math.sqrt(g.x[j] * g.x[j] + g.y[j] * g.y[j] + g.z[j] * g.z[j]).toFloat();
                sum += w;
                if (j > 0) { jerk += (w - prevG).abs(); }
                prevG = w;
            }
            gyroMag = sum / g.x.size();
            gyroJerk = g.x.size() > 1 ? jerk / (g.x.size() - 1) : 0.0;
        }
        // HRV only trusted in the Listening (stillness) gate.
        var h = data.heartRateData;
        if (gate.equals("LISTENING") && h != null && h.heartBeatIntervals != null) {
            var ivs = h.heartBeatIntervals;
            for (var k = 0; k < ivs.size(); k++) {
                if (ivs[k] > 300 && ivs[k] < 2000) { _rr.add(ivs[k]); }
            }
            while (_rr.size() > 30) { _rr = _rr.slice(1, null); }
        }
    }

    hidden function variance() as Float {
        if (_magCount < 2) { return 0.0; }
        var s = 0.0; var s2 = 0.0;
        for (var i = 0; i < _magCount; i++) { s += _mag[i]; s2 += _mag[i] * _mag[i]; }
        var mean = s / _magCount;
        return (s2 / _magCount - mean * mean).toFloat();
    }

    hidden function computeRmssd() {
        if (_rr.size() < 5) { return null; }
        var acc = 0.0;
        for (var i = 1; i < _rr.size(); i++) {
            var d = (_rr[i] - _rr[i - 1]).toFloat();
            acc += d * d;
        }
        return Math.sqrt(acc / (_rr.size() - 1)).toFloat();
    }

    function onPosition(info as Position.Info) as Void {
        if (info.position != null) {
            var d = info.position.toDegrees();
            lat = d[0].toFloat(); lon = d[1].toFloat();
        }
    }

    // ------------------------------------------------------------ 1 Hz tick
    function onTick() as Void {
        tick++;
        var nowMs = System.getTimer();

        // 1 Hz Sensor.Info: HR, SpO2, temperature, compass
        var info = Sensor.getInfo();
        var rawHr = info.heartRate;
        var rawSpo2 = (info has :oxygenSaturation) ? info.oxygenSaturation : null;
        var rawTemp = info.temperature;
        var rawHeading = info.heading;
        magField = info.mag;

        if (lat == null) {
            var pinfo = Position.getInfo();
            if (pinfo.position != null) {
                var dd = pinfo.position.toDegrees();
                if (dd[0] != 0.0 || dd[1] != 0.0) { lat = dd[0].toFloat(); lon = dd[1].toFloat(); }
            }
        }

        stepPhysics();

        // Hybrid modulator: live sensor where available, envelope where null/static.
        hr = rawHr != null ? rawHr + (_synHr - Config.BASELINE_HR) : _synHr;
        var realRm = computeRmssd();
        rmssd = realRm != null ? realRm : _synRmssd;
        spo2 = rawSpo2 != null ? rawSpo2 - (98.0 - _synSpo2) : _synSpo2;
        temp = rawTemp != null ? rawTemp + (_synTemp - 33.4) : _synTemp;
        heading = rawHeading != null ? Math.toDegrees(rawHeading) : _synHeading;

        // Effective motion variance: real accel, or mic-driven envelope from FastAPI.
        accelVar = realAccelVar;
        if (micSpeaking) {
            var synVar = 3200.0 + 2600.0 * stress + Rnd.range(-600.0, 900.0);
            if (synVar > accelVar) {
                accelVar = synVar;
                gyroMag = 55.0 + 90.0 * stress + Rnd.range(-15.0, 25.0);
                gyroJerk = 8.0 + 30.0 * stress * Rnd.range(0.5, 1.0);
                pitch = -12.0 + 18.0 * Math.sin(tick / 2.3) + Rnd.range(-3.0, 3.0);
                roll = 8.0 + 25.0 * Math.sin(tick / 1.7) + Rnd.range(-3.0, 3.0);
            }
        }
        var fidgetRaw = (hfEnergy / 4.0) + (gyroJerk * 1.2) + (micSpeaking ? 25.0 + 60.0 * stress : 6.0 + 25.0 * stress * Rnd.range(0.0, 1.0));
        fidget = fidgetRaw > 100.0 ? 100.0 : fidgetRaw;

        updateGate(nowMs);
        updatePhase();

        if (phase.equals("PRIMER")) { primerBreathCue(); }
        if (phase.equals("IDLE") || phase.equals("PRIMER")) {
            if (gate.equals("LISTENING") && _baseN < 60) { _baseSum += hr; _baseN++; baselineHr = _baseSum / _baseN; }
        }

        var c = 100.0 - 0.9 * max0(hr - baselineHr) - 0.35 * fidget - 4.0 * max0(97.5 - spo2) + 0.25 * (rmssd - 40.0);
        composure = c < 0.0 ? 0.0 : (c > 100.0 ? 100.0 : c);

        if (_session != null) {
            _fComposure.setData(composure);
            _fFidget.setData(fidget);
        }

        sync();
        WatchUi.requestUpdate();
    }

    hidden function max0(v as Float) as Float { return v > 0.0 ? v : 0.0; }

    hidden function approach(cur as Float, target as Float, rate as Float) as Float {
        return cur + (target - cur) * rate;
    }

    hidden function stepPhysics() as Void {
        var speakingF = micSpeaking ? 1.0 : 0.0;
        var primer = phase.equals("PRIMER");
        var hrT = Config.BASELINE_HR + 28.0 * stress + 7.0 * speakingF + (primer ? 6.0 : 0.0);
        _synHr = approach(_synHr, hrT, 0.18) + Rnd.range(-0.8, 0.8);
        var rmT = 62.0 - 34.0 * stress - 8.0 * speakingF;
        if (primer) {
            var el = (System.getTimer() - primerStart) / 3000.0;
            rmT += el > 20.0 ? 20.0 : el;
        }
        _synRmssd = approach(_synRmssd, rmT, 0.12) + Rnd.range(-1.5, 1.5);
        var spT = 98.0 - (micSpeaking ? 0.6 * stress : 2.6 * stress);
        _synSpo2 = approach(_synSpo2, spT, 0.15);
        var tT = 33.6 - 1.8 * stress - (primer && tick < 40 ? 0.9 : 0.0);
        _synTemp = approach(_synTemp, tT, 0.04);
        var swivel = micSpeaking ? 1.0 : (1.0 + 12.0 * stress);
        _synHeading = _synHeading + Rnd.range(-1.0, 1.0) * swivel;
        if (_synHeading < 0) { _synHeading += 360.0; }
        if (_synHeading >= 360) { _synHeading -= 360.0; }
    }

    // ------------------------------------------------------------ Stillness Gate
    hidden function updateGate(nowMs as Number) as Void {
        if (accelVar > Config.SPEAK_VAR_THRESHOLD) {
            if (!gate.equals("SPEAKING")) { _peakHr = hr; _rr = []; }
            gate = "SPEAKING";
            _stillSince = null;
            if (hr > _peakHr) { _peakHr = hr; }
            return;
        }
        if (_stillSince == null) { _stillSince = nowMs; }
        if (gate.equals("SPEAKING") && nowMs - _stillSince >= Config.LISTEN_HOLD_MS) {
            gate = "LISTENING";
            if (_peakHr - baselineHr > Config.PACER_HR_DELTA && phase.equals("LIVE")) {
                firePacer();
            }
        }
    }

    // Two ultra-soft pulses 1 s apart (60 BPM). Never fires while speaking.
    function firePacer() as Void {
        if (gate.equals("SPEAKING")) { return; }
        if (Attention has :vibrate) {
            Attention.vibrate([
                new Attention.VibeProfile(25, 400),
                new Attention.VibeProfile(0, 600),
                new Attention.VibeProfile(25, 400)
            ]);
        }
        pacerFired = true;
        pacerCount++;
        lastPacerMs = System.getTimer();
    }

    function forcePacer() as Void {
        pacerForced = true;
        gate = "LISTENING";
        _stillSince = System.getTimer();
        firePacer();
    }

    // Physiological sigh: inhale, top-up inhale, long exhale (10 s cycle).
    hidden function primerBreathCue() as Void {
        if (!(Attention has :vibrate)) { return; }
        var s = primerElapsedS() % 10;
        if (s == 0 || s == 2) {
            Attention.vibrate([new Attention.VibeProfile(40, 180)]);
        } else if (s == 3) {
            Attention.vibrate([new Attention.VibeProfile(12, 2500)]);
        }
    }

    function primerElapsedS() as Number {
        return (System.getTimer() - primerStart) / 1000;
    }

    // ------------------------------------------------------------ Phase machine
    hidden function updatePhase() as Void {
        if (lat != null && lon != null) {
            distance = Geo.haversine(lat, lon, calLat, calLon);
        }
        if (phase.equals("IDLE")) {
            var inFence = distance != null && distance < Config.GEOFENCE_M;
            var inWindow = true;
            if (calStart != null) {
                var delta = calStart - Time.now().value();
                inWindow = delta <= Config.PRIMER_LEAD_S && delta > -3600;
            }
            if ((inFence && inWindow) || geofenceOverride) {
                setPhase("PRIMER");
            } else if (micSpeaking) {
                setPhase("LIVE");
            }
        } else if (phase.equals("PRIMER")) {
            var el = primerElapsedS();
            if (el >= Config.PRIMER_MAX_S || (el >= 20 && rmssd != null && rmssd >= 55.0) || micSpeaking) {
                setPhase("LIVE");
            }
        }
    }

    function setPhase(p as String) as Void {
        if (p.equals(phase)) { return; }
        phase = p;
        if (p.equals("PRIMER")) { primerStart = System.getTimer(); }
        if (p.equals("LIVE")) { startSession(); }
        if (p.equals("DONE")) { finishSession(true); }
        if (phaseListener != null) { phaseListener.invoke(p); }
    }

    // ------------------------------------------------------------ FIT recording
    hidden function startSession() as Void {
        if (_session != null || !(Toybox has :ActivityRecording)) { return; }
        _session = ActivityRecording.createSession({ :name => "ComposureIQ", :sport => Activity.SPORT_GENERIC });
        _fComposure = _session.createField("composure_index", 0, FitContributor.DATA_TYPE_FLOAT,
            { :mesgType => FitContributor.MESG_TYPE_RECORD, :units => "pts" });
        _fFidget = _session.createField("fidget_index", 1, FitContributor.DATA_TYPE_FLOAT,
            { :mesgType => FitContributor.MESG_TYPE_RECORD, :units => "pts" });
        _session.start();
    }

    function finishSession(save as Boolean) as Void {
        if (_session == null) { return; }
        if (_session.isRecording()) { _session.stop(); }
        if (save) { _session.save(); } else { _session.discard(); }
        _session = null;
    }

    hidden function stillMs(nowMs as Number) as Number {
        var ss = _stillSince;
        if (ss == null) { return 0; }
        return nowMs - (ss as Number);
    }

    // ------------------------------------------------------------ 1 Hz FastAPI sync
    hidden function sync() as Void {
        var nowMs = System.getTimer();
        if (_inFlight && nowMs - _sentAt < 4000) { return; }
        _inFlight = true;
        _sentAt = nowMs;

        var p = {
            "source" => "watch",
            "phase" => phase,
            "gate" => gate,
            "accel_var" => accelVar,
            "gyro_mag" => gyroMag,
            "pitch" => pitch,
            "roll" => roll,
            "fidget_index" => fidget,
            "composure_index" => composure,
            "pacer_fired" => pacerFired,  // latched until sent
            "pacer_forced" => pacerForced,
            "baseline_hr" => baselineHr,
            "peak_hr" => _peakHr,
            "still_ms" => stillMs(nowMs),
            "hr" => hr,
            "temp" => temp
        };
        // Optical / orientation sensors only reported while still.
        if (gate.equals("LISTENING")) {
            if (rmssd != null) { p["rmssd"] = rmssd; }
            if (spo2 != null) { p["spo2"] = spo2; }
            if (heading != null) { p["heading"] = heading; }
        }
        if (lat != null) { p["lat"] = lat; p["lon"] = lon; }
        if (distance != null) { p["distance_m"] = distance; }

        Communications.makeWebRequest(Config.TELEMETRY_URL, p, {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        }, method(:onResponse));
        pacerFired = false;
        pacerForced = false;
    }

    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        _inFlight = false;
        serverOk = (code == 200);
        if (!serverOk) { System.println("sync code " + code); }
        if (!serverOk || !(data instanceof Dictionary)) { return; }
        var ms = data["mic_speaking"];
        micSpeaking = ms != null && ms;
        var st = data["stress_modulator"];
        stress = st != null ? st.toFloat() : 0.0;
        var go = data["geofence_override"];
        geofenceOverride = go != null && go;
        var fp = data["force_pacer"];
        if (fp != null && fp) { forcePacer(); }
        var ev = data["calendar_event"];
        if (ev instanceof Dictionary) {
            if (ev["title"] != null) { calTitle = ev["title"]; }
            if (ev["lat"] != null) { calLat = ev["lat"].toFloat(); }
            if (ev["lon"] != null) { calLon = ev["lon"].toFloat(); }
            if (ev["start_epoch"] != null) { calStart = ev["start_epoch"].toNumber(); }
        }
    }
}
