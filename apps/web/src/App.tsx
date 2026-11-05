import { useEffect, useState } from 'react'

type Health = { status: string; version: string }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)

  // Placeholder: proves the Vite proxy -> pi-service path works.
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

  return (
    <main className="grid min-h-screen place-items-center bg-slate-900 text-slate-100">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Pet</h1>
        <p className="mt-2 text-sm">
          Pi:{' '}
          {health ? (
            <span className="text-emerald-400">connected (v{health.version})</span>
          ) : (
            <span className="text-amber-400">not reachable</span>
          )}
        </p>
      </div>
    </main>
  )
}
