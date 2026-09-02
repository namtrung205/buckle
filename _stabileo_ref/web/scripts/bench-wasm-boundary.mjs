/**
 * bench-wasm-boundary.mjs — WASM JS↔engine boundary cost, before/after the
 * JsValue (serde-wasm-bindgen) migration of the hot exports.
 *
 * Usage:
 *   node web/scripts/bench-wasm-boundary.mjs
 *
 * "After" artifact: web/src/lib/wasm (built from the working tree).
 * "Before" artifact: /tmp/wasm-old (built from git HEAD's engine/src/lib.rs —
 * rebuild with:
 *   git show HEAD:engine/src/lib.rs > engine/src/lib.rs && \
 *   (cd engine && wasm-pack build --target web --out-dir /tmp/wasm-old) && \
 *   git checkout -- engine/src/lib.rs   # or restore the new lib.rs
 * If /tmp/wasm-old is missing, only "after" numbers are printed.
 *
 * Also prints map-key round-trip evidence: id-keyed input maps and
 * result-object round trips through combine_results_3d.
 */

import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadGlue(dir) {
  const glue = await import(pathToFileURL(path.join(dir, 'dedaliano_engine.js')).href);
  glue.initSync({ module: readFileSync(path.join(dir, 'dedaliano_engine_bg.wasm')) });
  return glue;
}

const newGlue = await loadGlue(path.join(here, '../src/lib/wasm'));
let oldGlue = null;
try {
  oldGlue = await loadGlue('/tmp/wasm-old');
} catch {
  console.log('NOTE: /tmp/wasm-old not found — printing AFTER numbers only.\n');
}

// ─── Model builder (3D frame building — well-conditioned, sparse-friendly) ─

/**
 * Regular frame building: bays×bays footprint, `floors` storeys, fixed bases.
 * ~1000 elements: bays=4, floors=16 → 1040 elem / 425 nodes (2550 DOFs).
 * ~5000 elements: bays=6, floors=36 → 4788 elem / 1813 nodes (10878 DOFs).
 * A cantilever chain is NOT used: it ill-conditions and triggers the dense-LU
 * fallback, which would measure the solver instead of the boundary.
 */
function buildModel3D(nElem, idStride = 1) {
  const floors = nElem >= 4000 ? 36 : nElem <= 400 ? 5 : 16;
  const bays = nElem >= 4000 ? 6 : 4;
  const bayLen = 4.0, storeyH = 3.0;
  const perPlane = bays + 1;
  const nodes = {}, elements = {}, supports = {};
  const nid = (ix, iz, f) => 1 + (f * perPlane * perPlane + iz * perPlane + ix) * idStride;
  for (let f = 0; f <= floors; f++)
    for (let iz = 0; iz <= bays; iz++)
      for (let ix = 0; ix <= bays; ix++) {
        const id = nid(ix, iz, f);
        nodes[String(id)] = { id, x: ix * bayLen, y: iz * bayLen, z: f * storeyH };
        if (f === 0) supports[String(id)] = { nodeId: id, rx: true, ry: true, rz: true, rrx: true, rry: true, rrz: true };
      }
  let k = 0;
  for (let f = 0; f < floors; f++)
    for (let iz = 0; iz <= bays; iz++)
      for (let ix = 0; ix <= bays; ix++) {
        const id = 1 + k++ * idStride;
        elements[String(id)] = { id, type: 'frame', nodeI: nid(ix, iz, f), nodeJ: nid(ix, iz, f + 1), materialId: 1, sectionId: 1 };
      }
  for (let f = 1; f <= floors; f++) {
    for (let iz = 0; iz <= bays; iz++)
      for (let ix = 0; ix < bays; ix++) {
        const id = 1 + k++ * idStride;
        elements[String(id)] = { id, type: 'frame', nodeI: nid(ix, iz, f), nodeJ: nid(ix + 1, iz, f), materialId: 1, sectionId: 1 };
      }
    for (let iz = 0; iz < bays; iz++)
      for (let ix = 0; ix <= bays; ix++) {
        const id = 1 + k++ * idStride;
        elements[String(id)] = { id, type: 'frame', nodeI: nid(ix, iz, f), nodeJ: nid(ix, iz + 1, f), materialId: 1, sectionId: 1 };
      }
  }
  const loads = [];
  for (let f = 1; f <= floors; f++)
    loads.push({ type: 'nodal', data: { nodeId: nid(0, 0, f), fx: 20, fy: 0, fz: -50, mx: 0, my: 0, mz: 0 } });
  return {
    nodes,
    materials: { '1': { id: 1, e: 200e6, nu: 0.3 } },          // kN/m² (steel)
    sections: { '1': { id: 1, a: 0.01, iy: 1e-4, iz: 1e-4, j: 2e-4 } },
    elements,
    supports,
    loads,
    plates: {}, quads: {}, curvedShells: {}, constraints: [], connectors: {}, leftHand: false,
  };
}

/** Small cantilever with non-contiguous id keys — for round-trip evidence only. */
function buildEvidenceModel() {
  return buildCantilever(20, 6); // node keys "1","7","13",…,"121"
}

function buildCantilever(nElem, idStride = 1) {
  const nodes = {}, elements = {};
  const nid = (i) => 1 + i * idStride;
  for (let i = 0; i <= nElem; i++) nodes[String(nid(i))] = { id: nid(i), x: i * 1.0, y: 0, z: 0 };
  for (let i = 0; i < nElem; i++) {
    const id = nid(i);
    elements[String(id)] = { id, type: 'frame', nodeI: nid(i), nodeJ: nid(i + 1), materialId: 1, sectionId: 1 };
  }
  return {
    nodes,
    materials: { '1': { id: 1, e: 200e6, nu: 0.3 } },
    sections: { '1': { id: 1, a: 0.01, iy: 1e-4, iz: 1e-4, j: 2e-4 } },
    elements,
    supports: { '1': { nodeId: 1, rx: true, ry: true, rz: true, rrx: true, rry: true, rrz: true } },
    loads: [
      { type: 'nodal', data: { nodeId: nid(nElem), fx: 0, fy: -50, fz: -25, mx: 0, my: 0, mz: 0 } },
      { type: 'distributed', data: { elementId: 1, qYI: -5, qYJ: -5, qZI: 0, qZJ: 0 } },
    ],
    plates: {}, quads: {}, curvedShells: {}, constraints: [], connectors: {}, leftHand: false,
  };
}

// ─── Map-key round-trip evidence ───────────────────────────────────

function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  PASS: ${msg}`);
}

function isPlainJson(v) {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return true;
  if (t === 'undefined' || t === 'bigint' || t === 'function') return false;
  if (Array.isArray(v)) return v.every(isPlainJson);
  if (v instanceof Map || v instanceof Set || v instanceof Uint8Array) return false;
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
  return Object.values(v).every(isPlainJson);
}

console.log('— Map-key round-trip evidence (id-keyed maps, non-contiguous string keys) —');
{
  const wire = buildEvidenceModel(); // node keys "1","7","13",…,"121"
  const res = newGlue.solve_3d(wire);

  const inputIds = Object.keys(wire.nodes).map(Number).sort((a, b) => a - b);
  const outIds = res.displacements.map(d => d.nodeId).sort((a, b) => a - b);
  assert(
    JSON.stringify(inputIds) === JSON.stringify(outIds),
    `input node keys ${inputIds.length} ids ("1","7",…,"121") → displacements reference exactly those ids`,
  );

  const inputElemIds = Object.keys(wire.elements).map(Number).sort((a, b) => a - b);
  const outElemIds = res.elementForces.map(f => f.elementId).sort((a, b) => a - b);
  assert(
    JSON.stringify(inputElemIds) === JSON.stringify(outElemIds),
    `input element keys → elementForces reference exactly those ids`,
  );

  assert(isPlainJson(res), 'solve_3d result is plain JSON-compatible data (no Map/Uint8Array/BigInt/undefined)');

  // Feed the result object straight back across the boundary (no JSON text).
  const comb = newGlue.combine_results_3d({
    factors: [{ caseId: 1, factor: 2 }],
    cases: [{ caseId: 1, results: res }],
  });
  const d0 = res.displacements[5], c0 = comb.displacements[5];
  assert(
    c0.nodeId === d0.nodeId && Math.abs(c0.uz - 2 * d0.uz) < 1e-12,
    `result object re-entered via combine_results_3d: nodeId ${c0.nodeId} preserved, uz doubled (${d0.uz.toExponential(3)} → ${c0.uz.toExponential(3)})`,
  );
  assert(isPlainJson(comb), 'combine_results_3d result is plain JSON-compatible data');
}

// ─── Benchmarks ────────────────────────────────────────────────────

function median(xs) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

function benchSolve(nElem, runs) {
  const wire = buildModel3D(nElem);
  const row = { nElem };
  // warmup + measure NEW (JsValue in → JsValue out)
  let res = newGlue.solve_3d(wire);
  row.payloadKB = Math.round(JSON.stringify(res).length / 1024);
  const tNew = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    res = newGlue.solve_3d(wire);
    tNew.push(performance.now() - t0);
  }
  row.newTotal = median(tNew);
  if (oldGlue) {
    // OLD: JS stringify → string in → string out → JS parse
    let json = JSON.stringify(wire);
    let out = oldGlue.solve_3d(json);
    JSON.parse(out);
    const tSer = [], tWasm = [], tParse = [];
    for (let i = 0; i < runs; i++) {
      let t0 = performance.now();
      json = JSON.stringify(wire);
      const t1 = performance.now();
      out = oldGlue.solve_3d(json);
      const t2 = performance.now();
      JSON.parse(out);
      const t3 = performance.now();
      tSer.push(t1 - t0); tWasm.push(t2 - t1); tParse.push(t3 - t2);
    }
    row.oldSer = median(tSer); row.oldWasm = median(tWasm); row.oldParse = median(tParse);
    row.oldTotal = row.oldSer + row.oldWasm + row.oldParse;
  }
  // Combine bench: 4 cases referencing the same result object (per-combo call).
  const cases = [{ caseId: 1, results: res }, { caseId: 2, results: res }, { caseId: 3, results: res }, { caseId: 4, results: res }];
  const factors = cases.map(c => ({ caseId: c.caseId, factor: 1 }));
  const tNewC = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    newGlue.combine_results_3d({ factors, cases });
    tNewC.push(performance.now() - t0);
  }
  row.newCombine = median(tNewC);
  if (oldGlue) {
    const tSerC = [], tWasmC = [], tParseC = [];
    for (let i = 0; i < runs; i++) {
      let t0 = performance.now();
      const payload = JSON.stringify({ factors, cases });
      const t1 = performance.now();
      const out = oldGlue.combine_results_3d(payload);
      const t2 = performance.now();
      JSON.parse(out);
      const t3 = performance.now();
      tSerC.push(t1 - t0); tWasmC.push(t2 - t1); tParseC.push(t3 - t2);
    }
    row.oldCombineSer = median(tSerC); row.oldCombineWasm = median(tWasmC); row.oldCombineParse = median(tParseC);
    row.oldCombine = row.oldCombineSer + row.oldCombineWasm + row.oldCombineParse;
  }
  return row;
}

const fmt = (v) => (v === undefined ? '   —  ' : v.toFixed(1).padStart(7));

console.log('\n— solve_3d end-to-end (medians, ms) —');
console.log('model        payload |  OLD: JS-ser  wasm-call JS-parse    total |  NEW: wasm-call(=total) | speedup');
// 5000-elem is opt-in (--big): the 30k-DOF solve dominates and the point is
// already made at 1000. Run it standalone for clean timings.
const sizes = process.argv.includes('--big') ? [300, 1000, 5000] : [300, 1000];
for (const n of sizes) {
  try {
    console.error(`[bench] solving ${n}-elem model…`);
    const r = benchSolve(n, n >= 5000 ? 3 : 7);
    console.log(
      `${String(r.nElem).padStart(5)} elem ${String(r.payloadKB).padStart(6)} KB |` +
      (oldGlue
        ? `${fmt(r.oldSer)}${fmt(r.oldWasm)}${fmt(r.oldParse)}${fmt(r.oldTotal)} |${fmt(r.newTotal)}               | ${(r.oldTotal / r.newTotal).toFixed(2)}×`
        : `       (old artifact missing)       |${fmt(r.newTotal)}`),
    );
    console.log(
      `${' '.repeat(21)}combine4 |` +
      (oldGlue
        ? `${fmt(r.oldCombineSer)}${fmt(r.oldCombineWasm)}${fmt(r.oldCombineParse)}${fmt(r.oldCombine)} |${fmt(r.newCombine)}               | ${(r.oldCombine / r.newCombine).toFixed(2)}×`
        : `                               |${fmt(r.newCombine)}`),
    );
  } catch (e) {
    console.log(`${n} elem: FAILED — ${e.message}`);
  }
}
