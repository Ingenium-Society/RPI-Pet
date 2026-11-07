/**
 * Pure maths for the orb skin: no Pixi, no DOM, no time source. Everything here is a
 * deterministic function of its arguments, so the motion is reproducible and testable.
 * Palette sampled from the club identity: gold #bba553, navy #282f57, grey #e8e8e8.
 */
import type { Emotion } from './rules'

export type Point = { x: number; y: number }

export type OrbPalette = {
  gold: number
  goldLight: number
  navy: number
  navyLight: number
  /** 0..1 strength of the additive halo. */
  glow: number
  /** 0..1 brightness multiplier for body and traces. */
  intensity: number
  /** Radians per second of the breathing oscillator. */
  breathRate: number
  /** Trace-pulse cycles per second. */
  pulseSpeed: number
  /** Eye tilt in radians; positive tilts the outer end up. */
  eyeTilt: number
  /** Downward droop as a fraction of the gem radius. */
  droop: number
  /** 0..1 liveliness: ambient sparks and orbiting nodes. */
  energy: number
}

export const ORB = {
  gold: 0xbba553,
  goldLight: 0xf0dfa0,
  navy: 0x282f57,
  deep: 0x0a0e20,
  light: 0xe8e8e8,
} as const

const PALETTES: Record<Emotion, OrbPalette> = {
  neutral: {
    gold: ORB.gold, goldLight: 0xf0dfa0, navy: 0x131a38, navyLight: 0x3d4a86,
    glow: 0.58, intensity: 1, breathRate: 1.05, pulseSpeed: 0.18,
    eyeTilt: 0, droop: 0, energy: 0.3,
  },
  happy: {
    gold: 0xe0cc74, goldLight: 0xfff3bd, navy: 0x1c2652, navyLight: 0x4a5696,
    glow: 0.95, intensity: 1.2, breathRate: 1.6, pulseSpeed: 0.32,
    eyeTilt: 0.22, droop: -0.025, energy: 1,
  },
  sad: {
    gold: 0x86a6e0, goldLight: 0xc8dcff, navy: 0x0e1734, navyLight: 0x273a72,
    glow: 0.26, intensity: 0.7, breathRate: 0.68, pulseSpeed: 0.09,
    eyeTilt: -0.24, droop: 0.055, energy: 0.1,
  },
  sleepy: {
    gold: 0x8d855c, goldLight: 0xc0b681, navy: 0x0c1129, navyLight: 0x232c58,
    glow: 0.2, intensity: 0.58, breathRate: 0.42, pulseSpeed: 0.055,
    eyeTilt: -0.09, droop: 0.035, energy: 0.04,
  },
  thinking: {
    gold: 0xdcc674, goldLight: 0xffefb0, navy: 0x141c40, navyLight: 0x434f92,
    glow: 0.82, intensity: 1.12, breathRate: 1.32, pulseSpeed: 0.75,
    eyeTilt: 0.15, droop: 0, energy: 0.85,
  },
}

export function paletteFor(emotion: Emotion): OrbPalette {
  return PALETTES[emotion]
}

/** A palette with every field interpolated, so mood changes cross-fade instead of snapping. */
export type LivePalette = Omit<OrbPalette, never>

export function paletteToLive(p: OrbPalette): LivePalette {
  return { ...p }
}

export function approachPalette(live: LivePalette, target: OrbPalette, t: number): LivePalette {
  const u = clamp01(t)
  return {
    gold: mixColor(live.gold, target.gold, u),
    goldLight: mixColor(live.goldLight, target.goldLight, u),
    navy: mixColor(live.navy, target.navy, u),
    navyLight: mixColor(live.navyLight, target.navyLight, u),
    glow: lerp(live.glow, target.glow, u),
    intensity: lerp(live.intensity, target.intensity, u),
    breathRate: lerp(live.breathRate, target.breathRate, u),
    pulseSpeed: lerp(live.pulseSpeed, target.pulseSpeed, u),
    eyeTilt: lerp(live.eyeTilt, target.eyeTilt, u),
    droop: lerp(live.droop, target.droop, u),
    energy: lerp(live.energy, target.energy, u),
  }
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const u = clamp01((x - edge0) / (edge1 - edge0 || 1))
  return u * u * (3 - 2 * u)
}

export function easeOutCubic(t: number): number {
  const u = clamp01(t)
  return 1 - (1 - u) ** 3
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * clamp01(t)) - 1) / 2
}

/** Channel-wise colour interpolation, used to cross-fade between emotion palettes. */
export function mixColor(a: number, b: number, t: number): number {
  const u = clamp01(t)
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  const r = Math.round(lerp(ar, br, u))
  const g = Math.round(lerp(ag, bg, u))
  const bl = Math.round(lerp(ab, bb, u))
  return (r << 16) | (g << 8) | bl
}

/** Sum of sines. `u` in [0,1] across the mouth; returns a value within [-amp, amp]. */
export function waveformY(u: number, t: number, amp: number): number {
  const envelope = Math.sin(Math.PI * clamp01(u))
  const a = Math.sin(u * Math.PI * 3 + t * 9)
  const b = Math.sin(u * Math.PI * 7 - t * 6.3)
  return amp * envelope * (0.62 * a + 0.38 * b)
}

/** Sum-of-sines breathing: two incommensurate frequencies keep the hover from looping visibly. */
export function breath(t: number, rate: number, amp: number): number {
  return amp * (Math.sin(t * rate) + 0.35 * Math.sin(t * rate * 1.73 + 1.1))
}

/** 0 = eyes open, 1 = fully closed. One short blink every `period` seconds. */
export function blink(t: number, period: number, width: number): number {
  const p = ((t % period) + period) % period / period
  const d = Math.abs(p - 0.5)
  return 1 - smoothstep(0, width, d)
}

/** Total arc length of a flat [x0,y0,x1,y1,...] polyline. */
export function polylineLength(points: readonly number[]): number {
  let total = 0
  for (let i = 2; i + 1 < points.length; i += 2) {
    total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1])
  }
  return total
}

/** Point at arc-length fraction `t` along a flat polyline, so pulses move at constant speed. */
export function polylinePoint(points: readonly number[], t: number): Point {
  if (points.length < 4) return { x: points[0] ?? 0, y: points[1] ?? 0 }
  const target = clamp01(t) * polylineLength(points)
  let walked = 0
  for (let i = 2; i + 1 < points.length; i += 2) {
    const ax = points[i - 2], ay = points[i - 1]
    const bx = points[i], by = points[i + 1]
    const seg = Math.hypot(bx - ax, by - ay)
    if (seg === 0) continue
    if (walked + seg >= target) {
      const u = (target - walked) / seg
      return { x: lerp(ax, bx, u), y: lerp(ay, by, u) }
    }
    walked += seg
  }
  return { x: points[points.length - 2], y: points[points.length - 1] }
}

/** Lissajous orbit for the thinking nodes. Always inside the rx/ry box. */
export function lissajous(t: number, a: number, b: number, delta: number, rx: number, ry: number): Point {
  return { x: rx * Math.sin(a * t + delta), y: ry * Math.sin(b * t) }
}

/** A reaction's attack/decay envelope: fast rise, quadratic fade. */
export function reactionPulse(elapsed: number, duration: number): number {
  const u = clamp01(elapsed / duration)
  return smoothstep(0, 0.09, u) * (1 - u) ** 2
}

/** Radius of ripple `index` of `count` at time `elapsed`; negative means not started. */
export function ringRadius(elapsed: number, index: number, maxR: number): number {
  const u = (elapsed - index * 0.24) / 1.7
  return u <= 0 ? -1 : easeOutCubic(u) * maxR
}

/** One spark of a burst: 8 directions at 0/45/90 degrees, eased outward. */
export function sparkPosition(index: number, count: number, progress: number, radius: number): Point {
  const angle = (index / count) * Math.PI * 2 + Math.PI / 8
  const r = radius * easeOutCubic(progress)
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
}
