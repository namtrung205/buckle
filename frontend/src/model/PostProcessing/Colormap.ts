import * as THREE from 'three'

/**
 * Diverging colormap (deep blue -> green -> deep red) with the green at zero
 * and NO white in the gradient. Zero-centered: blue = most negative, green = 0,
 * red = most positive.
 */
const STOPS: { t: number; color: THREE.Color }[] = [
  { t: 0.0, color: new THREE.Color(0x1e56b4) },
  { t: 0.25, color: new THREE.Color(0x2f7aa8) },
  { t: 0.5, color: new THREE.Color(0x2e9e50) },
  { t: 0.75, color: new THREE.Color(0xd19a2e) },
  { t: 1.0, color: new THREE.Color(0xc62828) },
]

/** Linearly interpolate the colormap at t in [0, 1] (0 = most negative, 0.5 = zero, 1 = most positive). */
export function lerpStops(t: number): THREE.Color {
  const clamped = Math.min(1, Math.max(0, t))
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]
    const b = STOPS[i + 1]
    if (clamped <= b.t) {
      const local = b.t === a.t ? 0 : (clamped - a.t) / (b.t - a.t)
      return a.color.clone().lerp(b.color, local)
    }
  }
  return STOPS[STOPS.length - 1].color.clone()
}

/**
 * Map a value to a colormap position using a zero-centered normalization:
 * -min/max magnitude maps to 0, zero maps to 0.5, +max magnitude maps to 1.
 */
export function valueToT(value: number, min: number, max: number): number {
  const maxAbs = Math.max(Math.abs(min), Math.abs(max))
  if (maxAbs < 1e-12) return 0.5
  return Math.min(1, Math.max(0, 0.5 + 0.5 * (value / maxAbs)))
}

/** Color for a value given the global [min, max] range of the active diagram. */
export function valueToColor01(value: number, min: number, max: number): THREE.Color {
  return lerpStops(valueToT(value, min, max))
}

/** CSS color string for legend/tooltip usage. */
export function colorToCss(color: THREE.Color): string {
  return `#${color.getHexString()}`
}
