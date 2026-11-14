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

/** Composure / Fidget chip on the red → green index. */
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

function PresenterBar({ mic, forcePending }) {
  const btn = 'rounded-md border border-line bg-card px-3 py-1.5 text-[12px] text-ink transition hover:border-line-strong hover:bg-sunk active:translate-y-px disabled:opacity-50'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={mic.on ? mic.stop : mic.start}
        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-medium transition active:translate-y-px ${
          mic.on ? 'border border-accent bg-accent-soft text-accent' : 'bg-accent text-white hover:bg-accent/90'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${mic.on ? (mic.speaking ? 'bg-alert' : 'bg-accent/40') : 'bg-white/70'}`} />
        {mic.on ? 'Mic on' : 'Start mic'}
        {mic.on && (
          <span className="h-1 w-12 overflow-hidden rounded-full bg-white">
            <span className="block h-full bg-accent transition-[width] duration-75" style={{ width: `${mic.level * 100}%` }} />
          </span>
        )}
      </button>
      <span className="mx-1 h-5 w-px bg-line" />
      <span className="label mr-1">Stage</span>
      <button className={btn} onClick={() => post('/api/control', { action: 'venue_arrival' })}>Venue arrival</button>
      <button className={btn} onClick={() => post('/api/control', { action: 'stress_question' })}>High-stress question</button>
      <button className={btn} disabled={forcePending} onClick={() => post('/api/control', { action: 'force_pacer' })}>
        {forcePending ? 'Pacer sent…' : 'Force pacer'}
      </button>
      <button className={btn} onClick={() => post('/api/control', { action: 'calm' })}>Calm</button>
      <button className={`${btn} text-muted`} onClick={() => confirm('Reset the session?') && post('/api/control', { action: 'reset' })}>Reset</button>
      {mic.error && <span className="text-[11px] text-alert">{mic.error}</span>}
      {!mic.speechSupported && <span className="text-[11px] text-note">Transcript needs Chrome (Web Speech API)</span>}
    </div>
  )
}

export default function Navbar({ spine, mic, pacerActive }) {
  const { telemetry, stage } = spine
  const row = telemetry[telemetry.length - 1]
  const phase = row?.phase ?? stage?.phase ?? 'IDLE'
  const source = row?.source
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
                  <span className={p.id === phase ? 'rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent' : 'text-faint'}>{p.label}</span>
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
        <PresenterBar mic={mic} forcePending={!!stage?.force_pending} />
      </div>
    </header>
  )
}
