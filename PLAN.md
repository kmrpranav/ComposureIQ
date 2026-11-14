# ComposureIQ — Hackathon Architecture & Execution Plan

### Section 1: Product Vision & Architecture ("ComposureIQ")

**The Pitch:** High-stakes communication—technical interviews, executive board pitches, and salary negotiations—triggers an evolutionary fight-or-flight response that sabotages performance: vocal rushing, "speaker's apnea" (shallow breath-holding), nervous micro-fidgeting, and peripheral vasoconstriction (cold hands). Standard wearables make this worse by flashing alarming red heart-rate alerts mid-sentence.

**ComposureIQ** is a context-aware **Garmin Fenix 7 Pro (API Level 5.2)** Connect IQ Watch App (`watch-app`) + Full-Stack Bio-Coach that automatically activates when you arrive at an interview or pitch venue, guides a pre-event physiological primer, delivers **sub-perceptual haptic pacing only during listening pauses**, and records synchronized **8-sensor biometric telemetry** onto an interactive post-interview flight recorder.

```
[1. CONTEXT TRIGGER]
Mocked Calendar Event (FastAPI) + Watch GPS Haversine Geofence (Toybox.Position < 100m)
       │
       ▼
[2. GARMIN EDGE ENGINE — Fenix 7 Pro (Monkey C, API Level 5.2, Watch App)]
  ├─ Speaking State (Motion Gate Open): 25Hz Accel (Pitch/Roll) + 25Hz 3-Axis Gyro + 1Hz HR
  ├─ Listening State (Stillness Gate): Pulse Ox + HRV (R-R RMSSD) + Skin Temp + Compass
  ├─ Tactile Pacer: Gentle 60-BPM pulse ONLY at start of Listening State after HR spike
  └─ Native Telemetry: FitContributor writes "Composure Index" & "Fidget Index" to .FIT file
       │  ▲
       │  │ Bidirectional 1Hz Sync (Communications.makeWebRequest every 1s to 127.0.0.1:8000)
       │  └─ Response: { mic_speaking, stress_modulator, geofence_override, calendar_event }
       ▼
[3. FULL-STACK EVENT SPINE (Python FastAPI + React + Vite + Tailwind)]
  ├─ FastAPI 1Hz Telemetry Ingestion + Real-Time WebSocket Broadcast
  ├─ Hybrid Simulator Physics Modulator (Live Browser Mic + Judge Controls -> Watch Gate State)
  └─ Post-Interview "Flight Recorder" Timeline (correlates transcript question spikes with 8 sensors)
```

---

### Section 2: The 8-Sensor Hardware Matrix (Fenix 7 Pro — API Level 5.2)

Every sensor has a hardware-accurate role governed by an on-watch **Stillness Gate** (so optical and orientation sensors are only trusted when motion noise is near zero):

| # | Garmin Sensor | Monkey C API (`fenix7pro`, API 5.2) | Hardware-Accurate Role in ComposureIQ |
| --- | --- | --- | --- |
| **1** | **GPS** | `Toybox.Position` (`Position.getInfo().position`) | Computes Haversine distance against upcoming Calendar event coordinates (e.g., Platform Calgary `51.0447° N, -114.0719° W`) to auto-launch **Pre-Interview Primer Mode** within a 100m geofence 15 minutes prior. |
| **2** | **Skin / Internal Temp** | `Sensor.Info.temperature` | Detects pre-interview peripheral vasoconstriction ("cold hands" sympathetic spike) during the waiting-room phase and verifies warm-up recovery. |
| **3** | **25Hz Accelerometer (with Pitch/Roll)** | `SensorData.accelerometerData` (`:sampleRate => 25`, `:includePitch => true`, `:includeRoll => true`) | Computes a 3-second rolling **Motion Variance ($\sigma^2_{\text{accel}}$)** to toggle the **Speaking vs. Listening Stillness Gate**, detects high-frequency nervous fidgeting, and tracks wrist inclination (pitch/roll). |
| **4** | **25Hz 3-Axis Gyroscope** | `SensorData.gyroscopeData` (`:gyroscope => {:enabled => true, :sampleRate => 25}`) | Measures angular velocity ($\omega_x, \omega_y, \omega_z$ in deg/s) to differentiate smooth, grounded open-palm speaking gestures from erratic, defensive wrist flicks or face-touching. |
| **5** | **Heart Rate (1Hz)** | `Sensor.Info.heartRate` | Tracks acute cardiovascular spikes during tough behavioral/technical questions and measures heart-rate recovery slope afterward. |
| **6** | **HRV (Beat-to-Beat R-R)** | `SensorData.heartRateData.heartBeatIntervals` (`:heartRateIntervals => {:enabled => true}`) | Sampled strictly during the **Listening Gate** (stillness) to compute rolling **RMSSD (ms)** and measure vagal tone recovery between answers. |
| **7** | **Pulse Ox ($\text{SpO}_2$)** | `Sensor.Info.oxygenSaturation` | Sampled during stillness to catch "speaker's apnea" (shallow breath-holding while formulating technical answers). |
| **8** | **Compass / Magnetometer** | `Sensor.Info.heading` & `Sensor.Info.mag` | Sampled during stillness to track torso/posture orientation stability and detect nervous chair-swiveling across the interview table. |

---

### Section 3: Data Flow & The Sub-Perceptual UX State Machine

To nail the **User Experience & Design (0–5)** criterion, the Fenix 7 Pro Watch App operates in three phases without ever distracting the user with alarming red text:

1. **Phase 1: Waiting Room Primer (T-minus 15 mins, GPS Geofence Triggered):**
   * Watch receives upcoming Calendar event metadata from FastAPI and verifies arrival inside the 100m venue geofence via `Position.getInfo()`.
   * Reads baseline **Skin Temperature**, **HRV (RMSSD)**, and **Pulse Ox ($\text{SpO}_2$)**. If sympathetic stress is elevated, the watch guides a 90-second physiological sigh (double inhale, long exhale) using rhythmic wrist vibrations until HRV stabilizes.

2. **Phase 2: Live Interview / Pitch Mode ("Stealth Analog + Tactile Pacer"):**
   * **Stealth Analog View:** Inside the Connect IQ Watch App, `WatchUi.switchToView()` transitions the screen to a dim, minimalist analog watch face so an interviewer across the table never sees glowing biometric charts.
   * **Speaking State ($\sigma^2_{\text{accel}} > \text{threshold}$):** Watch silently logs gesture angular smoothness (25Hz Gyro), fidget index (25Hz Accel variance + Pitch/Roll), and HR peak. **Zero vibrations are permitted while speaking.**
   * **Transition to Listening State ($\sigma^2_{\text{accel}} < \text{threshold}$ for 2.5s):** The moment you finish speaking and fold your hands to listen, if your HR spiked $>15\text{ BPM}$ above baseline during your answer, the watch fires **two ultra-soft, low-duty-cycle pulses (`Attention.VibeProfile(25, 400)`)** spaced 1 second apart (60 BPM cadence). This acts as an unobtrusive tactile cue to drop your shoulders and take one slow nasal breath while the interviewer speaks.

3. **Phase 3: Post-Interview Flight Recorder Timeline (React Dashboard):**
   * On the React dashboard, the user reviews a single-session synchronized Flight Recorder timeline of the interview or pitch: live Web Audio waveform + Web Speech API transcript & question markers overlaid with all 8 sensor streams.
   * **Automated Spike Correlation Callouts:** The backend automatically flags peak stress windows and correlates them with the transcript—highlighting exact moments like: *"At 02:15 ('Tell me about a time a production deployment failed'), Fidget Index rose 65%, Gyro Angular Jerk spiked 2.4x, and $\text{SpO}_2$ dipped 2%."*

---

### Section 4: Error Handling, Fallbacks & The 2-Minute Split-Screen Stage Demo

Running exclusively in the **Connect IQ Simulator (Fenix 7 Pro, API 5.2)** + **Local FastAPI/React Stack** on the presentation laptop eliminates BLE dropouts and venue Wi-Fi failures while keeping real Monkey C sensor pipelines executing live:

* **1Hz Bidirectional Simulator-to-Backend Loop (`http://127.0.0.1:8000/api/telemetry`):**
  * With `Use Device HTTPS Requirements` disabled in the Connect IQ Simulator, the Watch App posts its 8-sensor JSON payload every **1 second (1Hz)**.
  * The HTTP response body from FastAPI returns live stage state (`mic_speaking`, `stress_modulator`, `geofence_override`, `calendar_event`).
* **Hybrid Simulator Physics Modulator (Live Microphone $\rightarrow$ Watch Gate Sync):**
  * When a teammate speaks into the laptop microphone on stage (detected via browser Web Audio / Web Speech API), FastAPI sets `mic_speaking: true` in the 1Hz response to the Watch Simulator.
  * When `Sensor.Info` fields (`oxygenSaturation`, `temperature`, or `heartBeatIntervals`) return `null` or static values in the Simulator, the Watch App's deterministic Physics Modulator combines live Simulator sensor inputs with the `mic_speaking` / `stress_modulator` envelope—automatically opening the **25Hz Speaking Gate** while the presenter talks, climbing HR during tough questions, and dropping into the **Listening Stillness Gate** 2.5 seconds after they stop speaking so `Attention.vibrate` fires right on cue.
* **Dual Stage Overrides (Watch `Menu2` + React Presenter Bar):**
  * Both a 3-item hardware debug menu on the watch (`Menu2`: *Simulate Venue Arrival*, *Trigger High-Stress Question*, *Force Listening Pacer*) and a discrete Presenter Control Bar on the React UI allow instant manual state transitions on stage.
* **Split-Screen Big-Screen Demo Layout (Execution & Deployment 5/5):**
  * **Left 30% of Projector:** Connect IQ Simulator showing the Fenix 7 Pro transitioning from Waiting Room Primer $\rightarrow$ Stealth Analog Face $\rightarrow$ firing the 60-BPM Listening Gate haptic pulse.
  * **Right 70% of Projector:** React Flight Recorder streaming the live voice transcript alongside the 8-sensor telemetry curves and real-time spike correlation callouts as a teammate answers a live "tough interview question" from the judges.

---

### Section 5: 8-Hour Hackathon Execution Schedule (3-Person Team)

**Team Roster:**
* **Person 1 (Garmin Monkey C Engineer):** Fenix 7 Pro Watch App (`API 5.2`), 8-Sensor collector, 25Hz Motion Variance Stillness Gate, Haversine Geofence math, Tactile Pacer, `FitContributor`, Stealth Analog View + `Menu2`.
* **Person 2 (Backend & Simulator Bridge Engineer):** Python FastAPI server, 1Hz bidirectional `/api/telemetry` endpoint, WebSocket broadcaster, Mocked Calendar Geofence service, Hybrid Simulator Physics Modulator, and Spike Correlation detector.
* **Person 3 (React Flight Recorder & Audio/Transcript Engineer):** React + Vite + Tailwind dashboard, Web Speech API live transcript + Web Audio mic activity detector, synchronized 8-sensor Flight Recorder charts, and Presenter Stage Control bar.

#### Day-Of 8-Hour Execution Schedule

* **Hour 0:00 – 1:00 (Lock 1Hz Bidirectional Contract & Local Plumbing):**
  * **All:** Lock the JSON request/response schema for `POST http://127.0.0.1:8000/api/telemetry` and WebSocket broadcast payload.
  * **Person 1:** Initialize `fenix7pro` (API 5.2) Watch App project, disable Simulator HTTPS requirement, and verify a 1Hz `Communications.makeWebRequest` loop hits local FastAPI.
  * **Person 2:** Stand up FastAPI with `/api/telemetry` (HTTP POST) and `/ws/flight-recorder` (WebSocket) and verify end-to-end echo to React.
  * **Person 3:** Scaffold the Vite + React + Tailwind split-screen layout and wire up the live WebSocket consumer.

* **Hour 1:00 – 3:30 (Core 8-Sensor Engine, Physics Modulator & Live Audio Spine):**
  * **Person 1:** Implement `Sensor.registerSensorDataListener` (25Hz Accel with `:includePitch`/`:includeRoll`, 25Hz 3-Axis Gyro, R-R `heartRateIntervals` RMSSD) + 1Hz `Sensor.getInfo()` (`heartRate`, `oxygenSaturation`, `temperature`, `heading`/`mag`) + Hybrid Simulator fallback math and `Attention.VibeProfile(25, 400)` Listening-Gate trigger.
  * **Person 2:** Build the Mock Calendar Event provider (`Platform Calgary` coords), state transition tracker (`WAITING_ROOM` $\rightarrow$ `SPEAKING` $\rightarrow$ `LISTENING_PACER` $\rightarrow$ `SUMMARY`), and the Hybrid Physics Modulator that translates browser `mic_speaking` + stress state into the 1Hz watch response.
  * **Person 3:** Build the Web Speech API + Web Audio API microphone analyzer (streaming live transcript words + voice-activity boolean to FastAPI) and the live 8-sensor telemetry strip charts.

* **Hour 3:30 – 5:30 (Stealth Watch Views, `FitContributor` & Flight Recorder Spike Correlation):**
  * **Person 1:** Build the Haversine GPS geofence checker (`Toybox.Position`), Waiting Room Primer breath-pacing view, custom `Dc` **Stealth Analog Watch View**, Watch `Menu2` stage override menu, and `FitContributor` developer fields (`composure_index`, `fidget_index`).
  * **Person 2:** Build the automated **Spike Correlation Engine** that joins transcript question timestamps with 8-sensor anomalies (HR $> +15\text{ BPM}$, Accel/Gyro fidget bursts, $\text{SpO}_2$ dips) and emits structured Flight Recorder callout events.
  * **Person 3:** Build the interactive **Post-Interview Flight Recorder Timeline** (clickable transcript markers synced to multi-sensor zoom windows, Spike Correlation cards, and the Presenter Stage Override bar).

* **Hour 5:30 – 7:00 (End-to-End Split-Screen Integration & Stress Testing):**
  * **All:** Run full end-to-end loops on the presentation laptop: click "Simulate Venue Arrival" $\rightarrow$ complete Waiting Room Primer $\rightarrow$ switch to Stealth Analog mode $\rightarrow$ ask a live interview question into the laptop mic $\rightarrow$ verify Speaking Gate opens $\rightarrow$ pause for 2.5s $\rightarrow$ verify 60-BPM haptic pulse fires on the Simulator and logs a synchronized event on the Flight Recorder timeline.

* **Hour 7:00 – 8:00 (Demo Polish & 2-Minute Live Meta-Pitch Rehearsal):**
  * **All:** Lock window sizing for the 30/70 Split-Screen projector layout (Fenix 7 Pro Simulator beside React Flight Recorder), rehearse the 2-minute live judge Q&A demonstration, and verify instant fallback buttons on both Watch `Menu2` and the React Presenter Bar.
