/**
 * 2D elevation preview — third-party plugin port of the built-in
 * `generateTowerElevation` (frontend/src/model/Generators/TowerGenerator.ts).
 * Pure geometry, no model access; the panel draws it onto a canvas.
 */

export interface ElevationPoint {
  x: number; // horizontal (world X)
  y: number; // vertical (world Y)
}

export interface ElevationSegment {
  from: ElevationPoint
  to: ElevationPoint
  kind: 'leg' | 'brace' | 'belt' | 'peak' | 'arm'
}

export interface ElevationGeometry {
  width: number   // world-space total width (X extent)
  height: number  // world-space total height (Y extent)
  segments: ElevationSegment[]
  baseNodes: ElevationPoint[]
  armTips: ElevationPoint[]
  apex: ElevationPoint
}

interface ElevationParams {
  bodyHeight: number
  peakHeight: number
  baseWidth: number
  topWidth: number
  panelCount: number
  straightPanels?: number
  taper: 'linear' | 'step'
  armCount: number
  armLength: number
  armDrop: number
  armSpacing: number
}

/**
 * Produce a side-view of the tower from the same parameters used by
 * `generateTowerGraph`, without touching any model state.
 */
export function generateTowerElevation(params: Readonly<ElevationParams>): ElevationGeometry {
  const panels = Math.max(1, Math.round(params.panelCount));
  const bodyHeight = params.bodyHeight;
  // Mirror the two-part tower of generateTowerGraph: lower frustum (tapering
  // from baseWidth to topWidth) + straight head (constant topWidth) that
  // carries the conductor arms.
  const straightPanels = Math.max(
    0,
    Math.min(
      panels - 1,
      Math.round(params.straightPanels ?? Math.max(1, Math.floor(panels / 3))),
    ),
  );
  const taperPanels = panels - straightPanels;
  const halfWidthAt = (i: number) => {
    const t = taperPanels <= 0 ? 1 : Math.min(Math.max(i, 0), taperPanels) / taperPanels;
    return (params.baseWidth + ((params.topWidth - params.baseWidth) * t)) / 2;
  };

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

  // Arms — bolt only to the straight head (tầng 2), mirroring generateTowerGraph.
  const armTips: ElevationPoint[] = [];
  const armCount = Math.max(0, Math.min(3, Math.round(params.armCount)));
  if (armCount > 0) {
    const armCandidates = straightPanels > 0
      ? levels.map((_, i) => i).filter((i) => Math.abs(levels[i].halfW - params.topWidth / 2) < 1e-6)
      : bodyLevelIdx;
    const armBelts: number[] = [];
    for (let k = 0; k < armCount; k++) {
      const targetY = bodyHeight - k * params.armSpacing;
      let best = -1;
      for (const bi of armCandidates) {
        const lv = levels[bi];
        if (lv.y <= targetY + 1e-6 && (best === -1 || lv.y > levels[best].y)) best = bi;
      }
      if (best === -1 || armBelts.includes(best)) break;
      armBelts.push(best);
    }
    for (const bi of armBelts) {
      const lv = levels[bi];
      const lowerLv = bi > 0 ? levels[bi - 1] : null;
      for (const side of [-1, 1] as const) {
        const x = side * lv.halfW;
        const tip: ElevationPoint = { x: x + side * params.armLength, y: lv.y - params.armDrop };
        // Twin corner anchors at the head level + a diagonal stay to the belt
        // below — shows the delta cross-arm tied into the tower body.
        segments.push({ from: { x, y: lv.y }, to: tip, kind: 'arm' });
        if (lowerLv) {
          segments.push({ from: { x: side * lowerLv.halfW, y: lowerLv.y }, to: tip, kind: 'arm' });
        }
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