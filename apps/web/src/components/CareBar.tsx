import { useId, useRef, useState, type PointerEvent } from 'react'
import { hitPet } from '../game/petTarget'
import type { CareAction } from '../game/rules'
import { isOrb } from '../game/skin'
import { useGame } from '../game/store'
import { S } from '../strings'

const CARE: { action: CareAction; label: string; dot: string }[] = [
  { action: 'feed', label: S.feed, dot: 'bg-orange-400' },
  { action: 'play', label: S.play, dot: 'bg-sky-400' },
  { action: 'sleep', label: S.sleep, dot: 'bg-indigo-400' },
]

const BUTTON =
  'flex items-center gap-1.5 rounded-full border-2 border-white bg-white/85 px-3.5 py-2 text-sm font-bold text-ink shadow-sm transition hover:-translate-y-0.5 hover:bg-lemon focus-visible:ring-4 focus-visible:ring-ink focus-visible:outline-none motion-reduce:transform-none'

/** A biscuit drawn with shapes rather than an emoji, so it looks the same everywhere. */
function Cookie({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="#b9763c" />
      <circle cx="16" cy="16" r="11" fill="#e6b476" />
      <g fill="#7a4a24">
        <circle cx="11" cy="11" r="2" />
        <circle cx="20" cy="9" r="1.8" />
        <circle cx="23" cy="18" r="2" />
        <circle cx="13" cy="21" r="1.8" />
        <circle cx="17" cy="16" r="1.6" />
      </g>
    </svg>
  )
}

/** Orb skin's treat: a glowing gold shard, same shape language as the gem. */
function Spark({ size = 20 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id={`spark-glow-${id}`}>
          <stop offset="0%" stopColor="#fff3bd" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#e0cc74" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#bba553" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill={`url(#spark-glow-${id})`} />
      <path
        d="M16 3 L18.8 13.2 L29 16 L18.8 18.8 L16 29 L13.2 18.8 L3 16 L13.2 13.2 Z"
        fill="#e8d68e"
        stroke="#fff3bd"
        strokeWidth="0.9"
      />
      <path d="M16 9.4 L17.4 14.6 L22.6 16 L17.4 17.4 L16 22.6 L14.6 17.4 L9.4 16 L14.6 14.6 Z" fill="#fff8dd" />
    </svg>
  )
}

type Drag = { x: number; y: number; over: boolean }

/** Care buttons plus a treat that can be dragged onto the companion. */
export default function CareBar() {
  const care = useGame((s) => s.care)
  const touch = useGame((s) => s.touch)
  const dragging = useRef(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const Treat = isOrb ? Spark : Cookie

  function down(e: PointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    setDrag({ x: e.clientX, y: e.clientY, over: false })
  }

  function move(e: PointerEvent<HTMLButtonElement>) {
    if (!dragging.current) return
    setDrag({ x: e.clientX, y: e.clientY, over: hitPet(e.clientX, e.clientY) })
  }

  function finish(e: PointerEvent<HTMLButtonElement>, drop: boolean) {
    if (!dragging.current) return
    dragging.current = false
    const over = hitPet(e.clientX, e.clientY)
    setDrag(null)
    if (drop && over) touch('treat')
  }

  return (
    <div role="group" aria-label={S.careLabel} className="flex flex-wrap items-center justify-center gap-2">
      {CARE.map((c) => (
        <button key={c.action} data-orb="care" type="button" onClick={() => care(c.action)} className={BUTTON}>
          <span aria-hidden="true" data-orb="dot" className={`size-2 rounded-full ${c.dot}`} />
          {c.label}
        </button>
      ))}
      <button
        data-orb="care"
        type="button"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(e) => finish(e, true)}
        onPointerCancel={(e) => finish(e, false)}
        aria-label={`${S.treat} — ${S.treatHint}`}
        className={`${BUTTON} touch-none select-none ${drag ? 'opacity-40' : ''}`}
      >
        <Treat />
        {S.treat}
      </button>
      <span data-orb="hint" className="text-xs font-medium text-ink/60">
        {S.treatHint}
      </span>

      {drag && (
        <div
          data-orb="ghost"
          data-over={drag.over}
          className={`pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-full p-1.5 shadow-lg transition-colors ${
            drag.over ? 'bg-lemon ring-4 ring-raspberry' : 'bg-white/90'
          }`}
          style={{ left: drag.x, top: drag.y }}
        >
          <Treat size={40} />
        </div>
      )}
    </div>
  )
}
