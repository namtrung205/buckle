/**
 * The authoring panel has to be usable, not merely capable.
 *
 * The feedback that prompted this was specific: a seven-hundred-entry profile
 * picker, a default yield strength that related to nothing, question forms that
 * took five decisions to ask "what is the maximum moment", and a kinematic
 * classification nobody could work out how to set. Capability was never the
 * problem.
 *
 * What is pinned here is the shape of the fix: presets for the common cases,
 * a narrowed profile picker, named steel grades, a detected classification
 * rather than a typed one, and a help affordance on every option whose effect
 * is invisible until a student opens the exercise.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STEEL_GRADES, DEFAULT_GRADE, CHARACTERISTIC_PRESETS, STATIONS, suggestShapes,
} from '../exercise-presets';
import { lintExercise, type EduExerciseSpec } from '../exercise-spec';
import { getExerciseSpecs } from '../exercise-data';
import { ALL_PROFILES } from '../../../lib/data/steel-profiles';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const author = read('src/components/edu/ExerciseAuthor.svelte');

describe('steel grades are named, not bare numbers', () => {
  it('defaults to ADN 420, which is what a course reaches for', () => {
    // 235 was the European F-24 the profile tables are computed for —
    // technically consistent and not what anyone picks first here.
    expect(DEFAULT_GRADE.label).toBe('ADN 420');
    expect(DEFAULT_GRADE.fy).toBe(420);
  });

  it('still offers F-24, which is what the shipped profile tables assume', () => {
    const f24 = STEEL_GRADES.find((g) => g.id === 'f24');
    expect(f24?.fy).toBe(235);
  });

  it('every grade explains where it is used, and allows a custom value', () => {
    for (const g of STEEL_GRADES) expect(g.noteKey.startsWith('edu.author.grade')).toBe(true);
    expect(STEEL_GRADES.some((g) => g.id === 'custom')).toBe(true);
  });
});

describe('the common questions are one click', () => {
  it('covers the values a statics or strength course asks for', () => {
    const ids = CHARACTERISTIC_PRESETS.map((p) => p.id);
    for (const id of ['mmax', 'vmax', 'nmax', 'sigma', 'tau', 'vm']) {
      expect(ids, `missing ${id}`).toContain(id);
    }
  });

  it('every preset carries its own label and unit, so nothing is typed', () => {
    for (const p of CHARACTERISTIC_PRESETS) {
      expect(p.label.length, p.id).toBeGreaterThan(0);
      expect(p.unit.length, p.id).toBeGreaterThan(0);
    }
  });

  it('stress presets are marked as needing a profile', () => {
    // Offering them without one would produce a question the app cannot answer.
    for (const id of ['sigma', 'tau', 'vm']) {
      expect(CHARACTERISTIC_PRESETS.find((p) => p.id === id)!.needsProfile).toBe(true);
    }
    expect(CHARACTERISTIC_PRESETS.find((p) => p.id === 'mmax')!.needsProfile).toBeFalsy();
  });

  it('every preset produces an exercise that validates', () => {
    const base = getExerciseSpecs()[0];
    for (const p of CHARACTERISTIC_PRESETS) {
      const ex: EduExerciseSpec = {
        ...base,
        model: { ...base.model, profile: p.needsProfile ? 'IPE 300' : undefined, fy: 420 },
        characteristics: [{ label: p.label, unit: p.unit, answer: p.answer }],
      };
      expect(lintExercise(ex), p.id).toEqual([]);
    }
  });
});

describe('shapes are suggested from the loads, not left blank', () => {
  const of = (s: ReturnType<typeof suggestShapes>, d: string) => s.find((x) => x.diagram === d)!.correct;

  it('a uniform load suggests parabolic moment and linear shear', () => {
    const s = suggestShapes('uniform');
    expect(of(s, 'M')).toBe('quadratic');
    expect(of(s, 'V')).toBe('linear');
  });

  it('without one it suggests linear moment and constant shear', () => {
    // Offering a parabola where no distributed load exists invites a mistake.
    const s = suggestShapes('none');
    expect(of(s, 'M')).toBe('linear');
    expect(of(s, 'V')).toBe('constant');
  });

  it('a load that VARIES raises the whole chain a further power', () => {
    // Triangular load: quadratic shear, cubic moment. The case the format
    // could not express until cubic existed.
    const s = suggestShapes('varying');
    expect(of(s, 'V')).toBe('quadratic');
    expect(of(s, 'M')).toBe('cubic');
  });
});

describe('stations cover a member, not just its ends', () => {
  it('includes quarter points so a diagram can really be read', () => {
    expect(STATIONS.map((s) => s.t)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('the profile picker narrows before it lists', () => {
  it('the catalogue is far too large to offer flat', () => {
    // The original panel put all of these in one datalist.
    expect(ALL_PROFILES.length).toBeGreaterThan(500);
  });

  it('the panel picks a family first', () => {
    expect(author).toMatch(/profileFamily/);
    expect(author).toMatch(/familyProfiles/);
    expect(author).toContain('edu.author.pickSize');
  });

  it('no family has so many sizes that the second list is unusable', () => {
    const byFamily = new Map<string, number>();
    for (const p of ALL_PROFILES) byFamily.set(p.family, (byFamily.get(p.family) ?? 0) + 1);
    for (const [family, n] of byFamily) {
      expect(n, `${family} has ${n} sizes`).toBeLessThan(300);
    }
  });
});

describe('the kinematic classification is detected, not typed', () => {
  it('the panel asks WHETHER to ask, not what the answer is', () => {
    // Asking a teacher to state the degree of indeterminacy is asking for the
    // answer to their own question, and a slip marks a whole class wrongly.
    expect(author).toContain('askKinematic');
    expect(author).toContain('detectKinematics');
    expect(author).toContain('edu.author.detected');
  });

  it('says so when it cannot classify, rather than assuming determinate', () => {
    expect(author).toContain('edu.author.kinUnavailable');
  });
});

describe('every option that is not self-evident carries help', () => {
  it('help is attached to each question type and to the section choices', () => {
    for (const key of [
      'edu.author.helpCharWhat',
      'edu.author.helpDiagWhat',
      'edu.author.helpShapeWhat',
      'edu.author.helpKinWhat',
      'edu.author.helpProfileWhat',
      'edu.author.helpSteelWhat',
    ]) {
      expect(author, `missing ${key}`).toContain(key);
    }
  });

  it('help shows what the student will SEE, not only what the option means', () => {
    // The effect of "diagram shape question" is invisible until a student
    // opens the exercise, which is exactly why an example is required.
    for (const key of ['helpCharEx', 'helpDiagEx', 'helpShapeEx', 'helpKinEx', 'helpProfileEx']) {
      expect(author, `missing ${key}`).toContain(`edu.author.${key}`);
    }
  });

  it('every help string is translated in both locales', () => {
    const keys = [...author.matchAll(/edu\.author\.(help\w+|grade\w+)/g)].map((m) => m[0]);
    expect(keys.length).toBeGreaterThan(8);
    for (const loc of ['es', 'en']) {
      const dict = read(`src/lib/i18n/locales/${loc}.ts`);
      for (const k of new Set(keys)) {
        expect(dict, `${loc} missing ${k}`).toContain(k);
      }
    }
  });

  it('opens on click, so it is reachable on a tablet', () => {
    const help = read('src/components/edu/FieldHelp.svelte');
    expect(help).toMatch(/onclick/);
    expect(help).not.toMatch(/onmouseenter/);
  });
});
