import { describe, expect, it } from 'vitest'
import { TUNING, afterVisitorMessage, buildStyleHint, emotionFor, step } from './rules'

describe('emotionFor', () => {
  it('is neutral in a normal mood', () => {
    expect(emotionFor({ energy: 60, happiness: 50 })).toBe('neutral')
  })
  it('is happy when happiness is high', () => {
    expect(emotionFor({ energy: 60, happiness: 90 })).toBe('happy')
  })
  it('is sad when happiness is low', () => {
    expect(emotionFor({ energy: 60, happiness: 10 })).toBe('sad')
  })
  it('sleepy wins over sad', () => {
    expect(emotionFor({ energy: 10, happiness: 10 })).toBe('sleepy')
  })
})

describe('buildStyleHint', () => {
  it('is empty in a normal mood', () => {
    expect(buildStyleHint({ energy: 80, happiness: 50 })).toBe('')
  })
  it('asks for very short answers when sleepy', () => {
    expect(buildStyleHint({ energy: 10, happiness: 50 })).toContain('very short')
  })
  it('combines energy and happiness rules', () => {
    const hint = buildStyleHint({ energy: 40, happiness: 90 })
    expect(hint).toContain('tired')
    expect(hint).toContain('cheerful')
  })
})

describe('stat changes', () => {
  it('a message costs energy and adds happiness', () => {
    const next = afterVisitorMessage({ energy: 50, happiness: 50 })
    expect(next.energy).toBe(50 + TUNING.perMessage.energy)
    expect(next.happiness).toBe(50 + TUNING.perMessage.happiness)
  })
  it('stays within 0..100', () => {
    expect(afterVisitorMessage({ energy: 2, happiness: 99 })).toEqual({ energy: 0, happiness: 100 })
    expect(step({ energy: 0, happiness: 0 }, 100, 0)).toEqual({ energy: 0, happiness: 0 })
  })
  it('energy drains while active and recovers while resting', () => {
    const start = { energy: 50, happiness: 50 }
    expect(step(start, 10, 0).energy).toBeLessThan(50)
    expect(step(start, 10, TUNING.restAfterSec + 1).energy).toBeGreaterThan(50)
  })
  it('happiness always decays with time', () => {
    expect(step({ energy: 50, happiness: 50 }, 10, 100).happiness).toBeLessThan(50)
  })
})
