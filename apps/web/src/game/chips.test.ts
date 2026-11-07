import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHIPS, CHIPS_PER_PAGE, chipsOnPage } from './chips'

// The Rust eval test proves the same questions retrieve the same facts. Keeping this test
// next to the chips stops a chip from drifting away from the data that backs the answer.
const data = (name: string) => new URL(`../../../../data/${name}`, import.meta.url)
const facts = JSON.parse(readFileSync(data('facts.json'), 'utf8')) as {
  id: string
  public: boolean
}[]
const evalSet = JSON.parse(readFileSync(data('eval/questions.json'), 'utf8')) as {
  questions: { q: string; lang: string; expect: string | null }[]
}

describe('question chips', () => {
  it('points only at public facts', () => {
    const publicIds = new Set(facts.filter((f) => f.public).map((f) => f.id))
    for (const chip of CHIPS) {
      expect(publicIds.has(chip.factId), `${chip.q} -> ${chip.factId}`).toBe(true)
    }
  })

  it('is verified against the real retrieval eval set', () => {
    const verified = new Map(evalSet.questions.map((q) => [q.q, q]))
    for (const chip of CHIPS) {
      const entry = verified.get(chip.q)
      expect(entry, `missing from data/eval/questions.json: ${chip.q}`).toBeDefined()
      expect(entry?.expect, `wrong expect for ${chip.q}`).toBe(chip.factId)
      expect(entry?.lang).toBe('id')
    }
  })

  it('has no duplicate questions', () => {
    expect(new Set(CHIPS.map((c) => c.q)).size).toBe(CHIPS.length)
  })

  it('always fills a page with distinct suggestions', () => {
    for (let page = -2; page < 40; page++) {
      const pageChips = chipsOnPage(page)
      expect(pageChips).toHaveLength(CHIPS_PER_PAGE)
      expect(new Set(pageChips.map((c) => c.q)).size).toBe(CHIPS_PER_PAGE)
      expect(pageChips.every((c) => CHIPS.includes(c))).toBe(true)
    }
  })
})
