import { useState } from 'react'
import FlightRecorder from './components/FlightRecorder'
import SensorStrip from './components/SensorStrip'
import { Callouts, Gauges, Transcript } from './components/SidePanels'
import { fmtT, post, useMic, useSpine } from './hooks'

const PHASES = [
  { id: 'IDLE', label: 'En route' },
  { id: 'PRIMER', label: 'Primer' },
  { id: 'LIVE', label: 'Live' },
  { id: 'DONE', label: 'Debrief' },
]

function Status({ dot, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

function PresenterBar({ mic }) {
  const btn = 'rounded-md border border-line bg-card px-3 py-1.5 text-[12px] text-ink transition hover:border-line-strong hover:bg-sunk active:translate-y-px'
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
      <button className={btn} onClick={() => post('/api/control', { action: 'force_pacer' })}>Force pacer</button>
      <button className={btn} onClick={() => post('/api/control', { action: 'calm' })}>Calm</button>
      <button className={`${btn} text-muted`} onClick={() => confirm('Reset the session?') && post('/api/control', { action: 'reset' })}>Reset</button>
      {mic.error && <span className="text-[11px] text-alert">{mic.error}</span>}
      {!mic.speechSupported && <span className="text-[11px] text-note">Transcript needs Chrome (Web Speech API)</span>}
    </div>
  )
}

export default function App() {
  const spine = useSpine()
  const mic = useMic()
  const [view, setView] = useState({ mode: 'live' })
  const { telemetry, stage } = spine
  const lastRow = telemetry[telemetry.length - 1]
  const source = lastRow?.source
  const gate = lastRow?.gate ?? stage?.gate ?? 'LISTENING'
  const phase = lastRow?.phase ?? stage?.phase ?? 'IDLE'
  const jump = (t) => setView({ mode: 'zoom', from: Math.max(0, t - 10), to: t + 25 })

  return (
    <div className="flex min-h-full flex-col gap-3 p-4 xl:h-full">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <div className="text-[19px] font-semibold leading-none tracking-tight text-ink">
            Composure<span className="text-accent">IQ</span>
          </div>
          <div className="mt-1.5 text-[12px] text-muted">{stage?.calendar_event?.title ?? 'Interview flight recorder'}</div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <ol className="flex items-center gap-1 text-[11.5px]">
            {PHASES.map((p, i) => (
              <li key={p.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-line-strong">/</span>}
                <span className={p.id === phase ? 'font-medium text-accent' : 'text-faint'}>{p.label}</span>
              </li>
            ))}
          </ol>
          <Status dot={gate === 'SPEAKING' ? 'bg-note' : 'bg-accent'}>{gate === 'SPEAKING' ? 'Speaking' : 'Listening'}</Status>
          <Status dot={source === 'watch' ? 'bg-accent' : source ? 'bg-note' : 'bg-faint'}>
            {source === 'watch' ? 'Fenix 7 Pro' : source ? 'Backend sim' : 'No data'}
          </Status>
          <Status dot={spine.connected ? 'bg-accent' : 'bg-alert'}>{spine.connected ? 'Connected' : 'Offline'}</Status>
          <span className="font-mono text-[13px] text-ink">{fmtT(lastRow?.t ?? 0)}</span>
        </div>
      </header>

      <PresenterBar mic={mic} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
        <div className="flex min-h-0 flex-col gap-3">
          <SensorStrip telemetry={telemetry} gate={gate} />
          <div className="min-h-[380px] flex-1">
            <FlightRecorder telemetry={telemetry} transcript={spine.transcript} events={spine.events}
              callouts={spine.callouts} view={view} setView={setView} />
          </div>
        </div>
        <div className="grid min-h-0 grid-rows-[auto_minmax(240px,1fr)_minmax(240px,1fr)] gap-3">
          <Gauges telemetry={telemetry} />
          <Transcript transcript={spine.transcript} interim={spine.interim} callouts={spine.callouts} onJump={jump} />
          <Callouts callouts={spine.callouts} onJump={jump} />
        </div>
      </div>
    </div>
  )
}
