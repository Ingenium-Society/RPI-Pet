import { useGame } from '../game/store'

/** The pet's answer, above the character. */
export default function Bubble() {
  const bubble = useGame((s) => s.bubble)

  return (
    <div className="absolute inset-x-0 top-[5%] mx-auto w-[clamp(280px,calc(100vw-520px),600px)] rounded-3xl bg-white after:absolute after:-bottom-2 after:left-1/2 after:size-4 after:-translate-x-1/2 after:rotate-45 after:bg-white after:content-['']">
      <p
        aria-live="polite"
        className={
          'relative max-h-[26vh] overflow-y-auto whitespace-pre-wrap px-5 py-4 text-lg leading-relaxed ' +
          (bubble.kind === 'error' ? 'text-red-700' : bubble.kind === 'pending' ? 'text-ink/60' : '')
        }
      >
        {bubble.text}
      </p>
    </div>
  )
}
