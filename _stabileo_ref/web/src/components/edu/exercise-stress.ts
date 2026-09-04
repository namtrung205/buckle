/**
 * exercise-stress.ts — answering a stress question over the exercise's section.
 *
 * This is the bridge between the teaching mode and the section engine, and it
 * is what makes the mode able to ask something no other teaching tool asks
 * well: not "what is the moment" but "what is the von Mises stress at the
 * support of this IPE 300", answered by the same solver a professional uses.
 *
 * It lives apart from `exercise-spec.ts` on purpose. That module is the one
 * every marked answer flows through, so it stays free of the engine and
 * trivially testable; this is injected into it.
 */

import type { ElementForces } from '../../lib/engine/types';
import type { Section } from '../../lib/store/model.svelte';
import type { StressMeasure, AnswerContext } from './exercise-spec';
import { resolveSectionState } from '../../lib/section/state';
import { canonicalStressState } from '../../lib/section/stress-state';
import { stationForces2D } from '../../lib/section/panel';
import { ALL_PROFILES } from '../../lib/data/steel-profiles';
import { drawingGeometry } from '../../lib/section/drawing';

/** Build a section from a catalogue profile name, resolved and ready. */
export function sectionFromProfile(name: string): Section | null {
  const p = ALL_PROFILES.find((x) => x.name.trim().toUpperCase() === name.trim().toUpperCase());
  if (!p) return null;
  const sec = {
    id: 1,
    name: p.name,
    a: p.a * 1e-4,
    iy: p.iy * 1e-8,
    iz: p.iz * 1e-8,
  } as Section;
  sec.canonical = resolveSectionState(sec, { torsion: true });
  return sec;
}

/**
 * A stress resolver for a given profile.
 *
 * Returns `null` — never a number — when the profile is unknown or has no
 * geometry, so an exercise that asks the impossible fails validation instead of
 * marking students against a fabricated value.
 */
export function stressContext(profile: string | undefined, fy?: number): AnswerContext {
  if (!profile) return {};
  const sec = sectionFromProfile(profile);
  if (!sec || sec.canonical?.kind !== 'geometry-backed') return {};

  const g = drawingGeometry(sec.canonical);
  const [yMin, zMin, yMax, zMax] = g.bbox;

  return {
    stress(measure: StressMeasure, element: number, t: number, forces: ElementForces[]) {
      const ef = forces[element];
      if (!ef) return null;
      const f = stationForces2D(ef, t);

      // Where the measure is evaluated. Bending peaks at an extreme fibre and
      // shear at the neutral axis, so asking for both at one point would give
      // the wrong answer for one of them.
      const point: [number, number] =
        measure === 'tauMax' ? [0, 0] : measure === 'sigmaMin' ? [0, zMin] : [0, zMax];
      const r = canonicalStressState(
        sec,
        { n: f.n, my: f.my, mz: f.mz, vy: f.vy, vz: f.vz, t: f.tx },
        point,
        fy,
      );
      if (!r.ok) return null;
      switch (measure) {
        case 'sigmaMax':
        case 'sigmaMin':
          return r.state.sigma;
        case 'tauMax':
          return r.state.tau;
        case 'vonMises':
          return r.state.failure.vonMises;
      }
    },
  };
  // `yMin`/`yMax` are unused for now: stress questions are posed on the
  // vertical axis, which is where a plane exercise bends. Kept destructured so
  // the frame the point lives in is visible at the call site.
  void yMin;
  void yMax;
}
