# ComposureIQ

Context-aware Garmin Fenix 7 Pro (API 5.2) watch app + FastAPI event spine + React flight recorder.

```
watch-app/   Monkey C watch-app (8-sensor engine, stillness gate, tactile pacer, FIT fields, Menu2)
backend/     FastAPI: /api/telemetry (1 Hz bidirectional), WebSocket, physics modulator, spike correlation
dashboard/   Vite + React + Tailwind flight recorder, Web Audio VAD, Web Speech transcript, presenter bar
```

## Run it

```bash
# 1. Backend
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000

# 2. Dashboard (Chrome — Web Speech API)
cd dashboard && npm install && npm run dev      # http://localhost:5173

# 3. Watch: build, start the simulator, load the app
./watch-app/run-sim.sh              # or: ./watch-app/run-sim.sh build
```

`run-sim.sh` finds the SDK that the Garmin SDK Manager marked as current, so `monkeyc`, `connectiq` and `monkeydo` don't need to be on your `PATH`. It signs with `~/.connectiq/developer_key.der` and generates that key on first run. Override either with `CIQ_SDK=…` or `CIQ_KEY=…`. Keys are git-ignored; never commit them.

In the simulator: **Settings → uncheck "Use Device HTTPS Requirements"**, or the 1 Hz POST to `127.0.0.1:8000` is blocked. The setting resets each time the simulator starts. The symptom is sneaky: the backend logs `200 OK` and the dashboard shows `source: watch`, but the watch prints `sync code -1001` and ignores every reply, so venue arrival and the mic never move it out of IDLE.

If no watch has posted for 3 s, the backend runs the same physics model itself (`source: backend-sim`). The dashboard header badge shows which source is live, so the demo still works without the simulator.

## 1 Hz contract

`POST /api/telemetry` (watch → spine)
```json
{ "source":"watch", "phase":"IDLE|PRIMER|LIVE|DONE", "gate":"SPEAKING|LISTENING",
  "hr":84.1, "temp":32.9, "accel_var":3120, "gyro_mag":71, "pitch":-10, "roll":14,
  "fidget_index":41, "composure_index":72, "pacer_fired":false,
  "rmssd":38, "spo2":96.8, "heading":181,          // only sent in LISTENING gate
  "lat":51.0449, "lon":-114.0719, "distance_m":22 }
```
Response (spine → watch)
```json
{ "mic_speaking":true, "stress_modulator":0.75, "geofence_override":false, "force_pacer":false,
  "calendar_event":{ "title":"…", "lat":51.0447, "lon":-114.0719, "radius_m":100, "start_epoch":1794680000 } }
```
Browser → spine: `POST /api/mic {speaking, level}`, `POST /api/transcript {text, final}`,
`POST /api/control {action: venue_arrival|stress_question|force_pacer|calm|reset}`.
WebSocket `/ws/flight-recorder` broadcasts `telemetry | transcript | interim | callout | event | stage | reset`.

## How the pieces behave

- **Stillness gate.** 3 s rolling variance of 25 Hz accel magnitude (mg²). Above 2500 means *Speaking*. Below it for 2.5 s means *Listening*. While the simulator's accelerometer is still, the backend's `mic_speaking` flag drives an equivalent variance envelope.
- **Pacer.** Fires on the switch to Listening if HR peaked more than 15 BPM over baseline during the answer: `VibeProfile(25,400)`, then 600 ms off, then `VibeProfile(25,400)`. It never fires while speaking.
- **Hybrid modulator.** When a `Sensor.Info` field is null (SpO₂, temperature, HR, R-R), the watch uses the stress/mic envelope instead. When the field is present, the envelope is added on top of the real value.
- **Primer.** Starts inside the 100 m Haversine geofence, within 15 min of the event, or on override. It runs a 10 s physiological-sigh haptic cycle and moves to Live after 90 s, after RMSSD ≥ 55 ms (after 20 s), or as soon as you speak.
- **FIT.** `composure_index` and `fidget_index` developer fields are written once a second during Live. Back or *Finish & Save* writes the .FIT file.
- **Spike correlation.** 18 s after each detected question (a trailing `?` or a leading interrogative word), the backend compares that window with the 30 s before it (ΔHR, fidget %, gyro jerk ratio, SpO₂ dip, RMSSD drop) and posts a callout.

## Stage overrides

- Watch: hold **UP/MENU** to open the `Menu2` with Venue Arrival / High-Stress Q / Listening Pacer / Finish & Save. **START** skips the primer.
- Dashboard presenter bar: 📍 Venue arrival · ⚡ High-stress Q · 〰 Force pacer · Calm · Reset.
- Click a transcript line, callout, or chart point to zoom the flight recorder to that moment.

## Demo script (2 min)

1. Press **Start mic**, then **📍 Venue arrival**. The watch moves to the Primer view (breathing circle and haptic sigh).
2. Start speaking, or press START on the watch. It switches to the dim Stealth Analog face.
3. A judge asks a tough question into the mic. Its transcript line is flagged **Q** and stress rises.
4. Answer it. The Speaking gate opens and the HR, fidget and gyro curves climb.
5. Stop talking. 2.5 s later the Listening gate closes and the pacer fires (cyan line on the dashboard, two soft pulses on the watch).
6. About 18 s after the question, the Spike Correlation card appears. Click it to zoom the recorder to that moment.
