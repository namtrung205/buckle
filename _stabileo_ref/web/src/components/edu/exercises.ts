/**
 * Predefined exercises for Educational mode.
 * Each exercise defines a structure (nodes, elements, supports, loads)
 * that the solver resolves internally. The student must find the answers.
 */

import type { SupportType } from '../../lib/store/ui.svelte';
import { t } from '../../lib/i18n';
import type { ElementForces } from '../../lib/engine/types';

export interface EduExerciseAPI {
  addNode: (x: number, y: number) => number;
  addElement: (nI: number, nJ: number) => number;
  addSupport: (nodeId: number, type: SupportType) => void;
  addNodalLoad: (nodeId: number, fx: number, fy: number, mz?: number) => void;
  addDistributedLoad: (elementId: number, qI: number, qJ?: number) => void;
}

export interface DiagramQuestion {
  /** i18n key or plain text — the question prompt */
  question: string;
  /** Function that extracts the correct answer from element forces */
  getCorrect: (forces: ElementForces[]) => number;
  unit: string;
}

export type ExerciseCategory = 'statics' | 'strength' | 'advanced';

export type DiagramShape = 'zero' | 'constant' | 'linear' | 'quadratic' | 'cubic';

export interface KinematicQuestion {
  /** Correct classification */
  classification: 'isostatic' | 'hyperstatic';
  /** Degree of hyperstaticity (only for hyperstatic) */
  degree?: number;
}

export interface DiagramShapeQuestion {
  /** Which internal force diagram */
  diagram: 'N' | 'V' | 'M';
  /** Correct shape */
  correct: DiagramShape;
}

/** A diagram the student draws instead of naming. */
export interface DiagramSketchQuestion {
  /**
   * Which one to draw. `D` is the deflected shape, and it belongs in this
   * list for the reason the chain V → M → D exists at all: each is the
   * integral of the one before, so each is one power higher. A triangular
   * load gives a quadratic shear, a cubic moment and a quartic deflection —
   * and a student who has seen that once stops guessing.
   */
  diagram: 'N' | 'V' | 'M' | 'D';
  /** Index into the built model's elements; the first member when absent. */
  elementIndex?: number;
}

export interface SectionDataItem {
  label: string;
  value: string;
}

export interface EduExercise {
  id: string;
  title: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  category: ExerciseCategory;
  /** Which solver to use: 'linear' (default) or 'pdelta' */
  solverType?: 'linear' | 'pdelta';
  build: (api: EduExerciseAPI) => void;
  supports: Array<{
    label: string;
    nodeIndex: number;
    dofs: ('Rx' | 'Ry' | 'M')[];
  }>;
  characteristics: Array<{
    label: string;
    unit: string;
    /** Function that extracts the correct value from element forces */
    getCorrect: (forces: ElementForces[]) => number;
  }>;
  /** Questions about diagrams (Step 2) — the solver computes answers from results */
  diagramQuestions: DiagramQuestion[];
  /** Kinematic classification question (statics exercises) */
  kinematicQuestion?: KinematicQuestion;
  /** Diagram shape questions — student picks shape for N, V, M (statics exercises) */
  diagramShapeQuestions?: DiagramShapeQuestion[];
  /** Diagrams the student draws, ordinate by ordinate, with the power of each span */
  diagramSketchQuestions?: DiagramSketchQuestion[];
  /** Whether "show me the answer" is offered. Absent means yes. */
  allowReveal?: boolean;
  /** Section data to display as given info (strength/advanced exercises) */
  sectionData?: SectionDataItem[];
}

export interface ExerciseSection {
  category: ExerciseCategory;
  title: string;
  exercises: EduExercise[];
}

// ─── Exercise definitions ────────────────────────────────────────
//
// The exercises themselves now live in `exercise-data.ts` as DATA. What
// remains here is the translation into the shape the panel and the store
// already consume, so nothing downstream had to change when authoring moved.

import { getExerciseSpecs } from './exercise-data';
import { buildFromSpec, evaluateAnswer, type EduExerciseSpec } from './exercise-spec';

/** Adapt a declared exercise to the interface the UI consumes. */
function fromSpec(spec: EduExerciseSpec): EduExercise {
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    difficulty: spec.difficulty,
    category: spec.category,
    solverType: spec.solverType,
    build: (api) => buildFromSpec(spec.model, api),
    supports: spec.supports,
    characteristics: spec.characteristics.map((c) => ({
      label: c.label,
      unit: c.unit,
      // An answer that cannot be evaluated returns 0 here rather than null,
      // because the UI's contract is a number. The validation suite is what
      // makes sure that case never ships: it fails the build instead.
      getCorrect: (forces) => evaluateAnswer(c.answer, forces) ?? 0,
    })),
    diagramQuestions: spec.diagramQuestions.map((q) => ({
      question: q.question,
      unit: q.unit,
      getCorrect: (forces) => evaluateAnswer(q.answer, forces) ?? 0,
    })),
    kinematicQuestion: spec.kinematicQuestion,
    diagramShapeQuestions: spec.diagramShapeQuestions,
    diagramSketchQuestions: spec.diagramSketchQuestions,
    allowReveal: spec.allowReveal,
    sectionData: spec.sectionData,
  };
}

export function getExercises(): EduExercise[] {
  return getExerciseSpecs().map(fromSpec);
}

// ─── Grouped + sorted exercises ─────────────────────────────────

const difficultyOrder: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

function sortByDifficulty(exercises: EduExercise[]): EduExercise[] {
  return [...exercises].sort((a, b) => difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty]);
}

export function getExerciseSections(): ExerciseSection[] {
  const all = getExercises();
  const statics = sortByDifficulty(all.filter(e => e.category === 'statics'));
  const strength = sortByDifficulty(all.filter(e => e.category === 'strength'));
  const advanced = sortByDifficulty(all.filter(e => e.category === 'advanced'));

  return [
    { category: 'statics', title: t('edu.sectionStatics'), exercises: statics },
    { category: 'strength', title: t('edu.sectionStrength'), exercises: strength },
    { category: 'advanced', title: t('edu.sectionAdvanced'), exercises: advanced },
  ];
}
