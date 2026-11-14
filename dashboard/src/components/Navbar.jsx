import { useEffect, useRef, useState } from 'react'
import { fmtT, post } from '../hooks'
import { SCALE_GRADIENT, last, score, scoreColor } from '../sensors'
import InfoTip from './InfoTip'

export const PHASES = [
  { id: 'IDLE', label: 'En route' },
  { id: 'PRIMER', label: 'Primer' },
  { id: 'LIVE', label: 'Live' },
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

const DEMO_STEPS = [
  {
    at: 0,
    title: '1/7 · En route (GPS Geofence Watch)',
    note: 'Approaching Platform Calgary. Haversine distance is tracked silently with zero alerts.',
    run: async () => {
      await post('/api/control', { action: 'reset' })
      await post('/api/control', { action: 'set_phase', phase: 'IDLE' })
    },
  },
  {
    at: 5,
    title: '2/7 · Venue Arrival (<100m Geofence → Primer)',
    note: 'Entered 100 m geofence. Watch launches 10s physiological sigh haptics & monitors HRV recovery.',
    run: () => post('/api/control', { action: 'venue_arrival' }),
  },
  {
    at: 15,
    title: '3/7 · Entering Live Interview (Stealth Analog Face)',
    note: 'Watch dims to minimalist analog hands so an interviewer never sees distracting charts.',
    run: () => post('/api/control', { action: 'set_phase', phase: 'LIVE' }),
  },
  {
    at: 19,
    title: '4/7 · Judge Asks Tough Behavioral Question',
    note: 'Question flagged "Q" in transcript; sympathetic stress rises before you respond.',
    run: () => post('/api/control', {
      action: 'stress_question',
      text: 'Tell me about a time a production deployment failed and how you handled the outage?',
    }),
  },
  {
    at: 22,
    title: '5/7 · Speaking Gate Opens (Haptics Muted)',
    note: '6s spoken answer: 25Hz accel σ² > 2,500 mg² mutes haptics while logging HR, fidget & gyro.',
    run: () => post('/api/control', {
      action: 'simulate_answer',
      duration: 6,
      text: 'We rolled back the canary within two minutes, isolated the schema migration lock, and added automated pre-flight checks.',
    }),
  },
  {
    at: 28,
    title: '6/7 · 2.5s Stillness Countdown → 60-BPM Tactile Pacer',
    note: 'Speech stopped. Watch holds 2.5s stillness, flips to Listening Gate, and fires two 60-BPM pulses.',
  },
  {
    at: 34,
    title: '6b/7 · Spike Correlation & Recovery',
    note: 'Evaluating multi-sensor spike callout (ΔHR, fidget, gyro jerk, SpO₂) and settling baseline.',
    run: async () => {
      await post('/api/control', { action: 'evaluate_now' })
      await post('/api/control', { action: 'calm' })
    },
  },
  {
    at: 45,
    title: '7/7 · Session Saved (.FIT) → Post-Interview Debrief',
    note: 'Composure & Fidget developer fields saved. Inspect pacer efficacy, coaching & 4-session trend.',
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

/** Composure / Fidget chip on the red -> green index. */
function IndexChip({ k, name, caption, rows }) {
  const v = last(rows, k)
  const sc = score(k, rows)
  const col = scoreColor(sc)
  return (
    <div className="flex h-12 min-w-[168px] items-center gap-3 rounded-lg border border-line bg-card px-3">
      <span className="font-mono text-[24px] font-medium leading-none tabular-nums transition-colors duration-500" style={{ color: col }}>
        {v == null ? '—' : Math.round(v)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="text-[11.5px] font-semibold text-ink">{name}</span>
          <InfoTip k={k} />
        </span>
        <span className="block truncate text-[10.5px] leading-tight text-muted">{caption}</span>
        <span className="relative mt-1 block h-1 w-full rounded-full" style={{ background: SCALE_GRADIENT, opacity: 0.85 }}>
          {sc != null && (
            <span className="absolute -top-[3px] h-2.5 w-[3px] -translate-x-1/2 rounded-sm bg-ink transition-[left] duration-500"
              style={{ left: `${sc * 100}%` }} />
          )}
        </span>
      </span>
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
            <span className="font-mono text-[10.5px]">({demo.elapsed}s / 45s)</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartDemo}
            className="rounded-md border border-accent/50 bg-accent-soft px-3 py-1.5 text-[12px] font-medium text-accent transition hover:bg-accent hover:text-white active:translate-y-px"
          >
            ▶ Auto-Demo (60s)
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

        <button type="button" className={btn} onClick={() => post('/api/control', { action: 'venue_arrival' })}>Venue arrival</button>
        <button type="button" className={btn} disabled={forcePending} onClick={() => post('/api/control', { action: 'force_pacer' })}>
          {forcePending ? 'Pacer sent…' : 'Force pacer'}
        </button>
        <button type="button" className={btn} onClick={() => post('/api/control', { action: 'calm' })}>Calm</button>
        <button type="button" className={btn} onClick={() => post('/api/control', { action: 'set_phase', phase: 'DONE' })}>Debrief (.FIT)</button>
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
        setDemo((prev) => ({ ...prev, running: false, elapsed: 45 }))
      }, 46000),
    )

    const ticker = setInterval(() => {
      setDemo((prev) => ({
        ...prev,
        elapsed: Math.min(45, Math.floor((Date.now() - startedAt) / 1000)),
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

        <div className="flex flex-wrap items-center gap-2">
          <GateIndicator row={row} pacerActive={pacerActive} phase={phase} />
          <IndexChip k="composure_index" name="Composure" caption="How calm your body is · higher is better" rows={telemetry} />
          <IndexChip k="fidget_index" name="Fidget" caption="Nervous wrist movement · lower is better" rows={telemetry} />
          <div className="flex flex-col items-end gap-1 pl-1">
            <span className="font-mono text-[15px] leading-none text-ink">{fmtT(row?.t ?? 0)}</span>
            <Status dot={source === 'watch' ? 'bg-accent' : source ? 'bg-note' : 'bg-faint'}>
              {source === 'watch' ? 'Fenix 7 Pro' : source ? 'Backend sim' : 'No data'}
            </Status>
            <Status dot={spine.connected ? 'bg-accent' : 'bg-alert'}>{spine.connected ? 'Connected' : 'Offline'}</Status>
          </div>
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
