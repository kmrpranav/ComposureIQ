import { useState } from 'react'
import FlightRecorder from './components/FlightRecorder'
import Navbar from './components/Navbar'
import SensorStrip from './components/SensorStrip'
import { Callouts, Transcript } from './components/SidePanels'
import StagePanel from './components/StagePanel'
import { useMic, useSpine } from './hooks'

const PACER_FLASH_S = 4

export default function App() {
  const spine = useSpine()
  const mic = useMic()
  const [view, setView] = useState({ mode: 'live' })
  const { telemetry, stage, events } = spine
  const row = telemetry[telemetry.length - 1]
  const gate = row?.gate ?? stage?.gate ?? 'LISTENING'
  const now = row?.t ?? 0
  const lastPacer = [...events].reverse().find((e) => e.kind === 'pacer')
  const pacerActive = !!lastPacer && now - lastPacer.t <= PACER_FLASH_S
  const jump = (t) => setView({ mode: 'zoom', from: Math.max(0, t - 10), to: t + 25 })

  return (
    <div className="min-h-full">
      <Navbar spine={spine} mic={mic} pacerActive={pacerActive} />

      <main className="grid grid-cols-1 gap-3 p-4 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-3">
          <SensorStrip telemetry={telemetry} gate={gate} />
          <div className="h-[600px]">
            <FlightRecorder telemetry={telemetry} transcript={spine.transcript} events={events}
              callouts={spine.callouts} view={view} setView={setView} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <StagePanel telemetry={telemetry} events={events} stage={stage} />
          <div className="flex h-[340px] flex-col">
            <Transcript transcript={spine.transcript} interim={spine.interim} callouts={spine.callouts} onJump={jump} />
          </div>
          <div className="flex h-[340px] flex-col">
            <Callouts callouts={spine.callouts} onJump={jump} />
          </div>
        </div>
      </main>
    </div>
  )
}
