import { useState } from 'react'
import FlightRecorder from './components/FlightRecorder'
import Navbar from './components/Navbar'
import PhaseBanner, { DebriefBanner } from './components/PhaseBanner'
import SensorStrip from './components/SensorStrip'
import { Callouts, Transcript } from './components/SidePanels'
import StagePanel from './components/StagePanel'
import { useMic, useSpine } from './hooks'
import { ALL_8_CHANNELS, CORE_CHANNELS } from './sensors'

const PACER_FLASH_S = 4

export default function App() {
  const spine = useSpine()
  const mic = useMic()
  const [view, setView] = useState({ mode: 'live' })
  const [activeChannels, setActiveChannels] = useState(CORE_CHANNELS)
  const { telemetry, stage, events } = spine
  const row = telemetry[telemetry.length - 1]
  const phase = row?.phase ?? stage?.phase ?? 'IDLE'
  const gate = row?.gate ?? stage?.gate ?? 'LISTENING'
  const now = row?.t ?? 0
  const lastPacer = [...events].reverse().find((e) => e.kind === 'pacer')
  const pacerActive = !!lastPacer && now - lastPacer.t <= PACER_FLASH_S
  const jump = (t) => setView({ mode: 'zoom', from: Math.max(0, t - 10), to: t + 25 })

  const toggleChannel = (key) => {
    setActiveChannels((prev) => {
      if (prev.includes(key)) {
        return prev.length > 1 ? prev.filter((k) => k !== key) : prev
      }
      return ALL_8_CHANNELS.filter((k) => prev.includes(k) || k === key)
    })
  }

  const ensureChannel = (key) => {
    setActiveChannels((prev) => (prev.includes(key) ? prev : ALL_8_CHANNELS.filter((k) => prev.includes(k) || k === key)))
  }

  const hasQuestions = spine.transcript.some((l) => l.is_question)

  return (
    <div className="min-h-full">
      <Navbar spine={spine} mic={mic} pacerActive={pacerActive} />

      <main className="grid grid-cols-1 gap-3 p-4 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-3">
          <PhaseBanner
            telemetry={telemetry}
            stage={stage}
            events={events}
            callouts={spine.callouts}
            transcript={spine.transcript}
            pacerActive={pacerActive}
            onSelectChannel={ensureChannel}
          />
          <SensorStrip
            telemetry={telemetry}
            gate={gate}
            activeChannels={activeChannels}
            onToggleChannel={toggleChannel}
          />
          <div style={{ minHeight: Math.max(600, activeChannels.length * 76 + 120) }}>
            <FlightRecorder
              telemetry={telemetry}
              transcript={spine.transcript}
              events={events}
              callouts={spine.callouts}
              view={view}
              setView={setView}
              activeChannels={activeChannels}
              setActiveChannels={setActiveChannels}
            />
          </div>
          {phase === 'DONE' && (
            <DebriefBanner
              telemetry={telemetry}
              events={events}
              callouts={spine.callouts}
              transcript={spine.transcript}
              stage={stage}
              onSelectChannel={ensureChannel}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <StagePanel telemetry={telemetry} events={events} stage={stage} pacerActive={pacerActive} />
          <div className="flex h-[430px] flex-col">
            <Transcript
              transcript={spine.transcript}
              interim={spine.interim}
              callouts={spine.callouts}
              mic={mic}
              stage={stage}
              onJump={jump}
            />
          </div>
          <div className="flex h-[320px] flex-col">
            <Callouts callouts={spine.callouts} hasQuestions={hasQuestions} onJump={jump} />
          </div>
        </div>
      </main>
    </div>
  )
}
