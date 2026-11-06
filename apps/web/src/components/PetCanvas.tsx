import { useEffect, useRef } from 'react'
import { emotionFor } from '../game/rules'
import { PetScene } from '../game/scene'
import { useGame } from '../game/store'

export default function PetCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scene = new PetScene(() => {
      const s = useGame.getState()
      return {
        emotion: s.busy ? 'thinking' : emotionFor(s.stats),
        talking: performance.now() < s.speakingUntil,
      }
    })
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
