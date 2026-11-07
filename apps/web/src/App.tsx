import { useEffect } from 'react'
import { voice } from './audio/voice'
import BenchPanel from './components/BenchPanel'
import Bubble from './components/Bubble'
import CareBar from './components/CareBar'
import ChatInput from './components/ChatInput'
import PetCanvas from './components/PetCanvas'
import QuestionChips from './components/QuestionChips'
import { useGame } from './game/store'
import { fetchHealth } from './net/api'

export default function App() {
  const setHealth = useGame((s) => s.setHealth)
  const tick = useGame((s) => s.tick)

  // Poll the Pi so the panel shows whether the USB link is up.
  useEffect(() => {
    let alive = true
    const poll = async () => {
      const health = await fetchHealth()
      if (alive) setHealth(health)
    }
    void poll()
    const id = setInterval(poll, 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [setHealth])

  // Game clock and audio level, once per frame.
  useEffect(() => {
    let last = performance.now()
    let raf = 0
    const loop = (now: number) => {
      tick(Math.min((now - last) / 1000, 1)) // clamp: a background tab can pause frames
      last = now
      voice.update()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [tick])

  useEffect(() => {
    const unlock = () => voice.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-mint text-ink">
      <PetCanvas />
      <Bubble />
      <BenchPanel />
      {/* One dock, so the controls stack instead of fighting over bottom offsets. */}
      <div className="absolute inset-x-0 bottom-[5%] z-10 mx-auto flex w-[min(560px,calc(100vw-2rem))] flex-col gap-2.5">
        <CareBar />
        <ChatInput />
        <QuestionChips />
      </div>
    </main>
  )
}
