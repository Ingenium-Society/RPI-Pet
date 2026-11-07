import { useEffect, useRef } from 'react'
import { emotionFor, type Emotion } from '../game/rules'
import { sceneClass } from '../game/skin'
import { useGame } from '../game/store'

export default function PetCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const Scene = sceneClass()
    const scene = new Scene(
      () => {
        const s = useGame.getState()
        const now = performance.now()
        const sleepy = now < s.sleepUntil
        const emotion: Emotion = s.busy ? 'thinking' : sleepy ? 'sleepy' : emotionFor(s.stats)
        return {
          emotion,
          talking: now < s.speakingUntil,
          sleepy,
          reaction: s.reaction,
        }
      },
      () => useGame.getState().touch('poke'),
    )
    // init is async; wait for it before destroying so StrictMode's double mount is safe.
    const ready = scene.init(hostRef.current!).then(
      () => true,
      (err) => {
        console.error('Pixi init failed', err)
        return false
      },
    )
    return () => {
      void ready.then((ok) => ok && scene.destroy())
    }
  }, [])

  return <div ref={hostRef} className="absolute inset-0" />
}
