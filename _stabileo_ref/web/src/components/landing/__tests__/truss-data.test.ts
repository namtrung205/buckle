/**
 * The landing's truss illustration draws solved numbers, so those numbers are
 * tested like any other engineering result. Everything here is re-derived from
 * ../truss-data.ts; nothing is a snapshot of what the file happens to contain.
 */
import { describe, it, expect } from 'vitest';
import {
  NODES, MEMBERS, DECK, SUPPORTS, FORCES, DISPLACEMENTS,
  FORCE_MAX, FORCE_EPS, REVERSING_MEMBERS, stateAt,
} from '../truss-data';

const byId = new Map(NODES.map((n) => [n.id, n]));
const key = (m: { a: string; b: string }) => `${m.a}-${m.b}`;
const mirrorId = (id: string) => id[0] + String(6 - Number(id.slice(1)));

/** Member index whose ends are the mirror image of member `k`. */
function mirrorIndex(k: number) {
  const a = mirrorId(MEMBERS[k].a);
  const b = mirrorId(MEMBERS[k].b);
  return MEMBERS.findIndex((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));
}

describe('truss model', () => {
  it('every member references two nodes that exist', () => {
    for (const m of MEMBERS) {
      expect(byId.has(m.a), `unknown node ${m.a}`).toBe(true);
      expect(byId.has(m.b), `unknown node ${m.b}`).toBe(true);
      expect(m.a).not.toBe(m.b);
    }
  });

  it('has no duplicate or zero-length members', () => {
    const seen = new Set<string>();
    for (const m of MEMBERS) {
      const k = [m.a, m.b].sort().join('|');
      expect(seen.has(k), `duplicate member ${k}`).toBe(false);
      seen.add(k);
      const a = byId.get(m.a)!;
      const b = byId.get(m.b)!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0);
    }
  });

  it('is statically determinate: 2n = m + r', () => {
    expect(2 * NODES.length).toBe(MEMBERS.length + 3);
  });

  it('supports sit exactly on their own nodes, at the two ends of the deck', () => {
    expect(SUPPORTS.map((s) => s.node)).toEqual([DECK[0], DECK[DECK.length - 1]]);
    for (const s of SUPPORTS) {
      const n = byId.get(s.node);
      expect(n, `support node ${s.node} must exist`).toBeDefined();
      // A support is drawn at at(node); coinciding is structural, not cosmetic.
      expect(n!.y).toBe(byId.get(DECK[0])!.y);
    }
    expect(SUPPORTS.map((s) => s.kind)).toEqual(['pinned', 'roller']);
  });

  it('is geometrically symmetric about midspan', () => {
    for (const n of NODES) {
      const twin = byId.get(mirrorId(n.id));
      expect(twin, `no mirror node for ${n.id}`).toBeDefined();
      expect(twin!.y).toBe(n.y);
      const mid = (byId.get(DECK[0])!.x + byId.get(DECK[DECK.length - 1])!.x) / 2;
      expect(n.x - mid).toBeCloseTo(mid - twin!.x, 9);
    }
    for (let k = 0; k < MEMBERS.length; k++) {
      expect(mirrorIndex(k), `no mirror member for ${key(MEMBERS[k])}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('solved load cases', () => {
  it('has one case per deck panel point', () => {
    expect(FORCES).toHaveLength(DECK.length);
    expect(DISPLACEMENTS).toHaveLength(DECK.length);
    for (const row of FORCES) expect(row).toHaveLength(MEMBERS.length);
    for (const row of DISPLACEMENTS) expect(row).toHaveLength(2 * NODES.length);
  });

  it('reproduces the statics reactions for a unit load', () => {
    // Reaction at the left support = 1 - x/L; recovered here from the vertical
    // components of the members framing into each support node.
    const vertAt = (caseIdx: number, nodeId: string) => {
      let v = 0;
      MEMBERS.forEach((m, k) => {
        const a = byId.get(m.a)!;
        const b = byId.get(m.b)!;
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        const sy = (b.y - a.y) / L;
        if (m.a === nodeId) v -= FORCES[caseIdx][k] * sy;
        if (m.b === nodeId) v += FORCES[caseIdx][k] * sy;
      });
      return v;
    };
    // The two end cases are skipped on purpose: a load sitting directly on a
    // support node goes straight into the support without passing through any
    // member, so it is invisible to a member-force recovery. That case has its
    // own test below ("carries a load placed over a support straight into it").
    for (let p = 1; p < DECK.length - 1; p++) {
      const left = -vertAt(p, DECK[0]);
      const right = -vertAt(p, DECK[DECK.length - 1]);
      const span = DECK.length - 1;
      // Tolerance 1e-3, not machine epsilon: FORCES is stored rounded to four
      // decimals for compactness, so summing ~20 of them leaves a residual of
      // order 1e-5. That is the table's precision, not a solver error.
      expect(left + right, `ΣV for load at ${DECK[p]}`).toBeCloseTo(1, 3);
      expect(left, `left reaction for load at ${DECK[p]}`).toBeCloseTo((span - p) / span, 3);
    }
  });

  it('supports honour their displacement constraints in every case', () => {
    const iL = NODES.findIndex((n) => n.id === DECK[0]);
    const iR = NODES.findIndex((n) => n.id === DECK[DECK.length - 1]);
    for (const u of DISPLACEMENTS) {
      expect(u[2 * iL], 'pinned ux').toBe(0);
      expect(u[2 * iL + 1], 'pinned uy').toBe(0);
      expect(u[2 * iR + 1], 'roller uy').toBe(0);
    }
  });

  it('mirrors the response for mirrored load positions', () => {
    for (let p = 0; p < DECK.length; p++) {
      const q = DECK.length - 1 - p;
      for (let k = 0; k < MEMBERS.length; k++) {
        expect(FORCES[p][k], `${key(MEMBERS[k])} for load at ${DECK[p]} vs ${DECK[q]}`)
          .toBeCloseTo(FORCES[q][mirrorIndex(k)], 6);
      }
    }
  });

  it('carries a load placed over a support straight into it', () => {
    for (const p of [0, DECK.length - 1]) {
      for (const f of FORCES[p]) expect(Math.abs(f)).toBeLessThan(1e-9);
    }
  });
});

describe('load interpolation', () => {
  it('keeps the total applied load at exactly 1 everywhere', () => {
    for (let i = 0; i <= 200; i++) {
      const { load } = stateAt(i / 200);
      expect(load.reduce((a, b) => a + b, 0), `total load at s=${i / 200}`).toBeCloseTo(1, 12);
      for (const w of load) expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  it('splits the load linearly between the two adjacent deck nodes', () => {
    const { load, panel, fraction } = stateAt(0.5 / 6 + 0.5 / 6 * 0.4); // 40 % into panel 0..1
    expect(load.filter((w) => w > 0)).toHaveLength(2);
    expect(load[panel] + load[panel + 1]).toBeCloseTo(1, 12);
    expect(load[panel + 1]).toBeCloseTo(fraction, 12);
  });

  it('reproduces the panel-point solutions exactly at panel points', () => {
    for (let p = 0; p < DECK.length; p++) {
      const { forces } = stateAt(p / (DECK.length - 1));
      forces.forEach((f, k) => expect(f).toBeCloseTo(FORCES[p][k], 9));
    }
  });

  it('is a linear blend between bracketing cases', () => {
    const w = 0.37;
    const { forces } = stateAt((2 + w) / (DECK.length - 1));
    forces.forEach((f, k) =>
      expect(f).toBeCloseTo(FORCES[2][k] * (1 - w) + FORCES[3][k] * w, 9));
  });
});

describe('what the picture is supposed to show', () => {
  it('reverses the sign of exactly the members we claim reverse', () => {
    const reversing = MEMBERS
      .map((m, k) => {
        const vals = FORCES.map((row) => row[k]);
        const t = vals.some((v) => v > FORCE_EPS);
        const c = vals.some((v) => v < -FORCE_EPS);
        return t && c ? key(m) : null;
      })
      .filter(Boolean);
    expect(reversing.sort()).toEqual([...REVERSING_MEMBERS].sort());
    // The midspan diagonals are the pedagogical point; be explicit about them.
    expect(reversing).toContain('T2-B3');
    expect(reversing).toContain('T4-B3');
  });

  it('keeps the chords in their expected roles', () => {
    MEMBERS.forEach((m, k) => {
      if (m.kind !== 'bottom' && m.kind !== 'top') return;
      const vals = FORCES.map((row) => row[k]).filter((v) => Math.abs(v) > FORCE_EPS);
      if (!vals.length) return;
      const sign = Math.sign(vals[0]);
      for (const v of vals) {
        expect(Math.sign(v), `${key(m)} (${m.kind}) should not change role`).toBe(sign);
      }
      expect(sign, `${m.kind} chord sign`).toBe(m.kind === 'bottom' ? 1 : -1);
    });
  });

  it('changes force magnitude as the load moves', () => {
    const at = (s: number) => stateAt(s).forces;
    const a = at(1 / 6);
    const b = at(3 / 6);
    const changed = a.filter((v, k) => Math.abs(v - b[k]) > 0.05).length;
    expect(changed, 'members whose force changes appreciably').toBeGreaterThan(8);
  });

  it('uses one global force scale, not a per-frame normalisation', () => {
    // FORCE_MAX must bound every case, and must NOT equal the per-case maximum
    // of more than one case — otherwise the scale would effectively be local.
    const perCase = FORCES.map((row) => Math.max(...row.map(Math.abs)));
    for (const m of perCase) expect(m).toBeLessThanOrEqual(FORCE_MAX + 1e-9);
    expect(Math.max(...perCase)).toBeCloseTo(FORCE_MAX, 6);
    expect(perCase.filter((m) => Math.abs(m - FORCE_MAX) < 1e-9).length).toBeLessThan(FORCES.length);
    // A mid-span frame really is weaker than the strongest frame.
    expect(Math.max(...stateAt(0.1).forces.map(Math.abs))).toBeLessThan(FORCE_MAX);
  });
});
