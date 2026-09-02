/**
 * Canonical section state reaching the real solver wire.
 *
 * These assert on the values `buildSolverInput2D` / `buildSolverInput3D`
 * actually emit, not on an intermediate helper, because the defect class this
 * closes is "the numbers the solver used were not the numbers the geometry
 * implies".
 *
 * The torsion tests exist because `J` is the one property that must NOT come
 * from the polygon engine: it computes Routh's approximation, measured 56.9 %
 * low on a rectangle and 37.0 % high on an I-section.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { buildSolverInput2D, buildSolverInput3D } from '../../engine/solver-service';
import { resolveSectionState, solverProperties, cloneSectionState } from '../state';
import { ALL_PROFILES } from '../../data/steel-profiles';
import type { Section } from '../../store/model.svelte';

function sec(over: Partial<Section> & { id?: number }): Section {
  return { id: 1, name: '', a: 0.01, iz: 1e-5, ...over } as Section;
}

function fromCatalogue(name: string, id = 1): Section {
  const p = ALL_PROFILES.find((x) => x.name === name);
  if (!p) throw new Error(`no catalogue profile ${name}`);
  return sec({ id, name: p.name, a: p.a * 1e-4, iy: p.iy * 1e-8, iz: p.iz * 1e-8 });
}

/** A section with its canonical state resolved, as the app stores it. */
function resolved(s: Section): Section {
  return { ...s, canonical: resolveSectionState(s) };
}

/** Minimal one-element model wrapping a section. */
function model(section: Section) {
  return {
    nodes: new Map([[1, { id: 1, x: 0, y: 0, z: 0 }], [2, { id: 2, x: 4, y: 0, z: 0 }]]),
    materials: new Map([[1, { id: 1, e: 210000, nu: 0.3, rho: 78.5 }]]),
    sections: new Map([[section.id, section]]),
    elements: new Map([[1, {
      id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: section.id,
    }]]),
    supports: new Map([[1, { id: 1, nodeId: 1, type: 'fixed' }]]),
    loads: [{ type: 'nodal', data: { id: 1, nodeId: 2, fx: 0, fz: -10, my: 0 } }],
    plates: new Map(), quads: new Map(), constraints: [], connectors: new Map(),
  } as never;
}

const rel = (g: number, e: number) => (e === 0 ? Math.abs(g) : Math.abs((g - e) / e));

let ipe: Section;
beforeAll(() => {
  ipe = resolved(fromCatalogue('IPE 300'));
});

// ─── The wire the solver actually receives ─────────────────────────

describe('canonical properties reach the 2D solver wire', () => {
  it('area on the wire is the canonical area, not the declared one', () => {
    const st = ipe.canonical!;
    expect(st.kind).toBe('geometry-backed');
    const wire = buildSolverInput2D(model(ipe), false)!;
    const s = wire.sections.get(ipe.id)!;
    expect(s.a).toBeCloseTo(st.a, 15);
    // The declared catalogue area is 53.8 cm2; the canonical polygon gives
    // 53.817. Both are within the published rounding, but the wire must carry
    // the one the geometry implies.
    expect(rel(s.a * 1e4, 53.8)).toBeLessThan(6e-3);
  });

  it('a properties-only section still reaches the wire with its declared area', () => {
    const bare = resolved(sec({ name: 'Losa equivalente', a: 0.05, iy: 4e-4, iz: 1e-4 }));
    expect(bare.canonical!.kind).toBe('properties-only');
    const wire = buildSolverInput2D(model(bare), false)!;
    expect(wire.sections.get(bare.id)!.a).toBeCloseTo(0.05, 12);
  });
});

describe('canonical properties reach the 3D solver wire', () => {
  it('3D inertias come from canonical geometry for a geometry-backed section', () => {
    const st = ipe.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    const wire = buildSolverInput3D(model(ipe), false, false)!;
    const s = wire.sections.get(ipe.id)!;
    expect(s.a).toBeCloseTo(st.a, 15);
    expect(s.iy).toBeCloseTo(st.iy, 15);
    expect(s.iz).toBeCloseTo(st.iz, 15);
  });

  it('a properties-only section keeps its declared 3D inertias', () => {
    const bare = resolved(sec({ name: 'Sección compuesta', a: 0.02, iy: 9e-5, iz: 3e-5 }));
    expect(bare.canonical!.kind).toBe('properties-only');
    const wire = buildSolverInput3D(model(bare), false, false)!;
    const s = wire.sections.get(bare.id)!;
    expect(s.a).toBeCloseTo(bare.a, 15);
    // The axis each declared inertia lands on, pinned deliberately. In-plane
    // bending uses the strong axis; out-of-plane uses the WEAK one. This read
    // `s.iy ?? s.iz` for the out-of-plane term and so handed the engine the
    // strong axis, overstating out-of-plane stiffness. Deliberately asserted on
    // an ASYMMETRIC section: with iy == iz both readings agree and the test
    // would pass either way, which is exactly how the defect survived.
    expect(s.iy, 'in-plane uses the strong axis').toBeCloseTo(9e-5, 15);
    expect(s.iz, 'out-of-plane uses the weak axis').toBeCloseTo(3e-5, 15);
    // What this pins is that NOTHING canonical is invented for a section that
    // has no geometry: both inertias on the wire are values the section itself
    // declared. It deliberately does not pin WHICH declared inertia lands on
    // which solver axis — a flat 2D model embedded in 3D takes a branch that
    // reads `s.iy ?? s.iz` for the out-of-plane term, and whether that is the
    // right axis is a solver question, open and untouched here. An asymmetric
    // profile is used precisely so a future change to that mapping is not
    // silently blessed by a symmetric section where both answers coincide.
    const declared = [bare.iy, bare.iz];
    expect(declared).toContain(s.iz);
    expect(declared).toContain(s.iy);
  });
});

// ─── Torsion provenance ────────────────────────────────────────────

describe('torsional constant provenance', () => {
  it('CHS gets an EXACT analytical J, never Routh', () => {
    const chs = resolved(fromCatalogue('CHS 88.9x4'));
    const p = solverProperties(chs);
    expect(p.jProvenance).toBe('exactAnalytical');
    const D = 88.9e-3;
    const d = D - 2 * 4e-3;
    // The boundary is polygonised at 24 segments per quarter (96 sides), so
    // the inertia is an inscribed-polygon approximation of the true annulus;
    // the bound is that discretization error, not a fudge factor.
    expect(rel(p.j!, (Math.PI * (D ** 4 - d ** 4)) / 32)).toBeLessThan(5e-3);
    // For a circular section J equals the polar moment EXACTLY, and this
    // holds on the polygon too. Routh's value would not satisfy it, so this
    // is a direct check that Routh did not leak in.
    const st = chs.canonical!;
    if (st.kind === 'geometry-backed') {
      expect(rel(p.j!, st.iy + st.iz)).toBeLessThan(1e-15);
      const routh = st.a ** 4 / (4 * Math.PI ** 2 * (st.iy + st.iz));
      expect(rel(p.j!, routh)).toBeGreaterThan(1e-6);
    }
  });

  it('a non-circular section takes J from Saint-Venant, never from Routh', () => {
    // Resolved WITH torsion, the way the model store does it — browsing the
    // catalogue deliberately does not pay for a mesh-and-solve per thumbnail.
    const withJ = resolveSectionState(fromCatalogue('IPE 300'), { torsion: true });
    if (withJ.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    expect(withJ.jProvenance).toBe('saintVenant');
    expect(withJ.j).toBeGreaterThan(0);

    // IPE 300's J against the thin-strip sum of its three plates. The
    // published European value is about 20 cm⁴ and this lands at 19.7; it is
    // checked against the plate sum rather than a transcribed number so the
    // test does not depend on reading one column out of a PDF correctly.
    const plates = (2 * 0.15 * 0.0107 ** 3 + (0.3 - 2 * 0.0107) * 0.0071 ** 3) / 3;
    const ratio = withJ.j! / plates;
    expect(ratio, 'fillets add to the plate sum without doubling it').toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(1.5);

    // The Routh prohibition is now satisfied structurally rather than
    // numerically: `saintVenant` provenance means the value came from solving
    // Prandtl's problem on the mesh, and Routh is not reachable from there.
    // Asserting a numeric distance from Routh's formula was tempting but is a
    // bad test — for this profile the two happen to sit 20 % apart, so the
    // threshold would be measuring a coincidence, not the property.

    // Without the flag, nothing is claimed rather than something cheap.
    const st = ipe.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    expect(st.jProvenance).toBe('unavailable');
  });

  it('a declared J is preserved rather than recomputed', () => {
    const custom = resolved(sec({ shape: 'rect', b: 0.2, h: 0.4, j: 1.23e-4 }));
    const p = solverProperties(custom);
    expect(p.j).toBe(1.23e-4);
    expect(['catalogue', 'legacy']).toContain(p.jProvenance);
  });

  it('an unavailable J is reported as such, not as a number', () => {
    const p = solverProperties(sec({ shape: 'rect', b: 0.2, h: 0.4 }));
    expect(p.j).toBeNull();
    expect(p.jProvenance).toBe('unavailable');
  });
});

// ─── Geometry / rotation changes ───────────────────────────────────

describe('canonical state tracks the geometry it came from', () => {
  it('editing geometry changes the digest and the derived properties', () => {
    const a = resolved(sec({ shape: 'rect', b: 0.2, h: 0.4 }));
    const b = resolved(sec({ shape: 'rect', b: 0.2, h: 0.5 }));
    const [sa, sb] = [a.canonical!, b.canonical!];
    if (sa.kind !== 'geometry-backed' || sb.kind !== 'geometry-backed') throw new Error('both geometry-backed');
    expect(sb.digest).not.toBe(sa.digest);
    expect(sb.a).toBeGreaterThan(sa.a);
    expect(sb.iy).toBeGreaterThan(sa.iy);
  });

  it('renaming changes neither digest nor any derived property', () => {
    const a = resolved(sec({ id: 1, name: 'Beam A', shape: 'rect', b: 0.2, h: 0.4 }));
    const b = resolved(sec({ id: 2, name: 'Totally different', shape: 'rect', b: 0.2, h: 0.4 }));
    const [sa, sb] = [a.canonical!, b.canonical!];
    if (sa.kind !== 'geometry-backed' || sb.kind !== 'geometry-backed') throw new Error('both geometry-backed');
    expect(sb.digest).toBe(sa.digest);
    expect(sb.a).toBe(sa.a);
    expect(sb.iy).toBe(sa.iy);
    expect(sb.iyz).toBe(sa.iyz);
  });

  it('an asymmetric section carries Iyz and its principal angle through to state', () => {
    const angle = resolved(sec({ shape: 'L', h: 0.1, b: 0.1, t: 0.01 }));
    const st = angle.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    expect(Math.abs(st.iyz)).toBeGreaterThan(1e-9);
    expect(Math.abs(Math.abs((st.thetaP * 180) / Math.PI) - 45)).toBeLessThan(1e-6);
    expect(st.i1).toBeGreaterThan(st.iy);
    expect(st.i2).toBeLessThan(st.iz);
  });
});

// ─── Isolation ─────────────────────────────────────────────────────

describe('tab and copy isolation', () => {
  it('cloned canonical state shares no mutable arrays', () => {
    const st = ipe.canonical!;
    const copy = cloneSectionState(st)!;
    if (st.kind !== 'geometry-backed' || copy.kind !== 'geometry-backed') throw new Error('geometry-backed');

    expect(copy.geometry.polygons).not.toBe(st.geometry.polygons);
    expect(copy.geometry.polygons[0]).not.toBe(st.geometry.polygons[0]);
    expect(copy.geometry.polygons[0].vertices).not.toBe(st.geometry.polygons[0].vertices);
    expect(copy.geometry.polygons[0].vertices[0]).not.toBe(st.geometry.polygons[0].vertices[0]);

    // Mutating the copy must not reach the original — the failure mode that
    // would otherwise leak an edit from one tab into another.
    copy.geometry.polygons[0].vertices[0][0] = 999;
    expect(st.geometry.polygons[0].vertices[0][0]).not.toBe(999);
    expect(copy.digest).toBe(st.digest);
  });

  it('cloning a properties-only state deep-copies its reason', () => {
    const rhs = resolved(sec({ name: 'Losa equivalente', a: 0.05, iy: 4e-4, iz: 1e-4 }));
    const copy = cloneSectionState(rhs.canonical!)!;
    expect(copy.kind).toBe('properties-only');
    if (copy.kind === 'properties-only' && rhs.canonical!.kind === 'properties-only') {
      expect(copy.reason).not.toBe(rhs.canonical!.reason);
      expect(copy.reason.kind).toBe(rhs.canonical!.reason.kind);
    }
  });

  it('two sections resolved from the same catalogue entry hold separate state', () => {
    const a = resolved(fromCatalogue('HEB 200', 1));
    const b = resolved(fromCatalogue('HEB 200', 2));
    const [sa, sb] = [a.canonical!, b.canonical!];
    if (sa.kind !== 'geometry-backed' || sb.kind !== 'geometry-backed') throw new Error('geometry-backed');
    expect(sb.digest).toBe(sa.digest);
    expect(sb.geometry.polygons).not.toBe(sa.geometry.polygons);
  });
});

// ─── Idempotence ───────────────────────────────────────────────────

describe('resolution is idempotent and serialization-stable', () => {
  it('resolving twice gives the same digest and properties', () => {
    const once = resolveSectionState(fromCatalogue('IPE 300'));
    const twice = resolveSectionState(fromCatalogue('IPE 300'));
    if (once.kind !== 'geometry-backed' || twice.kind !== 'geometry-backed') throw new Error('geometry-backed');
    expect(twice.digest).toBe(once.digest);
    expect(twice.a).toBe(once.a);
    expect(twice.iy).toBe(once.iy);
  });

  it('a save/open round trip preserves digest and every derived property', () => {
    const st = ipe.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    // Exactly what persistence does: JSON out, JSON in.
    const back = JSON.parse(JSON.stringify(st));
    expect(back.digest).toBe(st.digest);
    expect(back.a).toBe(st.a);
    expect(back.iy).toBe(st.iy);
    expect(back.iz).toBe(st.iz);
    expect(back.iyz).toBe(st.iyz);
    expect(back.jProvenance).toBe(st.jProvenance);
    expect(back.version).toBe(st.version);
    // And twice, so the format is a fixed point.
    const again = JSON.parse(JSON.stringify(back));
    expect(again.digest).toBe(st.digest);
  });
});

// ─── Derived properties cannot be edited into contradiction ────────

describe('geometry-backed derived properties are read-only', () => {
  it('an attempt to set A/Iy/Iz/J on a geometry-backed section is ignored', async () => {
    const { modelStore } = await import('../../store/model.svelte');
    modelStore.clear();
    const id = modelStore.addSection({
      name: 'IPE 300', a: 53.8e-4, iy: 8356e-8, iz: 604e-8,
    });
    // The store resolves canonical state on update; force a first resolve.
    modelStore.updateSection(id, { name: 'IPE 300' });
    const before = modelStore.sections.get(id)!;
    expect(before.canonical?.kind).toBe('geometry-backed');
    const a0 = before.a, iy0 = before.iy;

    modelStore.updateSection(id, { a: 999, iy: 888, iz: 777, j: 666 });
    const after = modelStore.sections.get(id)!;
    expect(after.a).toBe(a0);
    expect(after.iy).toBe(iy0);
    expect(after.a).not.toBe(999);
    modelStore.clear();
  });

  it('a properties-only section keeps its declared-property editing', async () => {
    const { modelStore } = await import('../../store/model.svelte');
    modelStore.clear();
    // A section the user declares by properties alone — no catalogue name, no
    // shape — is the case that must stay editable.
    const id = modelStore.addSection({ name: 'Losa equivalente', a: 0.05, iy: 4e-4, iz: 1e-4 });
    expect(modelStore.sections.get(id)!.canonical?.kind).toBe('properties-only');
    modelStore.updateSection(id, { a: 0.005 });
    expect(modelStore.sections.get(id)!.a).toBe(0.005);
    modelStore.clear();
  });

  it('editing geometry regenerates derived state atomically', async () => {
    const { modelStore } = await import('../../store/model.svelte');
    modelStore.clear();
    const id = modelStore.addSection({ name: 'Rect', shape: 'rect', b: 0.2, h: 0.4, a: 0.08, iz: 2.6667e-4 });
    modelStore.updateSection(id, { shape: 'rect' });
    const first = modelStore.sections.get(id)!.canonical!;
    if (first.kind !== 'geometry-backed') throw new Error('geometry-backed');

    modelStore.updateSection(id, { h: 0.5 });
    const second = modelStore.sections.get(id)!.canonical!;
    if (second.kind !== 'geometry-backed') throw new Error('geometry-backed');
    // New geometry, new digest, and the derived area followed the dimensions
    // with no window in which the two disagreed.
    expect(second.digest).not.toBe(first.digest);
    expect(second.a).toBeCloseTo(0.2 * 0.5, 12);
    modelStore.clear();
  });
});
