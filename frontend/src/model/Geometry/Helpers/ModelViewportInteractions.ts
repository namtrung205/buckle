import * as THREE from 'three'
import type { Model } from '../../Model'
import { createDriverSession, resolveViewportPoint, InteractionError, ViewportDriver } from '../../../core/interaction/index.ts'
import type {
  InteractionSession,
  InteractionOwner,
  InteractionResult,
  InteractionSpec,
  InteractionEntityCollection,
  PickPointSpec,
  DrawPolylineSpec,
} from '../../../core/interaction/index.ts'
import type {
  PointResolveContext,
  SnapCandidate,
  ViewportConnection,
  ViewportDriverHandlers,
  ViewportDriverHost,
  ViewportPlane,
  ViewportPoint,
  ViewportPointerEvent,
} from '../../../core/interaction/index.ts'
import type { EntityReference, Vector3Record } from '../../../core/structural/types.ts'
import type { ContributionOwner, PluginViewportInteractions, ViewportZoomTarget } from '../../../core/plugins/index.ts'

const PROMPT_ID = 'pluginInteractionPrompt'

const toRecord = (vector: THREE.Vector3): Vector3Record => [vector.x, vector.y, vector.z]

/**
 * Model-backed viewport interaction host (Goal 3 slice 3.3). Binds the pure
 * `ViewportDriver` to the real canvas, Snapper, GPU picker, camera and console.
 * All pointer ownership stays host-side (roadmap design rule 4): the host owns
 * the single interaction session, snapping and picking; plugins only see the
 * broker surfaces. Every session guarantees full teardown — listeners,
 * cursor, status prompt and the forced snap mode — on any terminal path.
 */
export class ModelViewportInteractions {
  private readonly model: Model
  private activeSession: InteractionSession | null = null
  private savedCursor = ''
  private snapperWasEnabled = false
  private forcedSnapper = false

  constructor(model: Model) {
    this.model = model
  }

  /** Wire into `PluginCommandServices.interactions` (Goal 3 slice 3.2). */
  pluginViewportInteractions(): PluginViewportInteractions {
    return {
      pickEntities: (owner, spec) => this.runInteraction(owner, spec),
      pickPoint: (owner, spec) => this.runInteraction(owner, spec),
      drawPolyline: (owner, spec) => this.runInteraction(owner, spec),
      zoomTo: target => this.zoomTo(target),
    }
  }

  /** Run one host-owned interaction session. Resolves with the result, or null
   *  when it ended without one (Escape / timeout / owner release / busy). */
  private async runInteraction(owner: ContributionOwner, spec: InteractionSpec): Promise<InteractionResult | null> {
    const driverHost = this.buildDriverHost()
    const sessionOwner: InteractionOwner = owner.kind === 'plugin'
      ? { kind: 'plugin', id: owner.id, version: owner.version }
      : { kind: 'builtin', id: owner.id }
    const session = createDriverSession(sessionOwner, spec, driverHost)
    const driver = new ViewportDriver(session, driverHost)
    this.activeSession = session
    // Host-side guaranteed restore — runs exactly once on every terminal path,
    // mirroring the driver's own listener/cursor teardown.
    session.addCleanup(() => this.restoreHostState())
    try {
      return await driver.run()
    } catch (error) {
      if (error instanceof InteractionError) return null
      throw error
    } finally {
      this.activeSession = null
      this.restoreHostState()
    }
  }

  private buildDriverHost(): ViewportDriverHost {
    const model = this.model
    return {
      canTakeViewport: () => !model.isLocked,
      onPrompt: message => this.showPrompt(message),
      setCursor: cursor => {
        if (cursor === null) {
          document.body.style.cursor = this.savedCursor
          this.savedCursor = ''
          return
        }
        if (!this.savedCursor) this.savedCursor = document.body.style.cursor
        document.body.style.cursor = cursor
      },
      resolvePoint: (pointer, spec) => this.resolvePoint(pointer, spec),
      pickEntities: (pointer, collections) => this.pickEntitiesAt(pointer, collections),
      pickWindow: (from, to, collections) => this.pickWindow(from, to, collections),
      connect: handlers => this.connect(handlers),
      checkBudget: () => this.activeSession?.checkBudget(),
      now: () => performance.now(),
    }
  }

  /** Bind the gesture handlers to the real canvas for the session lifetime. */
  private connect(handlers: ViewportDriverHandlers): ViewportConnection {
    const canvas = this.model.canvas
    const snapper = this.model.snapper
    this.snapperWasEnabled = snapper.enabled
    this.forcedSnapper = false
    if (!snapper.enabled) {
      snapper.enable()
      this.forcedSnapper = true
    }
    if (snapper.enabled) snapper.update()

    const toPointer = (event: MouseEvent): ViewportPointerEvent => {
      const rect = canvas.getBoundingClientRect()
      const width = rect.width || 1
      const height = rect.height || 1
      return {
        x: ((event.clientX - rect.left) / width) * 2 - 1,
        y: -(((event.clientY - rect.top) / height) * 2 - 1),
      }
    }
    const onMove = (event: MouseEvent) => handlers.pointerMove(toPointer(event))
    const onDown = (event: MouseEvent) => {
      if (event.button === 2) handlers.rightClick(toPointer(event))
      else if (event.button === 0) handlers.click(toPointer(event))
    }
    const onContextMenu = (event: MouseEvent) => event.preventDefault()
    const onKey = (event: KeyboardEvent) => handlers.keyDown(event.key)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKey)
    return {
      disconnect: () => {
        canvas.removeEventListener('mousemove', onMove)
        canvas.removeEventListener('mousedown', onDown)
        canvas.removeEventListener('contextmenu', onContextMenu)
        window.removeEventListener('keydown', onKey)
      },
    }
  }

  /** Restore snap mode, status prompt and cursor — idempotent, safe to run
   *  from both the session cleanup and the finally guard. */
  private restoreHostState() {
    if (this.forcedSnapper && !this.snapperWasEnabled) this.model.snapper.disable()
    this.forcedSnapper = false
    this.model.console.batchDelete([PROMPT_ID])
    if (this.savedCursor) {
      document.body.style.cursor = this.savedCursor
      this.savedCursor = ''
    }
  }

  /** Status line while the interaction is active (Console prompt, fixed id). */
  private showPrompt(message: string | null) {
    if (message === null) {
      this.model.console.batchDelete([PROMPT_ID])
      return
    }
    this.model.console.createOrUpdateOne({ id: PROMPT_ID, message, type: 'INFO', timestamp: new Date() })
  }

  /** Resolve a pointer to a snap-annotated world point using the live Snapper
   *  state and the active workplane (delegates to the pure kernel). */
  private resolvePoint(pointer: ViewportPointerEvent, spec: PickPointSpec | DrawPolylineSpec): ViewportPoint | null {
    const model = this.model
    const snapper = model.snapper
    if (!snapper.enabled) return null
    snapper.update()
    const threeD = !model.hasActiveWorkPlane

    const endpoint = snapper.snappedEndpoint
    const memberPoint = snapper.snappedMemberPoint
    const grid = snapper.snappedGrid
    const candidate: SnapCandidate = {
      ...(endpoint
        ? {
          // Snapper already filtered candidates by the plane threshold, so an
          // endpoint here is always "on plane" (the flag is ignored in 3D mode).
          node: { id: endpoint.id, position: toRecord(endpoint.position), onPlane: true, exact: endpoint.exact },
        }
        : {}),
      ...(memberPoint
        ? {
          member: {
            id: memberPoint.memberId,
            ratio: memberPoint.ratio,
            position: toRecord(memberPoint.position),
            onPlane: true,
          },
        }
        : {}),
      ...(grid ? { grid: toRecord(grid) } : {}),
    }

    const plane: ViewportPlane | null = threeD
      ? null
      : { normal: toRecord(model.worldPlane.normal), distance: model.worldPlane.constant }
    let planePosition: Vector3Record | null = null
    if (!threeD) {
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), model.camera.cam)
      const hit = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(model.worldPlane, hit)) planePosition = toRecord(hit)
    }
    const context: PointResolveContext = {
      plane,
      planePosition,
      candidate,
      ...(spec.snap !== undefined ? { snap: spec.snap } : {}),
      planeThreshold: snapper.planeThreshold,
    }
    return resolveViewportPoint(context)
  }

  /** Single-entity GPU pick for the requested collections (click mode). */
  private pickEntitiesAt(
    pointer: ViewportPointerEvent,
    collections: readonly InteractionEntityCollection[],
  ): readonly EntityReference[] {
    const picker = this.model.structuralPicker
    if (!picker) return []
    const camera = this.model.camera.cam
    const refs: EntityReference[] = []
    for (const collection of collections) {
      if (collection === 'shells') continue
      const hit = picker.pick(pointer.x, pointer.y, camera, collection === 'nodes' ? 'node' : 'member')
      if (hit) refs.push({ collection, id: hit.entityId })
    }
    return refs
  }

  /** CPU rectangle query (window mode) through the shared window selector. */
  private pickWindow(
    from: ViewportPointerEvent,
    to: ViewportPointerEvent,
    collections: readonly InteractionEntityCollection[],
  ): readonly EntityReference[] {
    const selector = this.model.structuralPicker?.windowSelector
    if (!selector) return []
    const camera = this.model.camera.cam
    const start = { x: from.x, y: from.y }
    const end = { x: to.x, y: to.y }
    const refs: EntityReference[] = []
    if (collections.includes('members')) {
      for (const id of selector.select(camera, start, end)) refs.push({ collection: 'members', id })
    }
    if (collections.includes('nodes')) {
      for (const id of selector.selectNodes(camera, start, end)) refs.push({ collection: 'nodes', id })
    }
    return refs
  }

  /** Host-owned zoom backing `viewport.zoomTo`. */
  private zoomTo(target: ViewportZoomTarget) {
    switch (target.kind) {
      case 'selection':
        this.model.zoomToSelected()
        return
      case 'entities':
        this.model.zoomToRefs(target.entities)
        return
      case 'point': {
        const position = target.position
        const center = new THREE.Vector3(position[0], position[1], position[2])
        this.model.camera.fitBoxToView(new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(1, 1, 1)))
        return
      }
    }
  }
}
