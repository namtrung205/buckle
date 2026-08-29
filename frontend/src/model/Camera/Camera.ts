import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import Model from '../Model';
import { ViewportGizmo } from 'three-viewport-gizmo';
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
    this.controls.enableDamping = true;
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

  handle3dView(){
    this.viewMode = '3d'
    // Fit to the model when one exists (prevents far-plane culling on large models)
    if (!this.getModelBox().isEmpty()) {
      this.fitModelToView();
    } else {
      this.cam.position.set(20, 30, 20);
    }
    this.controls.enableDamping = true;
    this.controls.enableRotate = true;
    this.controls.mouseButtons = {
      LEFT: null as any,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    this.cam.layers.enableAll()
  }
  handle2dView(){
    this.viewMode = '2d'
    this.model.snapper.enable()
    this.controls.enableRotate = false;
    // Fit to the model when one exists (prevents far-plane culling on large models)
    if (!this.getModelBox().isEmpty()) {
      this.fitModelToView();
      return;
    }
    this.cam.position.set(0, 50, 0) 
    this.cam.lookAt(0, 0, 0);       
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
}

export default Camera