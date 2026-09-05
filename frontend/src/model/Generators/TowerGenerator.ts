import Model from '../Model';
import * as THREE from 'three';
import Node from '../Elements/Node/Node';
import ElasticBeamColumn from '../Elements/ElasticBeamColumn/ElasticBeamColumn';
import BoundaryCondition from '../BoundaryCondition/BoundaryCondition';
import Load from '../Load/Load';
import type { Section } from '../../types';

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
 *    (snapped to the nearest belt).
 *
 * Improvements:
 *  - Separate sections for main (leg/peak) members and diagonal (brace/belt/arm)
 *    members.
 *  - Optional automatic base supports (pinned or fixed) at the four foot nodes.
 *  - Optional automatic "realistic" loading: self-weight estimated from the
 *    member sections (gross area × material density × length × g) plus a wind
 *    load distributed across the face/altitude bands, both applied as nodal
 *    loads the solver can consume.
 */

export type SupportKind = 'pinned' | 'fixed';

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
  /** Section applied to the main (leg + peak) members. */
  legSectionId?: number;
  /** Section applied to the diagonal (brace + belt + arm) members. */
  braceSectionId?: number;
  /** Backward-compatible: single section applied to everything. */
  sectionId?: number;

  /** Auto-generate supports at the four base (foot) nodes. */
  autoSupports?: boolean;
  /** Fixity of the auto supports. */
  supportKind?: SupportKind;
  /** Auto-generate self-weight + wind nodal loads. */
  autoLoads?: boolean;
  /** Wind direction in the three.js scene frame, applied to every node. */
  windVector?: { x: number; y: number; z: number };
  /** Additional distributed wind magnitude (kN) applied per altitude band. */
  windForce?: number;
  /** Gravitational acceleration, m/s² (default 9.81). */
  gravity?: number;
}

export interface TowerResult {
  nodes: number;
  members: number;
  supports: number;
  loads: number;
}

/** Cross-sectional gross area (m²) of a section, for self-weight estimation. */
export function sectionArea(section: Section | undefined): number {
  if (!section) return 0;
  switch (section.type) {
    case 'Rectangular':
      return (section.width * section.height) * 1e-6;                 // mm² → m²
    case 'Circular':
      return Math.PI * Math.pow(section.diameter / 2, 2) * 1e-6;
    case 'HollowCircular': {
      const r = section.diameter / 2 - section.thickness;
      return Math.PI * (Math.pow(section.diameter / 2, 2) - r * r) * 1e-6;
    }
    case 'I':
    case 'IPN': {
      const depth = section.depth;
      const width = section.width;
      const tw = section.tw;
      const tf = section.tf;
      return (2 * width * tf + (depth - 2 * tf) * tw) * 1e-6;
    }
    case 'RectangularHollow': {
      const wi = section.width - 2 * section.thickness;
      const hi = section.height - 2 * section.thickness;
      return (section.width * section.height - wi * hi) * 1e-6;
    }
    case 'Channel':
    case 'UPN': {
      const width = section.width;
      const tw = section.tw;
      const tf = section.tf;
      return (2 * width * tf + (section.depth - 2 * tf) * tw) * 1e-6;
    }
    case 'Angle': {
      return (2 * section.width * section.thickness - section.thickness * section.thickness) * 1e-6;
    }
    case 'Tee': {
      return (section.width * section.tf + (section.depth - section.tf) * section.tw) * 1e-6;
    }
    default:
      return 0;
  }
}

export function generateTower(model: Model, params: TowerParams): TowerResult {
  // Resolve sections (allow the legacy single-section form).
  const legSection = model.sections.find((s) => s.id === (params.legSectionId ?? params.sectionId));
  const braceSection = model.sections.find((s) => s.id === (params.braceSectionId ?? params.sectionId));
  if (!legSection) throw new Error('Leg section not found — create a section first.');
  if (!braceSection) throw new Error('Brace section not found — create a section first.');

  const panels = Math.max(1, Math.round(params.panelCount));
  const bodyHeight = params.bodyHeight;
  const gravity = params.gravity ?? 9.81;

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
  const footNodes: Node[] = [];
  const allNodes: Node[] = [];
  const memberMeta: { member: ElasticBeamColumn; part: string; len: number; section: Section }[] = [];

  const addNode = (x: number, y: number, z: number): Node => {
    const n = new Node(new THREE.Vector3(x, y, z), undefined);
    n.model = model;
    n.create();
    model.nodes.push(n);
    allNodes.push(n);
    nodeCount++;
    return n;
  };
  const addMember = (a: Node, b: Node, part: string, section: Section): ElasticBeamColumn => {
    const m = new ElasticBeamColumn(model, 'TW-' + part, [a, b], section);
    m.create();
    model.members = [...model.members, m];
    memberCount++;
    memberMeta.push({
      member: m,
      part,
      len: new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).length(),
      section,
    });
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
    for (let c = 0; c < 4; c++) addMember(lo[c], hi[c], 'leg', legSection);
    for (let c = 0; c < 4; c++) addMember(hi[c], hi[(c + 1) % 4], 'belt', braceSection);
    for (const [a, b] of faces) {
      addMember(lo[a], hi[b], 'brace', braceSection);
      addMember(lo[b], hi[a], 'brace', braceSection);
    }
  }

  // Record the four base (foot) nodes for support generation.
  footNodes.push(...belts[0]);

  // ── Peak (shield-wire support) ──────────────────────────────────────────
  if (params.peakHeight > 0) {
    const top = belts[belts.length - 1];
    const apex = addNode(0, bodyHeight + params.peakHeight, 0);
    for (let c = 0; c < 4; c++) addMember(top[c], apex, 'peak', legSection);
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
        addMember(rootTop, faceCorners[0], 'arm', braceSection);
        addMember(rootTop, faceCorners[1], 'arm', braceSection);
        addMember(rootTop, rootBot, 'arm', braceSection);
        addMember(rootTop, tip, 'arm', braceSection);
        addMember(rootBot, tip, 'arm', braceSection);
      }
    }
  }

  // ── Automatic base supports ─────────────────────────────────────────────
  let supportCount = 0;
  if (params.autoSupports && footNodes.length) {
    const bc = new BoundaryCondition(model, {
      id: Math.floor(Math.random() * 0x7fffffff),
      name: 'Tower base',
      type: params.supportKind === 'fixed' ? 'fixed' : 'pinned',
      targets: footNodes.map((n) => n.id),
    } as any);
    bc.createOrUpdate();
    supportCount = footNodes.length;
  }

  // ── Automatic realistic loads ───────────────────────────────────────────
  let loadCount = 0;
  if (params.autoLoads) {
    // 1. Self-weight: estimate each member's mass from its gross area, material
    //    density and length, then lump half of its weight onto each end node.
    const selfWeightByNode = new Map<number, THREE.Vector3>();
    const addToNode = (nodeId: number, v: THREE.Vector3) => {
      const cur = selfWeightByNode.get(nodeId) || new THREE.Vector3();
      cur.add(v);
      selfWeightByNode.set(nodeId, cur);
    };
    for (const { member, len, section } of memberMeta) {
      const rho = (section.material?.rho) || 7850; // steel default kg/m³
      const area = sectionArea(section);
      const weight = rho * area * len * gravity; // N
      const half = weight / 2 / 1000; // → kN per end
      addToNode(member.nodes[0].id, new THREE.Vector3(0, -half, 0));
      addToNode(member.nodes[1].id, new THREE.Vector3(0, -half, 0));
    }

    // 2. Wind load: direction vector scaled and distributed with altitude.
    const wind = params.windVector
      ? new THREE.Vector3(params.windVector.x, params.windVector.y, params.windVector.z)
      : new THREE.Vector3(0, 0, 1);
    const windForceVal = params.windForce ?? 0;
    const windBase = windForceVal > 0 ? windForceVal : 1;
    const totalH = bodyHeight + params.peakHeight;
    const windByNode = new Map<number, THREE.Vector3>();
    for (const n of allNodes) {
      const t = totalH > 0 ? Math.max(0, Math.min(1, n.y / totalH)) : 0;
      // Higher nodes catch more wind: linear ramp +1 at the apex.
      const factor = 0.5 + 0.5 * t;
      const v = wind.clone().normalize().multiplyScalar(windBase * factor / 1000); // kN
      const cur = windByNode.get(n.id) || new THREE.Vector3();
      cur.add(v);
      windByNode.set(n.id, cur);
    }

    // Combine into per-node nodal loads, merging weight and wind where both exist.
    const combined = new Map<number, THREE.Vector3>();
    for (const [id, v] of selfWeightByNode) {
      const cur = combined.get(id) || new THREE.Vector3();
      cur.add(v);
      combined.set(id, cur);
    }
    for (const [id, v] of windByNode) {
      const cur = combined.get(id) || new THREE.Vector3();
      cur.add(v);
      combined.set(id, cur);
    }

    const makeNodalLoad = (targets: number[], value: THREE.Vector3) => {
      const load = new Load(model, {
        id: Math.floor(Math.random() * 0x7fffffff),
        name: 'Tower auto-load',
        type: 'nodal',
        targets,
        value,
      } as any);
      load.createOrUpdate();
      loadCount++;
    };

    // Group nodes by identical load vector to keep the load count reasonable.
    const groups = new Map<string, { targets: number[]; value: THREE.Vector3 }>();
    for (const [id, v] of combined) {
      const key = `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
      let g = groups.get(key);
      if (!g) {
        g = { targets: [], value: v.clone() };
        groups.set(key, g);
      }
      g.targets.push(id);
    }
    for (const g of groups.values()) makeNodalLoad(g.targets, g.value);
  }

  model.invalidateResults();
  return { nodes: nodeCount, members: memberCount, supports: supportCount, loads: loadCount };
}

// ── 2D elevation preview geometry ─────────────────────────────────────────

export interface ElevationPoint {
  x: number; // horizontal (world X)
  y: number; // vertical (world Y)
}

export interface ElevationSegment {
  from: ElevationPoint;
  to: ElevationPoint;
  kind: 'leg' | 'brace' | 'belt' | 'peak' | 'arm';
}

export interface ElevationGeometry {
  width: number;   // world-space total width (X extent)
  height: number;  // world-space total height (Y extent)
  segments: ElevationSegment[];
  baseNodes: ElevationPoint[];
  armTips: ElevationPoint[];
  apex: ElevationPoint;
}

/**
 * Produce a side-view (XZ-plane interpreted as elevation) of the tower from the
 * same parameters used by `generateTower`, but without touching the model. The
 * UI draws this onto a 2D canvas so the user can preview the shape before
 * generating.
 */
export function generateTowerElevation(params: TowerParams): ElevationGeometry {
  const panels = Math.max(1, Math.round(params.panelCount));
  const bodyHeight = params.bodyHeight;
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

  const segments: ElevationSegment[] = [];

  // Body: left and right legs, X-braces (single face), belt chords.
  for (let j = 0; j < levels.length - 1; j++) {
    const lo = levels[j];
    const hi = levels[j + 1];
    segments.push({ from: { x: -lo.halfW, y: lo.y }, to: { x: -hi.halfW, y: hi.y }, kind: 'leg' });
    segments.push({ from: { x: lo.halfW, y: lo.y }, to: { x: hi.halfW, y: hi.y }, kind: 'leg' });
    segments.push({ from: { x: -hi.halfW, y: hi.y }, to: { x: hi.halfW, y: hi.y }, kind: 'belt' });
    // X-braces on the front face
    segments.push({ from: { x: -lo.halfW, y: lo.y }, to: { x: hi.halfW, y: hi.y }, kind: 'brace' });
    segments.push({ from: { x: lo.halfW, y: lo.y }, to: { x: -hi.halfW, y: hi.y }, kind: 'brace' });
  }

  const baseNodes: ElevationPoint[] = [{ x: -levels[0].halfW, y: 0 }, { x: levels[0].halfW, y: 0 }];

  // Peak
  let apex: ElevationPoint = { x: 0, y: bodyHeight };
  if (params.peakHeight > 0) {
    apex = { x: 0, y: bodyHeight + params.peakHeight };
    const top = levels[levels.length - 1].halfW;
    segments.push({ from: { x: -top, y: bodyHeight }, to: apex, kind: 'peak' });
    segments.push({ from: { x: top, y: bodyHeight }, to: apex, kind: 'peak' });
  }

  // Arms
  const armTips: ElevationPoint[] = [];
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
      for (const side of [-1, 1] as const) {
        const x = side * lv.halfW;
        const tip: ElevationPoint = { x: x + side * params.armLength, y: lv.y - params.armDrop };
        segments.push({ from: { x, y: lv.y }, to: tip, kind: 'arm' });
        armTips.push(tip);
      }
    }
  }

  const maxX = Math.max(
    params.baseWidth / 2,
    ...armTips.map((t) => Math.abs(t.x)),
  );
  const maxY = Math.max(bodyHeight + params.peakHeight, bodyHeight);

  return {
    width: maxX * 2,
    height: maxY,
    segments,
    baseNodes,
    armTips,
    apex,
  };
}