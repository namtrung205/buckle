import type * as THREE from 'three'

export const RENDER_MODES = ['centerline-only', 'thin-shell', 'solid-extrude'] as const
export type RenderMode = (typeof RENDER_MODES)[number]

export const QUALITY_PROFILES = ['low', 'balanced', 'high', 'custom'] as const
export type QualityProfile = (typeof QUALITY_PROFILES)[number]

export type RenderBackend = 'webgl2' | 'webgpu'
export type EntityId = number
export type RenderIndex = number

export type StructuralFrameState = {
  camera: THREE.Camera
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
  timestampMs: number
}

export type StructuralModelDelta = {
  created?: readonly EntityId[]
  updated?: readonly EntityId[]
  deleted?: readonly EntityId[]
}

export type StructuralPickResult = {
  entityId: EntityId
  renderIndex: RenderIndex
  depth?: number
}

/**
 * Backend-independent boundary for the data-driven structural renderer.
 * Domain entities must never depend on Three.js Object3D or transient instance IDs.
 */
export interface StructuralRenderer<TScene = unknown, TResultKey = string> {
  readonly backend: RenderBackend
  readonly mode: RenderMode
  readonly qualityProfile: QualityProfile

  initialize(): Promise<void> | void
  uploadModel(scene: TScene): Promise<void> | void
  applyModelDelta(delta: StructuralModelDelta): Promise<void> | void
  bindResult(resultKey: TResultKey | null): Promise<void> | void
  setRenderMode(mode: RenderMode): Promise<void> | void
  setQualityProfile(profile: QualityProfile): Promise<void> | void
  setVisibility(entityIds: readonly EntityId[], visible: boolean): void
  pick(x: number, y: number): Promise<StructuralPickResult | null>
  render(frame: StructuralFrameState): void
  dispose(): void
}

export const isRenderMode = (value: unknown): value is RenderMode =>
  typeof value === 'string' && (RENDER_MODES as readonly string[]).includes(value)

export const isQualityProfile = (value: unknown): value is QualityProfile =>
  typeof value === 'string' && (QUALITY_PROFILES as readonly string[]).includes(value)

