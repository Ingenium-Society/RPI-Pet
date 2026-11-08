import { useEffect, useRef, useState } from 'react'
import { ShooterScene, type Snapshot } from '../game/minigame/shooterScene'

const BEST_KEY = 'orb-minigame-best'
const START: Snapshot = { phase: 'intro', score: 0, lives: 3, wave: 1 }

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

function Diamond({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={`size-2.5 rotate-45 ${on ? 'bg-[#e8d68e]' : 'bg-white/15'}`} />
}

const PRIMARY =
  'rounded-full bg-gradient-to-br from-[#e0cc74] to-[#a9903f] px-6 py-2.5 text-sm font-black tracking-wide text-[#10152e] shadow-[0_0_22px_rgba(187,165,83,0.35)] transition hover:from-[#f5e6a8] hover:to-[#c9ae55] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8d68e]'
const GHOST =
  'rounded-full border border-[#bba553]/45 px-5 py-2 text-sm font-bold text-[#e8d68e] transition hover:bg-[#bba553]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8d68e]'

/** Full-screen minigame. Replaces the pet while it is open; `onExit` brings the pet back. */
export default function Minigame({ onExit }: { onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ShooterScene | null>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit
  const [snap, setSnap] = useState<Snapshot>(START)
  const [best, setBest] = useState(readBest)

  useEffect(() => {
    const scene = new ShooterScene(setSnap, () => exitRef.current())
    sceneRef.current = scene
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

  useEffect(() => {
    if (snap.phase !== 'over' || snap.score <= best) return
    setBest(snap.score)
    try {
      localStorage.setItem(BEST_KEY, String(snap.score))
    } catch {
      /* private mode: the score just is not remembered */
    }
  }, [snap.phase, snap.score, best])

  return (
    <div className="fixed inset-0 z-50 select-none overflow-hidden bg-[#070a18] text-[#e8e8e8]">
      <div ref={hostRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-5 py-4 text-[0.72rem] font-bold tracking-[0.22em] uppercase">
        <div>
          <span className="opacity-60">Skor </span>
          <span className="tabular-nums text-[#f0dfa0]">{snap.score}</span>
        </div>
        <div className="opacity-60">Gelombang {snap.wave}</div>
        <div className="flex gap-1.5 pt-0.5" aria-label={`${snap.lives} nyawa`}>
          {[0, 1, 2].map((i) => (
            <Diamond key={i} on={i < snap.lives} />
          ))}
        </div>
      </div>

      {snap.phase === 'playing' && (
        <button type="button" onClick={onExit} className={`${GHOST} absolute right-4 bottom-4 opacity-70`}>
          Keluar
        </button>
      )}

      {snap.phase === 'intro' && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="w-[min(430px,100%)] rounded-3xl border border-[#bba553]/40 bg-[#101632]/92 p-7 text-center shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur">
            <p className="text-[0.66rem] font-bold tracking-[0.34em] text-[#bba553] uppercase">Ingenium Society</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-[#f0dfa0]">Pertahanan Orbit</h1>
            <p className="mt-3 text-sm leading-relaxed text-[#c9cee0]">
              Geser dengan panah kiri/kanan atau seret di layar. Tembakan otomatis.
            </p>
            <p className="mt-2 text-xs text-[#9aa3c4]">Rekor: {best}</p>
            <div className="mt-6 flex flex-col items-center gap-2">
              <button type="button" onClick={() => sceneRef.current?.start()} className={PRIMARY}>
                Mulai
              </button>
              <button type="button" onClick={onExit} className={GHOST}>
                Keluar
              </button>
            </div>
          </div>
        </div>
      )}

      {snap.phase === 'over' && (
        <div className="absolute inset-0 grid place-items-center bg-[#070a18]/55 p-6">
          <div className="w-[min(400px,100%)] rounded-3xl border border-[#bba553]/40 bg-[#101632]/94 p-7 text-center shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur">
            <p className="text-[0.66rem] font-bold tracking-[0.34em] text-[#bba553] uppercase">Selesai</p>
            <p className="mt-3 text-4xl font-black tabular-nums text-[#f0dfa0]">{snap.score}</p>
            <p className="mt-1 text-xs text-[#9aa3c4]">
              Rekor: {best} · Gelombang {snap.wave}
            </p>
            <div className="mt-6 flex flex-col items-center gap-2">
              <button type="button" onClick={() => sceneRef.current?.start()} className={PRIMARY}>
                Main lagi
              </button>
              <button type="button" onClick={onExit} className={GHOST}>
                Kembali ke teman virtual
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
