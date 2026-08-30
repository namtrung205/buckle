import * as THREE from 'three';
import { makeAutoObservable } from 'mobx';
import Model from '../../Model';
import { Tool } from './types';
import { ZoomMode } from '../../../types';

/**
 * Zoom navigation tool for the bottom bar.
 *
 * Supports three sub-modes:
 * - `fit`    : one-shot "zoom to extents" (camera.fitModelToView)
 * - `window` : drag the left mouse button to draw a rubber-band, the camera
 *              zooms to the covered region (CAD-style zoom window)
 * - `drag`   : drag the left mouse button up/down to zoom in/out continuously
 *
 * Wired up manually by Model.setNavTool (not through ToolsController), because
 * navigation must stay available while the model is locked after an analysis.
 */
class ZoomTool implements Tool {
  uuid: string = 'Zoom'
  state: number = 0
  model: Model
  mode: ZoomMode = 'drag'
  isDragging = false

  private box: HTMLDivElement | null = null
  private pointerDown = { x: 0, y: 0 }
  private lastY = 0

  constructor(model: Model) {
    this.model = model
    makeAutoObservable(this)
  }

  setMode(mode: ZoomMode) {
    this.mode = mode
    if (this.state !== 1) return
    // Re-arm the active zoom tool for the newly selected sub-mode.
    if (mode === 'fit') {
      this.removeListeners()
      this.hideBox()
      this.model.camera.fitModelToView()
    } else {
      this.hideBox()
      this.bindListeners()
    }
  }

  start() {
    if (this.state === 1) {
      // Already active: re-run fit so clicking the main zoom button re-fits.
      if (this.mode === 'fit') this.model.camera.fitModelToView();
      return
    }
    this.state = 1
    if (this.mode === 'fit') {
      // One-shot: fit immediately, no drag handlers needed.
      this.model.camera.fitModelToView()
      return
    }
    this.bindListeners()
  }

  stop() {
    if (this.state === 0) return
    this.state = 0
    this.isDragging = false
    this.removeListeners()
    this.hideBox()
    this.model.renderer.domElement.style.cursor = 'default'
  }

  private bindListeners() {
    this.removeListeners()
    this.model.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
  }

  private removeListeners() {
    this.model.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.state !== 1 || this.isDragging) return
    if (event.target !== this.model.renderer.domElement) return
    if (event.button !== 0) return
    event.preventDefault()
    this.isDragging = true
    this.pointerDown = { x: event.clientX, y: event.clientY }
    this.lastY = event.clientY
    this.model.renderer.domElement.style.cursor = this.mode === 'window' ? 'crosshair' : 'row-resize'
    if (this.mode === 'window') {
      this.showBox(event.clientX, event.clientY)
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.state !== 1 || !this.isDragging) return
    if (this.mode === 'drag') {
      const dy = this.lastY - event.clientY
      this.lastY = event.clientY
      if (dy !== 0) this.zoomBy(Math.exp(dy * 0.008))
    } else if (this.mode === 'window') {
      this.updateBox(event.clientX, event.clientY)
    }
  }

  private onPointerUp = (event: PointerEvent) => {
    if (this.state !== 1 || !this.isDragging) return
    this.isDragging = false
    this.model.renderer.domElement.style.cursor = 'default'
    if (this.mode === 'window') {
      const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y)
      this.hideBox()
      if (distance > 5) {
        this.zoomToWindow(this.pointerDown.x, this.pointerDown.y, event.clientX, event.clientY)
      }
    }
  }

  /**
   * Continuous zoom. Orthographic cameras change their `zoom` factor;
   * perspective cameras move along the view direction (OrbitControls' internal
   * `_dollyIn/_dollyOut` are private in three r173, so we manipulate the camera).
   */
  private zoomBy(factor: number) {
    const camera = this.model.camera
    const cam = camera.cam
    if (cam instanceof THREE.OrthographicCamera) {
      cam.zoom = THREE.MathUtils.clamp(cam.zoom * factor, 0.001, 100000)
      cam.updateProjectionMatrix()
    } else {
      const controls = camera.controls
      const forward = controls.target.clone().sub(cam.position)
      const dist = Math.max(forward.length(), 0.001)
      forward.normalize()
      const newDist = THREE.MathUtils.clamp(dist / factor, 0.01, 100000)
      cam.position.copy(controls.target).addScaledVector(forward, -newDist)
    }
    camera.controls.update()
  }

  /**
   * Resize the camera frustum so the world-space rectangle covered by the
   * drag box becomes the visible viewport.
   */
  private zoomToWindow(x1: number, y1: number, x2: number, y2: number) {
    const camera = this.model.camera
    const cam = camera.cam
    const controls = camera.controls
    const canvas = this.model.renderer.domElement
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const toNDC = (cx: number, cy: number) =>
      new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1)

    // Project the four corners of the drag box onto a plane passing through the
    // orbit target, perpendicular to the current view direction.
    const viewDir = controls.target.clone().sub(cam.position).normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, controls.target)
    const raycaster = new THREE.Raycaster()

    const cornersWorld: THREE.Vector3[] = []
    const ndcCorners = [toNDC(x1, y1), toNDC(x2, y1), toNDC(x2, y2), toNDC(x1, y2)]
    for (const ndc of ndcCorners) {
      raycaster.setFromCamera(ndc, cam)
      const hit = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(plane, hit)) cornersWorld.push(hit.clone())
    }
    if (cornersWorld.length < 4) return

    // Measure the covered region in camera space so the frustum can be fitted.
    cam.updateMatrixWorld()
    const inv = cam.matrixWorldInverse
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    const center = new THREE.Vector3()
    for (const point of cornersWorld) {
      const pc = point.clone().applyMatrix4(inv)
      minX = Math.min(minX, pc.x)
      maxX = Math.max(maxX, pc.x)
      minY = Math.min(minY, pc.y)
      maxY = Math.max(maxY, pc.y)
      center.add(point)
    }
    center.divideScalar(cornersWorld.length)

    const width = maxX - minX
    const height = maxY - minY
    if (width < 1e-6 || height < 1e-6) return

    const aspect = rect.width / rect.height
    const margin = 1.15

    // Keep the view direction; point the orbit target at the center of the region.
    const delta = center.clone().sub(controls.target)
    controls.target.copy(center)
    cam.position.add(delta)

    if (cam instanceof THREE.OrthographicCamera) {
      const size = Math.max(height, width / aspect) * margin
      cam.zoom = 1
      cam.top = size / 2
      cam.bottom = -size / 2
      cam.left = (-size * aspect) / 2
      cam.right = (size * aspect) / 2
    } else {
      const cam3 = cam as THREE.PerspectiveCamera
      const fov = THREE.MathUtils.degToRad(cam3.fov)
      const halfHeight = (Math.max(height, width / aspect) * margin) / 2
      const dist = halfHeight / Math.tan(fov / 2)
      const forward = controls.target.clone().sub(cam.position).normalize()
      cam.position.copy(controls.target).addScaledVector(forward, -dist)
    }

    cam.lookAt(controls.target)
    cam.updateProjectionMatrix()
    controls.update()
  }

  private showBox(x: number, y: number) {
    if (!this.box && this.model.renderer.domElement.parentElement) {
      this.box = document.createElement('div')
      this.box.classList.add('zoomBox')
      this.box.style.pointerEvents = 'none'
      this.model.renderer.domElement.parentElement.appendChild(this.box)
    }
    if (!this.box) return
    this.box.style.display = 'block'
    this.box.style.left = x + 'px'
    this.box.style.top = y + 'px'
    this.box.style.width = '0px'
    this.box.style.height = '0px'
  }

  private updateBox(x: number, y: number) {
    if (!this.box) return
    const left = Math.min(this.pointerDown.x, x)
    const top = Math.min(this.pointerDown.y, y)
    const width = Math.abs(x - this.pointerDown.x)
    const height = Math.abs(y - this.pointerDown.y)
    this.box.style.left = left + 'px'
    this.box.style.top = top + 'px'
    this.box.style.width = width + 'px'
    this.box.style.height = height + 'px'
  }

  private hideBox() {
    if (this.box) this.box.style.display = 'none'
  }

  dispose() {
    this.stop()
  }
}

export default ZoomTool