// Chart palette — one blue, neutrals, muted green, and a single warm alert colour.
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
  good: '#3f8a5a',
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
  fidget_index: {
    title: 'Fidget Index · 0–100, lower is better',
    what: 'How much nervous, jittery movement your wrist is making: quick twitches, flicks and fiddling. Smooth talking gestures barely count.',
    why: 'Built from high-frequency accelerometer jitter plus sudden gyroscope jerks across your session.',
    good: 'Green under 25 · amber 25–55 · red above 55',
  },
  composure_index: {
    title: 'Composure Index · 0–100, higher is better',
    what: 'One number for how calm your body is right now.',
    why: 'Starts at 100, then loses points for heart rate above your baseline, fidgeting and oxygen dips, and gains points for high HRV.',
    good: 'Green 70+ · amber 45–70 · red under 45',
  },
}

// The 6-sensor matrix.
export const SENSORS = [
  {
    key: 'hr', num: 1, name: 'Heart Rate', shortName: 'HR', sub: '1 Hz', unit: 'bpm', digits: 0,
    domain: [55, 115], api: 'Sensor.Info.heartRate', role: 'Cardiovascular spike & pacer trigger',
    gated: false, thresholdDelta: 15, thresholdLabel: '+15 bpm pacer',
  },
  {
    key: 'rmssd', num: 2, name: 'HRV', shortName: 'HRV', sub: 'RMSSD · when still', unit: 'ms', digits: 0,
    domain: [10, 90], api: 'heartBeatIntervals · RMSSD', role: 'Vagal recovery in listening pauses',
    gated: true, threshold: 55, thresholdLabel: '55 ms target',
  },
  {
    key: 'spo2', num: 3, name: 'Pulse Ox', shortName: 'SpO₂', sub: 'when still', unit: '%', digits: 1,
    domain: [93, 100], api: 'Sensor.Info.oxygenSaturation', role: "Speaker's apnea breath-hold check",
    gated: true, threshold: 96, thresholdLabel: '96% apnea',
  },
  {
    key: 'temp', num: 4, name: 'Skin Temp', shortName: 'Temp', sub: 'wrist', unit: '°C', digits: 1,
    domain: [30, 35], api: 'Sensor.Info.temperature', role: 'Pre-event vasoconstriction (cold hands)',
    gated: false,
  },
  {
    key: 'accel_var', num: 5, name: 'Motion', shortName: 'Motion σ²', sub: 'accel σ² · 25 Hz', unit: 'mg²', digits: 0,
    domain: [0, 8000], api: 'accelerometerData · 25Hz + Pitch/Roll', role: 'Speaking vs Listening Stillness Gate',
    gated: false, threshold: 2500, thresholdLabel: '2,500 mg² gate',
  },
  {
    key: 'gyro_mag', num: 6, name: 'Rotation', shortName: 'Gyro', sub: 'gyro · 25 Hz', unit: '°/s', digits: 0,
    domain: [0, 200], api: 'gyroscopeData · 25Hz 3-Axis', role: 'Smooth gestures vs nervous wrist jerk',
    gated: false,
  },
]

export const ALL_CHANNELS = [
  { key: 'hr', name: 'Heart Rate', shortName: 'HR', unit: 'bpm', domain: ['dataMin - 3', 'dataMax + 3'], thresholdDelta: 15, thresholdLabel: '+15 bpm pacer' },
  { key: 'rmssd', name: 'HRV', shortName: 'HRV', unit: 'ms', domain: [0, 'dataMax + 5'], threshold: 55, thresholdLabel: '55 ms target' },
  { key: 'spo2', name: 'Pulse Ox', shortName: 'SpO₂', unit: '%', domain: [93, 100], threshold: 96, thresholdLabel: '96% apnea' },
  { key: 'temp', name: 'Skin Temp', shortName: 'Temp', unit: '°C', domain: [30, 35.5] },
  { key: 'accel_var', name: 'Motion σ²', shortName: 'Motion σ²', unit: 'mg²', domain: [0, 'dataMax + 500'], threshold: 2500, thresholdLabel: '2,500 mg² gate' },
  { key: 'gyro_mag', name: 'Rotation', shortName: 'Gyro', unit: '°/s', domain: [0, 'dataMax + 10'] },
  { key: 'fidget_index', name: 'Fidget', shortName: 'Fidget', unit: '', domain: [0, 100] },
  { key: 'composure_index', name: 'Composure', shortName: 'Composure', unit: '', domain: [0, 100] },
]

export const CORE_CHANNELS = ['hr', 'fidget_index', 'gyro_mag', 'spo2', 'rmssd', 'composure_index']
export const SENSOR_6_CHANNELS = ['hr', 'rmssd', 'spo2', 'temp', 'accel_var', 'gyro_mag']
export const ALL_8_CHANNELS = ['hr', 'rmssd', 'spo2', 'temp', 'accel_var', 'gyro_mag', 'fidget_index', 'composure_index']
// Backwards-compatible aliases
export const SENSOR_8_CHANNELS = SENSOR_6_CHANNELS
export const ALL_10_CHANNELS = ALL_8_CHANNELS

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

// ---------------------------------------------------------------- red → green index
const clamp01 = (v) => Math.max(0, Math.min(1, v))
/** 0 = worst (red) … 1 = best (green), for value `v` between `bad` and `good`. */
const between = (v, bad, good) => clamp01((v - bad) / (good - bad))

/** Per-row calm score 0..1 (0 = stressed/high, 1 = calm/good), or null when absent. */
export function rowScore(key, row, fallbackBaselineHr = 72) {
  if (!row) return null
  const v = row[key]
  if (v == null) return null
  switch (key) {
    case 'hr': {
      const base = row.baseline_hr ?? fallbackBaselineHr
      return between(v - base, 25, 5)          // +5 bpm green -> +25 bpm red
    }
    case 'rmssd': return between(v, 20, 55)
    case 'spo2': return between(v, 94, 97.5)
    case 'temp': return between(v, 31, 33.5)
    case 'accel_var': return between(v, 7500, 2500)
    case 'gyro_mag': return between(v, 160, 40)
    case 'composure_index': return between(v, 40, 80)
    case 'fidget_index': return between(v, 65, 20)
    default: return null
  }
}

/** Calm score 0..1 for the latest reading (1 = calm/good), or null when there is no value. */
export function score(key, rows) {
  const base = last(rows, 'baseline_hr') ?? 72
  for (let i = rows.length - 1; i >= 0; i--) {
    const sc = rowScore(key, rows[i], base)
    if (sc != null) return sc
  }
  return null
}

const STOPS = [[176, 74, 63], [192, 138, 46], [63, 138, 90]] // red, amber, green (muted)
/** Colour for a 0..1 score on the red -> amber -> green index. */
export function scoreColor(sc) {
  if (sc == null) return C.faint
  const t = clamp01(sc) * 2
  const [a, b] = t <= 1 ? [STOPS[0], STOPS[1]] : [STOPS[1], STOPS[2]]
  const f = t <= 1 ? t : t - 1
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * f))
  return `rgb(${c.join(',')})`
}

/** Horizontal SVG linearGradient stops along the plotted rows based on red-to-green calm score. */
export function buildColorStops(key, rows) {
  if (!rows || rows.length === 0) return []
  const base = last(rows, 'baseline_hr') ?? 72
  const valid = []
  for (let i = 0; i < rows.length; i++) {
    const sc = rowScore(key, rows[i], base)
    if (sc != null) valid.push({ t: rows[i]?.t, sc, idx: i })
  }
  if (valid.length < 2) return []

  const count = Math.min(36, valid.length)
  const sampled = []
  for (let i = 0; i < count; i++) {
    const vIdx = Math.round((i / (count - 1)) * (valid.length - 1))
    sampled.push(valid[vIdx])
  }

  const minT = sampled[0].t
  const maxT = sampled[sampled.length - 1].t
  const hasTimeSpan = minT != null && maxT != null && maxT > minT

  return sampled.map((p, i) => {
    const pct = hasTimeSpan ? ((p.t - minT) / (maxT - minT)) * 100 : (i / (sampled.length - 1)) * 100
    return {
      offset: `${(clamp01(pct / 100) * 100).toFixed(1)}%`,
      color: scoreColor(p.sc),
    }
  })
}

export const scoreWord = (sc) => (sc == null ? '—' : sc >= 0.66 ? 'calm' : sc >= 0.33 ? 'elevated' : 'high')
export const SCALE_GRADIENT = 'linear-gradient(90deg, rgb(176,74,63), rgb(192,138,46), rgb(63,138,90))'
