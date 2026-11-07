/**
 * Suggested questions for the booth. A tap sends the question straight to the Pi, so every
 * one of these MUST retrieve a public fact. Two guards keep that promise:
 *  - each question is also in `data/eval/questions.json` with the same `expect` (checked by
 *    `cargo test -p pet-core facts_eval` on the real retrieval code);
 *  - `chips.test.ts` checks that `factId` is a public fact in `data/facts.json`.
 * Keep them short: three fit on one row on a laptop.
 */
export type Chip = { q: string; factId: string }

export const CHIPS: Chip[] = [
  { q: 'Siapa ketua klub?', factId: 'club.leader' },
  { q: 'Siapa yang membuatmu?', factId: 'pet.makers' },
  { q: 'Ingenium itu apa?', factId: 'club.intro' },
  { q: 'Kamu siapa?', factId: 'pet.intro' },
  { q: 'Ada berapa anggota?', factId: 'club.members' },
  { q: 'Ada divisi apa saja?', factId: 'club.divisions' },
  { q: 'Kapan klub bertemu?', factId: 'club.meetings' },
  { q: 'Sekolahmu di mana?', factId: 'club.school' },
  { q: 'Pembinanya siapa?', factId: 'club.advisor' },
  { q: 'Siapa itu Haidar?', factId: 'me.intro' },
  { q: 'Rizky itu siapa?', factId: 'partner.intro' },
  { q: 'Kamu ini AI ya?', factId: 'pet.intro' },
  { q: 'Kamu itu robot?', factId: 'pet.intro' },
  { q: 'Kapan World Engineering Day?', factId: 'club.wed' },
  { q: 'Forge Outreach itu apa?', factId: 'club.outreach' },
  { q: 'House website itu buat apa?', factId: 'club.house' },
  { q: 'Apa itu Lab Fundamentals?', factId: 'club.lab' },
  { q: 'Di Workbench ngapain?', factId: 'club.workbench' },
  { q: 'Apa tujuan klub teknik ini?', factId: 'club.why' },
  { q: 'Divisi software ngapain aja?', factId: 'club.software' },
]

export const CHIPS_PER_PAGE = 3
export const CHIP_ROTATE_MS = 9000

/** Three suggestions for `page`. Wraps around, so pages never run out. */
export function chipsOnPage(page: number): Chip[] {
  const start = (((page * CHIPS_PER_PAGE) % CHIPS.length) + CHIPS.length) % CHIPS.length
  return Array.from({ length: CHIPS_PER_PAGE }, (_, i) => CHIPS[(start + i) % CHIPS.length])
}
