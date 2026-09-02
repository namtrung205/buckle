/**
 * stress-state.ts — the complete stress state at one point of a section,
 * assembled entirely from canonical geometry.
 *
 * # Why this exists
 *
 * The section panel had two paths running side by side. The outline it drew
 * and the bending stress it plotted were canonical; the shear, the Mohr circle
 * and the failure criteria still came from the legacy resolver, which infers a
 * section's shape from its NAME and invents thicknesses when they are missing.
 * A user therefore read a Mohr circle built from a shape nobody verified,
 * drawn on top of an outline that was verified — and had no way to tell.
 *
 * This closes that. Every component here comes from the same polygons: axial
 * and bending in closed form, transverse shear from longitudinal equilibrium,
 * torsion from Saint-Venant. Mohr and the failure criteria are then pure
 * functions of the resulting sigma and tau, so those keep using the existing
 * helpers — they were never the problem.
 *
 * # What the caller must supply
 *
 * A point, centroid-relative. The panel has one because the user picks a fibre
 * on the drawing, and since the drawing is canonical the coordinates already
 * live in the right frame.
 */

import type { Section } from '../store/model.svelte';
import {
  analyzeSectionBending,
  analyzeSectionShear,
  analyzeSectionShearField,
  analyzeSectionTorsion,
  analyzeSectionTorsionField,
  hasSectionFieldExport,
  type BendingResponse,
  type ShearFieldResponse,
  type TorsionFieldResponse,
} from '../engine/wasm-solver';
import { computeMohrCircle, checkFailure } from '../engine/section-stress';
import type { MohrCircle, FailureCheck } from '../engine/section-stress';
import { stressTensorState, type StressTensorState } from './tensors';

/** Internal forces at a station, in the section's own frame. */
export interface SectionForces {
  /** Axial, kN. */
  n: number;
  /** Bending about the horizontal centroidal axis, kN·m. */
  my: number;
  /** Bending about the vertical centroidal axis, kN·m. */
  mz: number;
  /** Transverse shear along the horizontal axis, kN. */
  vy?: number;
  /** Transverse shear along the vertical axis, kN. */
  vz?: number;
  /** Torsion, kN·m. */
  t?: number;
}

export interface CanonicalStressState {
  /** Normal stress at the point, MPa. */
  sigma: number;
  /** Resultant in-plane shear at the point, MPa. */
  tau: number;
  /** Shear components `[tauXy, tauXz]`, MPa, so a direction can be drawn. */
  tauComponents: [number, number];
  /** Contribution of each source, for a panel that shows its working. */
  breakdown: {
    axial: number;
    bending: number;
    shearY: number;
    shearZ: number;
    torsion: number;
  };
  mohr: MohrCircle;
  failure: FailureCheck;
  /**
   * Shear centre, centroid-relative, in metres — present only when the state
   * needed a shear solve.
   *
   * Worth surfacing rather than keeping internal: a load applied anywhere else
   * twists the member, and for a channel this point lies OUTSIDE the section,
   * which is not something a user can guess from the drawing.
   */
  shearCentre?: [number, number];
  /**
   * The normal-stress field over the WHOLE section, as the coefficients of the
   * plane it lies on: `sigma(y, z) = axial + kz*z - ky*y`, MPa, with y and z
   * centroid-relative in metres.
   *
   * Normal stress under axial force and bending is affine in the section
   * coordinates — that is the Bernoulli hypothesis, not an approximation of it.
   * So three numbers reproduce the field everywhere, exactly, and a panel can
   * paint a stress map by evaluating a plane instead of asking the engine for a
   * point at a time. The alternative — sampling and interpolating — would be
   * both slower and less accurate than the closed form it approximates.
   *
   * Shear is NOT included here: it is a solved field on the mesh, not a plane,
   * and no three coefficients describe it.
   */
  field: { axial: number; ky: number; kz: number };
  /**
   * The full stress and strain tensors at the point, with their principal
   * values and invariants.
   *
   * Present only when elastic constants were supplied: strain needs E and nu,
   * and inventing them would be worse than leaving this out.
   */
  tensors?: StressTensorState;
}

export type StressStateResult =
  | { ok: true; state: CanonicalStressState }
  | { ok: false; reason: 'notResolved' | 'engineError'; message?: string };

// ── Solved-field cache ─────────────────────────────────────────
//
// The shear and torsion solves depend only on the geometry, but the point
// query used to be folded into the same WASM call — so a caller sweeping many
// points (the panel's fibre slider, one call per drag tick) re-meshed and
// re-solved the identical system every tick. The field exports split solve
// from query: solve once per geometry, cache by digest, and locate the
// triangle locally per point — a few thousand barycentric tests, which is
// free by comparison.

interface SectionFields {
  shear?: ShearFieldResponse;
  torsion?: TorsionFieldResponse;
}

/** A field is ~12k numbers (~100 KB); 16 entries bounds the cache at ~2 MB. */
const FIELD_CACHE_LIMIT = 16;
const fieldCache = new Map<string, SectionFields>();

function fieldsFor(digest: string): SectionFields {
  let f = fieldCache.get(digest);
  if (!f) {
    if (fieldCache.size >= FIELD_CACHE_LIMIT) {
      // Map iterates in insertion order, so the first key is the oldest.
      fieldCache.delete(fieldCache.keys().next().value!);
    }
    f = {};
    fieldCache.set(digest, f);
  }
  return f;
}

/**
 * Index of the triangle containing `p`, or the nearest one by centroid — the
 * same contract as the engine's `SectionMesh::locate`. The nearest-fallback
 * is deliberate: a query point comes from a user dragging a fibre on a
 * drawing and can land a hair outside the outline through rounding; snapping
 * to the nearest element is wrong by at most one element's width, which the
 * mesh already bounds.
 */
function locateTriangle(
  nodes: Array<[number, number]>,
  triangles: Array<[number, number, number]>,
  p: [number, number],
): number {
  let bestDist = Infinity;
  let best = 0;
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    const a = nodes[t[0]], b = nodes[t[1]], c = nodes[t[2]];
    const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (d !== 0) {
      const l1 = ((b[0] - p[0]) * (c[1] - p[1]) - (c[0] - p[0]) * (b[1] - p[1])) / d;
      const l2 = ((c[0] - p[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (c[1] - p[1])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return i;
    }
    const cy = (a[0] + b[0] + c[0]) / 3 - p[0];
    const cz = (a[1] + b[1] + c[1]) / 3 - p[1];
    const dist = cy * cy + cz * cz;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * Assemble the stress state at `point` from canonical geometry.
 *
 * Bending is closed-form and cheap, so it runs per call — or is taken from
 * `opts.bending` when the caller already computed it for the same forces (the
 * panel does, for its own plot, and re-solving would duplicate the work).
 * Shear and torsion come from the cached unit-load fields when the WASM build
 * exports them (one mesh-and-solve per geometry digest); on a build that
 * predates the field exports they fall back to a per-point mesh-and-solve.
 */
export function canonicalStressState(
  sec: Section,
  forces: SectionForces,
  point: [number, number],
  fy?: number,
  /**
   * Everything optional, in one bag.
   *
   * Two branches each added a fifth parameter — elastic constants here, a
   * pre-solved bending response on main — and two positional options are how a
   * signature starts collecting them. One object takes both and has room for
   * the next.
   *
   * `elastic`: needed only for the strain tensor. Without it the tensors are
   * omitted rather than filled with a guessed modulus.
   *
   * `bending`: the caller's own solve, reused instead of repeated. The panel
   * solves bending for its plot and then asks for a stress state at a point;
   * passing it through is what stops a drag tick re-solving the same system.
   */
  opts: { elastic?: { e: number; nu: number }; bending?: BendingResponse } = {},
): StressStateResult {
  const st = sec.canonical;
  if (!st || st.kind !== 'geometry-backed') return { ok: false, reason: 'notResolved' };

  try {
    // ── Normal stress: axial plus unsymmetrical bending ──────────
    //
    // Every quantity below is in kN and metres, so every stress comes out in
    // kPa and is converted once, at the end. Mixing that up is the classic way
    // to be wrong by a thousand and still look plausible.
    const bending = opts.bending ?? analyzeSectionBending({
      geometry: st.geometry,
      n: forces.n,
      my: forces.my,
      mz: forces.mz,
      forcesAreLocal: true,
    });
    // The engine returns the bending curvatures, so the stress anywhere is
    // reconstructed exactly rather than interpolated between reported points:
    // `sigma = N/A + kz*z - ky*y`, the same expression the engine integrates.
    const [py, pz] = point;
    const axial = st.a > 0 ? forces.n / st.a : 0;
    const sigma = axial + bending.kz * pz - bending.ky * py;

    // ── Transverse shear ─────────────────────────────────────────
    let shearY = 0;
    let shearZ = 0;
    let tauXy = 0;
    let tauXz = 0;
    let shearCentre: [number, number] | undefined;
    if (forces.vy || forces.vz) {
      // The solve is per UNIT force, so scaling is linear and superposable.
      if (hasSectionFieldExport()) {
        const fields = fieldsFor(st.digest);
        fields.shear ??= analyzeSectionShearField({ geometry: st.geometry });
        const sh = fields.shear;
        shearCentre = sh.shearCentre;
        const i = locateTriangle(sh.nodes, sh.triangles, point);
        if (forces.vy) {
          tauXy += sh.vy.tau[i][0] * forces.vy;
          tauXz += sh.vy.tau[i][1] * forces.vy;
          shearY = Math.hypot(sh.vy.tau[i][0], sh.vy.tau[i][1]) * forces.vy;
        }
        if (forces.vz) {
          tauXy += sh.vz.tau[i][0] * forces.vz;
          tauXz += sh.vz.tau[i][1] * forces.vz;
          shearZ = Math.hypot(sh.vz.tau[i][0], sh.vz.tau[i][1]) * forces.vz;
        }
      } else {
        const sh = analyzeSectionShear({ geometry: st.geometry, at: point });
        shearCentre = sh.shearCentre;
        if (forces.vy && sh.vy.at) {
          tauXy += sh.vy.at[0] * forces.vy;
          tauXz += sh.vy.at[1] * forces.vy;
          shearY = Math.hypot(sh.vy.at[0], sh.vy.at[1]) * forces.vy;
        }
        if (forces.vz && sh.vz.at) {
          tauXy += sh.vz.at[0] * forces.vz;
          tauXz += sh.vz.at[1] * forces.vz;
          shearZ = Math.hypot(sh.vz.at[0], sh.vz.at[1]) * forces.vz;
        }
      }
    }

    // ── Torsion ──────────────────────────────────────────────────
    let torsion = 0;
    if (forces.t) {
      // The field is per unit twist rate, with the shear modulus factored
      // out; a torque T gives twist T/(GJ), so G cancels and what remains is
      // T/J applied to the unit-rate field. The circle test pins this: there
      // the unit field's magnitude IS the radius, so tau = T r / J falls out.
      let tauAt: [number, number] | undefined;
      let j = 0;
      if (hasSectionFieldExport()) {
        const fields = fieldsFor(st.digest);
        fields.torsion ??= analyzeSectionTorsionField({ geometry: st.geometry });
        const to = fields.torsion;
        j = to.j;
        if (j > 0) tauAt = to.tau[locateTriangle(to.nodes, to.triangles, point)];
      } else {
        const to = analyzeSectionTorsion({ geometry: st.geometry, at: point });
        j = to.j;
        tauAt = to.at;
      }
      if (tauAt && j > 0) {
        const k = forces.t / j;
        tauXy += tauAt[0] * k;
        tauXz += tauAt[1] * k;
        torsion = Math.hypot(tauAt[0], tauAt[1]) * k;
      }
    }

    const tau = Math.hypot(tauXy, tauXz);
    // kPa to MPa, once, at the boundary.
    const toMPa = (v: number) => v * 1e-3;
    const sMPa = toMPa(sigma);
    const tMPa = toMPa(tau);

    return {
      ok: true,
      state: {
        sigma: sMPa,
        tau: tMPa,
        tauComponents: [toMPa(tauXy), toMPa(tauXz)],
        breakdown: {
          axial: toMPa(axial),
          bending: sMPa - toMPa(axial),
          shearY: toMPa(shearY),
          shearZ: toMPa(shearZ),
          torsion: toMPa(torsion),
        },
        // Pure functions of the two scalars, and the only part of the old path
        // that was never in question.
        mohr: computeMohrCircle(sMPa, tMPa),
        failure: checkFailure(sMPa, tMPa, fy),
        shearCentre,
        field: { axial: toMPa(axial), ky: toMPa(bending.ky), kz: toMPa(bending.kz) },
        tensors: opts.elastic
          ? stressTensorState(sMPa, toMPa(tauXy), toMPa(tauXz), opts.elastic.e, opts.elastic.nu)
          : undefined,
      },
    };
  } catch (err) {
    return { ok: false, reason: 'engineError', message: (err as Error)?.message ?? String(err) };
  }
}
