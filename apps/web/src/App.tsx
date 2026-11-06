import { useEffect } from 'react'
import { voice } from './audio/voice'
import BenchPanel from './components/BenchPanel'
import Bubble from './components/Bubble'
import ChatInput from './components/ChatInput'
import PetCanvas from './components/PetCanvas'
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
      <ChatInput />
      <BenchPanel />
    </main>
  )
}
