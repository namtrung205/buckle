import * as THREE from 'three'
import { makeAutoObservable } from 'mobx'
import { Model } from '../../Model'
import { Tool } from './types'

/**
 * 3-point working-plane picker (AutoCAD "UCS 3P" style).
 *
 * While active the user clicks three points on the current picking plane
 * (points snap to nodes / the square grid through the shared Snapper). After
 * the third click the plane through those points becomes the active working
 * plane and the tool stops automatically. Right-click or Escape cancels.
 */
class PlanePick implements Tool {
  private static _instance: PlanePick | null = null
  static getInstance(): PlanePick {
    if (PlanePick._instance === null) PlanePick._instance = new PlanePick()
    return PlanePick._instance
  }

  uuid: string = 'PlanePick'
  state: number = 0
  points: THREE.Vector3[] = []
  model: Model = Model.getInstance()
  private currentPointer: THREE.Vector3 = new THREE.Vector3()

  constructor() {
    this.model.canvas.addEventListener('mousemove', this.onMouseMove)
    this.model.canvas.addEventListener('click', this.onClick)
    this.model.canvas.addEventListener('contextmenu', this.onRightClick)
    window.addEventListener('keydown', this.onKey)
    makeAutoObservable(this)
  }

  start = () => {
    if (this.model.isLocked) return
    this.points = []
    this.state = 1
    this.model.canvas.style.cursor = 'crosshair'
    this.model.snapper.enable()
    this.model.console.create({
      id: '',
      message: 'Pick point 1 of 3 (Esc to cancel)',
      type: 'INFO',
      timestamp: new Date(),
    })
  }

  stop = () => {
    this.state = 0
    this.model.canvas.style.cursor = 'default'
    this.model.snapper.disable()
  }

  private onMouseMove = (e: MouseEvent) => {
    if (this.state !== 1) return
    const rect = this.model.canvas.getBoundingClientRect()
    const v2 = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(v2, this.model.camera.cam)
    raycaster.ray.intersectPlane(this.model.worldPlane, this.currentPointer)
  }

  private onClick = () => {
    if (this.state !== 1) return
    const snapped = this.model.snapper.snappedCoords
    const p = snapped ? snapped.clone() : this.currentPointer.clone()
    this.points.push(p)
    this.model.console.create({
      id: '',
      message: this.points.length < 3
        ? `Pick point ${this.points.length + 1} of 3 (Esc to cancel)`
        : 'Computing working plane…',
      type: 'INFO',
      timestamp: new Date(),
    })
    if (this.points.length < 3) return

    const [p1, p2, p3] = this.points
    const ok = this.model.workingPlane.setFromPoints(p1, p2, p3)
    if (!ok) {
      this.points = []
      this.model.console.create({
        id: '',
        message: 'Points are collinear — pick three non-aligned points',
        type: 'ERROR',
        timestamp: new Date(),
      })
      return
    }
    this.model.console.create({
      id: '',
      message: `Working plane updated (${this.model.workingPlane.label})`,
      type: 'INFO',
      timestamp: new Date(),
    })
    this.stop()
  }

  private onRightClick = (e: MouseEvent) => {
    if (this.state !== 1) return
    e.preventDefault()
    this.points = []
    this.stop()
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.state === 1) {
      e.preventDefault()
      this.points = []
      this.stop()
    }
  }

  dispose = () => {
    this.model.canvas.removeEventListener('mousemove', this.onMouseMove)
    this.model.canvas.removeEventListener('click', this.onClick)
    this.model.canvas.removeEventListener('contextmenu', this.onRightClick)
    window.removeEventListener('keydown', this.onKey)
  }
}

export default PlanePick