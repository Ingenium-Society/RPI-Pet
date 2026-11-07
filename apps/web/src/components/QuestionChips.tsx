import { useEffect, useState } from 'react'
import { voice } from '../audio/voice'
import { CHIP_ROTATE_MS, chipsOnPage } from '../game/chips'
import { useGame } from '../game/store'
import { S } from '../strings'

/** Suggested questions under the chat box. One tap sends the question to the Pi. */
export default function QuestionChips() {
  const [page, setPage] = useState(0)
  const busy = useGame((s) => s.busy)
  const online = useGame((s) => s.health !== null)
  const sendMessage = useGame((s) => s.sendMessage)
  const disabled = busy || !online

  // Rotate while the booth is unattended so passers-by see new prompts. Pause during a
  // reply: swapping the words under someone's finger mid-question is not helpful.
  useEffect(() => {
    if (busy) return
    const id = setInterval(() => setPage((p) => p + 1), CHIP_ROTATE_MS)
    return () => clearInterval(id)
  }, [busy])

  function tap(question: string) {
    if (disabled) return
    voice.unlock()
    setPage((p) => p + 1) // a fresh set when the visitor comes back for another go
    void sendMessage(question)
  }

  return (
    <div aria-label={S.suggestionsLabel} className="flex flex-wrap items-center justify-center gap-2">
      <span data-orb="chip-label" className="text-sm font-bold text-ink/70">
        {S.suggestions}
      </span>
      {chipsOnPage(page).map((chip) => (
        <button
          data-orb="chip"
          key={chip.q}
          type="button"
          disabled={disabled}
          onClick={() => tap(chip.q)}
          className="rounded-full border-2 border-white bg-white/85 px-3.5 py-2 text-sm font-semibold text-ink shadow-sm transition hover:-translate-y-0.5 hover:bg-lemon focus-visible:ring-4 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-50 motion-reduce:transform-none"
        >
          {chip.q}
        </button>
      ))}
    </div>
  )
}
