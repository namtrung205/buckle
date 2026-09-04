/**
 * The seam between the analysis model and the 3-D scene.
 *
 * The assertions that matter are the refusals. Building a box from b and h is arithmetic;
 * declining to build one from an area is a decision, and it is the decision that keeps a
 * fabricated section off the screen.
 */

import { describe, expect, it } from 'vitest';
import { membersFromModel } from '../member-geometry';

const NODES = [
  { id: 1, x: 0, y: 0, z: 0 },
  { id: 2, x: 6, y: 0, z: 0 },
  { id: 3, x: 6, y: 0, z: 3 },
  { id: 4, x: 6, y: 0, z: 0 },
];

const SECTIONS = [
  { id: 10, b: 0.2, h: 0.5, shape: 'rect' },
  { id: 11, b: 0.4, h: 0.4, shape: 'rect', rotation: 30 },
  { id: 12, shape: 'I' },
];

const ELEMENTS = [
  { id: 1, nodeI: 1, nodeJ: 2, sectionId: 10 },
  { id: 2, nodeI: 2, nodeJ: 3, sectionId: 11 },
  { id: 3, nodeI: 1, nodeJ: 2, sectionId: 12 },
  { id: 4, nodeI: 2, nodeJ: 4, sectionId: 10 },
];

function run(elementIds: number[]) {
  return membersFromModel({ elementIds, nodes: NODES, elements: ELEMENTS, sections: SECTIONS });
}

describe('it builds what the model actually states', () => {
  it('carries b and h through as width and depth', () => {
    const { members } = run([1]);
    expect(members[0].width).toBe(0.2);
    expect(members[0].depth).toBe(0.5);
  });

  it('carries the section rotation, so a turned column is drawn turned', () => {
    expect(run([2]).members[0].rollDeg).toBe(30);
  });

  it('calls a vertical member a column and a horizontal one a beam', () => {
    expect(run([1]).members[0].kind).toBe('beam');
    expect(run([2]).members[0].kind).toBe('column');
  });

  it('returns members in the order asked for', () => {
    expect(run([2, 1]).members.map((m) => m.elementId)).toEqual([2, 1]);
  });
});

describe('it refuses rather than invents', () => {
  it('will not square an area into a section it was never given', () => {
    // The I-profile states inertia, not a rectangle. A plausible box here is worse than a
    // visible gap, because nobody would ever question it.
    const { members, refused } = run([3]);
    expect(members).toEqual([]);
    expect(refused).toEqual([{ elementId: 3, reason: 'noRectangle' }]);
  });

  it('names an element that is not in the model', () => {
    expect(run([99]).refused).toEqual([{ elementId: 99, reason: 'noNodes' }]);
  });

  it('names a member whose nodes coincide', () => {
    expect(run([4]).refused).toEqual([{ elementId: 4, reason: 'zeroLength' }]);
  });

  it('reports every refusal, not just the first', () => {
    const { members, refused } = run([1, 3, 4, 99]);
    expect(members.map((m) => m.elementId)).toEqual([1]);
    expect(refused.map((r) => r.elementId)).toEqual([3, 4, 99]);
  });
});

describe('a 2-D model still produces geometry', () => {
  it('treats a missing z as zero rather than as a missing member', () => {
    const { members } = membersFromModel({
      elementIds: [1],
      nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 4, y: 0 }],
      elements: [{ id: 1, nodeI: 1, nodeJ: 2, sectionId: 10 }],
      sections: SECTIONS,
    });
    expect(members[0].start.z).toBe(0);
    expect(members[0].kind).toBe('beam');
  });
});
