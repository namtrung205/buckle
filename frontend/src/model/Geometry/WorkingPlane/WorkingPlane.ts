import * as THREE from 'three'
import { makeAutoObservable } from 'mobx'
import Model from '../../Model'
import Line from '../Tools/Line'

/**
 * Working plane — the conceptual "drawing surface" (AutoCAD UCS / Revit
 * workplane / SAP2000 plane concept).
 *
 * Everything that picks or draws (Line tool, Snapper, PlanPick tool) raycasts
 * against `model.worldPlane`. This class is the single entry point that:
 *  1. re-orients that picking plane,
 *  2. re-orients the visible square grid (the ô vuông drawing grid — NOT the
 *     labelling GridSystem),
 *  3. optionally aligns the camera to look straight at the plane.
 *
 * Naming follows the USER/engineering convention (X, Y horizontal, Z up):
 *  - OXY  = the horizontal plan (internally the three.js XZ plane),
 *  - OXZ  = the vertical face containing X and the up axis,
 *  - OYZ  = the vertical face containing Y and the up axis.
 *
 * A working plane can be defined from:
 *  - one of those axis-pair faces with an offset,
 *  - a storey level (horizontal at an elevation),
 *  - a structural GridSystem (its labelling plane),
 *  - three picked points (PlanePick tool).
 */

export type WorkingPlaneSource = 'world' | 'axes' | 'level' | 'grid' | '3points'

export type WorkPlaneAxes = 'OXY' | 'OXZ' | 'OYZ'

class WorkingPlane {
  model: Model
  source: WorkingPlaneSource = 'world'
  label: string = 'OXY plan'
  normal: THREE.Vector3 = new THREE.Vector3(0, 1, 0)
  constant: number = 0
  /** A point that belongs to the plane (used as the camera look-at / grid origin). */
  origin: THREE.Vector3 = new THREE.Vector3(0, 0, 0)

  constructor(model: Model) {
    this.model = model
    makeAutoObservable(this)
  }

  /**
   * The point the camera orbits when this plane is aligned: the projection of
   * the model's centre onto the plane (falls back to the plane's own origin
   * for an empty model) so the aligned view frames the model region that lies
   * ON the active plane instead of the world origin.
   * Must be called AFTER `model.worldPlane` has been pushed to this plane.
   */
  private orbitTarget(): THREE.Vector3 {
    // Structural cast mirrors Camera.getModelBox — Node exposes x/y/z.
    const nodes = this.model.nodes as unknown as { x: number; y: number; z: number }[] | undefined
    if (nodes && nodes.length > 0) {
      const box = new THREE.Box3()
      const v = new THREE.Vector3()
      for (const node of nodes) box.expandByPoint(v.set(node.x, node.y, node.z))
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        return this.model.worldPlane.projectPoint(center, new THREE.Vector3())
      }
    }
    return this.origin.clone()
  }

  /** Push this working plane into the model: picking plane + square grid + camera. */
  apply(opts: { alignCamera?: boolean } = {}) {
    const alignCamera = opts.alignCamera !== false
    const n = this.normal.clone().normalize()
    // Re-orient the shared picking plane in place — every pick/draw reads it.
    this.model.worldPlane.normal.copy(n)
    this.model.worldPlane.constant = this.constant
    // Re-orient the visible square grid (ô vuông) to lie in this plane.
    this.model.gridHelper.applyWorkingPlane(n, this.constant)
    if (alignCamera) {
      this.model.camera.alignToPlane(n, this.orbitTarget())
    }
  }

  setWorld() {
    this.source = 'world'
    this.label = 'OXY plan'
    this.normal.set(0, 1, 0)
    this.constant = 0
    this.origin.set(0, 0, 0)
    this.apply()
  }

  /**
   * Reset to the default horizontal plan (OXY) and fit the camera to the model
   * — the "Home" view. Re-uses handle2dView (which already fits and looks
   * straight down) and then re-orients the square grid without over-riding the
   * camera afterwards.
   */
  home() {
    // Cancel any in-flight nav-cube animation FIRST: ViewportGizmo._animate()
    // rewrites the camera position/quaternion on every frame while it runs and
    // would otherwise override the reset pose (so Home seemed to do nothing).
    // `animating` is a public flag on the gizmo (three-viewport-gizmo typings).
    if (this.model.gizmo) this.model.gizmo.animating = false
    // The gizmo disables OrbitControls for the duration of its animation; since
    // we just cancelled it, restore them so navigation keeps working.
    this.model.camera.controls.enabled = true
    this.setWorld()
    this.model.camera.handle2dView()
    this.model.gridHelper.applyWorkingPlane(this.normal, this.constant)
    // Home is a "back to the default view" action — it must not leave a draw /
    // copy tool running. Stop any active tool and return to the select nav mode.
    this.model.toolsController.deactivate()
    // The free-draw Line tool runs DIRECTLY from the Draw panel (not through
    // ToolsController), so deactivate() above never reaches it. Force-stop it
    // here too, and disable the snapper so its red snap indicator is cleared
    // (Esc used to be the only way to get rid of it).
    const lineTool = Line.getInstance()
    if (lineTool.state !== 0) {
      lineTool.stop()
      lineTool.delete()
    }
    this.model.snapper.disable()
    this.model.setNavTool('select')
    // setNavTool early-returns when the nav tool is already 'select', so make
    // sure picking is re-armed even if a draw tool had disabled the selector.
    this.model.selector.enable()
  }

  /**
   * Set a plane from a user-convention axis pair + an offset along the
   * remaining (normal) axis, in metres.
   *  - OXY (horizontal plan): offset = Z elevation
   *  - OXZ (vertical face X–Z) : offset = Y
   *  - OYZ (vertical face Y–Z) : offset = X
   */
  setAxes(axes: WorkPlaneAxes, offset: number) {
    this.source = 'axes'
    const ofs = Number(offset) || 0
    if (axes === 'OXY') {
      this.normal.set(0, 1, 0)
      this.constant = -ofs
      this.origin.set(0, ofs, 0)
      this.label = ofs === 0 ? 'OXY plan' : `OXY plan z=${ofs}`
    } else if (axes === 'OXZ') {
      this.normal.set(0, 0, 1)
      this.constant = -ofs
      this.origin.set(0, 0, ofs)
      this.label = ofs === 0 ? 'OXZ face' : `OXZ face y=${ofs}`
    } else {
      this.normal.set(1, 0, 0)
      this.constant = -ofs
      this.origin.set(ofs, 0, 0)
      this.label = ofs === 0 ? 'OYZ face' : `OYZ face x=${ofs}`
    }
    this.apply()
  }

  /** Horizontal working plane at a storey elevation. */
  setLevel(elevation: number, levelLabel?: string, opts: { alignCamera?: boolean } = {}) {
    this.source = 'level'
    const el = Number(elevation) || 0
    this.normal.set(0, 1, 0)
    this.constant = -el
    this.origin.set(0, el, 0)
    this.label = levelLabel ? `Plan ${levelLabel}` : `Plan y=${el}`
    this.apply(opts)
  }

  /**
   * Set the working plane along a single structural grid AXIS. Each grid line
   * (A, B, C… or 1, 2, 3…) is treated as a VERTICAL plane standing on that
   * line, perpendicular to the ground — NOT the whole horizontal grid plane.
   *  - X-family line (A at x=m, running along Z): vertical plane x=m (OYZ face),
   *  - Y-family line (1 at z=m, running along X): vertical plane z=m (OXZ face).
   */
  setGridLine(gridName: string, axis: 'X' | 'Y', label: string, coord: number) {
    this.source = 'grid'
    const c = Number(coord) || 0
    if (axis === 'X') {
      this.normal.set(1, 0, 0)
      this.constant = -c
      this.origin.set(c, 0, 0)
      this.label = `Grid ${gridName} · ${label} (OYZ x=${c})`
    } else {
      this.normal.set(0, 0, 1)
      this.constant = -c
      this.origin.set(0, 0, c)
      this.label = `Grid ${gridName} · ${label} (OXZ z=${c})`
    }
    this.apply()
  }

  /** Fit a plane through three picked points. Returns false when collinear. */
  setFromPoints(p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3): boolean {
    const ab = p2.clone().sub(p1)
    const ac = p3.clone().sub(p1)
    const n = ab.clone().cross(ac)
    if (n.lengthSq() < 1e-12) return false
    n.normalize()
    // Orient the normal TOWARDS the viewer: the pick order fixes the
    // right-hand-rule direction, while alignToPlane() places the camera along
    // +normal — without this flip the camera would jump to the plane's back
    // side right after picking.
    const toCamera = this.model.camera.cam.position.clone().sub(p1)
    if (n.dot(toCamera) < 0) n.negate()
    this.source = '3points'
    this.normal.copy(n)
    this.constant = -n.dot(p1)
    this.origin.copy(p1)
    this.label = '3-point plane'
    this.apply()
    return true
  }
}

export default WorkingPlane