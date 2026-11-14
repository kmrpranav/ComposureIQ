import { useEffect, useState } from 'react'
import { post } from '../hooks'
import { last } from '../sensors'

export default function WatchMirror({ telemetry, stage, events, pacerActive }) {
  const row = telemetry[telemetry.length - 1]
  const phase = row?.phase ?? stage?.phase ?? 'IDLE'
  const gate = row?.gate ?? stage?.gate ?? 'LISTENING'
  const source = row?.source

  const [tickMs, setTickMs] = useState(() => Date.now())
  const [menuOpen, setMenuOpen] = useState(false)
  const [backlight, setBacklight] = useState(false)
  const [primerEnteredAt, setPrimerEnteredAt] = useState(null)

  useEffect(() => {
    const id = setInterval(() => setTickMs(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (phase === 'PRIMER') {
      setPrimerEnteredAt((prev) => prev ?? Date.now())
    } else {
      setPrimerEnteredAt(null)
    }
  }, [phase])

  const hr = last(telemetry, 'hr')
  const rmssd = last(telemetry, 'rmssd')
  const spo2 = last(telemetry, 'spo2')
  const temp = last(telemetry, 'temp')
  const composure = last(telemetry, 'composure_index')
  const pacerCount = events.filter((e) => e.kind === 'pacer').length

  const calTitle = (stage?.calendar_event?.title ?? 'Senior SWE Onsite').slice(0, 22)
  const minsLeft = stage?.calendar_event?.start_epoch
    ? Math.max(0, Math.round((stage.calendar_event.start_epoch - tickMs / 1000) / 60))
    : 10

  // 10s physiological sigh animation matching Views.mc lines 57-61
  const cycleSec = (tickMs / 1000) % 10
  let sighR, sighLabel
  if (cycleSec < 2.0) {
    sighR = 30 + 22 * (cycleSec / 2.0)
    sighLabel = 'inhale'
  } else if (cycleSec < 3.0) {
    sighR = 52 + 10 * (cycleSec - 2.0)
    sighLabel = 'inhale more'
  } else {
    sighR = 62 - 32 * ((cycleSec - 3.0) / 7.0)
    sighLabel = 'slow exhale'
  }
  const primerElapsed = primerEnteredAt ? Math.min(90, Math.floor((tickMs - primerEnteredAt) / 1000)) : 0

  // Analog clock hands for StealthView
  const d = new Date(tickMs)
  const hourAngle = ((d.getHours() % 12) + d.getMinutes() / 60) * (Math.PI / 6)
  const minAngle = (d.getMinutes() + d.getSeconds() / 60) * (Math.PI / 30)

  const handleStart = () => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    if (phase === 'IDLE') post('/api/control', { action: 'set_phase', phase: 'PRIMER' })
    else if (phase === 'PRIMER') post('/api/control', { action: 'set_phase', phase: 'LIVE' })
    else if (phase === 'DONE') post('/api/control', { action: 'set_phase', phase: 'IDLE' })
  }

  const handleBack = () => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    if (phase === 'LIVE') post('/api/control', { action: 'set_phase', phase: 'DONE' })
    else if (phase === 'PRIMER') post('/api/control', { action: 'set_phase', phase: 'IDLE' })
  }

  const runMenuAction = (action, extra = {}) => {
    setMenuOpen(false)
    post('/api/control', { action, ...extra })
  }

  const bezelBtn =
    'whitespace-nowrap rounded border border-line-strong bg-sunk px-1.5 py-0.5 font-mono text-[8.5px] font-medium text-muted shadow-sm transition hover:border-accent hover:text-accent active:translate-y-px'

  return (
    <div className="mb-3 border-b border-line pb-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Fenix 7 Pro Mirror (Views.mc)</span>
        <span className="font-mono text-[10px] text-faint">
          {source === 'watch' ? 'live watch sync' : 'sim mirror'}
        </span>
      </div>

      {/* Bezel + 5 hardware buttons */}
      <div className="mx-auto flex w-full items-center justify-center gap-2.5 py-1">
        {/* Left hardware buttons */}
        <div className="flex shrink-0 flex-col items-end gap-4">
          <button type="button" onClick={() => setBacklight((b) => !b)} className={bezelBtn} title="Toggle MIP backlight">
            LIGHT
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className={`${bezelBtn} ${menuOpen ? 'border-accent bg-accent-soft text-accent' : ''}`}
            title="Open watch Menu2 stage overrides"
          >
            UP · MENU
          </button>
          <button
            type="button"
            onClick={() => post('/api/control', { action: 'force_pacer' })}
            className={bezelBtn}
            title="Test 60-BPM haptic pacer"
          >
            DOWN
          </button>
        </div>

        {/* Circular Fenix 7 Pro case */}
        <div className="relative flex h-[200px] w-[200px] shrink-0 items-center justify-center rounded-full border-[5px] border-[#26303c] bg-[#14191f] shadow-[0_8px_22px_rgba(30,42,54,0.22)]">
          {/* Inner titanium ring */}
          <div
            className={`relative flex h-[178px] w-[178px] flex-col items-center justify-center overflow-hidden rounded-full border transition-all duration-300 ${
              backlight ? 'border-sky-400/50 bg-[#050d14] shadow-[inset_0_0_24px_rgba(56,189,248,0.18)]' : 'border-white/10 bg-black'
            }`}
          >
            {/* Menu2 Overlay */}
            {menuOpen ? (
              <div className="flex h-full w-full flex-col justify-center bg-[#090d12]">
                <div className="mx-auto w-[134px] text-left">
                  <div className="mb-1 text-center font-mono text-[8.5px] uppercase tracking-widest text-sky-400">
                    Menu2 · Stage
                  </div>
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => runMenuAction('set_phase', { phase: 'PRIMER' })}
                      className="block w-full rounded bg-white/5 px-2 py-0.5 text-left text-[9px] text-white hover:bg-sky-500/20"
                    >
                      1. Start Primer
                    </button>
                    <button
                      type="button"
                      onClick={() => runMenuAction('set_phase', { phase: 'LIVE' })}
                      className="block w-full rounded bg-white/5 px-2 py-0.5 text-left text-[9px] text-white hover:bg-sky-500/20"
                    >
                      2. Start Interview
                    </button>
                    <button
                      type="button"
                      onClick={() => runMenuAction('stress_question')}
                      className="block w-full rounded bg-white/5 px-2 py-0.5 text-left text-[9px] text-white hover:bg-sky-500/20"
                    >
                      3. High-Stress Q
                    </button>
                    <button
                      type="button"
                      onClick={() => runMenuAction('force_pacer')}
                      className="block w-full rounded bg-white/5 px-2 py-0.5 text-left text-[9px] text-white hover:bg-sky-500/20"
                    >
                      4. Listening Pacer
                    </button>
                    <button
                      type="button"
                      onClick={() => runMenuAction('set_phase', { phase: 'DONE' })}
                      className="block w-full rounded bg-white/5 px-2 py-0.5 text-left text-[9px] text-white hover:bg-sky-500/20"
                    >
                      5. Finish Interview
                    </button>
                  </div>
                </div>
              </div>
            ) : phase === 'PRIMER' ? (
              /* PrimerView */
              <svg viewBox="0 0 182 182" className="h-full w-full">
                <text x="91" y="22" textAnchor="middle" fill="#a3aab3" fontSize="8.5" fontFamily="monospace">
                  PRIMER {primerElapsed}/90s
                </text>
                <circle cx="91" cy="91" r={sighR} fill="#0e7490" fillOpacity="0.48" stroke="#67e8f9" strokeWidth="1.8" />
                <text x="91" y="94" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600">
                  {sighLabel}
                </text>
                <text x="91" y="148" textAnchor="middle" fill="#cbd5e1" fontSize="8" fontFamily="monospace">
                  HRV {rmssd != null ? `${rmssd.toFixed(0)}ms` : '--'}  SpO2 {spo2 != null ? `${spo2.toFixed(0)}%` : '--'}
                </text>
                <text x="91" y="161" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="monospace">
                  skin {temp != null ? `${temp.toFixed(1)}C` : '--'}
                </text>
              </svg>
            ) : phase === 'LIVE' ? (
              /* StealthView */
              <svg viewBox="0 0 182 182" className="h-full w-full">
                {Array.from({ length: 12 }).map((_, i) => {
                  const a = (i * Math.PI) / 6
                  const r1 = 83
                  const r2 = i % 3 === 0 ? 70 : 77
                  return (
                    <line
                      key={i}
                      x1={91 + r1 * Math.sin(a)}
                      y1={91 - r1 * Math.cos(a)}
                      x2={91 + r2 * Math.sin(a)}
                      y2={91 - r2 * Math.cos(a)}
                      stroke="#2a2a2a"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                  )
                })}
                {/* Hour hand */}
                <line
                  x1="91"
                  y1="91"
                  x2={91 + 44 * Math.sin(hourAngle)}
                  y2={91 - 44 * Math.cos(hourAngle)}
                  stroke="#6b6b6b"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                {/* Minute hand */}
                <line
                  x1="91"
                  y1="91"
                  x2={91 + 68 * Math.sin(minAngle)}
                  y2={91 - 68 * Math.cos(minAngle)}
                  stroke="#6b6b6b"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <circle cx="91" cy="91" r="4.5" fill="#6b6b6b" />
                {/* 6 o'clock sub-perceptual gate dot + pacer ripple */}
                {pacerActive && (
                  <>
                    <circle cx="91" cy="148" r="12" fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.55" />
                    <circle cx="91" cy="148" r="18" fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.25" />
                  </>
                )}
                <circle
                  cx="91"
                  cy="148"
                  r="4.5"
                  fill={pacerActive ? '#38bdf8' : gate === 'SPEAKING' ? '#6b4f1d' : '#145353'}
                />
              </svg>
            ) : phase === 'DONE' ? (
              /* SummaryView */
              <div className="flex flex-col items-center px-3 text-center">
                <div className="font-mono text-[8.5px] tracking-widest text-sky-400">SESSION COMPLETE</div>
                <div className="mt-1.5 font-mono text-[34px] font-semibold leading-none text-white">
                  {composure != null ? Math.round(composure) : '--'}
                </div>
                <div className="mt-1.5 font-mono text-[8.5px] text-slate-300">composure index</div>
                <div className="mt-1 font-mono text-[8.5px] text-slate-400">{pacerCount} pacer cues</div>
                <div className="mt-1 font-mono text-[8px] text-slate-500">review on dashboard</div>
              </div>
            ) : (
              /* IdleView */
              <div className="flex flex-col items-center px-4 text-center">
                <div className="font-mono text-[9.5px] font-medium text-sky-400">ComposureIQ</div>
                <div className="mt-1.5 font-mono text-[8px] tracking-widest text-emerald-400">BASELINE READY</div>
                <div className="mt-0.5 max-w-[140px] truncate text-[9.5px] text-white">{calTitle}</div>
                <div className="mt-2 font-mono text-[13px] font-semibold leading-none text-white">
                  HR {hr != null ? Math.round(hr) : '--'} · HRV {rmssd != null ? Math.round(rmssd) : '--'}ms
                </div>
                <div className="mt-2 font-mono text-[8px] text-slate-400">
                  T-{minsLeft} min · press START for primer
                </div>
                <div className={`mt-2 font-mono text-[8.5px] ${source ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {source === 'watch' ? 'spine linked' : source ? 'sim active' : 'spine offline'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right hardware buttons */}
        <div className="flex shrink-0 flex-col items-start gap-11">
          <button
            type="button"
            onClick={handleStart}
            className={`${bezelBtn} border-accent/40 text-accent`}
            title="START: Advance stage (Baseline -> Primer -> Live Interview)"
          >
            START
          </button>
          <button
            type="button"
            onClick={handleBack}
            className={bezelBtn}
            title="BACK: Finish Interview when Live"
          >
            BACK
          </button>
        </div>
      </div>

      {/* Hardware Sensor Gate Summary pill */}
      <div className="mt-1.5 flex justify-center">
        <span
          className={`rounded-full border px-2.5 py-0.5 font-mono text-[9.5px] ${
            gate === 'SPEAKING'
              ? 'border-note/40 bg-note-soft text-note'
              : 'border-accent/30 bg-accent-soft text-accent'
          }`}
        >
          {gate === 'SPEAKING'
            ? '4 Motion/Cardio Active · 2 Optical Gated'
            : 'All 6 Garmin Sensors Active (Optical Trusted)'}
        </span>
      </div>
    </div>
  )
}
