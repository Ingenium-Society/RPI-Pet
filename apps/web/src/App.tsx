import { useEffect, useRef, useState, type FormEvent } from 'react'

type Health = { status: string; version: string }
type ChatReply = { reply: string; source: 'llama' | 'mock' }
type Message = { role: 'user' | 'pet' | 'error'; text: string }

const MAX_INPUT_CHARS = 200 // keep in sync with pi-service

// Fire-and-forget; only the Vite dev server has /__log, so failures are ignored.
function logInteraction(entry: Record<string, unknown>) {
  fetch('/__log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ts: new Date().toISOString(), ...entry }),
  }).catch(() => {})
}

async function askPet(message: string): Promise<ChatReply> {
  const res = await fetch('/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `request failed (${res.status})`)
  }
  return (await res.json()) as ChatReply
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Poll the Pi so the header shows whether the USB link is up.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/v1/health')
        const data = (await res.json()) as Health
        if (alive) setHealth(data)
      } catch {
        if (alive) setHealth(null)
      }
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    setMessages((m) => [...m, { role: 'user', text }])

    const started = performance.now()
    try {
      const { reply, source } = await askPet(text)
      setMessages((m) => [...m, { role: 'pet', text: reply }])
      logInteraction({ message: text, reply, source, ms: Math.round(performance.now() - started) })
    } catch (err) {
      const error = err instanceof Error ? err.message : 'something went wrong'
      setMessages((m) => [...m, { role: 'error', text: error }])
      logInteraction({ message: text, error, ms: Math.round(performance.now() - started) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex h-screen max-w-xl flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h1 className="text-xl font-bold">Pet</h1>
        <p className="text-sm">
          Pi:{' '}
          {health ? (
            <span className="text-emerald-400">connected (v{health.version})</span>
          ) : (
            <span className="text-amber-400">not reachable</span>
          )}
        </p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-slate-400">Say something to your pet.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <p
              className={
                'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ' +
                (m.role === 'user'
                  ? 'bg-indigo-600'
                  : m.role === 'pet'
                    ? 'bg-slate-700'
                    : 'bg-red-900/60 text-red-200')
              }
            >
              {m.text}
            </p>
          </div>
        ))}
        {busy && <p className="text-sm text-slate-400">Pet is thinking…</p>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-slate-700 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={MAX_INPUT_CHARS}
          placeholder="Type a message…"
          autoFocus
          className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </main>
  )
}
