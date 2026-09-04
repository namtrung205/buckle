import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import Model from '../Model';
import { ViewportGizmo } from 'three-viewport-gizmo';
import { NavTool } from '../../types';
export class Camera {
  cam: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  frustumSize: number;
  viewMode : '2d' | '3d'
  orthoCam: THREE.OrthographicCamera;
  perspectiveCam: THREE.PerspectiveCamera;  
  directionalLight : THREE.DirectionalLight;
  model: Model
  constructor(model: Model) {
    this.model = model
    this.renderer = model.renderer
    // this.cam = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.viewMode = '2d'
    this.frustumSize = 50
    const aspect = window.innerWidth / window.innerHeight;
    this.orthoCam = new THREE.OrthographicCamera( this.frustumSize * aspect / - 2, this.frustumSize * aspect / 2, this.frustumSize / 2, this.frustumSize / - 2, 0.1, 100 );
    this.perspectiveCam = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.cam = this.orthoCam;
    this.cam.position.set(0, -10, 0);
    this.controls = new OrbitControls(this.cam, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.enableRotate = false;
    this.controls.mouseButtons = {
      LEFT: null as any,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };

    // https://discourse.threejs.org/t/directionallight-parallel-to-the-camera-step-by-step/54225/5
    // const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    this.directionalLight = new THREE.DirectionalLight( 0xffffff, 20 );
    this.directionalLight.position.set(0, 1, 100);
    this.directionalLight.shadow.mapSize.set( 4096, 4096 );
    this.directionalLight.shadow.bias = -0.0005;
    this.directionalLight.shadow.camera.left =	-200;
    this.directionalLight.shadow.camera.right = 	200;
    this.directionalLight.shadow.camera.top = 	200;
    this.directionalLight.shadow.camera.bottom = -200;
    this.directionalLight.castShadow = true;
    this.directionalLight.castShadow = true;
    // this.cam.add(this.directionalLight)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.model.scene.add(ambientLight);
    this.model.scene.add(this.cam)
    this.handle3dView()
  }


  handleResize() {
    const aspect = window.innerWidth / window.innerHeight;
    
    if(this.cam instanceof THREE.OrthographicCamera) {
      this.cam.left = - this.frustumSize * aspect / 2;
      this.cam.right = this.frustumSize * aspect / 2;
      this.cam.top = this.frustumSize / 2;
      this.cam.bottom = - this.frustumSize / 2;
    }
    else{
      this.cam.aspect = window.innerWidth / window.innerHeight
    }
    this.cam.updateProjectionMatrix();
  }

  /** Bounding box of the model geometry (nodes when available, else the whole scene). */
  private getModelBox(): THREE.Box3 {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    // model.nodes is undefined while the Camera is constructed inside the Model constructor
    const nodes = this.model.nodes as unknown as { x: number; y: number; z: number }[] | undefined;
    if (nodes && nodes.length > 0) {
      for (const node of nodes) box.expandByPoint(v.set(node.x, node.y, node.z));
    } else {
      box.setFromObject(this.model.scene);
    }
    return box;
  }

  /**
   * Fit the frustum + camera to the model size — fixes culling on large models
   * (far plane) and clipping on tiny ones (near plane), and centres the orbit target.
   */
  fitModelToView() {
    const box = this.getModelBox();
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const radius = maxDim / 2;

    // Depth range scales with the model so nothing is culled by the near/far planes
    const near = Math.max(0.01, radius / 500);
    const far = Math.max(2000, radius * 100);
    this.orthoCam.near = near;
    this.orthoCam.far = far;
    this.perspectiveCam.near = near;
    this.perspectiveCam.far = far;

    // Orthographic frustum covers the whole model with a margin
    this.frustumSize = maxDim * 1.4;
    if (this.cam instanceof THREE.OrthographicCamera) this.cam.zoom = 1;

    // Orbit around the model centre
    this.controls.target.copy(center);

    if (this.viewMode === '2d') {
      // Top view: sit above the model centre, far enough for the far plane
      this.cam.position.set(center.x, center.y + Math.max(50, radius * 3), center.z);
    } else {
      // Iso direction at a distance that fits the model
      const dir = new THREE.Vector3(0.65, 1, 0.65).normalize();
      this.cam.position.copy(center).addScaledVector(dir, radius * 3 + 1);
    }
    // Normalize the camera up to the world default — the nav cube (gizmo) and
    // OrbitControls both assume the standard Y-up convention; a leftover
    // custom up (e.g. from a working-plane alignment) rolls the fitted view.
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(center);

    this.handleResize(); // recompute frustum bounds + updateProjectionMatrix
    this.controls.update();
  }

  /**
   * Fit the frustum + camera to the model size while KEEPING the current camera
   * orientation (view direction + roll). Unlike fitModelToView() it never snaps
   * the camera to a canonical iso / top pose — it only moves the orbit target to
   * the model centre and pulls the camera along its current view direction until
   * the model fits. Used by the Zoom → Fit button.
   */
  fitModelKeepOrientation() {
    const box = this.getModelBox();
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const radius = maxDim / 2;

    // Depth range scales with the model so nothing is culled by the near/far planes
    const near = Math.max(0.01, radius / 500);
    const far = Math.max(2000, radius * 100);
    this.orthoCam.near = near;
    this.orthoCam.far = far;
    this.perspectiveCam.near = near;
    this.perspectiveCam.far = far;

    // Orthographic frustum covers the whole model with a margin
    this.frustumSize = maxDim * 1.4;
    if (this.cam instanceof THREE.OrthographicCamera) this.cam.zoom = 1;

    // Preserve the current view direction (direction from the old orbit target to
    // the camera). Fall back to a sane iso / top direction when it is degenerate.
    const viewDir = new THREE.Vector3()
      .subVectors(this.cam.position, this.controls.target)
      .normalize();
    if (viewDir.lengthSq() < 1e-8) {
      viewDir.set(this.viewMode === '2d' ? 0 : 0.65, 1, this.viewMode === '2d' ? 0 : 0.65).normalize();
    }

    // Re-target the orbit to the model centre and pull the camera along the
    // SAME direction to a distance that fits the model — no rotation at all.
    this.controls.target.copy(center);
    this.cam.position.copy(center).addScaledVector(viewDir, radius * 3 + 1);

    // Keep the camera up untouched so the roll of the current view is preserved.
    this.cam.lookAt(center);

    this.handleResize(); // recompute frustum bounds + updateProjectionMatrix
    this.controls.update();
  }
  /**
   * Zoom to a single element (double-click in select mode). Keeps the current
   * view direction, recentres the orbit target on the element and resizes the
   * frustum / camera distance so the element fills the viewport with a margin.
   */
  fitObjectToView(object: THREE.Object3D) {
    this.fitBoxToView(new THREE.Box3().setFromObject(object));
  }

  /** Fit the frustum + camera to a world-space box (see fitObjectToView). */
  private fitBoxToView(box: THREE.Box3) {
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const radius = maxDim / 2;

    // Depth range scales with the element so nothing is culled by the near/far planes
    const near = Math.max(0.01, radius / 500);
    const far = Math.max(2000, radius * 100);
    this.orthoCam.near = near;
    this.orthoCam.far = far;
    this.perspectiveCam.near = near;
    this.perspectiveCam.far = far;

    // Orthographic frustum covers the element with a margin
    this.frustumSize = maxDim * 1.4;
    if (this.cam instanceof THREE.OrthographicCamera) this.cam.zoom = 1;

    // Orbit around the element centre, keeping the current view direction + roll.
    this.controls.target.copy(center);

    const dir = this.cam.position.clone().sub(this.controls.target);
    // Degenerate case (camera exactly on the target): fall back to a sane dir.
    if (dir.lengthSq() < 1e-12) {
      dir.set(this.viewMode === '2d' ? 0 : 0.65, 1, this.viewMode === '2d' ? 0 : 0.65);
    }
    dir.normalize();
    this.cam.position.copy(center).addScaledVector(dir, radius * 3 + 1);

    // Keep the camera up untouched so double-click zoom never re-rolls the view.
    this.cam.lookAt(center);

    this.handleResize(); // recompute frustum bounds + updateProjectionMatrix
    this.controls.update();
  }

  private lastNodeCount = -1;
  private frameCounter = 0;

  /**
   * Keep the near/far planes in sync with the model size (no repositioning).
   * Runs from the render loop, so drawing/generating/copying large models is never
   * culled by the default far plane (100 on the orthographic camera).
   */
  updateDepthRange() {
    this.frameCounter++;
    const nodes = this.model.nodes as unknown as { x: number; y: number; z: number }[] | undefined;
    const count = nodes?.length ?? 0;
    // Recompute when the node count changes, or periodically (covers node moves)
    if (count !== this.lastNodeCount || this.frameCounter % 30 === 0) {
      this.lastNodeCount = count;
      const box = this.getModelBox();
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 1) / 2;
      const near = Math.max(0.01, radius / 500);
      const far = Math.max(2000, radius * 100);
      if (this.orthoCam.near !== near || this.orthoCam.far !== far) {
        this.orthoCam.near = near;
        this.orthoCam.far = far;
        this.perspectiveCam.near = near;
        this.perspectiveCam.far = far;
        this.cam.updateProjectionMatrix();
      }
    }
  }

  /**
   * Configure OrbitControls mouse bindings + rotation per the active bottom-bar
   * navigation tool:
   * - select: left click reserved for picking / rubber-band selection
   * - pan   : left drag pans
   * - orbit : left drag rotates (switches the view to 3D beforehand in Model)
   * - zoom  : left drag is handled by the ZoomTool, wheel / middle still zoom
   */
  applyNavTool(tool: NavTool) {
    const controls = this.controls;
    controls.enableDamping = false;
    switch (tool) {
      case 'select':
        controls.mouseButtons = {
          LEFT: null,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };
        controls.enableRotate = this.viewMode === '3d';
        break;
      case 'pan':
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };
        controls.enableRotate = false;
        break;
      case 'orbit':
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };
        controls.enableRotate = true;
        break;
      case 'zoom':
        controls.mouseButtons = {
          LEFT: null,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };
        controls.enableRotate = this.viewMode === '3d';
        break;
    }
    controls.update();
  }

  handle3dView(){
    this.viewMode = '3d'
    // Keep the current view pose — enabling orbit must NOT snap the camera to a
    // canonical iso pose. Fit only (re-target + distance) along the current dir.
    if (!this.getModelBox().isEmpty()) {
      this.fitModelKeepOrientation()
    } else {
      this.cam.position.set(20, 30, 20);
    }
    // Normalize the camera up to the world default (nav cube / OrbitControls
    // Y-up convention) so orbiting never inherits a rolled orientation.
    this.cam.up.set(0, 1, 0);
    this.controls.enableDamping = false;
    this.controls.enableRotate = true;
    this.controls.mouseButtons = {
      LEFT: null as any,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    this.cam.layers.enableAll()
    this.applyNavTool(this.model.navTool)
  }
  handle2dView(){
    this.viewMode = '2d'
    this.model.snapper.enable()
    this.controls.enableRotate = false;
    // Normalize the camera up to the world default (see alignToPlane): with the
    // camera exactly above the target, lookAt() still yields the "-Z up on
    // screen" plan orientation via its degenerate branch.
    this.cam.up.set(0, 1, 0);
    // Fit to the model when one exists (prevents far-plane culling on large models)
    if (!this.getModelBox().isEmpty()) {
      this.fitModelToView();
      this.applyNavTool(this.model.navTool)
      return;
    }
    this.cam.position.set(0, 50, 0) 
    this.cam.lookAt(0, 0, 0);       
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.applyNavTool(this.model.navTool)
  }

  /**
   * Look straight at a working plane: positions the camera along the plane's
   * normal (plan-like view of that plane) and orbits around a point ON that
   * plane. No model-fit is performed so an existing zoom/frustum is preserved.
   *
   * IMPORTANT — camera.up is ALWAYS kept at the world default (0,1,0). The nav
   * cube (three-viewport-gizmo) computes every face-click orientation and its
   * cube-drag in the world Y-up convention, while OrbitControls re-derives the
   * orientation from `camera.up` on every update(). Mutating `up` (e.g. to
   * (0,0,-1) for a horizontal plan) makes the two conventions fight each frame:
   * the view rolls/spins after every cube click and Home cannot win the race.
   * For a horizontal plan the camera sits exactly along +Y above the target, so
   * lookAt() takes three.js' degenerate branch which still yields the wanted
   * "-Z up on screen" plan orientation deterministically.
   */
  alignToPlane(normal: THREE.Vector3, origin: THREE.Vector3) {
    this.viewMode = '2d'
    this.controls.enableRotate = false
    this.model.snapper.enable()
    const n = normal.clone().normalize()
    this.cam.up.set(0, 1, 0)
    const dist = Math.max(30, this.frustumSize * 2)
    this.cam.position.copy(origin).addScaledVector(n, dist)
    this.cam.lookAt(origin)
    this.controls.target.copy(origin)
    this.controls.update()
  }
}

export default Camera