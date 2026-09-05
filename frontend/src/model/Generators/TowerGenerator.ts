import Model from '../Model';
import * as THREE from 'three';
import Node from '../Elements/Node/Node';
import ElasticBeamColumn from '../Elements/ElasticBeamColumn/ElasticBeamColumn';

/**
 * Transmission-tower (lattice) generator — 500 kV style steel towers.
 *
 * Geometry model:
 *  - Body: a square prism of `panelCount` panels, shrinking from `baseWidth`
 *    at the ground belt to `topWidth` at the top belt. The shrink is either
 *    continuous ('linear' — raking legs) or stepped ('step' — each panel keeps
 *    its lower width for 60 % of its height, then kinks in).
 *  - Every belt is closed with 4 chords, every panel gets 4 X-braces.
 *  - Peak: a small pyramid on top of the body for the shield (earth) wires.
 *  - Arms (tai đỡ): cantilevers bolted to the body belts. `armCount` arms per
 *    side stacked from the top belt downwards every `armSpacing` metres
 *    (snapped to the nearest belt). Each arm = root-top on the body face
 *    mid-width, root-bottom below it and a tip node, braced.
 *    'double' circuit = delta / cat-head shape (armDrop tilts each lower arm
 *    tip further down); 'single' circuit keeps the tips level.
 */

export interface TowerParams {
  circuit: 'single' | 'double';
  /** Body height above ground, m (excludes the peak). */
  bodyHeight: number;
  /** Shield-wire peak height above the body top, m. */
  peakHeight: number;
  /** Leg-to-leg width at the ground belt, m. */
  baseWidth: number;
  /** Leg-to-leg width at the top of the body, m. */
  topWidth: number;
  /** Number of body panels (storeys). */
  panelCount: number;
  /** How the body narrows: continuous raking legs or stepped per panel. */
  taper: 'linear' | 'step';
  /** Number of arms per side (tai đỡ), 1..3. */
  armCount: number;
  /** Arm length from the body face to the tip, m. */
  armLength: number;
  /** Vertical drop of the arm tip below its belt, m (delta shape). */
  armDrop: number;
  /** Vertical distance between consecutive arms, m (snapped to nearest belt). */
  armSpacing: number;
  /** Section applied to every generated member. */
  sectionId: number;
}

export interface TowerResult {
  nodes: number;
  members: number;
}

export function generateTower(model: Model, params: TowerParams): TowerResult {
  const section = model.sections.find((s) => s.id === params.sectionId);
  if (!section) throw new Error('Section not found — create a section first.');

  const panels = Math.max(1, Math.round(params.panelCount));
  const bodyHeight = params.bodyHeight;

  // ── Level (belt) layout ─────────────────────────────────────────────────
  const halfWidthAt = (i: number) =>
    (params.baseWidth + ((params.topWidth - params.baseWidth) * i) / panels) / 2;

  type Level = { y: number; halfW: number };
  let levels: Level[] = [];
  const bodyLevelIdx: number[] = [];
  for (let i = 0; i <= panels; i++) {
    bodyLevelIdx.push(levels.length);
    levels.push({ y: (bodyHeight * i) / panels, halfW: halfWidthAt(i) });
  }
  if (params.taper === 'step') {
    const stepped: Level[] = [];
    for (let i = 0; i < panels; i++) {
      const a = levels[i];
      const b = levels[i + 1];
      stepped.push(a);
      stepped.push({ y: a.y + (b.y - a.y) * 0.6, halfW: a.halfW });
    }
    stepped.push(levels[levels.length - 1]);
    levels = stepped;
  }

  // ── Node / member factories ─────────────────────────────────────────────
  let nodeCount = 0;
  let memberCount = 0;
  const addNode = (x: number, y: number, z: number): Node => {
    const n = new Node(new THREE.Vector3(x, y, z), undefined);
    n.model = model;
    n.create();
    model.nodes.push(n);
    nodeCount++;
    return n;
  };
  const addMember = (a: Node, b: Node, part: string): ElasticBeamColumn => {
    const m = new ElasticBeamColumn(model, 'TW-' + part, [a, b], section);
    m.create();
    model.members = [...model.members, m];
    memberCount++;
    return m;
  };

  // ── Body belts + panels ─────────────────────────────────────────────────
  const belts: Node[][] = levels.map((lv) => [
    addNode(-lv.halfW, lv.y, -lv.halfW),
    addNode(lv.halfW, lv.y, -lv.halfW),
    addNode(lv.halfW, lv.y, lv.halfW),
    addNode(-lv.halfW, lv.y, lv.halfW),
  ]);

  const faces: [number, number][] = [
    [0, 1], // z = -w
    [1, 2], // x = +w
    [2, 3], // z = +w
    [3, 0], // x = -w
  ];

  for (let j = 0; j < belts.length - 1; j++) {
    const lo = belts[j];
    const hi = belts[j + 1];
    for (let c = 0; c < 4; c++) addMember(lo[c], hi[c], 'leg');
    for (let c = 0; c < 4; c++) addMember(hi[c], hi[(c + 1) % 4], 'belt');
    for (const [a, b] of faces) {
      addMember(lo[a], hi[b], 'brace');
      addMember(lo[b], hi[a], 'brace');
    }
  }

  // ── Peak (shield-wire support) ──────────────────────────────────────────
  if (params.peakHeight > 0) {
    const top = belts[belts.length - 1];
    const apex = addNode(0, bodyHeight + params.peakHeight, 0);
    for (let c = 0; c < 4; c++) addMember(top[c], apex, 'peak');
  }

  // ── Arms (tai đỡ) ───────────────────────────────────────────────────────
  const armCount = Math.max(0, Math.min(3, Math.round(params.armCount)));
  if (armCount > 0) {
    const armBelts: number[] = [];
    for (let k = 0; k < armCount; k++) {
      const targetY = bodyHeight - k * params.armSpacing;
      let best = -1;
      for (const bi of bodyLevelIdx) {
        const lv = levels[bi];
        if (lv.y <= targetY + 1e-6 && (best === -1 || lv.y > levels[best].y)) best = bi;
      }
      if (best === -1 || armBelts.includes(best)) break;
      armBelts.push(best);
    }

    for (const bi of armBelts) {
      const lv = levels[bi];
      const belt = belts[bi];
      const panelH = bodyHeight / panels;
      const rootDrop = Math.min(1.0, panelH * 0.35);
      for (const side of [-1, 1] as const) {
        const faceCorners = side > 0 ? [belt[1], belt[2]] : [belt[3], belt[0]];
        const xSide = side * lv.halfW;
        const rootTop = addNode(xSide, lv.y, 0);
        const rootBot = addNode(xSide, lv.y - rootDrop, 0);
        const tip = addNode(xSide + side * params.armLength, lv.y - params.armDrop, 0);
        addMember(rootTop, faceCorners[0], 'arm');
        addMember(rootTop, faceCorners[1], 'arm');
        addMember(rootTop, rootBot, 'arm');
        addMember(rootTop, tip, 'arm');
        addMember(rootBot, tip, 'arm');
      }
    }
  }

  model.invalidateResults();
  return { nodes: nodeCount, members: memberCount };
}
