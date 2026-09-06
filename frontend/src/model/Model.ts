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
  Shell,
  GridSystem,
  WorkingPlane,
  WorkPlaneReferenceVisual,
  LevelVisual,
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
import MemberLineBatch from "./Rendering/MemberLineBatch";
import MemberSolidBatch from "./Rendering/MemberSolidBatch";
import ShellBatch from "./Rendering/ShellBatch";
import NodeBatch from "./Rendering/NodeBatch";
import { preloadToolCursors, toolCursor } from "./Utils/CursorIcons";
export type PointerCoords = {
  x: number;
  y: number;
  z: number;
};

export type ViewerPerformanceSnapshot = {
  fps: number
  frameMsAvg: number
  frameMsP95: number
  frameMsP99: number
  raycastMsLast: number
  raycastMsP95: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  sceneObjects: number
  pickables: number
  labels: number
}

export type ViewerBenchmarkPhase = ViewerPerformanceSnapshot & {
  durationMs: number
  frameSamples: number
  raycastSamples: number
}

export type ViewerBenchmarkReport = {
  benchmarkVersion: string
  timestamp: string
  durationsMs: { warmup: number; idle: number; orbit: number; pointerSweep: number }
  environment: {
    userAgent: string
    logicalProcessors: number | null
    deviceMemoryGb: number | null
    viewport: { width: number; height: number; devicePixelRatio: number }
    gpu: string
  }
  model: { nodes: number; members: number; shells: number; loads: number; labels: number }
  batching: {
    memberSolids: { batches: number; instances: number; mappedEntities: number; activePickProxies: number }
    nodes: { batches: number; instances: number; mappedEntities: number; activePickProxies: number }
    shells: { batches: number; instances: number }
  }
  phases: {
    idle: ViewerBenchmarkPhase
    orbit: ViewerBenchmarkPhase
    pointerSweep: ViewerBenchmarkPhase
  }
}

const SIZE_VECTOR = new THREE.Vector2()



export class Model {
  private static instance: Model | null = null;

  enabled = true
  showVolumes = true
  /** On-screen FPS readout toggle (Settings → View → Show FPS). */
  showFps = false
  /** Last measured frame rate, refreshed ~2×/s from the render loop (0 = not
   *  measured yet). Kept as a low-frequency observable so the HUD re-render
   *  cost stays negligible. */
  fps = 0
  public scene = new THREE.Scene()
  public camera : Camera
  public renderer =  new THREE.WebGLRenderer();
  public container !: HTMLDivElement
  /** Watches #app-container so the canvas re-fits when a side panel opens/closes. */
  private containerResizeObserver: ResizeObserver | null = null
  /** Render-loop counter for the periodic container-size safety check. */
  private containerSyncCounter: number = 0
  /** FPS meter state — a ~500 ms rolling window, not per-frame writes, so the
   *  observable `fps` only changes a couple times per second (the HUD is an
   *  observer; we do not want it to re-render 60×/s). Not `private` so the
   *  mobx `makeAutoObservable` overrides below can reference them in TS. */
  fpsFrameCount = 0
  fpsAccumMs = 0
  fpsLastFrameTime = 0
  /** Rolling telemetry used to establish repeatable large-model baselines. */
  performanceSnapshot: ViewerPerformanceSnapshot = {
    fps: 0,
    frameMsAvg: 0,
    frameMsP95: 0,
    frameMsP99: 0,
    raycastMsLast: 0,
    raycastMsP95: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    sceneObjects: 0,
    pickables: 0,
    labels: 0,
  }
  // Public so MobX's annotation map can exclude these hot-path mutable buffers.
  // They remain an internal implementation detail of the telemetry collector.
  performanceFrameSamples: number[] = []
  performanceRaycastSamples: number[] = []
  performanceLastPublish = 0
  performancePickables = 0
  benchmarkRunning = false
  benchmarkPhase = ''
  benchmarkProgress = 0
  benchmarkReport = ''
  pointerCoords: THREE.Vector3;
  worldPlane : THREE.Plane;
  snapper : Snapper
  selector : Selector
  gizmo : ViewportGizmo
  /** Dedicated WebGL renderer for the nav cube. Its canvas is mounted inside the
   *  gizmo's z:1000 overlay div, so cube pixels live ABOVE the CSS2D label layer
   *  (#label-container, z:10) and the shared model canvas (z:0). Without this the
   *  cube was drawn INTO the model canvas via setViewport/setScissor and every
   *  text value / support hexagon painted over it. See rootGizmoCanvas(). */
  private gizmoRenderer!: THREE.WebGLRenderer
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
  // SAP2000/ETABS style structural axis grids
  grids : GridSystem[] = []
  // Active drawing surface — re-orients picking, the square grid and the camera
  workingPlane : WorkingPlane
  // Revit-style level datums rendered in the scene
  levelVisual : LevelVisual
  // Revit-style reference overlay on a vertical grid-axis working plane
  workPlaneReferenceVisual : WorkPlaneReferenceVisual
  gui : GUI | null = null
  toolsController : ToolsController = new ToolsController()
  console : Console = new Console()
  visibility : Visibility
  memberLineBatch : MemberLineBatch
  memberSolidBatch : MemberSolidBatch
  shellBatch : ShellBatch
  nodeBatch : NodeBatch
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
  // Members being batch-edited in the right dock (context menu "Edit element(s)").
  // Empty = single-edit mode (only the focused member is touched).
  editingMemberIds: number[] = [];
  selectedNodeId: number | null = null;
  selectedBoundaryConditionId: number | null = null;
  selectedLoadId: number | null = null;
  // "New entity" draft mode: the right dock shows a blank load/support form
  // WITHOUT any entity existing in the model yet. Only Apply (in RightPanel)
  // validates the draft and creates the entity — until then nothing is added
  // to model.loads / model.boundaryConditions (the model tree stays clean).
  newEntityDraft: 'load' | 'support' | null = null;
  // Bumped every time a new-entity draft opens so the dock re-seeds a blank
  // draft even when the same ribbon button is pressed twice in a row.
  newEntityDraftNonce: number = 0;
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
    // The canvas now sizes itself to the visible viewer cell (between the left
    // bar and the right dock), so side panels never overlap it — the gizmo only
    // needs its base offset from the canvas' own right edge.
    const right = Model.GIZMO_RIGHT_BASE;
    if (right !== this.gizmoOptions.offset.right) {
      this.gizmoOptions.offset.right = right;
      // `ViewportGizmo.set()` regenerates the whole widget and — because its
      // internal `dispose()` detaches controls and clears the internal
      // `_controls` ref — the `this._controls && this.attachControls(...)` inside
      // `set()` is a no-op. The widget is therefore left without its OrbitControls
      // binding (its `target` goes stale and face-click camera animation breaks).
      // Re-attach controls right after every rebuild to keep the cube functional.
      this.gizmo.set({
        ...this.gizmoOptions,
        // Keep the overlay anchored to the visible canvas cell on rebuilds too.
        container: this.container,
        offset: { ...this.gizmoOptions.offset },
      });
      this.gizmo.attachControls(this.camera.controls);
      // `set()` just replaced the overlay div (and any canvas mounted inside it)
      // — re-mount the dedicated nav-cube canvas into the new overlay.
      this.rootGizmoCanvas();
    }
  };

  /**
   * Mount the nav-cube's dedicated WebGL canvas inside the gizmo's DOM overlay
   * (the transparent z:1000 hit-area div) and recompute the cube viewport.
   *
   * WHY: three-viewport-gizmo normally renders the cube INTO the main model
   * canvas via setViewport/setScissor (z:0), so CSS2D labels (#label-container,
   * z:10) always painted OVER the cube-nav. Giving the gizmo its own mini
   * renderer moves the cube pixels into the overlay div (z:1000) — above every
   * text value / support hexagon — while pointer hit-testing (face click /
   * drag / hover) still runs on the overlay div itself (the canvas is
   * pointer-events:none).
   *
   * MUST be re-run after every `gizmo.set()` because the rebuild replaces the
   * overlay div and detaches the canvas from it.
   */
  private rootGizmoCanvas = () => {
    const overlay = (this.gizmo as unknown as { _domElement?: HTMLDivElement })?._domElement
    if (!overlay || !this.gizmoRenderer) return
    const canvas = this.gizmoRenderer.domElement
    // Fill the overlay exactly — the cube drawing buffer is sized in CSS px
    // (setSize(size, size, false)) so the two rects match 1:1 and the gizmo's
    // internal viewport math stays correct on any devicePixelRatio.
    canvas.style.position = 'absolute'
    canvas.style.inset = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    // The overlay div owns every pointer event for the cube.
    canvas.style.pointerEvents = 'none'
    if (canvas.parentElement !== overlay) overlay.appendChild(canvas)
    // domUpdate() inside the last set() ran BEFORE the canvas was rooted here,
    // so the stored cube viewport rect is stale — recompute it now that the
    // canvas rect matches the overlay rect.
    this.gizmo.update()
  };

  /** Focus an entity in the right dock (member or node, by id). */
  focusMember = (id: number | null) => {
    this.selectedMemberId = id;
    this.editingMemberIds = [];
    if (id != null) { this.selectedNodeId = null; this.selectedBoundaryConditionId = null; this.selectedLoadId = null; this.exitResults(); }
    this.newEntityDraft = null;
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Open the right dock to edit a batch of members at once (context menu
   *  "Edit element(s)"): shows the first member's properties, and applies
   *  section / rotation / release changes to every member in the batch. */
  editMembers = (ids: number[]) => {
    if (!ids.length) return;
    this.focusMember(ids[0]);
    this.editingMemberIds = [...ids];
  };

  focusNode = (id: number | null) => {
    this.selectedNodeId = id;
    if (id != null) { this.selectedMemberId = null; this.selectedBoundaryConditionId = null; this.selectedLoadId = null; this.exitResults(); }
    this.newEntityDraft = null;
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Focus a support / boundary condition in the right dock, by id. */
  focusBoundaryCondition = (id: number | null) => {
    this.selectedBoundaryConditionId = id;
    if (id != null) { this.selectedMemberId = null; this.selectedNodeId = null; this.selectedLoadId = null; this.exitResults(); }
    this.newEntityDraft = null;
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Focus a load in the right dock, by id. */
  focusLoad = (id: number | null) => {
    this.selectedLoadId = id;
    if (id != null) { this.selectedMemberId = null; this.selectedNodeId = null; this.selectedBoundaryConditionId = null; this.exitResults(); }
    this.newEntityDraft = null;
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Leave the results dock mode when an entity takes focus (returns to Properties). */
  private exitResults = () => {
    if (this.activeDialog === 'results' || this.activeDialog === 'reactions') {
      this.activeDialog = null;
      // Back to model editing — restore the member centre lines / sections /
      // loads that the result view had hidden.
      this.visibility.restoreModelView();
    }
  };

  /** True when any entity is focused for right-dock editing (draft mode included). */
  hasFocus = () =>
    this.selectedMemberId != null ||
    this.selectedNodeId != null ||
    this.selectedBoundaryConditionId != null ||
    this.selectedLoadId != null ||
    this.newEntityDraft != null;

  /** Clear the focused entity (closes the right dock and any new-entity draft). */
  clearFocus = () => {
    this.selectedMemberId = null;
    this.editingMemberIds = [];
    this.selectedNodeId = null;
    this.selectedBoundaryConditionId = null;
    this.selectedLoadId = null;
    this.newEntityDraft = null;
    this.updateGizmoOffset();
  };

  /**
   * True when the user has set a working plane (axes / level / grid line / 3
   * picked points). The default 'world' OXY plan means NO workplane is active,
   * so drawing runs in true 3D mode: members can only be created by snapping to
   * existing nodes (never by picking free points on the world grid / plane).
   *
   * Guarded: `workingPlane` is created AFTER the snapper in the constructor,
   * and the snapper's first `update()` runs during that window — treat the
   * uninitialized state as "no workplane" (3D mode).
   */
  get hasActiveWorkPlane(): boolean {
    return this.workingPlane ? this.workingPlane.source !== 'world' : false;
  }

  /**
   * Create a default entity and focus it in the right dock for inline editing.
   * These replace the old floating "New X" dialogs: the entity is instantiated
   * with sensible defaults and the dock takes over for the remaining inputs.
   */

  /** Open the right dock with a blank NEW-load draft (nothing added to the
   *  model yet — the load only enters model.loads when the user presses Apply
   *  and its targets validate). */
  addNewLoad = () => {
    this.selectedMemberId = null;
    this.selectedNodeId = null;
    this.selectedBoundaryConditionId = null;
    this.selectedLoadId = null;
    this.exitResults();
    this.newEntityDraft = 'load';
    this.newEntityDraftNonce++;
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Open the right dock with a blank NEW-support draft (nothing added to the
   *  model yet — the support only enters model.boundaryConditions when the user
   *  presses Apply and its targets validate). */
  addNewSupport = () => {
    this.selectedMemberId = null;
    this.selectedNodeId = null;
    this.selectedBoundaryConditionId = null;
    this.selectedLoadId = null;
    this.exitResults();
    this.newEntityDraft = 'support';
    this.newEntityDraftNonce++;
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Collect the node ids currently selected in the viewport. */
  get selectedNodeIds(): number[] {
    return this.selector.selected
      .map((item: any) => {
        const ud = item.object.userData;
        if (ud?.type === 'node') return ud.id;
        if (item.object.parent?.userData?.type === 'node') return item.object.parent.userData.id;
        return null;
      })
      .filter((id: number | null): id is number => id != null);
  }

  /** Collect the member ids currently selected in the viewport. */
  get selectedMemberIds(): number[] {
    return this.selector.selected
      .map((item: any) => {
        const ud = item.object.userData;
        if (ud?.type === 'elasticBeamColumn') return ud.id;
        if (item.object.parent?.userData?.type === 'elasticBeamColumn') return item.object.parent.userData.id;
        return null;
      })
      .filter((id: number | null): id is number => id != null);
  }

  /** Delete the nodes currently selected whose own mesh (or parent) carries a node type. */
  deleteSelectedNodes = () => {
    const ids = new Set(this.selectedNodeIds);
    const nodesToDelete = this.nodes.filter((n) => ids.has(n.id));
    nodesToDelete.forEach((node) => node?.delete());
    this.selector.clear();
  };

  /** Delete the members currently selected whose own mesh (or parent) carries a member type. */
  deleteSelectedMembers = () => {
    const ids = new Set(this.selectedMemberIds);
    const membersToDelete = this.members.filter((m) => ids.has(m.id));
    membersToDelete.forEach((member) => member?.remove());
    this.selector.clear();
  };

  /** Add the currently selected nodes to the selection (used by hover quick-actions). */
  ensureSelected = (nodeIds: number[]) => {
    if (!nodeIds.length) return;
    const selected = new Set(this.selectedNodeIds);
    for (const id of nodeIds) {
      if (selected.has(id)) continue;
      const node = this.nodes.find((n) => n.id === id);
      if (!node) continue;
      this.selector.selected = [...this.selector.selected, {
        object: node.mesh,
        originalColor: ((node.mesh.material as THREE.MeshStandardMaterial)?.color?.getHex?.() ?? 0x0000ff),
      } as any];
    }
  };

  /** Open the right dock with a NEW-support draft targeting the given node ids.
   *  Nothing is created until the user presses Apply in the dock, and Apply then
   *  creates ONE support per node (a multi-node support only supported a single
   *  node during analysis, so each node becomes its own boundary condition). */
  addSupportToNodes = (nodeIds: number[]) => {
    if (!nodeIds.length) return;
    this.ensureSelected(nodeIds);
    this.addNewSupport();
  };

  /** Create a blank nodal load targeting the given node ids and focus it for editing. */
  addNodalLoadToNodes = (nodeIds: number[]) => {
    if (!nodeIds.length) return;
    this.ensureSelected(nodeIds);
    const load = new Load(this, {
      id: Math.floor(Math.random() * 0x7fffffff),
      name: `Load ${this.loads.length + 1}`,
      type: 'nodal',
      targets: nodeIds,
      value: new THREE.Vector3(0, 0, 0),
    } as any);
    load.createOrUpdate();
    this.focusLoad(load.id);
  };

  /** Create a blank linear (distributed) load on the given member ids and focus it for editing. */
  addLinearLoadToMembers = (memberIds: number[]) => {
    if (!memberIds.length) return;
    const load = new Load(this, {
      id: Math.floor(Math.random() * 0x7fffffff),
      name: `Load ${this.loads.length + 1}`,
      type: 'linear',
      targets: memberIds,
      value: new THREE.Vector3(0, 0, 0),
    } as any);
    load.createOrUpdate();
    this.focusLoad(load.id);
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
  private editingDialogs = ['move', 'draw', 'sections', 'loads', 'supports', 'materials', 'copy', 'warehouseWizard', 'grids', 'workplane', 'levels'];
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
    // Remember the model-mode visibility BEFORE any result view hides the
    // member centre lines / solid sections / loads, so unlock can restore it.
    this.visibility.snapshotModelView();
  }

  /** Unlock: wipe all computed results and return to model editing mode. */
  unlockResults = () => {
    this.isLocked = false;
    this.invalidateResults();
    this.selector.clear();
    this.toolsController.deactivate();
    if (this.activeDialog === 'results') this.closeDialog();
    // Bring the model view back: member centre lines (and sections/loads per
    // the pre-results visibility) are restored even if the last result view
    // had hidden them. Idempotent — safe after closeDialog already restored.
    this.visibility.restoreModelView();
  }

  closeDialog = () => {
    const currentTool = this.toolsController.getCurrentTool();
    currentTool?.stop();
    const wasResults = this.activeDialog === 'results' || this.activeDialog === 'reactions';
    this.activeDialog = null;
    // Leaving the results dock returns the model view (member centre lines... )
    if (wasResults) this.visibility.restoreModelView();
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
    this.workingPlane = new WorkingPlane(this)
 
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
    // Visibility must exist before the datum visuals: GridSystem and LevelVisual
    // read the startup show/hide defaults from it (grids & levels start hidden).
    this.visibility = new Visibility(this)
    this.levelVisual = new LevelVisual(this)
    this.workPlaneReferenceVisual = new WorkPlaneReferenceVisual(this)
    this.reactionViz = new ReactionViz(this)
    // this.sections = new Sections(this)
    // Dedicated mini-renderer for the nav cube — its canvas is mounted inside
    // the gizmo's z:1000 overlay (see rootGizmoCanvas), ABOVE the CSS2D label
    // layer (z:10) and the shared model canvas (z:0). Keeping the drawing
    // buffer at CSS-px size (updateStyle:false) makes the gizmo's internal
    // viewport math match the overlay rect 1:1 on any devicePixelRatio.
    this.gizmoRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    this.gizmoRenderer.setPixelRatio(this.renderer.getPixelRatio())
    this.gizmoRenderer.setSize(this.gizmoOptions.size, this.gizmoOptions.size, false)
    this.gizmo = new ViewportGizmo(
      this.camera.cam, 
      this.gizmoRenderer, 
      {
        ...this.gizmoOptions,
        // Critical: point the gizmo's DOM overlay at the VISIBLE canvas cell
        // (#app-container), NOT document.body. The library appends its overlay
        // div to this container and positions it relative to it; with the
        // default body the overlay sat at the window's bottom-right, so when
        // the right dock opened (canvas shrinks) the gizmo's viewport fell
        // outside the canvas and the nav cube vanished under/behind the panel.
        container: this.container,
      },
    )
    this.gizmo.attachControls(this.camera.controls)
    this.rootGizmoCanvas();
    this.nodes = []
    this.members = []
    this.shells = []
    this.memberLineBatch = new MemberLineBatch(this)
    this.memberSolidBatch = new MemberSolidBatch(this)
    this.shellBatch = new ShellBatch(this)
    this.nodeBatch = new NodeBatch(this)
    this.layer = 0
    // buildModelOnjson(this, '/examples/ipe330-cantilever-beam.json')
    // buildModelOnjson(this, '/examples/concrete-frame-nodal-load.json')
    makeAutoObservable(this, {
      fpsFrameCount: false,
      fpsAccumMs: false,
      fpsLastFrameTime: false,
      performanceFrameSamples: false,
      performanceRaycastSamples: false,
      performanceLastPublish: false,
      performancePickables: false,
    })

    // Rasterise the pan / orbit toolbar icons into custom PNG cursors up front,
    // then re-apply so an already-active tool picks them up as soon as ready.
    void preloadToolCursors().then(() => this.applyCursor());
    
  }

  async init()
  {
    try {
      this.container = document.getElementById('app-container') as HTMLDivElement
      // Size the canvas to the VISIBLE viewer area — the flex cell between the
      // left bar and the right dock. A full-window canvas gets clipped by the
      // container (overflow: hidden), which shifted the render centre sideways
      // whenever a side panel was open and made Zoom-Fit look off-centre.
      const width = this.container?.clientWidth || window.innerWidth
      const height = this.container?.clientHeight || window.innerHeight
      this.renderer.setSize( width, height );
      this.container?.appendChild( this.renderer.domElement )
      this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
      this.camera.handleResize();
      // The visible area also changes WITHOUT a window resize (left bar
      // collapse, right dock open/close) — watch the container itself.
      if (typeof ResizeObserver !== 'undefined' && this.container) {
        this.containerResizeObserver = new ResizeObserver(() => this.onResize());
        this.containerResizeObserver.observe(this.container);
      }
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
    const width = this.container?.clientWidth || window.innerWidth
    const height = this.container?.clientHeight || window.innerHeight
    this.camera.handleResize()
    this.renderer.setSize(width, height)
    this.gizmo.update()
    this.labeler.renderer.setSize(width, height)
    this.memberLineBatch?.updateResolution()
  }

  private update = () => {
    // FPS meter (Settings → View → Show FPS): smooth over a ~500 ms window.
    // The first frame only seeds the baseline so the initial sample is not
    // polluted by the time spent before the loop started.
    const now = performance.now()
    if (this.fpsLastFrameTime) {
      const frameMs = now - this.fpsLastFrameTime
      this.fpsFrameCount++
      this.fpsAccumMs += frameMs
      // Keep a bounded ~5 second window at 60 FPS. Sorting only happens when
      // publishing the HUD, never on every animation frame.
      if (this.showFps) {
        this.performanceFrameSamples.push(frameMs)
        if (this.performanceFrameSamples.length > 300) this.performanceFrameSamples.shift()
      }
      if (this.fpsAccumMs >= 500) {
        this.fps = Math.round((this.fpsFrameCount * 1000) / this.fpsAccumMs)
        this.fpsFrameCount = 0
        this.fpsAccumMs = 0
      }
    }
    this.fpsLastFrameTime = now
    // Safety-net: keep the canvas matched to the visible viewer cell even if
    // the ResizeObserver missed a layout change (right dock open/close, left
    // bar collapse). A stale oversized canvas pushed its bottom-right corner —
    // the nav cube — outside the clipped container, "hiding" the gizmo.
    this.containerSyncCounter++;
    if (this.containerSyncCounter % 20 === 0 && this.container) {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      const size = this.renderer.getSize(SIZE_VECTOR);
      if (width > 0 && height > 0 && (size.x !== width || size.y !== height)) {
        this.onResize();
      }
    }
    this.camera.updateDepthRange(); // keep near/far in sync with model growth (prevents culling)
    this.camera.updateOrbitTargetMarker(); // orbit pivot bubble follows the target
    this.camera.cam.updateProjectionMatrix();
    this.reactionViz?.onFrame();
    this.nodes?.forEach((node: any) => node.updateScreenScale?.());
    this.nodeBatch?.syncMatrices()
    // Grid end bubbles keep a constant on-screen size, just like the nodes.
    this.grids?.forEach((grid) => grid.updateScreenScale());
    this.renderer.render(this.scene, this.camera.cam);
    this.publishPerformanceSnapshot(now)
    // While the nav cube animates a face-click it owns the camera pose; a
    // concurrent OrbitControls update() would re-roll the orientation mid-flight.
    if (!this.gizmo?.animating) this.camera.controls.update()
    this.camera.directionalLight.target.position.copy(this.camera.controls.target)
    this.camera.directionalLight.target.updateMatrixWorld()
    requestAnimationFrame(this.update);
    this.gizmo?.render()
    this.labeler?.renderer.render(this.scene, this.camera.cam)
  }

  /** Record picking cost without making pointer-move state observable. */
  recordRaycastPerformance(durationMs: number, pickables: number) {
    if (!this.showFps) return
    this.performancePickables = pickables
    this.performanceRaycastSamples.push(durationMs)
    if (this.performanceRaycastSamples.length > 120) this.performanceRaycastSamples.shift()
  }

  private percentile(samples: number[], percentile: number): number {
    if (!samples.length) return 0
    const sorted = [...samples].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1)
    return sorted[Math.max(0, index)]
  }

  /** Publish at 2 Hz so the diagnostics UI itself has negligible overhead. */
  private publishPerformanceSnapshot(now: number) {
    if (!this.showFps) {
      // Avoid scene traversal, sorting and allocations when diagnostics are off.
      this.performanceFrameSamples.length = 0
      this.performanceRaycastSamples.length = 0
      return
    }
    if (now - this.performanceLastPublish < 500) return
    this.performanceLastPublish = now

    let sceneObjects = 0
    this.scene.traverse(() => { sceneObjects++ })
    const frames = this.performanceFrameSamples
    const avg = frames.length ? frames.reduce((sum, value) => sum + value, 0) / frames.length : 0
    const raycasts = this.performanceRaycastSamples
    const info = this.renderer.info

    this.performanceSnapshot = {
      fps: this.fps,
      frameMsAvg: Number(avg.toFixed(2)),
      frameMsP95: Number(this.percentile(frames, 0.95).toFixed(2)),
      frameMsP99: Number(this.percentile(frames, 0.99).toFixed(2)),
      raycastMsLast: Number((raycasts[raycasts.length - 1] ?? 0).toFixed(2)),
      raycastMsP95: Number(this.percentile(raycasts, 0.95).toFixed(2)),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      sceneObjects,
      pickables: this.performancePickables,
      labels: this.labeler?.count ?? 0,
    }
  }

  private resetBenchmarkSamples() {
    this.performanceFrameSamples.length = 0
    this.performanceRaycastSamples.length = 0
    this.performancePickables = 0
  }

  private waitForBenchmarkPhase(durationMs: number, onFrame?: (elapsedMs: number) => void): Promise<void> {
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

  private updateBenchmarkProgress(value: number) {
    const rounded = Math.max(0, Math.min(100, Math.round(value)))
    if (rounded !== this.benchmarkProgress) this.benchmarkProgress = rounded
  }

  private captureBenchmarkPhase(durationMs: number): ViewerBenchmarkPhase {
    const frames = this.performanceFrameSamples
    const raycasts = this.performanceRaycastSamples
    const avg = frames.length ? frames.reduce((sum, value) => sum + value, 0) / frames.length : 0
    let sceneObjects = 0
    this.scene.traverse(() => { sceneObjects++ })
    const info = this.renderer.info
    return {
      fps: avg > 0 ? Number((1000 / avg).toFixed(1)) : 0,
      frameMsAvg: Number(avg.toFixed(2)),
      frameMsP95: Number(this.percentile(frames, 0.95).toFixed(2)),
      frameMsP99: Number(this.percentile(frames, 0.99).toFixed(2)),
      raycastMsLast: Number((raycasts[raycasts.length - 1] ?? 0).toFixed(2)),
      raycastMsP95: Number(this.percentile(raycasts, 0.95).toFixed(2)),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      sceneObjects,
      pickables: this.performancePickables,
      labels: this.labeler?.count ?? 0,
      durationMs,
      frameSamples: frames.length,
      raycastSamples: raycasts.length,
    }
  }

  private getGpuDescription(): string {
    try {
      const gl = this.renderer.getContext()
      const extension = gl.getExtension('WEBGL_debug_renderer_info')
      return extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
    } catch {
      return 'unavailable'
    }
  }

  /**
   * Deterministic in-app benchmark used before/after every viewer optimization.
   * It intentionally exercises the existing render and selector code paths;
   * no browser event synthesis or external automation is required.
   */
  async runPerformanceBenchmark(): Promise<string> {
    if (this.benchmarkRunning) return this.benchmarkReport

    const durations = { warmup: 1500, idle: 3000, orbit: 3000, pointerSweep: 3000 }
    const cam = this.camera.cam
    const controls = this.camera.controls
    const original = {
      position: cam.position.clone(),
      quaternion: cam.quaternion.clone(),
      up: cam.up.clone(),
      target: controls.target.clone(),
      controlsEnabled: controls.enabled,
      hoverEnabled: this.selector.enableHover,
      showFps: this.showFps,
      pointer: this.pointerCoords.clone(),
    }

    this.benchmarkRunning = true
    this.benchmarkReport = ''
    this.showFps = true
    controls.enabled = false

    try {
      this.benchmarkPhase = 'Warmup'
      this.benchmarkProgress = 0
      this.resetBenchmarkSamples()
      await this.waitForBenchmarkPhase(durations.warmup, elapsed => {
        this.updateBenchmarkProgress(Math.min(14, (elapsed / durations.warmup) * 14))
      })

      this.benchmarkPhase = 'Idle'
      this.resetBenchmarkSamples()
      await this.waitForBenchmarkPhase(durations.idle, elapsed => {
        this.updateBenchmarkProgress(14 + Math.min(28, (elapsed / durations.idle) * 28))
      })
      const idle = this.captureBenchmarkPhase(durations.idle)

      this.benchmarkPhase = 'Orbit'
      this.resetBenchmarkSamples()
      const target = controls.target.clone()
      const currentDistance = Math.max(cam.position.distanceTo(target), 10)
      const orbitRadius = currentDistance * 0.8
      const orbitHeight = currentDistance * 0.6
      cam.position.set(target.x + orbitRadius, target.y + orbitHeight, target.z + orbitRadius)
      cam.lookAt(target)
      await this.waitForBenchmarkPhase(durations.orbit, elapsed => {
        const angle = (elapsed / durations.orbit) * Math.PI * 2
        cam.position.set(
          target.x + Math.cos(angle) * orbitRadius,
          target.y + orbitHeight,
          target.z + Math.sin(angle) * orbitRadius,
        )
        cam.lookAt(target)
        this.updateBenchmarkProgress(42 + Math.min(29, (elapsed / durations.orbit) * 29))
      })
      const orbit = this.captureBenchmarkPhase(durations.orbit)

      this.benchmarkPhase = 'Pointer sweep'
      cam.position.copy(original.position)
      cam.quaternion.copy(original.quaternion)
      cam.up.copy(original.up)
      controls.target.copy(original.target)
      cam.updateMatrixWorld()
      this.selector.enableHover = true
      this.resetBenchmarkSamples()
      await this.waitForBenchmarkPhase(durations.pointerSweep, elapsed => {
        const phase = (elapsed / durations.pointerSweep) * Math.PI * 8
        this.pointerCoords.set(Math.sin(phase) * 0.8, Math.sin(phase * 0.57) * 0.7, 0)
        this.selector.onHover()
        this.updateBenchmarkProgress(71 + Math.min(29, (elapsed / durations.pointerSweep) * 29))
      })
      const pointerSweep = this.captureBenchmarkPhase(durations.pointerSweep)

      const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null
      const size = this.renderer.getSize(new THREE.Vector2())
      const report: ViewerBenchmarkReport = {
        benchmarkVersion: 'viewer3d-v2',
        timestamp: new Date().toISOString(),
        durationsMs: durations,
        environment: {
          userAgent: navigator.userAgent,
          logicalProcessors: navigator.hardwareConcurrency || null,
          deviceMemoryGb: memory,
          viewport: { width: size.x, height: size.y, devicePixelRatio: window.devicePixelRatio || 1 },
          gpu: this.getGpuDescription(),
        },
        model: {
          nodes: this.nodes.length,
          members: this.members.length,
          shells: this.shells.length,
          loads: this.loads.length,
          labels: this.labeler?.count ?? 0,
        },
        batching: {
          memberSolids: this.memberSolidBatch.diagnostics,
          nodes: this.nodeBatch.diagnostics,
          shells: this.shellBatch.diagnostics,
        },
        phases: { idle, orbit, pointerSweep },
      }
      this.benchmarkReport = JSON.stringify(report, null, 2)
      console.log('=== BUCKLE VIEWER BENCHMARK START ===\n' + this.benchmarkReport + '\n=== BUCKLE VIEWER BENCHMARK END ===')
      return this.benchmarkReport
    } catch (error) {
      console.error('Viewer benchmark failed', error)
      throw error
    } finally {
      cam.position.copy(original.position)
      cam.quaternion.copy(original.quaternion)
      cam.up.copy(original.up)
      controls.target.copy(original.target)
      controls.enabled = original.controlsEnabled
      this.selector.enableHover = original.hoverEnabled
      this.pointerCoords.copy(original.pointer)
      cam.updateMatrixWorld()
      this.benchmarkProgress = 100
      this.benchmarkPhase = 'Complete'
      this.benchmarkRunning = false
      // Keep diagnostics visible with the completed report. The user may turn
      // it off manually after copying; a pre-existing off state is noted only
      // to avoid silently hiding the result at completion.
      if (original.showFps) this.showFps = true
    }
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
    this.containerResizeObserver?.disconnect()
    this.containerResizeObserver = null
    this.selector.dispose()
    this.labeler.dispose()
    this.levelVisual?.dispose()
    this.workPlaneReferenceVisual?.dispose()
    this.memberLineBatch?.dispose()
    this.memberSolidBatch?.dispose()
    this.shellBatch?.dispose()
    this.nodeBatch?.dispose()
    this.gizmo.dispose()
    // Tear down the dedicated nav-cube canvas + its WebGL context. (The canvas
    // lived inside the gizmo's overlay, which gizmo.dispose() already removed.)
    this.gizmoRenderer?.domElement.remove()
    this.gizmoRenderer?.dispose()
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
    
    // Dispose of grid systems
    const grids = [...this.grids]
    grids.forEach(grid => grid.delete())
    this.grids = []
    
    // Dispose of all nodes
    // Create a copy of the array to avoid issues when dispose() modifies the original array
    const nodes = [...this.nodes]
    nodes.forEach(node => node.dispose())
    this.nodes = []
    
    // Clear post processing
    this.postProcessing.dispose()
    this.reactionViz.dispose()
    this.memberLineBatch.rebuild()
    this.memberSolidBatch.rebuild()
    this.shellBatch.rebuild()
    this.nodeBatch.rebuild()
    
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
    // Level = horizontal working plane at that elevation (aligns grid + picking).
    // alignCamera:false keeps the camera fit/handle2dView behaviour unchanged.
    this.workingPlane.setLevel(elevation, level.label, { alignCamera: false })
    this.layer = this.levels.findIndex(l => l.value === level.value)
    // Revit-style: the structural axis grid follows the active level, so it is
    // shown "through" at every storey plan (and its vertical rise hints span
    // all levels whenever a grid activates a 3D reference).
    this.grids.forEach((grid) => grid.setElevation(elevation))
    this.snapper.snap?.layers.set(this.layer)
    this.gridHelper.grid.layers.set(this.layer)
    // this.axes.setLayer(this.layer)
    this.camera.cam.layers.set(this.layer)
    // this.light.directionalLight.layers.set(this.layer)

  }

  /** Add a level (Revit-style datum) and switch to its plan view. */
  addLevel(level: Level) {
    this.levels.push(level)
    this.handleLevelChange(level)
  }

  /** Update a level's name / elevation in place. */
  updateLevel(oldValue: number, patch: Partial<Level>) {
    const lv = this.levels.find((l) => l.value === oldValue)
    if (lv) Object.assign(lv, patch)
  }

  /** Remove a level datum. Returns false if it is the last remaining level. */
  deleteLevel(value: number): boolean {
    if (this.levels.length <= 1) return false
    this.levels = this.levels.filter((l) => l.value !== value)
    // If the active layer pointed at the deleted level, fall back to the first.
    const active = this.levels[0]
    this.handleLevelChange(active)
    return true
  }
}


export default Model
