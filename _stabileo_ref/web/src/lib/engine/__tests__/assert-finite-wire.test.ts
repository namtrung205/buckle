/**
 * assertFiniteWire unit tests — the JsValue boundary guard.
 *
 * The 8 hot WASM exports used to receive JSON text: JSON.stringify coerced
 * NaN/Infinity to null and serde_json rejected them. serde-wasm-bindgen would
 * pass non-finite numbers straight through as f64. This guard restores the
 * old rejection semantics without a string round trip.
 */

import { describe, it, expect } from 'vitest';
import { assertFiniteWire } from '../wasm-solver';

describe('assertFiniteWire', () => {
  describe('accepts finite values', () => {
    it('scalars and empty containers', () => {
      expect(() => assertFiniteWire(null)).not.toThrow();
      expect(() => assertFiniteWire(0)).not.toThrow();
      expect(() => assertFiniteWire(-0)).not.toThrow();
      expect(() => assertFiniteWire(1e300)).not.toThrow();
      expect(() => assertFiniteWire(-1e300)).not.toThrow();
      expect(() => assertFiniteWire('NaN')).not.toThrow(); // strings are not numbers
      expect(() => assertFiniteWire(true)).not.toThrow();
      expect(() => assertFiniteWire(undefined)).not.toThrow();
      expect(() => assertFiniteWire([])).not.toThrow();
      expect(() => assertFiniteWire({})).not.toThrow();
    });

    it('nested plain structures (wire-object shape)', () => {
      const wire = {
        nodes: { '1': { id: 1, x: 0, y: 0, z: 0 }, '7': { id: 7, x: 5, y: 0, z: 0 } },
        materials: { '1': { id: 1, e: 200e6, nu: 0.3 } },
        loads: [{ type: 'nodal', data: { nodeId: 7, fx: 0, fy: 0, fz: -10 } }],
        constraints: [],
        leftHand: false,
      };
      expect(() => assertFiniteWire(wire)).not.toThrow();
    });
  });

  describe('rejects non-finite numbers', () => {
    it('NaN at top level', () => {
      expect(() => assertFiniteWire(NaN)).toThrow(/Non-finite number \(NaN\) at input$/);
    });

    it('Infinity / -Infinity at top level', () => {
      expect(() => assertFiniteWire(Infinity)).toThrow(/Non-finite number \(Infinity\) at input$/);
      expect(() => assertFiniteWire(-Infinity)).toThrow(/Non-finite number \(-Infinity\) at input$/);
    });

    it('NaN nested in an object reports the key path', () => {
      expect(() => assertFiniteWire({ nodes: { '1': { x: NaN } } }))
        .toThrow(/Non-finite number \(NaN\) at input\.nodes\.1\.x$/);
    });

    it('Infinity nested in an array reports the index path', () => {
      expect(() => assertFiniteWire({ loads: [{ data: { fz: -10 } }, { data: { fz: Infinity } }] }))
        .toThrow(/Non-finite number \(Infinity\) at input\.loads\[1\]\.data\.fz$/);
    });

    it('respects a custom root path', () => {
      expect(() => assertFiniteWire({ a: NaN }, 'payload'))
        .toThrow(/Non-finite number \(NaN\) at payload\.a$/);
    });

    it('fails fast on the first non-finite value', () => {
      expect(() => assertFiniteWire([NaN, Infinity])).toThrow(/at input\[0\]$/);
    });
  });
});
