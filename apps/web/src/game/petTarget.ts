/**
 * The pet is drawn on a canvas, so DOM controls cannot hit-test it with `elementFromPoint`.
 * The scene publishes its hit test here; the draggable treat asks `hitPet()` on pointer-up.
 * Identity-checked clearing keeps React StrictMode's double mount from unregistering the
 * scene that actually won.
 */
type HitTest = (clientX: number, clientY: number) => boolean

let current: HitTest | null = null

export function setPetHitTest(fn: HitTest) {
  current = fn
}

export function clearPetHitTest(fn: HitTest) {
  if (current === fn) current = null
}

export function hitPet(clientX: number, clientY: number): boolean {
  return current?.(clientX, clientY) ?? false
}
