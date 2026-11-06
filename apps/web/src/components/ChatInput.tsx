import { useEffect, useRef, useState, type FormEvent } from 'react'
import { voice } from '../audio/voice'
import { useGame } from '../game/store'
import { MAX_INPUT_CHARS } from '../net/api'
import { S } from '../strings'

/** Text input below the character. */
export default function ChatInput() {
  const [input, setInput] = useState('')
  const busy = useGame((s) => s.busy)
  const online = useGame((s) => s.health !== null)
  const sendMessage = useGame((s) => s.sendMessage)
  const inputRef = useRef<HTMLInputElement>(null)
  const disabled = busy || !online

  useEffect(() => {
    if (!disabled) inputRef.current?.focus()
  }, [disabled])

  function submit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || disabled) return
    setInput('')
    voice.unlock() // this is a user gesture, so the browser allows audio from now on
    void sendMessage(text)
  }

  return (
    <form onSubmit={submit} className="absolute inset-x-0 bottom-[5%] mx-auto flex w-[min(560px,calc(100vw-2rem))] gap-2">
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        maxLength={MAX_INPUT_CHARS}
        disabled={disabled}
        autoComplete="off"
        aria-label={S.inputLabel}
        placeholder={!online ? S.placeholderOffline : busy ? S.placeholderBusy : S.placeholder}
        className="min-w-0 flex-1 rounded-2xl bg-white px-4 py-3.5 outline-none focus-visible:ring-4 focus-visible:ring-ink disabled:opacity-70"
      />
      <button
        type="submit"
        disabled={disabled || !input.trim()}
        className="rounded-2xl bg-raspberry px-5 font-bold text-white focus-visible:ring-4 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-50"
      >
        {S.send}
      </button>
    </form>
  )
}
