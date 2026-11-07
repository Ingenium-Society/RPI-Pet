import { useGame } from '../game/store'
import type { ChatSource } from '../net/api'
import { S } from '../strings'

// What the pet's answer was based on, in words a visitor at the booth can read.
const SOURCE_LABEL: Record<ChatSource, string> = {
  llama: 'model AI',
  fallback: 'kalimat cadangan',
  deflect: 'di luar topik',
  mock: 'tanpa model',
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <dt className="opacity-70">{label}</dt>
      <dd className="text-right font-bold tabular-nums">{value}</dd>
    </div>
  )
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="mb-1.5 grid grid-cols-[52px_1fr] items-center gap-2">
      <span>{label}</span>
      <div className="h-2.5 overflow-hidden rounded-md bg-slate-200">
        <div className="h-full bg-lemon transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

/** Benchmark data in the corner. Rows from the Pi's health endpoint appear once it reports them. */
export default function BenchPanel() {
  const health = useGame((s) => s.health)
  const last = useGame((s) => s.last)
  const stats = useGame((s) => s.stats)

  return (
    <aside aria-label={S.bench} className="absolute top-3.5 right-3.5 w-58 rounded-2xl bg-white/90 px-3.5 py-3 text-[0.85rem]">
      <h2 className="mb-2 font-bold">
        {S.bench}{' '}
        <small className={'ml-1 font-medium ' + (health ? 'text-emerald-700' : 'opacity-70')}>
          {health ? `${S.connected} (v${health.version})` : S.disconnected}
        </small>
      </h2>
      <dl>
        {health?.llama_up != null && <Row label="Otak AI" value={health.llama_up ? 'aktif' : 'mati'} />}
        {health?.model && <Row label="Model" value={health.model} />}
        <Row label="Sumber jawaban" value={last ? SOURCE_LABEL[last.source] : '-'} />
        {last?.factId && <Row label="Fakta" value={last.factId} />}
        <Row label="Waktu jawab" value={last ? fmtMs(last.ms) : '-'} />
        <Row label="Panjang jawaban" value={last ? `${last.chars} karakter` : '-'} />
        {health?.tok_per_sec != null && <Row label="Kecepatan" value={`${health.tok_per_sec.toFixed(1)} token/detik`} />}
        {health?.cpu_temp_c != null && <Row label="Suhu CPU" value={`${health.cpu_temp_c.toFixed(0)} °C`} />}
        {health?.ram_free_mb != null && <Row label="RAM bebas" value={`${health.ram_free_mb.toFixed(0)} MB`} />}
        {health?.throttled != null && <Row label="Throttling" value={health.throttled ? 'YA' : 'tidak'} />}
      </dl>
      <div className="mt-2.5 border-t border-slate-200 pt-2.5">
        <Bar label={S.energy} value={stats.energy} />
        <Bar label={S.happiness} value={stats.happiness} />
      </div>
    </aside>
  )
}
