// Chart palette — one blue, neutrals, and a single warm alert colour.
export const C = {
  accent: '#2f5d8a',
  accentSoft: '#e6eef6',
  ink: '#1e2a36',
  muted: '#66707c',
  faint: '#9aa1aa',
  line: '#e7e2d8',
  grid: '#efebe3',
  alert: '#b04a3f',
  note: '#c08a2e',
}

// What each reading means. `what` = the measurement, `why` = how ComposureIQ uses it.
export const INFO = {
  hr: {
    title: 'Heart Rate',
    what: 'Beats per minute from the optical sensor, sampled once a second.',
    why: 'A jump of more than 15 bpm over your baseline while answering is what triggers the listening pacer.',
    good: 'Calm: within ~10 bpm of baseline',
  },
  rmssd: {
    title: 'Heart Rate Variability (RMSSD)',
    what: 'Variation between consecutive heartbeats, in milliseconds. Only measured while your wrist is still.',
    why: 'Higher means your nervous system is in "rest" mode. It drops when you are stressed and recovers as you settle.',
    good: 'Calm: above ~50 ms',
  },
  spo2: {
    title: 'Blood Oxygen (SpO₂)',
    what: 'Percentage of oxygen in your blood. Only measured while still, since movement corrupts the reading.',
    why: 'A dip while you are thinking can mean you are holding your breath ("speaker\'s apnea").',
    good: 'Normal: 96–100%',
  },
  temp: {
    title: 'Skin Temperature',
    what: 'Temperature at the wrist in °C.',
    why: 'Stress pulls blood away from your hands, so cold hands before an interview are a sign of anxiety. The primer helps them warm back up.',
    good: 'Relaxed: rising or steady',
  },
  accel_var: {
    title: 'Motion Variance (Accelerometer)',
    what: 'How much your wrist is moving, from 25 readings a second over the last 3 seconds. Pitch and roll show wrist angle.',
    why: 'Above the dashed line you are gesturing (Speaking). Below it for 2.5 s you are still (Listening). This decides when the pacer may vibrate.',
    good: 'Threshold: 2,500 mg²',
  },
  gyro_mag: {
    title: 'Rotation Speed (Gyroscope)',
    what: 'How fast your wrist is turning, in degrees per second, across all three axes.',
    why: 'Smooth, steady values are calm open-hand gestures. Sudden spikes are nervous flicks or face-touching.',
    good: 'Calm gestures: smooth curve, no sharp spikes',
  },
  heading: {
    title: 'Compass Heading',
    what: 'Which direction your wrist and torso face, in degrees. Only measured while still.',
    why: 'Drifting back and forth while you listen suggests chair-swiveling or restless posture.',
    good: 'Settled: within a few degrees',
  },
  distance_m: {
    title: 'Distance to Venue (GPS)',
    what: 'Straight-line distance from you to the interview location from the calendar event.',
    why: 'Inside 100 m (dashed line) and within 15 minutes of the start time, the watch begins the waiting-room breathing primer.',
    good: 'Primer starts below 100 m',
  },
  fidget_index: {
    title: 'Fidget Index',
    what: 'A 0–100 score combining fast jittery wrist movement and gyroscope jerk.',
    why: 'Shows nervous energy separately from normal talking gestures. Saved to the watch\'s .FIT file.',
    good: 'Calm: under ~30',
  },
  composure_index: {
    title: 'Composure Index',
    what: 'A 0–100 score combining heart rate above baseline, fidgeting, oxygen dips and HRV.',
    why: 'One number for how composed you are right now. Saved every second to the watch\'s .FIT file.',
    good: 'Composed: 70 and above',
  },
}

// The 8-sensor matrix.
export const SENSORS = [
  { key: 'hr', name: 'Heart Rate', sub: '1 Hz', unit: 'bpm', digits: 0, domain: [55, 115] },
  { key: 'rmssd', name: 'HRV', sub: 'RMSSD · when still', unit: 'ms', digits: 0, domain: [10, 90] },
  { key: 'spo2', name: 'Pulse Ox', sub: 'when still', unit: '%', digits: 1, domain: [93, 100] },
  { key: 'temp', name: 'Skin Temp', sub: 'wrist', unit: '°C', digits: 1, domain: [30, 35] },
  { key: 'accel_var', name: 'Motion', sub: 'accel σ² · 25 Hz', unit: 'mg²', digits: 0, domain: [0, 8000], threshold: 2500 },
  { key: 'gyro_mag', name: 'Rotation', sub: 'gyro · 25 Hz', unit: '°/s', digits: 0, domain: [0, 200] },
  { key: 'heading', name: 'Compass', sub: 'when still', unit: '°', digits: 0, domain: [120, 240] },
  { key: 'distance_m', name: 'Venue Distance', sub: 'GPS geofence', unit: 'm', digits: 0, domain: [0, 500], threshold: 100 },
]

/** Last non-null value of a key. */
export const last = (rows, key) => {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return rows[i][key]
  return null
}

/** Contiguous speaking segments [{x1, x2}] for timeline shading. */
export function speakingSegments(rows) {
  const out = []
  let start = null
  for (const r of rows) {
    if (r.gate === 'SPEAKING' && start == null) start = r.t
    if (r.gate !== 'SPEAKING' && start != null) { out.push({ x1: start, x2: r.t }); start = null }
  }
  if (start != null && rows.length) out.push({ x1: start, x2: rows[rows.length - 1].t })
  return out
}
