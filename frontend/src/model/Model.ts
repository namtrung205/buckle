import * as THREE from "three";
import { ViewportGizmo } from "three-viewport-gizmo";
import { 
  Node, 
  Camera, 
  Selector, 
  Labeler , 
  GridHelper, 
  Light, 
  PostProcessing,
  Snapper,
  Line,
  ElasticBeamColumn,
  Console,
  Visibility,
  WebSocketHandler,
  Shell
} from "./index";
import ReactionViz from "./PostProcessing/ReactionViz";
import { makeAutoObservable } from "mobx";
import { Material, mockMaterials, mockSections, Section, NavTool } from "../types";
import { GUI } from "lil-gui";
import { Line3D, Member, Level, mockLevels } from "../types";
import BoundaryCondition from "./BoundaryCondition/BoundaryCondition";
import Load from "./Load/Load";
import { buildModelOnjson } from "../helpers";
import ToolsController from "./Geometry/Tools/Controller";
import ZoomTool from "./Geometry/Tools/Zoom";
import { preloadToolCursors, toolCursor } from "./Utils/CursorIcons";
export type PointerCoords = {
  x: number;
  y: number;
  z: number;
};

const SIZE_VECTOR = new THREE.Vector2()



export class Model {
  private static instance: Model | null = null;

  enabled = true
  showVolumes = true
  public scene = new THREE.Scene()
  public camera : Camera
  public renderer =  new THREE.WebGLRenderer();
  public container !: HTMLDivElement
  pointerCoords: THREE.Vector3;
  worldPlane : THREE.Plane;
  snapper : Snapper
  selector : Selector
  gizmo : ViewportGizmo
  canvas : HTMLCanvasElement
  // axes : Axes
  nodes : Node[]
  members : Member[]
  shells : Shell[] = []
  boundaryConditions : BoundaryCondition[] = []
  // lines : Line3D[]
  gridHelper : GridHelper
  layer : number
  light : Light
  levels : Level[]
  postProcessing : PostProcessing
  reactionViz : ReactionViz
  labeler : Labeler
  loads : Load[] = []
  output : any
  sections : Section[] = mockSections
  materials : Material[] = mockMaterials
  gui : GUI | null = null
  toolsController : ToolsController = new ToolsController()
  console : Console = new Console()
  visibility : Visibility
  contextMenu = {
    visible: false,
    x: 0,
    y: 0,
  }
  activeDialog: string | null = null;
  // Results lock: true after a successful analysis — model editing is disabled until unlocked
  isLocked: boolean = false;
  // Right dock panel state: which entity is being edited inline, and whether the
  // dock is open. These are observable so the dock and any trigger stay in sync.
  rightPanelOpen = true;
  selectedMemberId: number | null = null;
  selectedNodeId: number | null = null;
  selectedBoundaryConditionId: number | null = null;
  selectedLoadId: number | null = null;
  selectedMemberDialogs = {
    section: false,
    material: false,
  };

  // Right dock width (px) — kept in sync with RightPanel.tsx so the viewport
  // gizmo (ViewCube) can be shifted clear of the dock when it is visible.
  static readonly RIGHT_PANEL_WIDTH = 332;
  private static readonly GIZMO_RIGHT_BASE = 60;
  private static readonly GIZMO_BOTTOM = 80;
  // Canonical ViewCube options; replayed whole on reposition so `ViewportGizmo.set`
  // (which REPLACES options rather than merging) keeps cube/placement/size intact.
  private gizmoOptions = {
    type: "cube" as const,
    placement: "bottom-right" as const,
    size: 100,
    offset: { right: Model.GIZMO_RIGHT_BASE, bottom: Model.GIZMO_BOTTOM },
  };

  /** Reposition the ViewCube so it is never hidden behind the right dock. */
  private updateGizmoOffset = () => {
    if (!this.gizmo) return;
    const dockOpen = this.rightPanelOpen && (this.hasFocus() || this.activeDialog === 'results' || this.activeDialog === 'reactions' || this.activeDialog === 'draw');
    const right = Model.GIZMO_RIGHT_BASE + (dockOpen ? Model.RIGHT_PANEL_WIDTH : 0);
    if (right !== this.gizmoOptions.offset.right) {
      this.gizmoOptions.offset.right = right;
      this.gizmo.set({ ...this.gizmoOptions, offset: { ...this.gizmoOptions.offset } });
    }
  };

  /** Focus an entity in the right dock (member or node, by id). */
  focusMember = (id: number | null) => {
    this.selectedMemberId = id;
    if (id != null) { this.selectedNodeId = null; this.selectedBoundaryConditionId = null; this.selectedLoadId = null; this.exitResults(); }
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  focusNode = (id: number | null) => {
    this.selectedNodeId = id;
    if (id != null) { this.selectedMemberId = null; this.selectedBoundaryConditionId = null; this.selectedLoadId = null; this.exitResults(); }
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Focus a support / boundary condition in the right dock, by id. */
  focusBoundaryCondition = (id: number | null) => {
    this.selectedBoundaryConditionId = id;
    if (id != null) { this.selectedMemberId = null; this.selectedNodeId = null; this.selectedLoadId = null; this.exitResults(); }
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Focus a load in the right dock, by id. */
  focusLoad = (id: number | null) => {
    this.selectedLoadId = id;
    if (id != null) { this.selectedMemberId = null; this.selectedNodeId = null; this.selectedBoundaryConditionId = null; this.exitResults(); }
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Leave the results dock mode when an entity takes focus (returns to Properties). */
  private exitResults = () => {
    if (this.activeDialog === 'results' || this.activeDialog === 'reactions') this.activeDialog = null;
  };

  /** True when any entity is focused for right-dock editing. */
  hasFocus = () =>
    this.selectedMemberId != null ||
    this.selectedNodeId != null ||
    this.selectedBoundaryConditionId != null ||
    this.selectedLoadId != null;

  /** Clear the focused entity (closes the right dock). */
  clearFocus = () => {
    this.selectedMemberId = null;
    this.selectedNodeId = null;
    this.selectedBoundaryConditionId = null;
    this.selectedLoadId = null;
    this.updateGizmoOffset();
  };

  /** Resolve a viewport-picked mesh → its owning member/node id and focus it. */
  focusFromSelection = () => {
    const sel = this.selector.selected?.[this.selector.selected.length - 1];
    if (!sel) return;
    let obj: THREE.Object3D = sel.object;
    // climb to the typed group carrying the entity id (member group / node mesh)
    if (obj.parent instanceof THREE.Group && (obj.parent.userData as any)?.id != null) {
      obj = obj.parent;
    }
    const ud = (obj.userData || {}) as any;
    if (ud.type === 'node' && ud.id != null) this.focusNode(ud.id);
    else if (ud.type === 'load' && typeof ud.id === 'string') {
      // Load meshes carry a compound id: `load-<loadId>-<targetId>`.
      const parts = String(ud.id).split('-');
      const numeric = parts.map((p: string) => Number(p)).find((n: number) => !Number.isNaN(n));
      if (parts[0] === 'load' && parts[1] != null && !Number.isNaN(Number(parts[1]))) {
        this.focusLoad(Number(parts[1]));
      } else if (numeric != null) {
        this.focusLoad(numeric);
      }
    } else if (ud.id != null) this.focusMember(ud.id);
  };

  /**
   * Create a default entity and focus it in the right dock for inline editing.
   * These replace the old floating "New X" dialogs: the entity is instantiated
   * with sensible defaults and the dock takes over for the remaining inputs.
   */

  /** Create a blank nodal load (no targets, zero magnitude) and focus it. */
  addNewLoad = () => {
    const load = new Load(this, {
      id: Math.floor(Math.random() * 0x7fffffff),
      name: `Load ${this.loads.length + 1}`,
      type: 'nodal',
      targets: [],
      value: new THREE.Vector3(0, 0, 0),
    } as any);
    load.createOrUpdate();
    this.focusLoad(load.id);
  };

  /** Create a fixed support with no targets yet, then focus it. */
  addNewSupport = () => {
    const bc = new BoundaryCondition(this, {
      id: Math.floor(Math.random() * 0x7fffffff),
      name: `Support ${this.boundaryConditions.length + 1}`,
      type: 'fixed',
      targets: [],
    } as any);
    bc.createOrUpdate();
    this.focusBoundaryCondition(bc.id);
  };

  /** Create a node at the origin and focus it. */
  addNewNode = () => {
    const node = new Node(new THREE.Vector3(0, 0, 0), undefined);
    node.model = this;
    node.create();
    this.nodes.push(node);
    this.focusNode(node.id);
  };
  // Active bottom-bar navigation tool (select / zoom / pan / orbit)
  navTool: NavTool = 'select';
  // Zoom navigation tool handling fit / window / drag modes
  zoomTool: ZoomTool;
  private editingDialogs = ['move', 'draw', 'sections', 'loads', 'supports', 'materials', 'copy', 'warehouseWizard'];
  ws : WebSocketHandler = new WebSocketHandler((import.meta.env.VITE_BACKEND_SERVER || 'http://localhost:8000').replace(/^http/, 'ws') + '/ws/1', this)

  closeContextMenu = () => {
    this.contextMenu.visible = false;
  }

  openContextMenu = (x: number, y: number) => {
    this.contextMenu = { visible: true, x, y };
  }

  openDialog = (dialog: string): boolean => {
    // While results are locked, editing dialogs are blocked (view dialogs stay available)
    if (this.isLocked && this.editingDialogs.includes(dialog)) {
      return false;
    }
    this.activeDialog = dialog;
    this.updateGizmoOffset();
    return true;
  }

  /** Lock the model after a successful analysis: results become active, editing is disabled. */
  lockResults = () => {
    this.isLocked = true;
  }

  /** Unlock: wipe all computed results and return to model editing mode. */
  unlockResults = () => {
    this.isLocked = false;
    this.invalidateResults();
    this.selector.clear();
    this.toolsController.deactivate();
    if (this.activeDialog === 'results') this.closeDialog();
  }

  closeDialog = () => {
    const currentTool = this.toolsController.getCurrentTool();
    currentTool?.stop();
    this.activeDialog = null;
    this.updateGizmoOffset();
  }

  /**
   * Switch the active bottom-bar navigation tool. Applying the tool configuration
   * is delegated to applyNavTool so the constructor can share the same path.
   */
  setNavTool = (tool: NavTool) => {
    if (this.navTool === tool) return;
    this.navTool = tool;
    this.applyNavTool();
  }

  /**
   * Sync OrbitControls bindings + the Selector with the active nav tool:
   * - select: picking + rubber-band selection (Selector enabled)
   * - pan / orbit: camera owns the left button (Selector disabled)
   * - zoom  : left drag is handled by the ZoomTool (Selector disabled)
   */
  applyNavTool = () => {
    const tool = this.navTool;
    const camera = this.camera;

    // Stop any active drawing/copy tool so it does not fight the camera gesture
    this.toolsController.deactivate();

    if (tool === 'orbit' && camera.viewMode === '2d') {
      camera.handle3dView();
    }
    camera.applyNavTool(tool);

    if (tool === 'select') {
      this.zoomTool.stop();
      this.selector.enable();
    } else if (tool === 'zoom') {
      this.selector.disable();
      this.zoomTool.start();
    } else {
      // pan / orbit
      this.zoomTool.stop();
      this.selector.disable();
    }

    this.applyCursor();
  }

  /**
   * Reflect the active navigation tool on the canvas cursor:
   * - select : default arrow (used for picking)
   * - pan    : the toolbar's PanTool icon (grab while the cursor rasterises)
   * - orbit  : the toolbar's ThreeDRotation icon (grab while it rasterises)
   * - zoom   : depends on the zoom sub-mode (window = crosshair, drag = ns-resize)
   */
  applyCursor = () => {
    const tool = this.navTool;
    const domElement = this.renderer?.domElement;
    if (!domElement) return;

    let cursor = 'default';
    switch (tool) {
      case 'select':
        cursor = 'default';
        break;
      case 'pan':
        cursor = toolCursor('pan', 'grab');
        break;
      case 'orbit':
        cursor = toolCursor('orbit', 'grab');
        break;
      case 'zoom':
        if (this.zoomTool?.mode === 'window') cursor = 'crosshair';
        else if (this.zoomTool?.mode === 'drag') cursor = 'ns-resize';
        else cursor = 'default';
        break;
    }
    domElement.style.cursor = cursor;
  }

  static getInstance(): Model {
    if (Model.instance === null) {
      Model.instance = new Model();
    }
    return Model.instance;
  }

  set setupEvent(enabled: boolean) {
    if (enabled) {
      this.onResize = this.onResize.bind(this);

      this.updatePointerCoords = this.updatePointerCoords.bind(this);

      window.addEventListener("resize", this.onResize);
      window.addEventListener('pointermove', this.updatePointerCoords);
    } else {
      window.removeEventListener("resize", this.onResize);
    }
  }

  private constructor() {
    this.camera = new Camera(this)
    this.gridHelper = new GridHelper(this.scene)
    this.light = new Light(this.scene)
    this.pointerCoords =  new THREE.Vector3(0,0,0,)
    this.worldPlane =  new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    
    this.snapper = new Snapper(this)
 
    this.update()
    this.init()
    this.setupEvent = true;
    
    this.selector = new Selector(this); 
    this.toolsController.canActivate = () => !this.isLocked;
    this.zoomTool = new ZoomTool(this);
    
    // this.axes = new Axes(this)  
    this.canvas = document.querySelector('canvas') as HTMLCanvasElement
    this.levels = mockLevels
    this.postProcessing = new PostProcessing(this)
    this.labeler = new Labeler(this)
    this.reactionViz = new ReactionViz(this)
    // this.sections = new Sections(this)
    this.gizmo = new ViewportGizmo(
      this.camera.cam, 
      this.renderer, 
      this.gizmoOptions,
    )
    this.gizmo.attachControls(this.camera.controls);
    this.nodes = []
    this.members = []
    this.shells = []
    this.layer = 0
    this.visibility = new Visibility(this)
    // buildModelOnjson(this, '/examples/ipe330-cantilever-beam.json')
    // buildModelOnjson(this, '/examples/concrete-frame-nodal-load.json')
    makeAutoObservable(this)

    // Rasterise the pan / orbit toolbar icons into custom PNG cursors up front,
    // then re-apply so an already-active tool picks them up as soon as ready.
    void preloadToolCursors().then(() => this.applyCursor());
    
  }

  async init()
  {
    try {
      this.container = document.getElementById('app-container') as HTMLDivElement
      this.renderer.setSize( window.innerWidth, window.innerHeight );
      this.container?.appendChild( this.renderer.domElement )
      this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
      // AutoCAD-style dark blue-black viewport background
      this.scene.background = new THREE.Color('#212830');
      await this.ws.connect();
      if (this.ws.isConnected())  console.log('Connected!');
      
    } catch (error) {
      console.log('init error', error)
    }
  }

  /** Convert an on-screen pixel length at a world position into world units. */
  pixelToWorld(position: THREE.Vector3, pixels: number): number {
    const cam = this.camera.cam
    const height = this.renderer.getSize(SIZE_VECTOR).y || 1
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const ortho = cam as THREE.OrthographicCamera
      return (pixels * ((ortho.top - ortho.bottom) / (ortho.zoom || 1))) / height
    }
    const perspective = cam as THREE.PerspectiveCamera
    const distance = Math.max(perspective.position.distanceTo(position), 1e-3)
    return (pixels * 2 * distance * Math.tan((perspective.fov * Math.PI) / 360)) / height
  }

  private onResize = () => 

  {
    this.camera.handleResize()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.gizmo.update()
    this.labeler.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private update = () => {
    this.camera.updateDepthRange(); // keep near/far in sync with model growth (prevents culling)
    this.camera.cam.updateProjectionMatrix();
    this.reactionViz?.onFrame();
    this.nodes?.forEach((node: any) => node.updateScreenScale?.());
    this.renderer.render(this.scene, this.camera.cam);
    this.camera.controls.update()
    this.camera.directionalLight.target.position.copy(this.camera.controls.target)
    this.camera.directionalLight.target.updateMatrixWorld()
    requestAnimationFrame(this.update);
    this.gizmo?.render()
    this.labeler?.renderer.render(this.scene, this.camera.cam)
  }

  public dispose = () => {
    function removeObjWithChildren(obj : any) {
      if (obj.children.length > 0) {
        for (var x = obj.children.length - 1; x >= 0; x--) {
          removeObjWithChildren(obj.children[x])
        }
      }
      if (obj.isMesh) {
        obj.geometry.dispose();
        if( Array.isArray(obj.material)){
          for(let i = 0; i < obj.material.length; i++){
            obj.material[i].dispose()
          }
        }else{
          obj.material.dispose();
        }
      }
      if (obj.parent) {
        obj.parent.remove(obj)
      }
    }
    this.scene.traverse(function(obj) {
      removeObjWithChildren(obj)
    });
    this.container.removeChild(this.renderer.domElement)
    this.selector.dispose()
    this.labeler.dispose()
    this.gizmo.dispose()
    this.removeListeners()
    this.zoomTool.stop()
    this.toolsController.dispose()
    // Disconnect when done
    this.ws.disconnect();

    // Reset singleton instance
    Model.instance = null;
  }
  public removeListeners = () => { 
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('pointermove', this.updatePointerCoords)
  }

  public clear = () => {
    // Clear all existing model data
    console.log('Clearing existing this...')
    
    // Dispose of all loads
    this.loads.forEach(load => load.dispose())
    this.loads = []
    
    // Dispose of all boundary conditions
    this.boundaryConditions.forEach(bc => bc.delete())
    this.boundaryConditions = []
    
    // Dispose of all members
    console.log('MEMBERS TO DISPOSE', this.members.length)
    const members = [...this.members]
    members.forEach(member => {
      console.log('disposing', member)
      member.remove()
    })
    this.members = []
    
    // Dispose of all shells
    const shells = [...this.shells]
    shells.forEach(shell => shell.remove())
    this.shells = []
    
    // Dispose of all nodes
    // Create a copy of the array to avoid issues when dispose() modifies the original array
    const nodes = [...this.nodes]
    nodes.forEach(node => node.dispose())
    this.nodes = []
    
    // Clear post processing
    this.postProcessing.dispose()
    this.reactionViz.dispose()
    
    // Clear labeler
    this.labeler.deleteAll('effort')
    
    console.log('Model cleared successfully')
  }

  public invalidateResults = () => {
    this.postProcessing.dispose()
    this.reactionViz.dispose()
    this.output = null
  }

  updatePointerCoords = (event : MouseEvent) =>
  {

    const mouseLoc =  this.getMouseLocation(event)
    this.pointerCoords = new THREE.Vector3(mouseLoc.x, mouseLoc.y, this.pointerCoords.z);
    if(this.snapper.enabled){
      this.snapper.update()
    }
  }

  getMouseLocation ( event : MouseEvent ) {
      
      const canvas = document.querySelector('canvas')
      const rect = canvas!.getBoundingClientRect();
      const _vec2 = new THREE.Vector2();
      _vec2.x = (( ( event.clientX - rect.left ) / ( rect.right - rect.left ) ) * 2 - 1);
      _vec2.y =  -( ( event.clientY - rect.top ) / ( rect.bottom - rect.top) ) * 2 + 1;

      return _vec2
  }

  handleLevelChange(level: Level) {
    if(this.camera.viewMode === '3d') {
      this.camera.handle2dView()
      this.gridHelper.show()
    }
    const elevation = level.value
    this.worldPlane.constant = -elevation
    this.gridHelper.grid.position.y = elevation -0.005
    this.layer = this.levels.findIndex(l => l.value === level.value)
    this.snapper.snap?.layers.set(this.layer)
    this.gridHelper.grid.layers.set(this.layer)
    // this.axes.setLayer(this.layer)
    this.camera.cam.layers.set(this.layer)
    // this.light.directionalLight.layers.set(this.layer)

  }
}


export default Model