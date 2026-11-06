export const MAX_INPUT_CHARS = 200 // keep in sync with pi-service
const REQUEST_TIMEOUT_MS = 20_000 // pi-service itself gives up after 12 s

export type Health = {
  status: string
  version: string
  llama_configured?: boolean
  // Optional telemetry for the benchmark panel. pi-service does not send these yet
  // (see the TODO in its health()); each row appears only when the field is present.
  model?: string
  tok_per_sec?: number
  cpu_temp_c?: number
  ram_free_mb?: number
}

export type ChatReply = { reply: string; source: 'llama' | 'mock' }

export async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch('/v1/health')
    return res.ok ? ((await res.json()) as Health) : null
  } catch {
    return null
  }
}

/** `styleHint` is the extra system-prompt text from game/rules.ts (may be empty). */
export async function askPet(message: string, styleHint: string): Promise<ChatReply> {
  const res = await fetch('/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, style_hint: styleHint }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `request failed (${res.status})`)
  }
  return (await res.json()) as ChatReply
}

// Fire-and-forget; only the Vite dev server has /__log, so failures are ignored.
export function logInteraction(entry: Record<string, unknown>) {
  fetch('/__log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ts: new Date().toISOString(), ...entry }),
  }).catch(() => {})
}
