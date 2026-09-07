import * as THREE from 'three'
import { lerpStops } from '../PostProcessing/Colormap.ts'
import type { StructuralSceneDB } from './StructuralSceneDB.ts'

export const DEFAULT_RESULT_STATION_COUNT = 20
const DEFAULT_TEXTURE_WIDTH = 2048

export type ResultValues = Record<string, number>
export type ResultStationInput = { position: number; values: ResultValues }
export type ResultMemberInput = { entityId: number; stations: readonly ResultStationInput[] }
export type ResultCaseInput = { key: string; label?: string; members: readonly ResultMemberInput[] }

export type ResultBinding = {
  caseKey: string
  component: string
  texture: THREE.DataTexture
  colorLut: THREE.DataTexture
  textureWidth: number
  textureHeight: number
  stationCount: number
  min: number
  max: number
  version: number
}

type ResultField = { values: Float32Array; min: number; max: number }
type StoredCase = {
  key: string
  label: string
  memberCount: number
  stationCount: number
  memberIds: Uint32Array
  fields: Map<string, ResultField>
}
type ResidentTexture = { texture: THREE.DataTexture; touched: number }

const COMPONENT_ALIASES: Record<string, string> = {
  Vy: 'V2', VY: 'V2', Vz: 'V3', VZ: 'V3', My: 'M2', MY: 'M2', Mz: 'M3', MZ: 'M3',
}

export const canonicalResultComponent = (component: string) => COMPONENT_ALIASES[component] ?? component

export const sampleStations = (
  stations: readonly ResultStationInput[],
  component: string,
  position: number,
) => {
  if (stations.length === 0) return Number.NaN
  const canonical = canonicalResultComponent(component)
  const valueAt = (station: ResultStationInput) => {
    const direct = station.values[canonical]
    if (Number.isFinite(direct)) return direct
    for (const [key, value] of Object.entries(station.values)) {
      if (canonicalResultComponent(key) === canonical && Number.isFinite(value)) return value
    }
    return Number.NaN
  }
  if (position <= stations[0].position) return valueAt(stations[0])
  const last = stations[stations.length - 1]
  if (position >= last.position) return valueAt(last)
  let upper = 1
  while (upper < stations.length && stations[upper].position < position) upper++
  const a = stations[upper - 1]
  const b = stations[upper]
  const av = valueAt(a)
  const bv = valueAt(b)
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return Number.NaN
  const span = b.position - a.position
  return span > 1e-12 ? av + (bv - av) * ((position - a.position) / span) : av
}

const normalizeStations = (stations: readonly ResultStationInput[]) => stations
  .filter(station => Number.isFinite(station.position))
  .map(station => ({ ...station, position: Math.max(0, Math.min(1, station.position)) }))
  .sort((a, b) => a.position - b.position)

const textureShape = (valueCount: number) => {
  const width = Math.max(1, Math.min(DEFAULT_TEXTURE_WIDTH, valueCount))
  return { width, height: Math.max(1, Math.ceil(valueCount / width)) }
}

const createColorLut = (size = 256) => {
  const bytes = new Uint8Array(size * 4)
  for (let index = 0; index < size; index++) {
    const color = lerpStops(index / (size - 1))
    bytes[index * 4] = Math.round(color.r * 255)
    bytes[index * 4 + 1] = Math.round(color.g * 255)
    bytes[index * 4 + 2] = Math.round(color.b * 255)
    bytes[index * 4 + 3] = 255
  }
  const texture = new THREE.DataTexture(bytes, size, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/**
 * CPU result database plus a small lazy GPU-residency cache. Model geometry is
 * never owned or modified here: changing a case/component only changes texture
 * and scalar uniforms on the structural render passes.
 */
export default class ResultStore {
  readonly cases = new Map<string, StoredCase>()
  private readonly resident = new Map<string, ResidentTexture>()
  private colorLut = createColorLut()
  private clock = 0
  private version = 0
  private readonly stationCount: number
  private readonly maxResidentTextures: number

  constructor(stationCount = DEFAULT_RESULT_STATION_COUNT, maxResidentTextures = 8) {
    this.stationCount = stationCount
    this.maxResidentTextures = maxResidentTextures
  }

  ingest(input: ResultCaseInput, database: StructuralSceneDB) {
    const components = new Set<string>()
    for (const member of input.members) for (const station of member.stations) {
      for (const key of Object.keys(station.values)) components.add(canonicalResultComponent(key))
    }
    const fields = new Map<string, ResultField>()
    for (const component of components) {
      const values = new Float32Array(database.memberCount * this.stationCount)
      values.fill(Number.NaN)
      fields.set(component, { values, min: Infinity, max: -Infinity })
    }
    for (const member of input.members) {
      const memberIndex = database.memberIndexById.get(member.entityId)
      if (memberIndex === undefined) continue
      const stations = normalizeStations(member.stations)
      if (stations.length === 0) continue
      for (const [component, field] of fields) {
        const componentStations = stations.filter(station => Object.entries(station.values).some(
          ([key, value]) => canonicalResultComponent(key) === component && Number.isFinite(value),
        ))
        if (componentStations.length === 0) continue
        const offset = memberIndex * this.stationCount
        for (let sampleIndex = 0; sampleIndex < this.stationCount; sampleIndex++) {
          const u = this.stationCount === 1 ? 0 : sampleIndex / (this.stationCount - 1)
          const value = sampleStations(componentStations, component, u)
          field.values[offset + sampleIndex] = value
          if (Number.isFinite(value)) {
            field.min = Math.min(field.min, value)
            field.max = Math.max(field.max, value)
          }
        }
      }
    }
    for (const field of fields.values()) {
      if (!Number.isFinite(field.min)) field.min = 0
      if (!Number.isFinite(field.max)) field.max = 0
    }
    this.dropCaseTextures(input.key)
    this.cases.set(input.key, {
      key: input.key,
      label: input.label ?? input.key,
      memberCount: database.memberCount,
      stationCount: this.stationCount,
      memberIds: database.memberIds.slice(0, database.memberCount),
      fields,
    })
    this.version++
    return this.cases.get(input.key)!
  }

  ingestAnalysisOutput(output: any, database: StructuralSceneDB, key = 'analysis') {
    const members: ResultMemberInput[] = (output?.members ?? []).map((member: any) => {
      const raw = member.stations?.length ? member.stations : member.node_efforts ?? []
      const first = raw[0]?.coord as number[] | undefined
      const last = raw[raw.length - 1]?.coord as number[] | undefined
      const dx = first && last ? last[0] - first[0] : 0
      const dy = first && last ? last[1] - first[1] : 0
      const dz = first && last ? last[2] - first[2] : 0
      const lengthSq = dx * dx + dy * dy + dz * dz
      const positionOf = (station: any, index: number, source: any[]) => {
        let position = Number(station.position ?? station.xi)
        if (!Number.isFinite(position) && lengthSq > 1e-16 && station.coord) {
          const cx = station.coord[0] - first![0]
          const cy = station.coord[1] - first![1]
          const cz = station.coord[2] - first![2]
          position = (cx * dx + cy * dy + cz * dz) / lengthSq
        }
        if (!Number.isFinite(position)) position = source.length > 1 ? index / (source.length - 1) : 0
        return position
      }
      const stations: ResultStationInput[] = raw.map((station: any, index: number) => {
        const values: ResultValues = station.values ? { ...station.values } : {}
        for (const [component, effort] of Object.entries(station.efforts ?? {})) {
          values[component] = Number((effort as any)?.value)
        }
        return { position: positionOf(station, index, raw), values }
      })
      const displacements = member.displacement_stations ?? []
      displacements.forEach((station: any, index: number) => stations.push({
        position: positionOf(station, index, displacements),
        values: {
          dX: Number(station.disp?.ux),
          dY: Number(station.disp?.uz),
          dZ: Number(station.disp?.uy),
        },
      }))
      return { entityId: Number(member.id), stations }
    })
    return this.ingest({ key, label: key, members }, database)
  }

  getBinding(caseKey: string, component: string): ResultBinding | null {
    const resultCase = this.cases.get(caseKey)
    const canonical = canonicalResultComponent(component)
    const field = resultCase?.fields.get(canonical)
    if (!resultCase || !field) return null
    const cacheKey = `${caseKey}\u0000${canonical}`
    let cached = this.resident.get(cacheKey)
    if (!cached) {
      const { width, height } = textureShape(field.values.length)
      const packed = new Float32Array(width * height)
      packed.fill(Number.NaN)
      packed.set(field.values)
      const texture = new THREE.DataTexture(packed, width, height, THREE.RedFormat, THREE.FloatType)
      texture.minFilter = texture.magFilter = THREE.NearestFilter
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
      texture.generateMipmaps = false
      texture.needsUpdate = true
      cached = { texture, touched: ++this.clock }
      this.resident.set(cacheKey, cached)
      this.evictIfNeeded(cacheKey)
    } else cached.touched = ++this.clock
    const image = cached.texture.image
    return {
      caseKey, component: canonical, texture: cached.texture, colorLut: this.colorLut,
      textureWidth: image.width, textureHeight: image.height,
      stationCount: resultCase.stationCount, min: field.min, max: field.max, version: this.version,
    }
  }

  /** Read one interpolated GPU-field value for selection/tooltip text without
   * rebuilding geometry or downloading a texture. */
  sample(caseKey: string, component: string, entityId: number, position = .5) {
    const resultCase = this.cases.get(caseKey)
    const field = resultCase?.fields.get(canonicalResultComponent(component))
    if (!resultCase || !field) return Number.NaN
    const memberIndex = resultCase.memberIds.indexOf(entityId)
    if (memberIndex < 0) return Number.NaN
    const scaled = Math.max(0, Math.min(1, position)) * (resultCase.stationCount - 1)
    const lower = Math.floor(scaled)
    const upper = Math.min(resultCase.stationCount - 1, lower + 1)
    const a = field.values[memberIndex * resultCase.stationCount + lower]
    const b = field.values[memberIndex * resultCase.stationCount + upper]
    return Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * (scaled - lower) : Number.NaN
  }

  /** Patch one contiguous member row without reparsing/rebuilding the model. */
  updateMember(
    caseKey: string,
    component: string,
    entityId: number,
    stationsInput: readonly ResultStationInput[],
    database: StructuralSceneDB,
  ) {
    const canonical = canonicalResultComponent(component)
    const resultCase = this.cases.get(caseKey)
    const field = resultCase?.fields.get(canonical)
    const memberIndex = database.memberIndexById.get(entityId)
    if (!resultCase || !field || memberIndex === undefined) return false
    const stations = normalizeStations(stationsInput).filter(station => Object.entries(station.values).some(
      ([key, value]) => canonicalResultComponent(key) === canonical && Number.isFinite(value),
    ))
    const offset = memberIndex * resultCase.stationCount
    for (let sampleIndex = 0; sampleIndex < resultCase.stationCount; sampleIndex++) {
      const u = resultCase.stationCount === 1 ? 0 : sampleIndex / (resultCase.stationCount - 1)
      field.values[offset + sampleIndex] = sampleStations(stations, canonical, u)
    }
    field.min = Infinity
    field.max = -Infinity
    for (const value of field.values) if (Number.isFinite(value)) {
      field.min = Math.min(field.min, value)
      field.max = Math.max(field.max, value)
    }
    if (!Number.isFinite(field.min)) field.min = field.max = 0
    const cached = this.resident.get(`${caseKey}\u0000${canonical}`)
    if (cached) {
      const packed = cached.texture.image.data as Float32Array
      packed.set(field.values.subarray(offset, offset + resultCase.stationCount), offset)
      // Three.js DataTexture has no public texSubImage2D range API. The CPU
      // patch is row-local; needsUpdate is the portable WebGL2 upload fallback.
      cached.texture.needsUpdate = true
      cached.touched = ++this.clock
    }
    this.version++
    return true
  }

  /** Update the 1D LUT in-place so already-bound materials see the new palette. */
  setPalette(colors: readonly THREE.ColorRepresentation[]) {
    if (colors.length < 2) throw new Error('A result palette needs at least two colors')
    const bytes = this.colorLut.image.data as Uint8Array
    const parsed = colors.map(color => new THREE.Color(color))
    const size = bytes.length / 4
    for (let index = 0; index < size; index++) {
      const scaled = (index / (size - 1)) * (parsed.length - 1)
      const lower = Math.min(parsed.length - 2, Math.floor(scaled))
      const color = parsed[lower].clone().lerp(parsed[lower + 1], scaled - lower)
      bytes[index * 4] = Math.round(color.r * 255)
      bytes[index * 4 + 1] = Math.round(color.g * 255)
      bytes[index * 4 + 2] = Math.round(color.b * 255)
      bytes[index * 4 + 3] = 255
    }
    this.colorLut.needsUpdate = true
    this.version++
  }

  get components() {
    const components = new Set<string>()
    for (const resultCase of this.cases.values()) for (const key of resultCase.fields.keys()) components.add(key)
    return [...components]
  }

  getExtrema(caseKey: string, component: string, memberIds?: readonly number[]) {
    const resultCase = this.cases.get(caseKey)
    const field = resultCase?.fields.get(canonicalResultComponent(component))
    if (!resultCase || !field) return null
    const filter = memberIds?.length ? new Set(memberIds) : null
    let min = Infinity
    let max = -Infinity
    let minMemberId: number | null = null
    let maxMemberId: number | null = null
    let minU = 0
    let maxU = 0
    for (let memberIndex = 0; memberIndex < resultCase.memberCount; memberIndex++) {
      const entityId = resultCase.memberIds[memberIndex]
      if (filter && !filter.has(entityId)) continue
      const offset = memberIndex * resultCase.stationCount
      for (let stationIndex = 0; stationIndex < resultCase.stationCount; stationIndex++) {
        const value = field.values[offset + stationIndex]
        if (!Number.isFinite(value)) continue
        const u = resultCase.stationCount > 1 ? stationIndex / (resultCase.stationCount - 1) : 0
        if (value < min) { min = value; minMemberId = entityId; minU = u }
        if (value > max) { max = value; maxMemberId = entityId; maxU = u }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null
    return { min, max, minMemberId, maxMemberId, minU, maxU }
  }

  clear() {
    for (const item of this.resident.values()) item.texture.dispose()
    this.resident.clear()
    this.cases.clear()
    this.version++
  }

  dispose() {
    this.clear()
    this.colorLut.dispose()
  }

  private dropCaseTextures(caseKey: string) {
    for (const [key, item] of this.resident) if (key.startsWith(`${caseKey}\u0000`)) {
      item.texture.dispose()
      this.resident.delete(key)
    }
  }

  private evictIfNeeded(protectedKey: string) {
    while (this.resident.size > this.maxResidentTextures) {
      let oldestKey: string | null = null
      let oldest = Infinity
      for (const [key, item] of this.resident) {
        if (key !== protectedKey && item.touched < oldest) { oldest = item.touched; oldestKey = key }
      }
      if (!oldestKey) break
      this.resident.get(oldestKey)!.texture.dispose()
      this.resident.delete(oldestKey)
    }
  }
}
