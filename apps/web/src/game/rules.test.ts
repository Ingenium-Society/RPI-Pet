import { describe, expect, it } from 'vitest'
import { TUNING, afterVisitorMessage, applyCare, applyTouch, buildStyleHint, emotionFor, step } from './rules'

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

describe('instant care and touch actions', () => {
  it('each care action applies its own tuning', () => {
    const start = { energy: 40, happiness: 40 }
    expect(applyCare(start, 'feed')).toEqual({
      energy: 40 + TUNING.care.feed.energy,
      happiness: 40 + TUNING.care.feed.happiness,
    })
    expect(applyCare(start, 'play')).toEqual({
      energy: 40 + TUNING.care.play.energy,
      happiness: 40 + TUNING.care.play.happiness,
    })
    expect(applyCare(start, 'sleep')).toEqual({
      energy: 40 + TUNING.care.sleep.energy,
      happiness: 40 + TUNING.care.sleep.happiness,
    })
  })

  it('poking and a treat both raise happiness, a treat more', () => {
    const start = { energy: 50, happiness: 50 }
    const poke = applyTouch(start, 'poke')
    const treat = applyTouch(start, 'treat')
    expect(poke.happiness).toBeGreaterThan(50)
    expect(treat.happiness).toBeGreaterThan(poke.happiness)
  })

  it('never leaves the 0..100 range', () => {
    expect(applyCare({ energy: 99, happiness: 99 }, 'sleep')).toEqual({ energy: 100, happiness: 97 })
    expect(applyCare({ energy: 1, happiness: 1 }, 'play')).toEqual({ energy: 0, happiness: 21 })
    expect(applyTouch({ energy: 0, happiness: 100 }, 'poke')).toEqual({ energy: 0, happiness: 100 })
  })
})
