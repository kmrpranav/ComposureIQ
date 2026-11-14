import { useEffect, useRef, useState } from 'react'
import { fmtT, post } from '../hooks'
import { last, score, scoreColor, scoreWord } from '../sensors'
import InfoTip from './InfoTip'

export const PHASES = [
  { id: 'IDLE', label: 'Baseline' },
  { id: 'PRIMER', label: 'Primer' },
  { id: 'LIVE', label: 'Live Interview' },
  { id: 'DONE', label: 'Debrief' },
]
const HOLD_MS = 2500

const PRESET_QUESTIONS = [
  'Tell me about a time a production deployment failed and how you handled the outage?',
  'Why should we hire you over candidates with twice as much systems experience?',
  'Walk me through your biggest architectural mistake and what it cost the team?',
  'What is your target compensation, and why do you think you are worth that?',
  'How would you redesign our core telemetry pipeline if latency doubled overnight?',
]

const DEMO_DURATION_S = 45

const DEMO_STEPS = [
  {
    at: 0,
    title: '1/7 · Stage 1: Baseline Calibration (00:00)',
    note: 'Sampling resting HR, HRV, SpO₂, and wrist skin temperature before the interview.',
    run: async () => {
      await post('/api/control', { action: 'reset' })
      await post('/api/control', { action: 'set_phase', phase: 'IDLE' })
    },
  },
  {
    at: 5,
    title: '2/7 · Stage 2: Pre-Interview Breathing Primer (00:05)',
    note: 'Marked "Primer Started" on graph. Watch guides a 10s physiological sigh to elevate vagal HRV.',
    run: () => post('/api/control', { action: 'set_phase', phase: 'PRIMER' }),
  },
  {
    at: 12,
    title: '3/7 · Stage 3: Interview Started — Stealth Mode (00:12)',
    note: 'Marked "00:12 · Interview Started" on graph. Watch dims to analog face and arms Listening Gate.',
    run: () => post('/api/control', { action: 'set_phase', phase: 'LIVE' }),
  },
  {
    at: 18,
    title: '4/7 · Interviewer Asks High-Stress Question (00:18)',
    note: 'Marked "Question Asked" on graph; sympathetic stress rises (sensors shift from green toward amber/red).',
    run: () => post('/api/control', {
      action: 'stress_question',
      text: 'Tell me about a time a production deployment failed and how you handled the outage?',
    }),
  },
  {
    at: 22,
    title: '5/7 · Candidate Answering — Speaking Gate Open (00:22)',
    note: '6s spoken answer: 25Hz accel σ² > 2,500 mg² mutes haptics while logging HR, fidget & gyro.',
    run: () => post('/api/control', {
      action: 'simulate_answer',
      duration: 6,
      text: 'We rolled back the canary within two minutes, isolated the schema migration lock, and added automated pre-flight checks.',
    }),
  },
  {
    at: 29,
    title: '6/7 · 2.5s Stillness Hold → 60-BPM Tactile Pacer (00:29)',
    note: 'Speech ended at 00:28. Watch verifies 2.5s stillness, flips to Listening Gate, and fires 60-BPM pacer.',
  },
  {
    at: 34,
    title: '6b/7 · Spike Callout & Autonomic Recovery (00:34)',
    note: 'Correlating question spike (ΔHR, fidget, gyro, SpO₂) as sensors recover back to calm green.',
    run: async () => {
      await post('/api/control', { action: 'evaluate_now' })
      await post('/api/control', { action: 'calm' })
    },
  },
  {
    at: 40,
    title: '7/7 · Stage 4: Interview Complete → Debrief (00:40)',
    note: 'Marked "Interview Complete" on graph. Review pacer efficacy, habit prescriptions & 4-session trend.',
    run: () => post('/api/control', { action: 'set_phase', phase: 'DONE' }),
  },
]

/** Big, unmissable speaking / listening / pacer state. */
function GateIndicator({ row, pacerActive, phase }) {
  const gate = row?.gate ?? 'LISTENING'
  const still = row?.still_ms ?? 0
  let tone, title, sub, progress = null

  if (pacerActive) {
    tone = 'pacer'; title = 'Pacer cue'; sub = 'two soft pulses · slow breath'
  } else if (gate === 'SPEAKING') {
    if (still > 300) {
      tone = 'settling'; title = 'Going still'
      sub = `${(Math.min(still, HOLD_MS) / 1000).toFixed(1)} / 2.5 s to listening`
      progress = Math.min(1, still / HOLD_MS)
    } else {
      tone = 'speaking'; title = 'Speaking'; sub = 'haptics muted'
    }
  } else {
    tone = 'listening'; title = 'Listening'
    sub = phase === 'LIVE' ? 'pacer armed' : 'sensors trusted'
  }

  const styles = {
    listening: 'bg-accent text-white border-accent',
    pacer: 'bg-accent text-white border-accent ring-4 ring-accent/25',
    speaking: 'bg-note-soft text-note border-note/40',
    settling: 'bg-card text-accent border-accent/50',
  }
  return (
    <div className={`relative flex h-12 min-w-[200px] items-center gap-3 overflow-hidden rounded-lg border px-4 transition-colors duration-300 ${styles[tone]}`}>
      {progress != null && (
        <span className="absolute inset-y-0 left-0 bg-accent-soft transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
      )}
      <span className="relative flex h-3 w-3 shrink-0">
        {(tone === 'listening' || tone === 'pacer') && (
          <span className={`absolute inline-flex h-full w-full rounded-full bg-white/70 ${tone === 'pacer' ? 'animate-ping' : 'animate-[ping_2.4s_ease-out_infinite]'}`} />
        )}
        <span className={`relative inline-flex h-3 w-3 rounded-full ${tone === 'speaking' ? 'bg-note' : tone === 'settling' ? 'bg-accent' : 'bg-white'}`} />
      </span>
      <span className="relative leading-tight">
        <span className="block text-[15px] font-semibold uppercase tracking-[0.08em]">{title}</span>
        <span className="block font-mono text-[10.5px] opacity-80">{sub}</span>
      </span>
    </div>
  )
}

/** Semi-circular speedometer gauge on the red (stressed/high) -> amber -> green (calm) index. */
function SpeedometerGauge({ k, name, caption, rows }) {
  const v = last(rows, k)
  const sc = score(k, rows)
  const col = scoreColor(sc)
  const word = scoreWord(sc)
  const angleDeg = -90 + (sc ?? 0.5) * 180
  const gradId = `gauge-grad-${k}`

  return (
    <div className="flex h-[62px] min-w-[205px] items-center gap-2.5 rounded-lg border border-line bg-card px-2.5 py-1">
      <div className="flex shrink-0 flex-col items-center">
        <svg width="76" height="42" viewBox="0 0 76 42" className="overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#b04a3f" />
              <stop offset="50%" stopColor="#c08a2e" />
              <stop offset="100%" stopColor="#3f8a5a" />
            </linearGradient>
          </defs>

          {/* Background track + red-to-green magnitude arc */}
          <path
            d="M 8 36 A 30 30 0 0 1 68 36"
            fill="none"
            stroke="rgba(30,42,54,0.08)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="M 8 36 A 30 30 0 0 1 68 36"
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="6"
            strokeLinecap="round"
          />

          {/* Subtle rim ticks at -90, -45, 0, +45, +90 degrees */}
          {[-90, -45, 0, 45, 90].map((deg) => (
            <line
              key={deg}
              x1="38"
              y1="2.5"
              x2="38"
              y2="5.5"
              stroke="rgba(30,42,54,0.28)"
              strokeWidth="1"
              transform={`rotate(${deg} 38 36)`}
            />
          ))}

          {/* Pivoting speedometer needle */}
          <g
            style={{
              transform: `rotate(${angleDeg}deg)`,
              transformOrigin: '38px 36px',
              transformBox: 'view-box',
              transition: 'transform 500ms ease-out',
            }}
          >
            <line x1="38" y1="36" x2="38" y2="11" stroke="#1e2a36" strokeWidth="2.2" strokeLinecap="round" />
          </g>
          <circle cx="38" cy="36" r="3.5" fill={col} stroke="#ffffff" strokeWidth="1.2" />
        </svg>
        <div className="-mt-0.5 flex w-[76px] justify-between font-mono text-[7.5px] font-semibold uppercase tracking-wider">
          <span className="text-alert">High</span>
          <span className="text-good">Calm</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-semibold text-ink">{name}</span>
          <InfoTip k={k} />
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="font-mono text-[20px] font-semibold leading-none tabular-nums transition-colors duration-500" style={{ color: col }}>
            {v == null ? '—' : Math.round(v)}
          </span>
          <span className="font-mono text-[9.5px] text-faint">/100</span>
          {sc != null && (
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold capitalize leading-none"
              style={{ color: col, background: 'rgba(30,42,54,0.05)' }}
            >
              {word}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[10px] leading-tight text-muted">{caption}</div>
      </div>
    </div>
  )
}

function Status({ dot, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

function PresenterBar({ mic, forcePending, demo, onStartDemo, onStopDemo }) {
  const [selectedQ, setSelectedQ] = useState(PRESET_QUESTIONS[0])
  const [customQ, setCustomQ] = useState('')
  const btn = 'rounded-md border border-line bg-card px-2.5 py-1.5 text-[11.5px] text-ink transition hover:border-line-strong hover:bg-sunk active:translate-y-px disabled:opacity-50'

  const askQuestion = () => {
    const text = selectedQ === '__custom__' ? customQ.trim() : selectedQ
    if (!text) return
    post('/api/control', { action: 'stress_question', text })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Mic button */}
        <button
          type="button"
          onClick={mic.on ? mic.stop : mic.start}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-medium transition active:translate-y-px ${
            mic.on ? 'border border-accent bg-accent-soft text-accent' : 'bg-accent text-white hover:bg-accent/90'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${mic.on ? (mic.speaking ? 'bg-alert' : 'bg-accent/40') : 'bg-white/70'}`} />
          {mic.on ? 'Mic on' : 'Start mic'}
          {mic.on && (
            <span className="h-1 w-12 overflow-hidden rounded-full bg-white">
              <span className="block h-full bg-accent transition-[width] duration-75" style={{ width: `${mic.level * 100}%` }} />
            </span>
          )}
        </button>

        {/* 1-Click Auto-Demo */}
        {demo.running ? (
          <button
            type="button"
            onClick={onStopDemo}
            className="flex items-center gap-1.5 rounded-md border border-alert bg-alert-soft px-3 py-1.5 text-[12px] font-medium text-alert transition hover:bg-alert-soft/80"
          >
            <span>■ Stop Demo</span>
            <span className="font-mono text-[10.5px]">({demo.elapsed}s / {DEMO_DURATION_S}s)</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartDemo}
            className="rounded-md border border-accent/50 bg-accent-soft px-3 py-1.5 text-[12px] font-medium text-accent transition hover:bg-accent hover:text-white active:translate-y-px"
          >
            ▶ Auto-Demo ({DEMO_DURATION_S}s)
          </button>
        )}

        <span className="mx-0.5 h-5 w-px bg-line" />
        <span className="label">Question</span>

        <select
          value={selectedQ}
          onChange={(e) => setSelectedQ(e.target.value)}
          className="max-w-[270px] truncate rounded-md border border-line bg-card px-2 py-1.5 text-[11.5px] text-ink focus:border-accent focus:outline-none"
        >
          {PRESET_QUESTIONS.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
          <option value="__custom__">Custom question…</option>
        </select>

        {selectedQ === '__custom__' && (
          <input
            type="text"
            value={customQ}
            onChange={(e) => setCustomQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && askQuestion()}
            placeholder="Type interview question…"
            className="w-52 rounded-md border border-line bg-card px-2.5 py-1.5 text-[11.5px] text-ink focus:border-accent focus:outline-none"
          />
        )}

        <button type="button" className={btn} onClick={askQuestion}>Ask Question</button>
        <button
          type="button"
          className="rounded-md border border-note/40 bg-note-soft px-2.5 py-1.5 text-[11.5px] font-medium text-note transition hover:border-note active:translate-y-px"
          onClick={() => post('/api/control', { action: 'simulate_answer', duration: 6 })}
        >
          Simulate Answer → Pacer
        </button>

        <span className="mx-0.5 h-5 w-px bg-line" />
        <span className="label">Stage</span>

        <button type="button" className={btn} onClick={() => post('/api/control', { action: 'set_phase', phase: 'PRIMER' })}>Start Primer</button>
        <button type="button" className={btn} onClick={() => post('/api/control', { action: 'set_phase', phase: 'LIVE' })}>Start Interview</button>
        <button type="button" className={btn} disabled={forcePending} onClick={() => post('/api/control', { action: 'force_pacer' })}>
          {forcePending ? 'Pacer sent…' : 'Force pacer'}
        </button>
        <button type="button" className={btn} onClick={() => post('/api/control', { action: 'calm' })}>Calm</button>
        <button type="button" className={btn} onClick={() => post('/api/control', { action: 'set_phase', phase: 'DONE' })}>Debrief</button>
        <button
          type="button"
          className={`${btn} text-muted`}
          onClick={() => {
            if (demo.running) onStopDemo()
            if (confirm('Reset the session?')) post('/api/control', { action: 'reset' })
          }}
        >
          Reset
        </button>

        {mic.error && <span className="text-[11px] text-alert">{mic.error}</span>}
        {mic.sttNote && <span className="text-[11px] text-accent">{mic.sttNote}</span>}
      </div>

      {/* Auto-Demo live narration bar */}
      {demo.step && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/35 bg-accent-soft/70 px-3 py-1.5 text-[11.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-white">
              {demo.running ? 'Auto-Demo' : 'Demo Complete'}
            </span>
            <span className="font-semibold text-ink">{demo.step.title}</span>
            <span className="text-muted">— {demo.step.note}</span>
          </div>
          {!demo.running && (
            <button type="button" onClick={onStopDemo} className="font-mono text-[10px] text-muted hover:text-ink">
              dismiss
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function Navbar({ spine, mic, pacerActive }) {
  const { telemetry, stage } = spine
  const row = telemetry[telemetry.length - 1]
  const phase = row?.phase ?? stage?.phase ?? 'IDLE'
  const source = row?.source

  const [demo, setDemo] = useState({ running: false, elapsed: 0, step: null })
  const timersRef = useRef({ timeouts: [], ticker: null })

  const clearDemoTimers = () => {
    timersRef.current.timeouts.forEach(clearTimeout)
    if (timersRef.current.ticker) clearInterval(timersRef.current.ticker)
    timersRef.current = { timeouts: [], ticker: null }
  }

  const stopDemo = () => {
    clearDemoTimers()
    setDemo({ running: false, elapsed: 0, step: null })
  }

  const startDemo = () => {
    clearDemoTimers()
    const startedAt = Date.now()
    setDemo({ running: true, elapsed: 0, step: DEMO_STEPS[0] })

    const timeouts = DEMO_STEPS.map((st) =>
      setTimeout(() => {
        st.run?.()
        setDemo((prev) => ({ ...prev, step: st }))
      }, st.at * 1000),
    )

    timeouts.push(
      setTimeout(() => {
        if (timersRef.current.ticker) clearInterval(timersRef.current.ticker)
        timersRef.current.ticker = null
        setDemo((prev) => ({ ...prev, running: false, elapsed: DEMO_DURATION_S }))
      }, DEMO_DURATION_S * 1000),
    )

    const ticker = setInterval(() => {
      setDemo((prev) => ({
        ...prev,
        elapsed: Math.min(DEMO_DURATION_S, Math.floor((Date.now() - startedAt) / 1000)),
      }))
    }, 500)

    timersRef.current = { timeouts, ticker }
  }

  useEffect(() => () => clearDemoTimers(), [])

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 shadow-[0_1px_0_rgba(30,42,54,0.03)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pt-3">
        <div className="min-w-0">
          <div className="text-[19px] font-semibold leading-none tracking-tight text-ink">
            Composure<span className="text-accent">IQ</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[11.5px] text-muted">{stage?.calendar_event?.title ?? 'Interview flight recorder'}</span>
            <ol className="flex items-center gap-1 text-[11px]">
              {PHASES.map((p, i) => (
                <li key={p.id} className="flex items-center gap-1">
                  {i > 0 && <span className="text-line-strong">›</span>}
                  <button
                    type="button"
                    onClick={() => post('/api/control', { action: 'set_phase', phase: p.id })}
                    title={`Switch stage to ${p.label}`}
                    className={`rounded px-1.5 py-0.5 transition ${
                      p.id === phase
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-faint hover:bg-sunk hover:text-ink'
                    }`}
                  >
                    {i + 1}. {p.label}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex flex-col items-end gap-1 pr-1">
            <span className="font-mono text-[15px] leading-none text-ink">{fmtT(row?.t ?? 0)}</span>
            <Status dot={source === 'watch' ? 'bg-accent' : source ? 'bg-note' : 'bg-faint'}>
              {source === 'watch' ? 'Fenix 7 Pro' : source ? 'Backend sim' : 'No data'}
            </Status>
            <Status dot={spine.connected ? 'bg-accent' : 'bg-alert'}>{spine.connected ? 'Connected' : 'Offline'}</Status>
          </div>
          <GateIndicator row={row} pacerActive={pacerActive} phase={phase} />
          <SpeedometerGauge k="composure_index" name="Composure" caption="Higher = calmer" rows={telemetry} />
          <SpeedometerGauge k="fidget_index" name="Fidget" caption="Lower = calmer" rows={telemetry} />
        </div>
      </div>
      <div className="px-4 pt-2.5 pb-3">
        <PresenterBar
          mic={mic}
          forcePending={!!stage?.force_pending}
          demo={demo}
          onStartDemo={startDemo}
          onStopDemo={stopDemo}
        />
      </div>
    </header>
  )
}
