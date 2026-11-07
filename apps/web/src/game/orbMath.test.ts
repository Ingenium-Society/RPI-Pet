import { describe, expect, it } from 'vitest'
import {
  ORB,
  blink,
  breath,
  clamp01,
  easeInOutSine,
  approachPalette,
  easeOutCubic,
  lerp,
  paletteToLive,
  lissajous,
  mixColor,
  paletteFor,
  polylineLength,
  polylinePoint,
  reactionPulse,
  ringRadius,
  smoothstep,
  sparkPosition,
  waveformY,
} from './orbMath'

describe('easing', () => {
  it('clamps and lerps', () => {
    expect(clamp01(-2)).toBe(0)
    expect(clamp01(3)).toBe(1)
    expect(lerp(10, 20, 0.25)).toBe(12.5)
  })

  it('smoothstep is 0/1 at the edges and monotone', () => {
    expect(smoothstep(0, 1, 0)).toBe(0)
    expect(smoothstep(0, 1, 1)).toBe(1)
    expect(smoothstep(0, 1, -5)).toBe(0)
    const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map((x) => smoothstep(0, 1, x))
    expect(samples.every((v, i) => i === 0 || v >= samples[i - 1])).toBe(true)
  })

  it('cubic ease and sine ease both start at 0 and end at 1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeInOutSine(0)).toBeCloseTo(0)
    expect(easeInOutSine(1)).toBeCloseTo(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5) // ease-out is front-loaded
  })
})

describe('colour', () => {
  it('mixes channels, not the packed integer', () => {
    expect(mixColor(0x000000, 0xffffff, 0)).toBe(0x000000)
    expect(mixColor(0x000000, 0xffffff, 1)).toBe(0xffffff)
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080)
    expect(mixColor(0xff0000, 0x0000ff, 0.5)).toBe(0x800080)
  })

  it('the sampled club palette is present', () => {
    expect(ORB.gold).toBe(0xbba553)
    expect(ORB.navy).toBe(0x282f57)
    expect(ORB.light).toBe(0xe8e8e8)
  })

  it('emotions are clearly ordered and distinct', () => {
    const p = (e: Parameters<typeof paletteFor>[0]) => paletteFor(e)
    expect(p('happy').glow).toBeGreaterThan(p('neutral').glow)
    expect(p('neutral').glow).toBeGreaterThan(p('sad').glow)
    expect(p('sad').glow).toBeGreaterThan(p('sleepy').glow)
    expect(p('thinking').pulseSpeed).toBeGreaterThan(p('neutral').pulseSpeed * 2)
    expect(p('sleepy').breathRate).toBeLessThan(p('happy').breathRate / 2)
    expect(p('sad').eyeTilt).toBeLessThan(0)
    expect(p('happy').eyeTilt).toBeGreaterThan(0)
    expect(p('sad').droop).toBeGreaterThan(p('happy').droop)
    // Sad is the cool one: its gold has more blue than red.
    expect((p('sad').gold & 0xff) - (p('sad').gold >> 16)).toBeGreaterThan(0)
  })

  it('palette cross-fade keeps the endpoints and moves monotonically', () => {
    const sad = paletteToLive(paletteFor('sad'))
    const happy = paletteFor('happy')
    expect(approachPalette(sad, happy, 0)).toEqual(sad)
    expect(approachPalette(sad, happy, 1).gold).toBe(happy.gold)
    expect(approachPalette(sad, happy, 1).glow).toBe(happy.glow)
    const mid = approachPalette(sad, happy, 0.5)
    expect(mid.glow).toBeGreaterThan(sad.glow)
    expect(mid.glow).toBeLessThan(happy.glow)
  })

  it('every emotion has finite, in-range numbers', () => {
    for (const e of ['neutral', 'happy', 'sad', 'sleepy', 'thinking'] as const) {
      const v = paletteFor(e)
      for (const n of [v.glow, v.intensity, v.breathRate, v.pulseSpeed, v.energy]) {
        expect(Number.isFinite(n)).toBe(true)
        expect(n).toBeGreaterThanOrEqual(0)
      }
      expect(v.glow).toBeLessThanOrEqual(1)
      expect(v.energy).toBeLessThanOrEqual(1)
    }
  })
})

describe('motion maths', () => {
  it('a quiet mouth is flat and a loud one stays bounded', () => {
    for (let u = 0; u <= 1; u += 0.1) expect(Math.abs(waveformY(u, 3.2, 0))).toBe(0)
    for (let t = 0; t < 4; t += 0.13) {
      for (let u = 0; u <= 1; u += 0.05) {
        expect(Math.abs(waveformY(u, t, 12))).toBeLessThanOrEqual(12.0001)
      }
    }
    expect(waveformY(0, 1, 12)).toBe(0)
    expect(waveformY(1, 1, 12)).toBeCloseTo(0)
  })

  it('breathing is a bounded sum of sines', () => {
    for (let t = 0; t < 20; t += 0.2) expect(Math.abs(breath(t, 1.1, 6))).toBeLessThanOrEqual(8.1)
    expect(breath(3, 1.1, 0)).toBe(0)
  })

  it('blink is periodic, short, and closed at the centre', () => {
    expect(blink(0.5 * 4, 4, 0.03)).toBe(1)
    expect(blink(0.1 * 4, 4, 0.03)).toBe(0)
    expect(blink(0.5 * 4 + 4, 4, 0.03)).toBe(1)
  })

  it('polyline interpolation is arc-length correct', () => {
    const line = [0, 0, 10, 0, 10, 10]
    expect(polylineLength(line)).toBe(20)
    expect(polylinePoint(line, 0)).toEqual({ x: 0, y: 0 })
    expect(polylinePoint(line, 1)).toEqual({ x: 10, y: 10 })
    expect(polylinePoint(line, 0.5)).toEqual({ x: 10, y: 0 })
    expect(polylinePoint(line, 0.25).x).toBeCloseTo(5)
    expect(polylinePoint(line, -3).x).toBe(0)
    expect(polylinePoint(line, 9).y).toBe(10)
  })

  it('Lissajous nodes stay inside their box', () => {
    for (let t = 0; t < 12; t += 0.07) {
      const p = lissajous(t, 2, 3, Math.PI / 4, 80, 50)
      expect(Math.abs(p.x)).toBeLessThanOrEqual(80.0001)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(50.0001)
    }
  })

  it('reaction envelope rises then fades to zero', () => {
    expect(reactionPulse(-1, 1)).toBe(0)
    expect(reactionPulse(0, 1)).toBe(0)
    expect(reactionPulse(0.2, 1)).toBeGreaterThan(0.5)
    expect(reactionPulse(1, 1)).toBe(0)
    expect(reactionPulse(9, 1)).toBe(0)
  })

  it('rings ripple outward in order and sparks sit on 45-degree rays', () => {
    expect(ringRadius(0, 1, 100)).toBeLessThan(0)
    expect(ringRadius(0.3, 0, 100)).toBeGreaterThan(0)
    for (let t = 0.5; t < 1.6; t += 0.1) {
      expect(ringRadius(t, 0, 100)).toBeGreaterThanOrEqual(ringRadius(t, 1, 100))
    }
    const s = sparkPosition(0, 8, 1, 40)
    expect(Math.abs(s.x - Math.cos(Math.PI / 8) * 40)).toBeLessThan(1e-9)
    expect(sparkPosition(0, 8, 0, 40)).toEqual({ x: 0, y: 0 })
  })
})
