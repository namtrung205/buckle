import * as THREE from 'three'
import { ENTITY_HOVERED, ENTITY_SELECTED, ENTITY_VISIBLE, type StructuralSceneDB } from './StructuralSceneDB.ts'

export type AnnotationPriority = 'selected' | 'hovered' | 'extrema' | 'id' | 'value'

export type ProjectedLabel = {
  id: string
  text: string
  anchor: readonly [number, number, number]
  screenX: number
  screenY: number
  depth: number
  priority: AnnotationPriority
  /** Labels explicitly enabled by the user bypass LOD budget/decluttering. */
  forceVisible?: boolean
  color?: readonly [number, number, number]
}

const PRIORITY: Record<AnnotationPriority, number> = {
  selected: 5,
  hovered: 4,
  extrema: 3,
  id: 2,
  value: 1,
}

/** Pure, deterministic screen-space label scheduler. Selected labels bypass both
 * the normal budget and collision rejection, so selection feedback never
 * disappears at a distant LOD. */
export const scheduleProjectedLabels = (
  labels: readonly ProjectedLabel[],
  budget = 200,
  cellWidth = 110,
  cellHeight = 28,
) => {
  const sorted = [...labels].sort((a, b) =>
    PRIORITY[b.priority] - PRIORITY[a.priority] || a.id.localeCompare(b.id),
  )
  const accepted: ProjectedLabel[] = []
  const occupied = new Set<string>()
  let regularCount = 0
  for (const label of sorted) {
    const pinned = label.forceVisible || label.priority === 'selected' || label.priority === 'extrema'
    const key = `${Math.floor(label.screenX / cellWidth)}:${Math.floor(label.screenY / cellHeight)}`
    if (!pinned && (regularCount >= budget || occupied.has(key))) continue
    accepted.push(label)
    if (!pinned) regularCount++
    occupied.add(key)
  }
  return accepted
}

const FIRST_CHAR = 32
const LAST_CHAR = 126
const COLUMNS = 16
const CELL_W = 32
const CELL_H = 40

export const glyphUvRect = (character: string): readonly [number, number, number, number] => {
  const code = Math.min(LAST_CHAR, Math.max(FIRST_CHAR, character.charCodeAt(0) || 63)) - FIRST_CHAR
  const column = code % COLUMNS
  const row = Math.floor(code / COLUMNS)
  const rows = Math.ceil((LAST_CHAR - FIRST_CHAR + 1) / COLUMNS)
  return [column / COLUMNS, 1 - (row + 1) / rows, (column + 1) / COLUMNS, 1 - row / rows]
}

/** Compact CAD-like horizontal metrics. Glyphs still share one atlas/batch,
 * but punctuation and narrow letters no longer consume a full monospace cell. */
export const glyphAdvance = (character: string) => {
  if (character === ' ') return 4
  if (/[.,:;|!ilI1'`()\[\]]/.test(character)) return 5
  if (/[MW@%&#]/.test(character)) return 11
  return 9
}

const createGlyphAtlas = () => {
  const rows = Math.ceil((LAST_CHAR - FIRST_CHAR + 1) / COLUMNS)
  if (typeof document === 'undefined') {
    const texture = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat)
    texture.needsUpdate = true
    return texture
  }
  const canvas = document.createElement('canvas')
  canvas.width = COLUMNS * CELL_W
  canvas.height = rows * CELL_H
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#fff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  // A light condensed engineering face reads closer to CAD/SHX lettering while
  // remaining a normal canvas font that can be packed into the shared SDF atlas.
  // The fallbacks are ordered for Windows first, then other browser platforms.
  context.font = '400 28px "Arial Narrow", "Bahnschrift Condensed", "Roboto Condensed", sans-serif'
  for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
    const index = code - FIRST_CHAR
    context.fillText(String.fromCharCode(code), (index % COLUMNS + 0.5) * CELL_W, (Math.floor(index / COLUMNS) + 0.5) * CELL_H)
  }
  // Convert the glyph mask to a compact signed-distance field once. This
  // keeps edges readable across DPI/zoom changes without one texture per
  // label. Search is intentionally bounded to the glyph cell (atlas build is
  // a one-off ~20M comparisons, not per-frame work).
  const source = context.getImageData(0, 0, canvas.width, canvas.height)
  const output = context.createImageData(canvas.width, canvas.height)
  const radius = 6
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const inside = source.data[(y * canvas.width + x) * 4 + 3] > 127
    const cellX = Math.floor(x / CELL_W) * CELL_W
    const cellY = Math.floor(y / CELL_H) * CELL_H
    let distance = radius
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy >= distance * distance) continue
      const sx = x + dx, sy = y + dy
      if (sx < cellX || sx >= cellX + CELL_W || sy < cellY || sy >= cellY + CELL_H) continue
      const sampleInside = source.data[(sy * canvas.width + sx) * 4 + 3] > 127
      if (sampleInside !== inside) distance = Math.sqrt(dx * dx + dy * dy)
    }
    const value = Math.round(255 * (.5 + (inside ? distance : -distance) / (2 * radius)))
    const o = (y * canvas.width + x) * 4
    output.data[o] = output.data[o + 1] = output.data[o + 2] = value
    output.data[o + 3] = 255
  }
  context.putImageData(output, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

export type SymbolCandidate = {
  anchor: readonly [number, number, number]
  direction?: readonly [number, number, number]
  kind: number
  /** Bit mask used by compound symbols. Support bits 0..5 represent
   * Dx, Dy, Dz, Rx, Ry and Rz respectively. */
  state?: number
  color: readonly [number, number, number]
}
export type WorldLabelCandidate = Omit<ProjectedLabel, 'screenX' | 'screenY' | 'depth'>

/** Two constant-draw-call annotation passes: one instanced glyph stream and one
 * instanced structural-symbol stream. No Object3D or DOM node is created per
 * entity. */
export default class GpuAnnotations {
  readonly group = new THREE.Group()
  readonly textMesh: THREE.Mesh
  readonly symbolMesh: THREE.Mesh
  labelBudget = 200
  private dirty = true
  private lastDbVersion = -1
  private memberLabels = false
  private nodeLabels = false
  private supports: SymbolCandidate[] = []
  private extraLabels: WorldLabelCandidate[] = []
  private resultLabels: WorldLabelCandidate[] = []
  private memberText = new Map<number, string>()
  private nodeText = new Map<number, string>()
  private selectedValue: ((entityId: number) => string | null) | null = null
  private viewport = new THREE.Vector2(1, 1)
  private readonly atlas = createGlyphAtlas()
  private readonly temp = new THREE.Vector3()

  constructor(scene: THREE.Scene, layer = 0) {
    this.group.name = 'GpuAnnotations'
    this.group.layers.set(layer)
    this.textMesh = this.createTextMesh()
    this.symbolMesh = this.createSymbolMesh()
    this.group.add(this.textMesh, this.symbolMesh)
    scene.add(this.group)
  }

  setLabelBudget(value: number) { this.labelBudget = Math.max(0, Math.floor(value)); this.dirty = true }
  setMemberLabels(value: boolean) { this.memberLabels = value; this.dirty = true }
  setNodeLabels(value: boolean) { this.nodeLabels = value; this.dirty = true }
  setData(symbols: SymbolCandidate[], labels: WorldLabelCandidate[] = []) { this.supports = symbols; this.extraLabels = labels; this.dirty = true }
  setResultLabels(labels: WorldLabelCandidate[]) { this.resultLabels = labels; this.dirty = true }
  setEntityLabels(members: ReadonlyMap<number, string>, nodes: ReadonlyMap<number, string>) {
    this.memberText = new Map(members); this.nodeText = new Map(nodes); this.dirty = true
  }
  setSelectedValueProvider(value: ((entityId: number) => string | null) | null) { this.selectedValue = value; this.dirty = true }
  markDirty() { this.dirty = true }

  update(db: StructuralSceneDB, camera: THREE.Camera, width: number, height: number) {
    const material = this.textMesh.material as THREE.ShaderMaterial
    const symbolMaterial = this.symbolMesh.material as THREE.ShaderMaterial
    this.viewport.set(Math.max(1, width), Math.max(1, height))
    material.uniforms.viewport.value.copy(this.viewport)
    symbolMaterial.uniforms.viewport.value.copy(this.viewport)
    if (!this.dirty && db.version === this.lastDbVersion) return
    this.lastDbVersion = db.version
    this.dirty = false
    const candidates: ProjectedLabel[] = []
    const project = (anchor: readonly [number, number, number]) => {
      this.temp.fromArray(anchor).project(camera)
      return { x: (this.temp.x * .5 + .5) * width, y: (-this.temp.y * .5 + .5) * height, z: this.temp.z }
    }
    for (let i = 0; i < db.memberCount; i++) {
      const flags = db.memberFlags[i]
      if (!(flags & ENTITY_VISIBLE)) continue
      const selected = Boolean(flags & ENTITY_SELECTED)
      const hovered = Boolean(flags & ENTITY_HOVERED)
      if (!this.memberLabels && !selected && !hovered) continue
      const offset = i * 6
      const anchor: [number, number, number] = [
        (db.memberEndpoints[offset] + db.memberEndpoints[offset + 3]) * .5,
        (db.memberEndpoints[offset + 1] + db.memberEndpoints[offset + 4]) * .5,
        (db.memberEndpoints[offset + 2] + db.memberEndpoints[offset + 5]) * .5,
      ]
      const p = project(anchor)
      if (p.z < -1 || p.z > 1) continue
      const result = selected ? this.selectedValue?.(db.memberIds[i]) : null
      const baseText = this.memberText.get(db.memberIds[i]) || `M${db.memberIds[i]}`
      candidates.push({ id: `member-${db.memberIds[i]}`, text: `${baseText}${result ? ` ${result}` : ''}`, anchor, screenX: p.x, screenY: p.y, depth: p.z,
        priority: selected ? 'selected' : hovered && !this.memberLabels ? 'hovered' : 'id', forceVisible: this.memberLabels,
        color: selected ? [1, .75, .1] : [1, 1, 1] })
    }
    for (const label of [...this.extraLabels, ...this.resultLabels]) {
      const p = project(label.anchor)
      if (p.z >= -1 && p.z <= 1) candidates.push({ ...label, screenX: p.x, screenY: p.y, depth: p.z })
    }
    for (let i = 0; i < db.nodeCount; i++) {
      const flags = db.nodeFlags[i]
      if (!(flags & ENTITY_VISIBLE)) continue
      const selected = Boolean(flags & ENTITY_SELECTED)
      const hovered = Boolean(flags & ENTITY_HOVERED)
      if (!this.nodeLabels && !selected && !hovered) continue
      const anchor: [number, number, number] = [db.nodePositions[i * 3], db.nodePositions[i * 3 + 1], db.nodePositions[i * 3 + 2]]
      const p = project(anchor)
      if (p.z < -1 || p.z > 1) continue
      candidates.push({ id: `node-${db.nodeIds[i]}`, text: this.nodeText.get(db.nodeIds[i]) || `N${db.nodeIds[i]}`, anchor, screenX: p.x, screenY: p.y, depth: p.z,
        priority: selected ? 'selected' : hovered && !this.nodeLabels ? 'hovered' : 'id', forceVisible: this.nodeLabels,
        color: selected ? [1, .75, .1] : [.8, .95, 1] })
    }
    this.uploadText(scheduleProjectedLabels(candidates, this.labelBudget))
    this.uploadSymbols(this.supports)
  }

  private createTextMesh() {
    const geometry = new THREE.InstancedBufferGeometry().copy(
      new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry,
    )
    const material = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, uniforms: { atlas: { value: this.atlas }, viewport: { value: this.viewport } },
      vertexShader: `attribute vec3 iAnchor; attribute vec2 iOffset; attribute vec4 iUv; attribute vec3 iColor; uniform vec2 viewport; varying vec2 vUv; varying vec3 vColor; void main(){ vec4 c=projectionMatrix*viewMatrix*vec4(iAnchor,1.); c.xy+=(iOffset+position.xy*vec2(13.,19.))*2./viewport*c.w; gl_Position=c; vUv=mix(iUv.xy,iUv.zw,uv); vColor=iColor; }`,
      fragmentShader: `uniform sampler2D atlas; varying vec2 vUv; varying vec3 vColor; void main(){ float d=texture2D(atlas,vUv).r; float a=smoothstep(.44,.56,d); if(a<.02) discard; gl_FragColor=vec4(vColor,a); }`,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false; mesh.renderOrder = 1100; mesh.name = 'GpuGlyphs'; geometry.instanceCount = 0
    return mesh
  }

  private createSymbolMesh() {
    const geometry = new THREE.InstancedBufferGeometry().copy(
      new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry,
    )
    const material = new THREE.ShaderMaterial({ transparent: true, depthTest: true, depthWrite: false,
      uniforms: { viewport: { value: this.viewport } },
      vertexShader: `attribute vec3 iAnchor; attribute vec3 iDirection; attribute float iKind; attribute float iState; attribute vec3 iColor; uniform vec2 viewport; varying vec2 vP; varying float vKind; varying float vState; varying vec3 vColor; void main(){ vec4 c=projectionMatrix*viewMatrix*vec4(iAnchor,1.); vec4 t=projectionMatrix*viewMatrix*vec4(iAnchor+iDirection,1.); vec2 d=(t.xy/max(t.w,1e-6)-c.xy/max(c.w,1e-6))*viewport; d=length(d)>.001?normalize(d):vec2(0.,1.); vec2 side=vec2(d.y,-d.x); float size=iKind<.5?24.:34.; vec2 local=position.xy*size; vec2 oriented=iKind<.5?local:side*local.x+d*local.y; c.xy+=oriented*2./viewport*c.w; gl_Position=c; vP=uv*2.-1.; vKind=iKind; vState=iState; vColor=iColor; }`,
      fragmentShader: `varying vec2 vP; varying float vKind; varying float vState; varying vec3 vColor; void main(){ vec2 p=abs(vP); float hex=max(dot(p,vec2(.8660254,.5)),p.y); float support=1.-step(.82,hex); float shaft=(1.-step(.105,p.x))*step(-.86,vP.y)*step(vP.y,.28); float head=(1.-step((.82-vP.y)*.88,p.x))*step(.05,vP.y)*step(vP.y,.82); float linearArrow=max(shaft,head); float radius=length(vP); float momentRing=step(.50,radius)*(1.-step(.78,radius))*step(-.72,vP.x); float momentHead=(1.-step(.18,length(vP-vec2(-.48,.58)))); if(vKind<.5){ if(support<.5) discard; const float PI=3.14159265359; float sectorPos=mod(atan(vP.y,vP.x)+PI+PI/6.,2.*PI)/(PI/3.); float sector=floor(sectorPos); float dofIndex=mod(10.-sector,6.); float restrained=mod(floor(vState/exp2(dofIndex)),2.); float radialEdge=1.-step(.035,min(fract(sectorPos),1.-fract(sectorPos))*max(radius,.001)); float outerEdge=step(.72,hex); vec3 freeColor=vec3(.92,.055,.035); vec3 fill=mix(freeColor,vColor,restrained); float edge=.8*max(radialEdge,outerEdge); gl_FragColor=vec4(mix(fill,vec3(0.),edge),.96); return; } float shape=vKind>2.5&&vKind<3.5?max(momentRing,momentHead):linearArrow; if(shape<.5) discard; gl_FragColor=vec4(vColor,1.); }`,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false; mesh.renderOrder = 999; mesh.name = 'GpuStructuralSymbols'; geometry.instanceCount = 0
    return mesh
  }

  private uploadText(labels: readonly ProjectedLabel[]) {
    const anchors: number[] = [], offsets: number[] = [], uvs: number[] = [], colors: number[] = []
    for (const label of labels) {
      const characters = [...label.text]
      const advances = characters.map(glyphAdvance)
      let cursor = -advances.reduce((total, advance) => total + advance, 0) / 2
      characters.forEach((character, index) => {
        const advance = advances[index]
        anchors.push(...label.anchor); offsets.push(cursor + advance / 2, -14); uvs.push(...glyphUvRect(character)); colors.push(...(label.color ?? [1, 1, 1]))
        cursor += advance
      })
    }
    const g = this.textMesh.geometry as THREE.InstancedBufferGeometry
    g.setAttribute('iAnchor', new THREE.InstancedBufferAttribute(new Float32Array(anchors), 3))
    g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 2))
    g.setAttribute('iUv', new THREE.InstancedBufferAttribute(new Float32Array(uvs), 4))
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(colors), 3)); g.instanceCount = anchors.length / 3
    // Three.js caches the maximum instance capacity after the first draw. The
    // viewer starts with an empty batch, so growing 0 -> N must invalidate it.
    delete (g as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount
  }

  private uploadSymbols(symbols: readonly SymbolCandidate[]) {
    const anchors: number[] = [], directions: number[] = [], kinds: number[] = [], states: number[] = [], colors: number[] = []
    for (const symbol of symbols) { anchors.push(...symbol.anchor); directions.push(...(symbol.direction ?? [0, 1, 0])); kinds.push(symbol.kind); states.push(symbol.state ?? 0); colors.push(...symbol.color) }
    const g = this.symbolMesh.geometry as THREE.InstancedBufferGeometry
    g.setAttribute('iAnchor', new THREE.InstancedBufferAttribute(new Float32Array(anchors), 3))
    g.setAttribute('iDirection', new THREE.InstancedBufferAttribute(new Float32Array(directions), 3))
    g.setAttribute('iKind', new THREE.InstancedBufferAttribute(new Float32Array(kinds), 1))
    g.setAttribute('iState', new THREE.InstancedBufferAttribute(new Float32Array(states), 1))
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(colors), 3)); g.instanceCount = symbols.length
    delete (g as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount
  }

  dispose() {
    this.group.removeFromParent(); this.textMesh.geometry.dispose(); this.symbolMesh.geometry.dispose()
    ;(this.textMesh.material as THREE.Material).dispose(); (this.symbolMesh.material as THREE.Material).dispose(); this.atlas.dispose()
  }

  getStats() {
    return {
      labelBudget: this.labelBudget,
      glyphInstances: (this.textMesh.geometry as THREE.InstancedBufferGeometry).instanceCount,
      symbolInstances: (this.symbolMesh.geometry as THREE.InstancedBufferGeometry).instanceCount,
      drawObjects: 2,
    }
  }
}
