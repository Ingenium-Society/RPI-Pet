import { useCallback, useEffect, useRef, useState } from 'react'
import { voice } from './audio/voice'
import BenchPanel from './components/BenchPanel'
import Bubble from './components/Bubble'
import CareBar from './components/CareBar'
import ChatInput from './components/ChatInput'
import Minigame from './components/Minigame'
import PetCanvas from './components/PetCanvas'
import QuestionChips from './components/QuestionChips'
import { isOrb, SKIN } from './game/skin'
import { useGame } from './game/store'
import { fetchHealth } from './net/api'

export default function App() {
  const setHealth = useGame((s) => s.setHealth)
  const tick = useGame((s) => s.tick)
  const [minigame, setMinigame] = useState(false)
  const closeGame = useCallback(() => setMinigame(false), [])
  // While the minigame is up the pet is unmounted; stop its clock too, so stats do not
  // decay and attract mode cannot talk over the game.
  const paused = useRef(false)
  paused.current = minigame

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
      if (!paused.current) tick(Math.min((now - last) / 1000, 1)) // clamp: a background tab can pause frames
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

  if (minigame) return <Minigame onExit={closeGame} />

  return (
    <main
      data-skin={SKIN}
      className={`relative h-screen w-screen overflow-hidden bg-mint text-ink ${isOrb ? 'skin-orb' : ''}`}
    >
      <PetCanvas />
      <Bubble />
      <BenchPanel />
      {isOrb && (
        <button
          type="button"
          data-orb="game"
          onClick={() => setMinigame(true)}
          className="absolute top-3.5 left-3.5 z-10 rounded-full px-3.5 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8d68e]"
        >
          Main game
        </button>
      )}
      {/* One dock, so the controls stack instead of fighting over bottom offsets. */}
      <div
        className={`absolute inset-x-0 bottom-[5%] z-10 mx-auto flex flex-col gap-2.5 ${
          isOrb ? 'w-[min(700px,calc(100vw-2rem))]' : 'w-[min(560px,calc(100vw-2rem))]'
        }`}
      >
        <CareBar />
        <ChatInput />
        <QuestionChips />
      </div>
    </main>
  )
}
