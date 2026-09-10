import { makeAutoObservable } from 'mobx'
import * as THREE from 'three'
import type Model from '../Model'
import type { QualityProfile, RenderBackend, RenderMode } from '../Rendering/contracts'

export type BenchmarkFixtureInfo = {
  kind: 'structural-grid'
  version: number
  seed: number
  requestedBeamCount: number
  loadMs: number
}

export type ViewerPerformanceSnapshot = {
  fps: number
  frameMsAvg: number
  frameMsP95: number
  frameMsP99: number
  cpuUpdateMsAvg: number
  renderSubmitMsAvg: number
  labelRenderMsAvg: number
  raycastMsLast: number
  raycastMsP95: number
  drawCalls: number
  triangles: number
  lines: number
  points: number
  geometries: number
  textures: number
  programs: number
  sceneObjects: number
  meshes: number
  linesObjects: number
  instancedMeshes: number
  instances: number
  batchedMeshes: number
  batchedInstances: number
  pickables: number
  labels: number
}

export type ViewerBenchmarkPhase = ViewerPerformanceSnapshot & {
  durationMs: number
  frameSamples: number
  raycastSamples: number
}

export type ViewerBenchmarkReport = {
  benchmarkVersion: 'viewer3d-v3'
  timestamp: string
  durationsMs: { warmup: number; idle: number; orbit: number; pointerSweep: number }
  environment: {
    userAgent: string
    logicalProcessors: number | null
    deviceMemoryGb: number | null
    viewport: { width: number; height: number; devicePixelRatio: number }
    backend: RenderBackend
    gpu: string
    webglVersion: string
  }
  settings: { renderMode: RenderMode; qualityProfile: QualityProfile }
  fixture: BenchmarkFixtureInfo | null
  sceneDatabase: {
    nodes: number
    profiles: number
    members: number
    byteLength: number
    buildMs: number
    version: number
  }
  model: { nodes: number; members: number; shells: number; loads: number; labels: number }
  phases: { idle: ViewerBenchmarkPhase; orbit: ViewerBenchmarkPhase; pointerSweep: ViewerBenchmarkPhase }
}

const EMPTY_SNAPSHOT: ViewerPerformanceSnapshot = {
  fps: 0,
  frameMsAvg: 0,
  frameMsP95: 0,
  frameMsP99: 0,
  cpuUpdateMsAvg: 0,
  renderSubmitMsAvg: 0,
  labelRenderMsAvg: 0,
  raycastMsLast: 0,
  raycastMsP95: 0,
  drawCalls: 0,
  triangles: 0,
  lines: 0,
  points: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
  sceneObjects: 0,
  meshes: 0,
  linesObjects: 0,
  instancedMeshes: 0,
  instances: 0,
  batchedMeshes: 0,
  batchedInstances: 0,
  pickables: 0,
  labels: 0,
}

const round = (value: number) => Number(value.toFixed(2))

export default class ViewerBenchmark {
  readonly model: Model
  snapshot: ViewerPerformanceSnapshot = { ...EMPTY_SNAPSHOT }
  running = false
  fixtureLoading = false
  phase = ''
  progress = 0
  report = ''
  resultReport = ''
  resultRunning = false
  fixture: BenchmarkFixtureInfo | null = null

  frameSamples: number[] = []
  updateSamples: number[] = []
  renderSamples: number[] = []
  labelSamples: number[] = []
  raycastSamples: number[] = []
  lastFrameTimestamp = 0
  lastPublishTimestamp = 0
  pickables = 0
  private mainRenderStats = { calls: 0, triangles: 0, lines: 0, points: 0 }

  constructor(model: Model) {
    this.model = model
    makeAutoObservable(this, {
      model: false,
      frameSamples: false,
      updateSamples: false,
      renderSamples: false,
      labelSamples: false,
      raycastSamples: false,
      lastFrameTimestamp: false,
      lastPublishTimestamp: false,
      pickables: false,
    })
  }

  setFixture(info: BenchmarkFixtureInfo | null) {
    this.fixture = info
  }

  /** Fixture load feedback: 0–100 with the current pipeline stage label. */
  fixtureProgress = 0
  fixtureStage = ''

  setFixtureProgress(value: number, stage?: string) {
    this.fixtureProgress = Math.max(0, Math.min(100, Math.round(value)))
    if (stage) this.fixtureStage = stage
  }

  recordFrame(timestampMs: number, updateMs: number, renderSubmitMs: number) {
    const render = this.model.renderer.info.render
    this.mainRenderStats = {
      calls: render.calls,
      triangles: render.triangles,
      lines: render.lines,
      points: render.points,
    }
    const enabled = this.running || this.model.showFps
    if (!enabled) {
      this.lastFrameTimestamp = timestampMs
      return
    }
    if (this.lastFrameTimestamp > 0) this.pushBounded(this.frameSamples, timestampMs - this.lastFrameTimestamp, 600)
    this.lastFrameTimestamp = timestampMs
    this.pushBounded(this.updateSamples, updateMs, 600)
    this.pushBounded(this.renderSamples, renderSubmitMs, 600)
    this.publish(timestampMs)
  }

  recordLabelRender(durationMs: number) {
    if (this.running || this.model.showFps) this.pushBounded(this.labelSamples, durationMs, 600)
  }

  recordRaycast(durationMs: number, pickables: number) {
    if (!(this.running || this.model.showFps)) return
    this.pickables = pickables
    this.pushBounded(this.raycastSamples, durationMs, 240)
  }

  private pushBounded(target: number[], value: number, limit: number) {
    target.push(value)
    if (target.length > limit) target.splice(0, target.length - limit)
  }

  private average(samples: number[]) {
    return samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0
  }

  private percentile(samples: number[], ratio: number) {
    if (!samples.length) return 0
    const sorted = [...samples].sort((a, b) => a - b)
    return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1))]
  }

  private collectSnapshot(): ViewerPerformanceSnapshot {
    let sceneObjects = 0
    let meshes = 0
    let linesObjects = 0
    let instancedMeshes = 0
    let instances = 0
    let batchedMeshes = 0
    let batchedInstances = 0

    this.model.scene.traverse(object => {
      sceneObjects++
      const candidate = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry & { isInstancedBufferGeometry?: boolean; instanceCount?: number }
        isMesh?: boolean
        isLine?: boolean
        isLineSegments?: boolean
        isInstancedMesh?: boolean
        isBatchedMesh?: boolean
        count?: number
        _instanceInfo?: Array<{ active?: boolean }>
      }
      if (candidate.isMesh) meshes++
      if (candidate.isLine || candidate.isLineSegments) linesObjects++
      if (candidate.isInstancedMesh) {
        instancedMeshes++
        instances += candidate.count ?? 0
      } else if (candidate.isMesh && candidate.geometry?.isInstancedBufferGeometry) {
        instancedMeshes++
        instances += candidate.geometry.instanceCount ?? 0
      }
      if (candidate.isBatchedMesh) {
        batchedMeshes++
        batchedInstances += candidate._instanceInfo?.filter(instance => instance.active !== false).length ?? 0
      }
    })

    const info = this.model.renderer.info
    const frames = this.frameSamples
    const averageFrameMs = this.average(frames)
    return {
      fps: averageFrameMs > 0 ? round(1000 / averageFrameMs) : this.model.fps,
      frameMsAvg: round(averageFrameMs),
      frameMsP95: round(this.percentile(frames, 0.95)),
      frameMsP99: round(this.percentile(frames, 0.99)),
      cpuUpdateMsAvg: round(this.average(this.updateSamples)),
      renderSubmitMsAvg: round(this.average(this.renderSamples)),
      labelRenderMsAvg: round(this.average(this.labelSamples)),
      raycastMsLast: round(this.raycastSamples[this.raycastSamples.length - 1] ?? 0),
      raycastMsP95: round(this.percentile(this.raycastSamples, 0.95)),
      drawCalls: this.mainRenderStats.calls,
      triangles: this.mainRenderStats.triangles,
      lines: this.mainRenderStats.lines,
      points: this.mainRenderStats.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      sceneObjects,
      meshes,
      linesObjects,
      instancedMeshes,
      instances,
      batchedMeshes,
      batchedInstances,
      pickables: this.pickables,
      labels: this.model.labeler?.count ?? 0,
    }
  }

  private publish(timestampMs: number) {
    if (timestampMs - this.lastPublishTimestamp < 500) return
    this.lastPublishTimestamp = timestampMs
    this.snapshot = this.collectSnapshot()
  }

  private resetSamples() {
    this.frameSamples.length = 0
    this.updateSamples.length = 0
    this.renderSamples.length = 0
    this.labelSamples.length = 0
    this.raycastSamples.length = 0
    this.lastFrameTimestamp = 0
    this.pickables = 0
  }

  private capturePhase(durationMs: number): ViewerBenchmarkPhase {
    return {
      ...this.collectSnapshot(),
      durationMs,
      frameSamples: this.frameSamples.length,
      raycastSamples: this.raycastSamples.length,
    }
  }

  private waitForPhase(durationMs: number, onFrame?: (elapsedMs: number) => void): Promise<void> {
    return new Promise(resolve => {
      const startedAt = performance.now()
      const tick = (now: number) => {
        const elapsed = now - startedAt
        onFrame?.(elapsed)
        if (elapsed >= durationMs) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  private setProgress(value: number) {
    this.progress = Math.max(0, Math.min(100, Math.round(value)))
  }

  private getEnvironment() {
    const gl = this.model.renderer.getContext()
    const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
    let gpu = String(gl.getParameter(gl.RENDERER))
    try {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      if (debugInfo) gpu = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
    } catch {
      // Privacy-hardened browsers may intentionally block unmasked renderer info.
    }
    const size = this.model.renderer.getSize(new THREE.Vector2())
    return {
      userAgent: navigator.userAgent,
      logicalProcessors: navigator.hardwareConcurrency || null,
      deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      viewport: { width: size.x, height: size.y, devicePixelRatio: window.devicePixelRatio || 1 },
      backend: 'webgl2' as const,
      gpu,
      webglVersion: isWebGL2 ? 'WebGL 2' : 'WebGL 1 compatibility context',
    }
  }

  async run(): Promise<string> {
    if (this.running) return this.report
    const durations = { warmup: 1500, idle: 3000, orbit: 3000, pointerSweep: 3000 }
    const camera = this.model.camera.cam
    const controls = this.model.camera.controls
    const original = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      up: camera.up.clone(),
      target: controls.target.clone(),
      controlsEnabled: controls.enabled,
      hoverEnabled: this.model.selector.enableHover,
      pointer: this.model.pointerCoords.clone(),
      structuralSelection: [...this.model.selector.selectedCenterlineIds],
    }

    this.running = true
    this.model.showFps = true
    this.report = ''
    controls.enabled = false
    this.model.selector.isBoxActive = false
    this.model.selector.isDragging = false

    try {
      this.phase = 'Warmup'
      this.setProgress(0)
      this.resetSamples()
      await this.waitForPhase(durations.warmup, elapsed => this.setProgress((elapsed / durations.warmup) * 14))

      this.phase = 'Idle'
      this.resetSamples()
      await this.waitForPhase(durations.idle, elapsed => this.setProgress(14 + (elapsed / durations.idle) * 28))
      const idle = this.capturePhase(durations.idle)

      this.phase = 'Orbit'
      this.resetSamples()
      const target = controls.target.clone()
      const distance = Math.max(camera.position.distanceTo(target), 10)
      const radius = distance * 0.8
      const height = distance * 0.6
      await this.waitForPhase(durations.orbit, elapsed => {
        const angle = (elapsed / durations.orbit) * Math.PI * 2
        camera.position.set(target.x + Math.cos(angle) * radius, target.y + height, target.z + Math.sin(angle) * radius)
        camera.lookAt(target)
        this.setProgress(42 + (elapsed / durations.orbit) * 29)
      })
      const orbit = this.capturePhase(durations.orbit)

      this.phase = 'Pointer sweep'
      camera.position.copy(original.position)
      camera.quaternion.copy(original.quaternion)
      camera.up.copy(original.up)
      controls.target.copy(original.target)
      camera.updateMatrixWorld()
      this.model.selector.enableHover = true
      this.resetSamples()
      await this.waitForPhase(durations.pointerSweep, elapsed => {
        const angle = (elapsed / durations.pointerSweep) * Math.PI * 8
        this.model.pointerCoords.set(Math.sin(angle) * 0.8, Math.sin(angle * 0.57) * 0.7, 0)
        this.model.selector.onHover()
        this.setProgress(71 + (elapsed / durations.pointerSweep) * 29)
      })
      const pointerSweep = this.capturePhase(durations.pointerSweep)

      const report: ViewerBenchmarkReport = {
        benchmarkVersion: 'viewer3d-v3',
        timestamp: new Date().toISOString(),
        durationsMs: durations,
        environment: this.getEnvironment(),
        settings: { renderMode: this.model.renderMode, qualityProfile: this.model.qualityProfile },
        fixture: this.fixture,
        sceneDatabase: {
          nodes: this.model.structuralSceneDB.nodeCount,
          profiles: this.model.structuralSceneDB.profileCount,
          members: this.model.structuralSceneDB.memberCount,
          byteLength: this.model.structuralSceneDB.byteLength,
          buildMs: round(this.model.structuralSceneDBBuildMs),
          version: this.model.structuralSceneDB.version,
        },
        model: {
          nodes: this.model.nodes.length,
          members: this.model.members.length,
          shells: this.model.shells.length,
          loads: this.model.loads.length,
          labels: this.model.labeler?.count ?? 0,
        },
        phases: { idle, orbit, pointerSweep },
      }
      this.report = JSON.stringify(report, null, 2)
      console.log(`=== BUCKLE VIEWER BENCHMARK V3 START ===\n${this.report}\n=== BUCKLE VIEWER BENCHMARK V3 END ===`)
      return this.report
    } finally {
      camera.position.copy(original.position)
      camera.quaternion.copy(original.quaternion)
      camera.up.copy(original.up)
      controls.target.copy(original.target)
      controls.enabled = original.controlsEnabled
      this.model.selector.enableHover = original.hoverEnabled
      this.model.pointerCoords.copy(original.pointer)
      if (this.model.renderMode !== 'solid-extrude') {
        this.model.selector.replaceStructuralSelection(original.structuralSelection)
      }
      camera.updateMatrixWorld()
      this.setProgress(100)
      this.phase = 'Complete'
      this.running = false
    }
  }
}
