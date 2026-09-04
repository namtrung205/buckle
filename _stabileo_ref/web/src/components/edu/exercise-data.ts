/**
 * exercise-data.ts — the shipped exercises, as data.
 *
 * Adding one here needs no code: a structure is nodes, elements, supports and
 * loads, and an answer says what to measure. `exercise-spec.ts` explains the
 * format; `__tests__/exercise-validation.test.ts` checks every entry actually
 * solves and that its stated answers match what the solver produces.
 *
 * Values that used to be written out by hand are gone, with two deliberate
 * exceptions kept as `literal`: a section modulus the student is meant to work
 * out from `b h^2 / 6`, and an Euler load from `pi^2 EI/(kL)^2`. Neither is
 * something the solver produces, so neither can be derived from it. Everything
 * else now comes from the solve.
 */

import { t } from '../../lib/i18n';
import type { EduExerciseSpec } from './exercise-spec';

/** Rectangular section used by the bending-stress exercise: 200 x 400 mm. */
const RECT_W = (0.2 * 0.4 * 0.4) / 6; // m³, W = b h²/6

export function getExerciseSpecs(): EduExerciseSpec[] {
  return [
    // ── Simply supported beam, uniform load ────────────────────
    {
      id: 'simply-supported-distributed',
      title: t('edu.ex2Title'),
      description: t('edu.ex2Desc'),
      difficulty: 'easy',
      category: 'statics',
      model: {
        nodes: [[0, 0], [8, 0]],
        elements: [[0, 1]],
        supports: [{ node: 0, type: 'pinned' }, { node: 1, type: 'rollerX' }],
        distributedLoads: [{ element: 0, qI: -5 }],
      },
      supports: [
        { label: t('edu.ex2SupportA'), nodeIndex: 0, dofs: ['Rx', 'Ry'] },
        { label: t('edu.ex2SupportB'), nodeIndex: 1, dofs: ['Ry'] },
      ],
      characteristics: [
        // Was hand-written as 5*8²/8 because the old extractor only looked at
        // element ends and could not see a mid-span maximum. Swept now.
        { label: 'Mmax', unit: 'kN·m', answer: { kind: 'maxAbs', force: 'moment' } },
        { label: 'Vmax', unit: 'kN', answer: { kind: 'maxAbs', force: 'shear' } },
      ],
      diagramQuestions: [
        { question: t('edu.dq.shearAtSupport'), unit: 'kN', answer: { kind: 'at', force: 'shear', element: 0, t: 0 } },
        { question: t('edu.dq.momentAtMidspan'), unit: 'kN·m', answer: { kind: 'at', force: 'moment', element: 0, t: 0.5 } },
      ],
      kinematicQuestion: { classification: 'isostatic' },
      diagramShapeQuestions: [
        { diagram: 'N', correct: 'zero' },
        { diagram: 'V', correct: 'linear' },
        { diagram: 'M', correct: 'quadratic' },
      ],
      // Naming the shape and drawing it are different skills, and this is the
      // case where the second one pays: the shear crosses zero at midspan,
      // which is exactly where the moment is flat.
      diagramSketchQuestions: [
        { diagram: 'V' },
        { diagram: 'M' },
      ],
    },

    // ── Portal frame, horizontal load ──────────────────────────
    {
      id: 'portal-frame',
      title: t('edu.ex3Title'),
      description: t('edu.ex3Desc'),
      difficulty: 'medium',
      category: 'statics',
      model: {
        nodes: [[0, 0], [0, 3], [4, 3], [4, 0]],
        elements: [[0, 1], [1, 2], [2, 3]],
        supports: [{ node: 0, type: 'fixed' }, { node: 3, type: 'fixed' }],
        nodalLoads: [{ node: 1, fx: 8 }],
      },
      supports: [
        { label: t('edu.ex3SupportA'), nodeIndex: 0, dofs: ['Rx', 'Ry', 'M'] },
        { label: t('edu.ex3SupportB'), nodeIndex: 3, dofs: ['Rx', 'Ry', 'M'] },
      ],
      characteristics: [
        { label: t('edu.ex3MmaxCol'), unit: 'kN·m', answer: { kind: 'maxAbs', force: 'moment', elements: [0, 2] } },
        { label: t('edu.ex3MmaxBeam'), unit: 'kN·m', answer: { kind: 'maxAbs', force: 'moment', elements: [1] } },
      ],
      diagramQuestions: [
        { question: t('edu.dq.momentAtBase'), unit: 'kN·m', answer: { kind: 'at', force: 'moment', element: 0, t: 0 } },
      ],
      kinematicQuestion: { classification: 'hyperstatic', degree: 3 },
      diagramShapeQuestions: [
        { diagram: 'V', correct: 'constant' },
        { diagram: 'M', correct: 'linear' },
      ],
    },

    // ── Cantilever, point load at the tip ──────────────────────
    {
      id: 'cantilever-point',
      title: t('edu.ex4Title'),
      description: t('edu.ex4Desc'),
      difficulty: 'easy',
      category: 'statics',
      model: {
        nodes: [[0, 0], [4, 0]],
        elements: [[0, 1]],
        supports: [{ node: 0, type: 'fixed' }],
        nodalLoads: [{ node: 1, fy: -12 }],
      },
      supports: [{ label: t('edu.ex4SupportA'), nodeIndex: 0, dofs: ['Rx', 'Ry', 'M'] }],
      characteristics: [
        { label: 'Mmax', unit: 'kN·m', answer: { kind: 'maxAbs', force: 'moment' } },
        { label: 'Vmax', unit: 'kN', answer: { kind: 'maxAbs', force: 'shear' } },
      ],
      diagramQuestions: [
        { question: t('edu.dq.momentAtFixed'), unit: 'kN·m', answer: { kind: 'at', force: 'moment', element: 0, t: 0 } },
        { question: t('edu.dq.shearConstant'), unit: 'kN', answer: { kind: 'at', force: 'shear', element: 0, t: 0 } },
      ],
      kinematicQuestion: { classification: 'isostatic' },
      diagramShapeQuestions: [
        { diagram: 'N', correct: 'zero' },
        { diagram: 'V', correct: 'constant' },
        { diagram: 'M', correct: 'linear' },
      ],
      diagramSketchQuestions: [
        { diagram: 'V' },
        { diagram: 'M' },
      ],
    },

    // ── Simple triangular truss ────────────────────────────────
    {
      id: 'simple-truss',
      title: t('edu.ex7Title'),
      description: t('edu.ex7Desc'),
      difficulty: 'medium',
      category: 'statics',
      model: {
        nodes: [[0, 0], [4, 0], [2, 3]],
        // Left diagonal, right diagonal, bottom chord — the order the
        // questions refer to.
        elements: [[0, 2], [1, 2], [0, 1]],
        supports: [{ node: 0, type: 'pinned' }, { node: 1, type: 'rollerX' }],
        nodalLoads: [{ node: 2, fy: -20 }],
      },
      supports: [
        { label: t('edu.ex7SupportA'), nodeIndex: 0, dofs: ['Rx', 'Ry'] },
        { label: t('edu.ex7SupportB'), nodeIndex: 1, dofs: ['Ry'] },
      ],
      characteristics: [
        { label: t('edu.ex7Nmax'), unit: 'kN', answer: { kind: 'maxAbs', force: 'axial' } },
      ],
      diagramQuestions: [
        { question: t('edu.dq.axialBottomChord'), unit: 'kN', answer: { kind: 'at', force: 'axial', element: 2, t: 0 } },
      ],
      kinematicQuestion: { classification: 'isostatic' },
      diagramShapeQuestions: [
        { diagram: 'N', correct: 'constant' },
        { diagram: 'V', correct: 'zero' },
        { diagram: 'M', correct: 'zero' },
      ],
    },

    // ── Bending stress on a rectangular section ────────────────
    {
      id: 'bending-stress-rect',
      title: t('edu.ex9Title'),
      description: t('edu.ex9Desc'),
      difficulty: 'easy',
      category: 'strength',
      model: {
        nodes: [[0, 0], [2, 0], [4, 0]],
        elements: [[0, 1], [1, 2]],
        supports: [{ node: 0, type: 'pinned' }, { node: 2, type: 'rollerX' }],
        nodalLoads: [{ node: 1, fy: -15 }],
      },
      supports: [
        { label: t('edu.ex9SupportA'), nodeIndex: 0, dofs: ['Rx', 'Ry'] },
        { label: t('edu.ex9SupportB'), nodeIndex: 2, dofs: ['Ry'] },
      ],
      characteristics: [
        // A section property, not a solver output — the student derives it.
        { label: t('edu.ex9W'), unit: 'm³', answer: { kind: 'literal', value: RECT_W } },
        // sigma = Mmax / W, in MPa. Used to be the literal 2.8125, which would
        // have gone stale the moment the load or the span changed.
        {
          label: 'σmax', unit: 'MPa',
          answer: { kind: 'scaled', of: { kind: 'maxAbs', force: 'moment' }, factor: 1 / (RECT_W * 1000) },
        },
      ],
      diagramQuestions: [
        {
          question: t('edu.dq.sigmaMax'), unit: 'MPa',
          answer: { kind: 'scaled', of: { kind: 'maxAbs', force: 'moment' }, factor: 1 / (RECT_W * 1000) },
        },
        { question: t('edu.dq.momentAtCenter'), unit: 'kN·m', answer: { kind: 'at', force: 'moment', element: 0, t: 1 } },
      ],
      sectionData: [
        { label: 'b', value: '200 mm' },
        { label: 'h', value: '400 mm' },
        { label: t('edu.sectionFormula'), value: 'W = bh²/6' },
      ],
    },

    // ── Combined stresses on a rolled profile ──────────────────
    //
    // The exercise the section work made possible: a real IPE 300, asked for
    // the stresses a designer actually checks. Every answer comes out of the
    // same solver the professional mode uses, over the profile's true outline
    // — fillets included — rather than a rectangle standing in for it.
    {
      id: 'combined-stress-ipe',
      title: t('edu.ex11Title'),
      description: t('edu.ex11Desc'),
      difficulty: 'hard',
      category: 'strength',
      model: {
        nodes: [[0, 0], [3, 0]],
        elements: [[0, 1]],
        supports: [{ node: 0, type: 'fixed' }],
        nodalLoads: [{ node: 1, fy: -40 }],
        profile: 'IPE 300',
        fy: 235,
      },
      supports: [{ label: t('edu.ex11SupportA'), nodeIndex: 0, dofs: ['Rx', 'Ry', 'M'] }],
      characteristics: [
        { label: 'Mmax', unit: 'kN·m', answer: { kind: 'maxAbs', force: 'moment' } },
        // At the fixed end's extreme fibre, where bending governs.
        { label: 'σmax', unit: 'MPa', answer: { kind: 'stress', measure: 'sigmaMax', element: 0, t: 0 } },
        // At the neutral axis of the same section, where shear governs and
        // bending does not — the pairing the exercise is built to teach.
        { label: 'τmax', unit: 'MPa', answer: { kind: 'stress', measure: 'tauMax', element: 0, t: 0 } },
        { label: 'von Mises', unit: 'MPa', answer: { kind: 'stress', measure: 'vonMises', element: 0, t: 0 } },
      ],
      diagramQuestions: [
        { question: t('edu.dq.momentAtFixed'), unit: 'kN·m', answer: { kind: 'at', force: 'moment', element: 0, t: 0 } },
      ],
      diagramShapeQuestions: [
        { diagram: 'V', correct: 'constant' },
        { diagram: 'M', correct: 'linear' },
      ],
      sectionData: [
        { label: t('edu.ex11Profile'), value: 'IPE 300' },
        { label: 'fy', value: '235 MPa' },
        { label: t('edu.sectionFormula'), value: 'σ = M·c/I ; τ = V·Q/(I·b)' },
      ],
    },

    // ── P-Delta on a leaning column ────────────────────────────
    {
      id: 'pdelta-column',
      title: t('edu.ex10Title'),
      description: t('edu.ex10Desc'),
      difficulty: 'medium',
      category: 'advanced',
      solverType: 'pdelta',
      model: {
        nodes: [[0, 0], [0, 5]],
        elements: [[0, 1]],
        supports: [{ node: 0, type: 'fixed' }],
        nodalLoads: [{ node: 1, fx: 2, fy: -100 }],
      },
      supports: [{ label: t('edu.ex10SupportA'), nodeIndex: 0, dofs: ['Rx', 'Ry', 'M'] }],
      characteristics: [
        // First-order H*L, which the student is meant to know and which the
        // P-Delta solver does NOT report — hence a literal.
        { label: t('edu.ex10MBase1st'), unit: 'kN·m', answer: { kind: 'literal', value: 2 * 5 } },
        { label: t('edu.ex10MBasePD'), unit: 'kN·m', answer: { kind: 'at', force: 'moment', element: 0, t: 0 } },
        // Euler: pi² E I / (k L)², k = 2 for a cantilever.
        {
          label: t('edu.ex10Pcr'), unit: 'kN',
          answer: { kind: 'literal', value: (Math.PI ** 2 * 200e6 * 9.8e-5) / (2 * 5) ** 2 },
        },
      ],
      diagramQuestions: [
        { question: t('edu.dq.momentAtBasePD'), unit: 'kN·m', answer: { kind: 'at', force: 'moment', element: 0, t: 0 } },
      ],
      sectionData: [
        { label: 'E', value: '200 000 MPa' },
        { label: 'Iz', value: '9 800 cm⁴' },
        { label: 'L', value: '5 m' },
        { label: t('edu.ex10BoundaryK'), value: 'k = 2 (' + t('edu.ex10Cantilever') + ')' },
        { label: t('edu.sectionFormula'), value: 'Pcr = π²EI / (kL)²' },
      ],
    },
  ];
}
