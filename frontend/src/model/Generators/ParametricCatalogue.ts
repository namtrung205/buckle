import type { ParametricGeneratorBinding } from '../../core/ai/index.ts'
import type { StructuralDocument } from '../../core/structural/index.ts'
import { generateFrameArrayGraph, generateGridGraph, generatePortalFrameGraph } from './BasicParametricGenerators.ts'
import { generateTowerParametricGraph } from './TowerParametricGenerator.ts'
import { generateTrussGraph } from './TrussGenerator.ts'
import { generateWarehouseGraph } from './WarehouseGenerator.ts'

type Raw = Readonly<Record<string, unknown>>

export const PARAMETRIC_TEMPLATE_CATALOGUE = Object.freeze({
  Grid: { id: 'orthogonal-grid', version: 1, defaults: { name: 'Grid', xSpacings: [6], ySpacings: [6] } },
  PortalFrame: { id: 'steel-portal-frame', version: 1, defaults: { width: 20, height: 6, pitch: 15, origin: [0, 0, 0] } },
  FrameArray: { id: 'steel-frame-array', version: 1, defaults: { width: 20, length: 60, height: 6, pitch: 15, baySpacing: 6, origin: [0, 0, 0] } },
  Truss: { id: 'pitched-roof-truss', version: 1, defaults: { span: 20, height: 3, panelCount: 8, origin: [0, 0, 0] } },
  Warehouse: { id: 'steel-warehouse', version: 1, defaults: {
    width: 20, length: 60, height: 6, pitch: 15, baySpacing: 6, numPurlins: 3,
    hasBracing: true, addSelfWeight: true, addWindLoad: false, windMagnitude: 1.2,
    addSnowLoad: false, snowMagnitude: 0.8, addMembrane: false, membraneThickness: 0.002,
    windOnRoof: true, windOnSideWalls: true, windOnEndWalls: true, snowOnRoof: true,
  } },
  Tower: { id: 'lattice-transmission-tower', version: 1, defaults: {
    circuit: 'double', bodyHeight: 36, peakHeight: 4, baseWidth: 8, topWidth: 3,
    panelCount: 9, straightPanels: 3, taper: 'linear', armCount: 3, armLength: 4,
    armDrop: 0.5, armSpacing: 4, autoSupports: true, supportKind: 'pinned',
    autoLoads: false, windVector: { x: 1, y: 0, z: 0 }, windForce: 1, gravity: 9.81,
  } },
} as const)

export const PARAMETRIC_ENGINEERING_VOCABULARY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  width: ['width', 'nhịp', 'bề rộng', 'chiều rộng'],
  length: ['length', 'chiều dài', 'dài nhà'],
  height: ['height', 'chiều cao', 'cao mép mái'],
  pitch: ['pitch', 'độ dốc mái', 'góc mái'],
  baySpacing: ['bay spacing', 'bước khung', 'khoảng cách khung'],
  numBays: ['bay count', 'số bước', 'số gian'],
  numPurlins: ['purlin count', 'số khoảng xà gồ'],
  span: ['span', 'nhịp giàn'],
  panelCount: ['panel count', 'số khoang', 'số panel'],
  bodyHeight: ['body height', 'chiều cao thân tháp'],
  sectionId: ['section', 'tiết diện'],
  xSpacings: ['X spacings', 'bước lưới X'],
  ySpacings: ['Y spacings', 'bước lưới Y'],
})

type CatalogueKind = keyof typeof PARAMETRIC_TEMPLATE_CATALOGUE
const bindingMetadata = (kind: CatalogueKind) => ({
  templateId: PARAMETRIC_TEMPLATE_CATALOGUE[kind].id,
  templateVersion: PARAMETRIC_TEMPLATE_CATALOGUE[kind].version,
  parameterDefaults: PARAMETRIC_TEMPLATE_CATALOGUE[kind].defaults as unknown as Readonly<Record<string, unknown>>,
  vocabulary: PARAMETRIC_ENGINEERING_VOCABULARY,
})

const unitAliases: Readonly<Record<string, number>> = {
  '': 1, m: 1, metre: 1, metres: 1, meter: 1, meters: 1, met: 1, 'mét': 1,
  mm: 0.001, millimetre: 0.001, millimeter: 0.001,
  cm: 0.01, centimetre: 0.01, centimeter: 0.01,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
}

export const parseEngineeringLength = (value: unknown, name: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') throw new Error(`${name} must be a finite length in m, mm, cm, ft or in`)
  const match = value.trim().toLocaleLowerCase().match(/^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*([\p{L}]+|")?$/u)
  if (!match) throw new Error(`${name} must be an explicit engineering length`)
  const unit = match[2] === '"' ? 'in' : (match[2] ?? '')
  const factor = unitAliases[unit]
  if (factor === undefined) throw new Error(`${name} uses unsupported unit ${unit}`)
  return Number(match[1].replace(',', '.')) * factor
}

export const parseEngineeringAngle = (value: unknown, name: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') throw new Error(`${name} must be an angle in degrees`)
  const match = value.trim().toLocaleLowerCase().match(/^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*(°|deg|degree|degrees|độ|do|rad)?$/u)
  if (!match) throw new Error(`${name} must be an explicit angle`)
  const numeric = Number(match[1].replace(',', '.'))
  return match[2] === 'rad' ? numeric * 180 / Math.PI : numeric
}

const finiteNumber = (value: unknown, name: string) => {
  const numeric = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) throw new Error(`${name} must be a finite number`)
  return numeric
}
const integer = (value: unknown, name: string, minimum = 1) => {
  const numeric = finiteNumber(value, name)
  if (!Number.isSafeInteger(numeric) || numeric < minimum) throw new Error(`${name} must be an integer >= ${minimum}`)
  return numeric
}
const bool = (value: unknown, name: string) => {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}
const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}
const vector = (value: unknown, name: string): readonly [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${name} must contain three coordinates`)
  return value.map((item, index) => parseEngineeringLength(item, `${name}[${index}]`)) as [number, number, number]
}
const lengths = (value: unknown, name: string) => {
  if (!Array.isArray(value) || !value.length) throw new Error(`${name} must contain at least one spacing`)
  return value.map((item, index) => parseEngineeringLength(item, `${name}[${index}]`))
}

const withDefaults = <T extends Record<string, unknown>>(raw: Raw, defaults: T) => {
  const defaultsApplied = Object.keys(defaults).filter(key => raw[key] === undefined)
  return { value: { ...defaults, ...raw }, defaultsApplied }
}

const sectionContext = (document: StructuralDocument, raw: Record<string, unknown>, keys: readonly string[]) => {
  const fallback = [...document.sections.keys()].sort((a, b) => a - b)[0]
  if (fallback === undefined) throw new Error('A section is required; create a section or provide a valid sectionId')
  const result = { ...raw }
  const defaultsApplied: string[] = []
  for (const key of keys) {
    const candidate = result[key] ?? result.sectionId ?? fallback
    const id = integer(candidate, key)
    if (!document.sections.has(id)) throw new Error(`Unknown sections id ${id}`)
    if (result[key] === undefined) defaultsApplied.push(key)
    result[key] = id
  }
  return { value: result, defaultsApplied }
}

const bayCount = (length: number, value: Record<string, unknown>, warnings: string[]) => {
  if (value.numBays !== undefined) return integer(value.numBays, 'numBays')
  const spacing = parseEngineeringLength(value.baySpacing, 'baySpacing')
  if (spacing <= 0) throw new Error('baySpacing must be greater than zero')
  const exact = length / spacing
  const count = Math.max(1, Math.round(exact))
  if (Math.abs(exact - count) > 1e-9) warnings.push(`baySpacing adjusted from ${spacing} m to ${(length / count).toFixed(6)} m so the frame count is integral`)
  return count
}

const sectionArea = (document: StructuralDocument, sectionId: number) => {
  const section = document.sections.get(sectionId)!
  const area = Number(section.properties?.A)
  return Number.isFinite(area) && area > 0 ? area : 0.01
}
const density = (document: StructuralDocument, sectionId: number) => {
  const section = document.sections.get(sectionId)!
  const rho = Number(document.materials.get(section.materialId)?.rho)
  return Number.isFinite(rho) && rho > 0 ? rho : 7850
}

export const createParametricGeneratorCatalogue = (document: StructuralDocument): Readonly<Record<string, ParametricGeneratorBinding>> => ({
  Grid: {
    version: 1, generatorVersion: 'grid@1', ...bindingMetadata('Grid'),
    generator: generateGridGraph as never,
    normalizeParameters: raw => {
      const { value, defaultsApplied } = withDefaults(raw, PARAMETRIC_TEMPLATE_CATALOGUE.Grid.defaults as unknown as Record<string, unknown>)
      return { parameters: { name: text(value.name, 'name'), xSpacings: lengths(value.xSpacings, 'xSpacings'), ySpacings: lengths(value.ySpacings, 'ySpacings') }, defaultsApplied }
    },
  },
  PortalFrame: {
    version: 1, generatorVersion: 'portal-frame@1', ...bindingMetadata('PortalFrame'),
    generator: generatePortalFrameGraph as never,
    normalizeParameters: raw => {
      const base = withDefaults(raw, PARAMETRIC_TEMPLATE_CATALOGUE.PortalFrame.defaults as unknown as Record<string, unknown>)
      const resolved = sectionContext(document, base.value, ['sectionId'])
      return { parameters: { ...resolved.value, width: parseEngineeringLength(resolved.value.width, 'width'), height: parseEngineeringLength(resolved.value.height, 'height'), pitch: parseEngineeringAngle(resolved.value.pitch, 'pitch'), origin: vector(resolved.value.origin, 'origin') }, defaultsApplied: [...base.defaultsApplied, ...resolved.defaultsApplied] }
    },
  },
  FrameArray: {
    version: 1, generatorVersion: 'frame-array@1', ...bindingMetadata('FrameArray'),
    generator: generateFrameArrayGraph as never,
    normalizeParameters: raw => {
      const base = withDefaults(raw, PARAMETRIC_TEMPLATE_CATALOGUE.FrameArray.defaults as unknown as Record<string, unknown>)
      const resolved = sectionContext(document, base.value, ['sectionId'])
      const warnings: string[] = []
      const length = parseEngineeringLength(resolved.value.length, 'length')
      return { parameters: { ...resolved.value, width: parseEngineeringLength(resolved.value.width, 'width'), length, height: parseEngineeringLength(resolved.value.height, 'height'), pitch: parseEngineeringAngle(resolved.value.pitch, 'pitch'), baySpacing: parseEngineeringLength(resolved.value.baySpacing, 'baySpacing'), numBays: bayCount(length, resolved.value, warnings), origin: vector(resolved.value.origin, 'origin') }, defaultsApplied: [...base.defaultsApplied, ...resolved.defaultsApplied, ...(raw.numBays === undefined ? ['numBays'] : [])], warnings }
    },
  },
  Truss: {
    version: 1, generatorVersion: 'truss@1', ...bindingMetadata('Truss'),
    generator: generateTrussGraph as never,
    normalizeParameters: raw => {
      const base = withDefaults(raw, PARAMETRIC_TEMPLATE_CATALOGUE.Truss.defaults as unknown as Record<string, unknown>)
      const resolved = sectionContext(document, base.value, ['sectionId'])
      return { parameters: { ...resolved.value, span: parseEngineeringLength(resolved.value.span, 'span'), height: parseEngineeringLength(resolved.value.height, 'height'), panelCount: integer(resolved.value.panelCount, 'panelCount', 2), origin: vector(resolved.value.origin, 'origin') }, defaultsApplied: [...base.defaultsApplied, ...resolved.defaultsApplied] }
    },
  },
  Warehouse: {
    version: 1, generatorVersion: 'warehouse@1', ...bindingMetadata('Warehouse'),
    generator: generateWarehouseGraph as never,
    normalizeParameters: raw => {
      const base = withDefaults(raw, PARAMETRIC_TEMPLATE_CATALOGUE.Warehouse.defaults as unknown as Record<string, unknown>)
      const resolved = sectionContext(document, base.value, ['sectionId', 'columnSectionId', 'rafterSectionId', 'secondarySectionId', 'bracingSectionId'])
      const sectionId = resolved.value.sectionId as number
      const section = document.sections.get(sectionId)!
      const warnings: string[] = []
      const length = parseEngineeringLength(resolved.value.length, 'length')
      const parameters = {
        ...resolved.value, width: parseEngineeringLength(resolved.value.width, 'width'), length,
        height: parseEngineeringLength(resolved.value.height, 'height'), pitch: parseEngineeringAngle(resolved.value.pitch, 'pitch'),
        baySpacing: parseEngineeringLength(resolved.value.baySpacing, 'baySpacing'), numBays: bayCount(length, resolved.value, warnings),
        numPurlins: integer(resolved.value.numPurlins, 'numPurlins'), sectionId,
        columnSectionId: resolved.value.columnSectionId, rafterSectionId: resolved.value.rafterSectionId,
        secondarySectionId: resolved.value.secondarySectionId, bracingSectionId: resolved.value.bracingSectionId,
        materialId: section.materialId, sectionArea: sectionArea(document, sectionId),
        hasBracing: bool(resolved.value.hasBracing, 'hasBracing'), addSelfWeight: bool(resolved.value.addSelfWeight, 'addSelfWeight'),
        addWindLoad: bool(resolved.value.addWindLoad, 'addWindLoad'), windMagnitude: finiteNumber(resolved.value.windMagnitude, 'windMagnitude'),
        addSnowLoad: bool(resolved.value.addSnowLoad, 'addSnowLoad'), snowMagnitude: finiteNumber(resolved.value.snowMagnitude, 'snowMagnitude'),
        addMembrane: bool(resolved.value.addMembrane, 'addMembrane'), membraneThickness: parseEngineeringLength(resolved.value.membraneThickness, 'membraneThickness'),
        windOnRoof: bool(resolved.value.windOnRoof, 'windOnRoof'), windOnSideWalls: bool(resolved.value.windOnSideWalls, 'windOnSideWalls'),
        windOnEndWalls: bool(resolved.value.windOnEndWalls, 'windOnEndWalls'), snowOnRoof: bool(resolved.value.snowOnRoof, 'snowOnRoof'),
      }
      return { parameters, defaultsApplied: [...base.defaultsApplied, ...resolved.defaultsApplied, ...(raw.numBays === undefined ? ['numBays'] : []), 'materialId', 'sectionArea'], warnings }
    },
  },
  Tower: {
    version: 1, generatorVersion: 'tower@1', ...bindingMetadata('Tower'),
    generator: generateTowerParametricGraph as never,
    normalizeParameters: raw => {
      const base = withDefaults(raw, PARAMETRIC_TEMPLATE_CATALOGUE.Tower.defaults as unknown as Record<string, unknown>)
      const resolved = sectionContext(document, base.value, ['legSectionId', 'braceSectionId'])
      const legSectionId = resolved.value.legSectionId as number; const braceSectionId = resolved.value.braceSectionId as number
      const circuit = text(resolved.value.circuit, 'circuit'); if (circuit !== 'single' && circuit !== 'double') throw new Error('circuit must be single or double')
      const taper = text(resolved.value.taper, 'taper'); if (taper !== 'linear' && taper !== 'step') throw new Error('taper must be linear or step')
      const supportKind = text(resolved.value.supportKind, 'supportKind'); if (supportKind !== 'pinned' && supportKind !== 'fixed') throw new Error('supportKind must be pinned or fixed')
      return { parameters: {
        ...resolved.value, circuit, taper, supportKind,
        bodyHeight: parseEngineeringLength(resolved.value.bodyHeight, 'bodyHeight'), peakHeight: parseEngineeringLength(resolved.value.peakHeight, 'peakHeight'),
        baseWidth: parseEngineeringLength(resolved.value.baseWidth, 'baseWidth'), topWidth: parseEngineeringLength(resolved.value.topWidth, 'topWidth'),
        panelCount: integer(resolved.value.panelCount, 'panelCount'), straightPanels: integer(resolved.value.straightPanels, 'straightPanels', 0),
        armCount: integer(resolved.value.armCount, 'armCount', 0), armLength: parseEngineeringLength(resolved.value.armLength, 'armLength'),
        armDrop: parseEngineeringLength(resolved.value.armDrop, 'armDrop'), armSpacing: parseEngineeringLength(resolved.value.armSpacing, 'armSpacing'),
        autoSupports: bool(resolved.value.autoSupports, 'autoSupports'), autoLoads: bool(resolved.value.autoLoads, 'autoLoads'),
        windForce: finiteNumber(resolved.value.windForce, 'windForce'), gravity: finiteNumber(resolved.value.gravity, 'gravity'),
        legSectionId, braceSectionId, legArea: sectionArea(document, legSectionId), braceArea: sectionArea(document, braceSectionId),
        legDensity: density(document, legSectionId), braceDensity: density(document, braceSectionId),
      }, defaultsApplied: [...base.defaultsApplied, ...resolved.defaultsApplied, 'legArea', 'braceArea', 'legDensity', 'braceDensity'] }
    },
  },
})
