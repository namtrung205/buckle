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
import { makeAutoObservable, runInAction } from "mobx";
import { Material, mockMaterials, mockSections, Section, NavTool } from "../types";
import { GUI } from "lil-gui";
import { Member, Level, mockLevels } from "../types";
import BoundaryCondition from "./BoundaryCondition/BoundaryCondition";
import Load from "./Load/Load";
import { buildModelFromJson } from "../helpers";
import ToolsController from "./Geometry/Tools/Controller";
import ZoomTool from "./Geometry/Tools/Zoom";
import { preloadToolCursors, toolCursor } from "./Utils/CursorIcons";
import ViewerBenchmark from "./Benchmark/viewerBenchmark";
import { generateStructuralBenchmarkFixture } from "./Benchmark/structuralFixture";
import {
  isQualityProfile,
  isRenderMode,
  isSelectionMode,
  type QualityProfile,
  type RenderMode,
  type SelectionMode,
} from "./Rendering/contracts";
import { ENTITY_SELECTED, ENTITY_VISIBLE, StructuralSceneDB } from "./Rendering/StructuralSceneDB";
import {
  CommandGateway,
  StructuralDocument,
  type AnalysisSnapshot,
  type CommandEnvelope,
  type CommandGatewayContext,
  type CommandResult,
  type CommandTransactionOperation,
  type EntityReference,
  type SelectionSetKind,
  type SelectionSetRecord,
  type StructuralDocumentSeed,
} from "../core/structural";
import { StructuralDocumentBridge } from "./Rendering/StructuralDocumentBridge";
import { legacyModelToDocumentSeed } from "./Structural/legacyStructuralDocumentAdapter";
import { applyStructuralChangeToLegacy } from "./Structural/StructuralLegacyProjection";
import { WorkspaceContext } from "./Workspace/WorkspaceContext";
import { SHRINK_RATIO_PER_END } from "./Utils/shrink";
import { buildLoadInstances } from "./Load/loadInstances";
import LoadGpuRenderer from "./Rendering/LoadGpuRenderer";
import CenterlineRenderer from "./Rendering/CenterlineRenderer";
import ThinShellRenderer from "./Rendering/ThinShellRenderer";
import StructuralGpuPicker from "./Rendering/StructuralGpuPicker";
import ResultStore, { type ResultBinding } from "./Rendering/ResultStore";
import DiagramRenderer from "./Rendering/DiagramRenderer";
import GpuAnnotations from "./Rendering/GpuAnnotations";
import { estimateSolidTriangles, shouldEvictSolidResources } from "./Rendering/solidResourcePolicy";
import { computeMemberFrame } from "./Rendering/memberFrame";
import type { AnalysisOutput } from '../contracts/structuralModel';
import { AiToolExecutor, type AgentBudget, type ParametricGeneratorBinding } from '../core/ai';
export type PointerCoords = {
  x: number;
  y: number;
  z: number;
};

const SIZE_VECTOR = new THREE.Vector2()

const storedRenderMode = (): RenderMode => {
  const value = typeof localStorage === 'undefined' ? null : localStorage.getItem('buckle.renderMode')
  return isRenderMode(value) ? value : 'solid-extrude'
}

const storedQualityProfile = (): QualityProfile => {
  const value = typeof localStorage === 'undefined' ? null : localStorage.getItem('buckle.qualityProfile')
  return isQualityProfile(value) ? value : 'balanced'
}

const storedSelectionMode = (): SelectionMode => {
  const value = typeof localStorage === 'undefined' ? null : localStorage.getItem('buckle.selectionMode')
  return isSelectionMode(value) ? value : 'element1d'
}



export class Model {
  private static instance: Model | null = null;

  enabled = true
  showVolumes = true
  /** On-screen FPS readout toggle (Settings → View → Show FPS). On by default. */
  showFps = true
  /** Midas-style Shrink display toggle (BottomBar → Shrink). Off by default. */
  shrinkEnabled = false
  /** Viewer/editor canvas background hex (Settings → View → Background). */
  viewerBackground = '#212830'
  /** Goal-0 schema only: legacy rendering remains unchanged until Goal 2. */
  renderMode: RenderMode = storedRenderMode()
  qualityProfile: QualityProfile = storedQualityProfile()
  selectionMode: SelectionMode = storedSelectionMode()
  performanceBenchmark: ViewerBenchmark
  /** Canonical Z-up engineering state. Legacy UI objects are migration adapters. */
  structuralDocument = new StructuralDocument()
  /** The only supported mutation entry point for canonical engineering state. */
  commandGateway = new CommandGateway(this.structuralDocument)
  /** Renderer-facing SoA projection of StructuralDocument. */
  structuralSceneDB = new StructuralSceneDB()
  structuralDocumentBridge = new StructuralDocumentBridge(this.structuralDocument, this.structuralSceneDB)
  workspaceContext = new WorkspaceContext()
  analysisRevision: number | null = null
  analysisSnapshotHash: string | null = null
  resultStore = new ResultStore()
  structuralSceneDBBuildMs = 0
  structuralSceneSyncScheduled = false
  centerlineRenderer: CenterlineRenderer
  thinShellRenderer: ThinShellRenderer
  diagramRenderer: DiagramRenderer
  gpuAnnotations: GpuAnnotations
  loadGpuRenderer: LoadGpuRenderer
  structuralPicker: StructuralGpuPicker
  private activeResultBinding: ResultBinding | null = null
  solidPreparation = { active: false, progress: 0, estimatedTriangles: 0 }
  private solidPreparationToken = 0
  contextLost = false
  /** Last measured frame rate, refreshed ~2×/s from the render loop (0 = not
   *  measured yet). Kept as a low-frequency observable so the HUD re-render
   *  cost stays negligible. */
  fps = 0
  public scene = new THREE.Scene()
  /** Detached as one unit in centerline mode to avoid traversing legacy objects. */
  public legacyStructuralRoot = new THREE.Group()
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
  /** Highest member `index` ever assigned — O(1) source for the next index. */
  memberIndexHighWater = 0
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
  output: AnalysisOutput | null = null
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
  /** Incremented only when the canonical viewport selection changes. Panels
   *  use this to refresh selection-linked targets without re-seeding drafts. */
  workspaceSelectionRevision = 0;
  /** Incremented when the hidden-entity set changes (show/hide commands and
   *  their undo). Tree rows read it to refresh show/hide icons without
   *  observable Sets. */
  workspaceHiddenRevision = 0;
  /** Incremented after every commit that changes the `selectionSets` collection
   *  (including undo/redo). The Selection Sets left-panel tab reads it as a MobX
   *  dependency and re-renders the folder tree from the plain Maps. */
  selectionSetRevision = 0;
  /** True while the right dock is bound to the live viewport selection: every
   *  entity dock and draft follows later selection changes (node/member docks
   *  rebind, support/load targets restage). clearFocus resets it. */
  rightPanelTargetsFollowSelection = false;
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
    this.rightPanelTargetsFollowSelection = true;
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

  /** Keep the right dock bound to the live viewport selection. The member and
   *  node docks rebind to the swept entities (a multi-member sweep turns the
   *  member dock into a batch edit); the support/load docks restage their
   *  targets from the same workspaceSelectionRevision signal in RightPanel.
   *  An empty sweep is a no-op: the dock keeps its current entity and stays
   *  open. */
  private syncSelectionLinkedPanel = () => {
    if (!this.rightPanelOpen || !this.rightPanelTargetsFollowSelection) return;
    if (this.selectedMemberId != null || this.editingMemberIds.length > 0) {
      const ids = [...this.workspaceContext.selectedMemberIds];
      if (!ids.length) return;
      this.editingMemberIds = ids.length > 1 ? ids : [];
      this.selectedMemberId = ids[0];
      return;
    }
    if (this.selectedNodeId != null) {
      const ids = [...this.workspaceContext.selectedNodeIds];
      if (ids.length) this.selectedNodeId = ids[0];
    }
  };

  focusNode = (id: number | null) => {
    this.selectedNodeId = id;
    this.rightPanelTargetsFollowSelection = true;
    if (id != null) { this.selectedMemberId = null; this.selectedBoundaryConditionId = null; this.selectedLoadId = null; this.exitResults(); }
    this.newEntityDraft = null;
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Focus a support / boundary condition in the right dock, by id. */
  focusBoundaryCondition = (id: number | null) => {
    this.selectedBoundaryConditionId = id;
    this.rightPanelTargetsFollowSelection = true;
    if (id != null) { this.selectedMemberId = null; this.selectedNodeId = null; this.selectedLoadId = null; this.exitResults(); }
    this.newEntityDraft = null;
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Focus a load in the right dock, by id. The dock follows the live viewport
   *  selection: sweeping other elements restages the load's targets. */
  focusLoad = (id: number | null) => {
    this.selectedLoadId = id;
    this.rightPanelTargetsFollowSelection = true;
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
    this.rightPanelTargetsFollowSelection = false;
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
    this.rightPanelTargetsFollowSelection = true;
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
    this.rightPanelTargetsFollowSelection = true;
    this.newEntityDraftNonce++;
    this.rightPanelOpen = true;
    this.updateGizmoOffset();
  };

  /** Collect the node ids currently selected in the viewport. */
  get selectedNodeIds(): number[] {
    if (this.renderMode !== 'solid-extrude') return [...this.selector.selectedNodeIds];
    return this.selector.selected
      .map((item) => {
        const ud = item.object.userData;
        if (ud?.type === 'node') return ud.id;
        if (item.object.parent?.userData?.type === 'node') return item.object.parent.userData.id;
        return null;
      })
      .filter((id: number | null): id is number => id != null);
  }

  /** Collect the member ids currently selected in the viewport. */
  get selectedMemberIds(): number[] {
    if (this.renderMode !== 'solid-extrude') return [...this.selector.selectedCenterlineIds];
    const ids = this.selector.selected
      .map((item) => {
        const ud = item.object.userData;
        if (ud?.type === 'elasticBeamColumn') return ud.id;
        if (item.object.parent?.userData?.type === 'elasticBeamColumn') return item.object.parent.userData.id;
        return null;
      })
      .filter((id: number | null): id is number => id != null);
    return [...new Set(ids)];
  }

  get selectedShellIds(): number[] {
    const ids = this.selector.selected
      .map((item) => item.object.userData?.type === 'shell' ? item.object.userData.id : null)
      .filter((id: number | null): id is number => id != null)
    return [...new Set(ids)]
  }

  deleteNodesById = (ids: readonly number[]) => {
    if (!ids.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'DeleteNodes', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { ids, cascade: true },
    })
  }

  deleteMembersById = (ids: readonly number[]) => {
    if (!ids.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'DeleteMembers', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui', payload: { ids },
    })
  }

  deleteShellsById = (ids: readonly number[]) => {
    if (!ids.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'DeleteShells', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui', payload: { ids },
    })
  }

  createOrUpdateLoads = (loads: readonly {
    id: number; name?: string; type: 'nodal' | 'linear' | 'area' | 'pressure';
    targets: readonly number[]; value: { x: number; y: number; z: number }; magnitude?: number;
  }[]) => {
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'CreateOrUpdateLoads', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { loads: loads.map(load => ({
        id: load.id, name: load.name, type: load.type, targetIds: [...load.targets],
        value: [load.value.x, load.value.z, load.value.y], magnitude: load.magnitude,
      })) },
    })
  }

  deleteLoadsById = (ids: readonly number[]) => {
    if (!ids.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'DeleteLoads', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui', payload: { ids },
    })
  }

  createOrUpdateBoundaryConditions = (items: readonly {
    id: number; name?: string; type: BoundaryCondition['type']; targets: readonly number[];
    dx?: number; dy?: number; dz?: number; rx?: number; ry?: number; rz?: number; rotation?: number;
  }[]) => {
    const normalized = items.map(item => {
      const preset = item.type === 'fixed'
        ? { dx: 1, dy: 1, dz: 1, rx: 1, ry: 1, rz: 1 }
        : item.type === 'pinned'
          ? { dx: 1, dy: 1, dz: 1, rx: 1, ry: 0, rz: 0 }
          : item.type === 'roller'
            ? { dx: 0, dy: 1, dz: 1, rx: 1, ry: 0, rz: 0 }
          : { dx: item.dx ?? 0, dy: item.dy ?? 0, dz: item.dz ?? 0, rx: item.rx ?? 0, ry: item.ry ?? 0, rz: item.rz ?? 0 }
      return {
        id: item.id, name: item.name, type: item.type, targetNodeIds: [...item.targets],
        ...preset, rotationDegrees: item.rotation ?? 0,
      }
    })
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'CreateOrUpdateBoundaryConditions', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui', payload: { boundaryConditions: normalized },
    })
  }

  deleteBoundaryConditionsById = (ids: readonly number[]) => {
    if (!ids.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'DeleteBoundaryConditions', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui', payload: { ids },
    })
  }

  /** Delete the nodes currently selected whose own mesh (or parent) carries a node type. */
  deleteSelectedNodes = () => {
    const ids = this.selectedNodeIds;
    if (!ids.length) return;
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { operations: [
        { type: 'DeleteNodes', payload: { ids, cascade: true } },
        { type: 'SetSelection', payload: { entities: [] } },
      ] },
    });
    this.selector.clear();
  };

  /** Delete the members currently selected whose own mesh (or parent) carries a member type. */
  deleteSelectedMembers = () => {
    const ids = this.selectedMemberIds;
    if (!ids.length) return;
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { operations: [
        { type: 'DeleteMembers', payload: { ids } },
        { type: 'SetSelection', payload: { entities: [] } },
      ] },
    });
    this.selector.clear();
  };

  deleteSelectedShells = () => {
    const ids = this.selectedShellIds
    if (!ids.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { operations: [
        { type: 'DeleteShells', payload: { ids } },
        { type: 'SetSelection', payload: { entities: [] } },
      ] },
    })
    this.selector.clear()
  };

  /** Hide selected members through the shared render flag as well as retained
   * legacy resources, so the state is stable across Render Mode switches. */
  hideSelectedMembers = () => {
    const entities = this.selectedMemberIds.map(id => ({ collection: 'members' as const, id }))
    if (!entities.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { operations: [
        { type: 'HideEntities', payload: { entities } },
        { type: 'SetSelection', payload: { entities: [] } },
      ] },
    })
    this.selector.clear();
  };

  /** Replace the viewport selection with a single node / member (model tree
   *  click): the element lights up through the shared selection flag. */
  selectInViewport = (collection: 'nodes' | 'members', id: number) => {
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'SetSelection', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { entities: [{ collection, id }] },
    })
  };

  /** Hide / show specific nodes or members (model tree show-hide toggle)
   *  through the shared render flag, so the state is stable across Render
   *  Mode switches. */
  setEntitiesHidden = (collection: 'nodes' | 'members', ids: number[], hidden: boolean) => {
    const entities = ids.map(id => ({ collection, id }))
    if (!entities.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { operations: [hidden
        ? { type: 'HideEntities', payload: { entities } }
        : { type: 'ShowEntities', payload: { entities } },
      ] },
    })
  };

  /** Zoom the camera to a node / member (model tree quick-zoom): frames the
   *  element's world-space bounds while keeping the current view direction. */
  zoomToEntity = (collection: 'nodes' | 'members', id: number) => {
    const box = new THREE.Box3()
    if (collection === 'nodes') {
      const node = this.nodes.find((n) => n.id === id)
      if (!node) return
      box.expandByPoint(new THREE.Vector3(node.x, node.y, node.z))
    } else {
      const member = this.members.find((m) => m.id === id)
      if (!member) return
      for (const endpoint of member.nodes) {
        box.expandByPoint(new THREE.Vector3(endpoint.x, endpoint.y, endpoint.z))
      }
    }
    this.camera.fitBoxToView(box)
  };

  /** Whether the node / member id is in the canonical viewport selection.
   *  Reads the selection revision so MobX observers calling this re-render
   *  when the (plain, non-observable) selection Sets change. */
  isEntitySelected = (collection: 'nodes' | 'members', id: number) => {
    const revision = this.workspaceSelectionRevision
    const selected = collection === 'nodes'
      ? this.workspaceContext.selectedNodeIds
      : this.workspaceContext.selectedMemberIds
    return revision >= 0 && selected.has(id)
  };

  /** Whether the node / member id is hidden (model tree show-hide toggle).
   *  Reads the hidden revision so MobX observers calling this re-render when
   *  the (plain, non-observable) hidden Set changes. */
  isEntityHidden = (collection: 'nodes' | 'members', id: number) => {
    const revision = this.workspaceHiddenRevision
    return revision >= 0 && this.workspaceContext.hiddenEntityRefs.has(`${collection}:${id}`)
  };

  /** True while at least one node / member / shell is hidden. Reads the
   *  hidden revision so MobX observers calling this re-render on show/hide
   *  changes (the hidden Set is plain, non-observable render data). */
  hasHiddenEntities = () => {
    const revision = this.workspaceHiddenRevision
    return revision >= 0 && this.workspaceContext.hiddenEntityRefs.size > 0
  };

  /** Show every hidden node / member / shell (bottom bar "Show all"): one
   *  undoable transaction that clears the whole hidden set. */
  showAllEntities = () => {
    const entities = this.workspaceContext.getCommandState().hidden
    if (!entities.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { operations: [
        { type: 'ShowEntities', payload: { entities } },
      ] },
    })
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
      }];
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
    });
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
    });
    load.createOrUpdate();
    this.focusLoad(load.id);
  };

  addPressureLoadToShells = (shellIds: number[]) => {
    if (!shellIds.length) return
    const id = Math.floor(Math.random() * 0x7fffffff)
    this.createOrUpdateLoads([{
      id,
      name: `Load ${this.loads.length + 1}`,
      type: 'pressure',
      targets: shellIds,
      value: new THREE.Vector3(0, -1, 0),
      magnitude: 0,
    }])
    this.focusLoad(id)
  };

  /** Create a node at the origin and focus it. */
  addNewNode = () => {
    const id = Math.floor(Math.random() * 0x7fffffff)
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'CreateNodes', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { nodes: [{ id, position: [0, 0, 0] }] },
    })
    this.focusNode(id);
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
    if ((dialog === 'copy' || dialog === 'move') && this.renderMode !== 'solid-extrude') {
      this.selector.syncLegacySelectionFromCenterline();
    }
    this.activeDialog = dialog;
    this.updateGizmoOffset();
    return true;
  }

  /** Lock the model after a successful analysis: results become active, editing is disabled. */
  lockResults = () => {
    if (!this.output) return
    this.resultStore.ingestAnalysisOutput(this.output, this.structuralSceneDB)
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
    this.workspaceContext.activeTool = tool
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
      window.addEventListener('keydown', this.onGlobalKeyDown);
    } else {
      window.removeEventListener("resize", this.onResize);
      window.removeEventListener('pointermove', this.updatePointerCoords);
      window.removeEventListener('keydown', this.onGlobalKeyDown);
    }
  }

  /** Global keyboard shortcuts: Escape re-arms select mode, Ctrl+Z / Ctrl+Y
   *  (and Shift variants) drive the command history. Form fields are skipped. */
  private onGlobalKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    // Escape ends the active navigation tool (zoom / pan / orbit / ...) and
    // re-arms select mode - the keyboard twin of the bottom bar Select button.
    if (event.key === 'Escape') {
      if (this.navTool !== 'select') {
        event.preventDefault()
        this.setNavTool('select')
      }
      return
    }
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    const undo = key === 'z' && !event.shiftKey
    const redo = key === 'y' || (key === 'z' && event.shiftKey)
    if (!undo && !redo) return
    const result = undo ? this.undoCommand() : this.redoCommand()
    if (result) event.preventDefault()
  }

  private constructor() {
    this.workspaceContext.activeTool = this.navTool
    this.camera = new Camera(this)
    this.gridHelper = new GridHelper(this.scene)
    this.light = new Light(this.scene)
    this.pointerCoords =  new THREE.Vector3(0,0,0,)
    this.worldPlane =  new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    
    this.snapper = new Snapper(this)
    this.workingPlane = new WorkingPlane(this)
    this.performanceBenchmark = new ViewerBenchmark(this)
 
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
    this.memberIndexHighWater = 0
    this.shells = []
    this.layer = 0
    this.legacyStructuralRoot.name = 'LegacyStructuralRoot'
    this.legacyStructuralRoot.layers.set(this.layer)
    this.scene.add(this.legacyStructuralRoot)
    this.centerlineRenderer = new CenterlineRenderer(this.scene, this.layer)
    this.centerlineRenderer.setQualityProfile(this.qualityProfile)
    this.thinShellRenderer = new ThinShellRenderer(this.scene, this.layer)
    this.thinShellRenderer.setQualityProfile(this.qualityProfile)
    // Keep the renderers in sync with the shrink toggle state (no-op while off).
    const shrinkPerEnd = this.shrinkEnabled ? SHRINK_RATIO_PER_END : 0
    this.centerlineRenderer.setShrink(shrinkPerEnd)
    this.thinShellRenderer.setShrink(shrinkPerEnd)
    this.diagramRenderer = new DiagramRenderer(this.scene, this.layer)
    this.gpuAnnotations = new GpuAnnotations(this.scene, this.layer)
    this.loadGpuRenderer = new LoadGpuRenderer(this.scene, this.layer)
    this.camera.controls.addEventListener('end', () => this.gpuAnnotations.markDirty())
    this.structuralPicker = new StructuralGpuPicker(this.renderer)
    // Seed the canonical authority with startup materials/sections before the
    // first UI command is allowed to reference them.
    this.reconcileStructuralDocument()
    // buildModelOnjson(this, '/examples/ipe330-cantilever-beam.json')
    // buildModelOnjson(this, '/examples/concrete-frame-nodal-load.json')
    makeAutoObservable(this, {
      fpsFrameCount: false,
      fpsAccumMs: false,
      fpsLastFrameTime: false,
      memberIndexHighWater: false,
      performanceBenchmark: false,
      structuralDocument: false,
      commandGateway: false,
      structuralSceneDB: false,
      structuralDocumentBridge: false,
      workspaceContext: false,
      resultStore: false,
      structuralSceneDBBuildMs: false,
      structuralSceneSyncScheduled: false,
      centerlineRenderer: false,
      thinShellRenderer: false,
      diagramRenderer: false,
      gpuAnnotations: false,
      loadGpuRenderer: false,
      structuralPicker: false,
      legacyStructuralRoot: false,
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
      this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)
      this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored)
      this.camera.handleResize();
      // The visible area also changes WITHOUT a window resize (left bar
      // collapse, right dock open/close) — watch the container itself.
      if (typeof ResizeObserver !== 'undefined' && this.container) {
        this.containerResizeObserver = new ResizeObserver(() => this.onResize());
        this.containerResizeObserver.observe(this.container);
      }
      // AutoCAD-style dark blue-black viewport background
      this.scene.background = new THREE.Color(this.viewerBackground);
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

  /** Replace the current model with an explicit user-requested deterministic fixture. */
  async loadBenchmarkFixture(beamCount: 1_000 | 10_000 | 100_000, seed = 0x4255434b) {
    if (this.performanceBenchmark.running) throw new Error('Wait for the active benchmark to finish')
    this.performanceBenchmark.fixtureLoading = true
    this.performanceBenchmark.setFixture(null)
    this.performanceBenchmark.setFixtureProgress(0, 'Generating fixture')
    try {
      // Yield between the long synchronous steps so the HUD can actually paint
      // the progress bar — no rendering happens while main-thread work runs.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const startedAt = performance.now()
      const fixture = generateStructuralBenchmarkFixture({ beamCount, seed })
      this.performanceBenchmark.setFixtureProgress(10, 'Committing document')
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      buildModelFromJson(this, fixture)
      // The SceneDB upload is scheduled from the commit; give it two frames.
      this.performanceBenchmark.setFixtureProgress(85, 'Uploading scene buffers')
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      this.performanceBenchmark.setFixtureProgress(100)
      const loadMs = performance.now() - startedAt
      this.performanceBenchmark.setFixture({
        kind: fixture.metadata.fixture,
        version: fixture.metadata.version,
        seed: fixture.metadata.seed,
        requestedBeamCount: fixture.metadata.requestedBeamCount,
        loadMs: Number(loadMs.toFixed(2)),
      })
      return this.performanceBenchmark.fixture
    } finally {
      this.performanceBenchmark.fixtureLoading = false
    }
  }

  /** Reconcile legacy editor objects into the canonical document, then upload dirty render buffers. */
  syncStructuralSceneDB() {
    const startedAt = performance.now()
    const previousFlags = new Map<number, number>()
    const previousNodeFlags = new Map<number, number>()
    for (let index = 0; index < this.structuralSceneDB.nodeCount; index++) {
      previousNodeFlags.set(this.structuralSceneDB.nodeIds[index], this.structuralSceneDB.nodeFlags[index])
    }
    for (let index = 0; index < this.structuralSceneDB.memberCount; index++) {
      previousFlags.set(this.structuralSceneDB.memberIds[index], this.structuralSceneDB.memberFlags[index])
    }
    this.structuralDocument.reconcile(this.legacyDocumentSeedPreservingOrganizationalState())
    this.selector.selectedCenterlineIds = this.selector.selectedCenterlineIds.filter(id =>
      this.structuralSceneDB.memberIndexById.has(id),
    )
    this.selector.selectedNodeIds = this.selector.selectedNodeIds.filter(id =>
      this.structuralSceneDB.nodeIndexById.has(id),
    )
    const selectedIds = new Set(this.selector.selectedCenterlineIds)
    for (let index = 0; index < this.structuralSceneDB.memberCount; index++) {
      const id = this.structuralSceneDB.memberIds[index]
      const flags = previousFlags.get(id)
      if (flags !== undefined) this.structuralSceneDB.memberFlags[index] = flags
      if (selectedIds.has(id)) this.structuralSceneDB.memberFlags[index] |= ENTITY_SELECTED
    }
    const selectedNodeIds = new Set(this.selector.selectedNodeIds)
    for (let index = 0; index < this.structuralSceneDB.nodeCount; index++) {
      const id = this.structuralSceneDB.nodeIds[index]
      const flags = previousNodeFlags.get(id)
      if (flags !== undefined) this.structuralSceneDB.nodeFlags[index] = flags
      if (selectedNodeIds.has(id)) this.structuralSceneDB.nodeFlags[index] |= ENTITY_SELECTED
    }
    this.structuralSceneDBBuildMs = performance.now() - startedAt
    this.gpuAnnotations.setEntityLabels(
      new Map(this.members.map(member => [member.id, member.label || `M${member.id}`])),
      new Map(this.nodes.map(node => [node.id, node.name || `N${node.id}`])),
    )
    this.centerlineRenderer.upload(this.structuralSceneDB)
    this.thinShellRenderer.upload(this.structuralSceneDB)
    this.diagramRenderer.upload(this.structuralSceneDB)
    this.structuralPicker.upload(this.structuralSceneDB)
    this.structuralPicker.warmup(this.camera.cam)
    return this.structuralSceneDB
  }

  reconcileStructuralDocument() {
    this.structuralDocument.reconcile(this.legacyDocumentSeedPreservingOrganizationalState())
    return this.structuralDocument
  }

  /** The legacy adapter only knows the editor entity arrays; reconciling with it
   *  alone would silently drop the canonical organizational collections
   *  (groups, parametric objects, selection sets, grids, levels). Merge them in
   *  from the current document so they survive Analyse / scene resyncs. */
  private legacyDocumentSeedPreservingOrganizationalState = (): StructuralDocumentSeed => ({
    ...legacyModelToDocumentSeed(this),
    groups: [...this.structuralDocument.groups.values()],
    parametricObjects: [...this.structuralDocument.parametricObjects.values()],
    selectionSets: [...this.structuralDocument.selectionSets.values()],
    ...(this.structuralDocument.grids.size ? { grids: [...this.structuralDocument.grids.values()] } : {}),
    ...(this.structuralDocument.levels.size ? { levels: [...this.structuralDocument.levels.values()] } : {}),
  })

  /** Root/child folders and sets, sorted by id (deterministic tree order). The
   *  revision read keeps the Selection Sets tab reactive to commits/undo. */
  selectionSetChildren = (parentId: number | null): SelectionSetRecord[] => {
    void this.selectionSetRevision
    return [...this.structuralDocument.selectionSets.values()]
      .filter(item => item.parentId === parentId)
      .sort((a, b) => a.id - b.id)
  }

  createSelectionSet = (name: string, kind: SelectionSetKind, parentId: number | null, entityRefs: readonly EntityReference[] = []) => {
    const ids = [...this.structuralDocument.selectionSets.keys()]
    const id = ids.length ? Math.max(...ids) + 1 : 1
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'CreateOrUpdateSelectionSets', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: {
        selectionSets: [{
          id,
          name: name.trim() || (kind === 'folder' ? `Folder ${id}` : `Selection Set ${id}`),
          kind,
          parentId,
          entityRefs,
        }],
      },
    })
    return id
  }

  updateSelectionSet = (id: number, patch: Partial<Omit<SelectionSetRecord, 'id'>>) => {
    const current = this.structuralDocument.selectionSets.get(id)
    if (!current) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'CreateOrUpdateSelectionSets', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { selectionSets: [{ ...current, ...patch }] },
    })
  }

  deleteSelectionSet = (id: number) => {
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'DeleteSelectionSets', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { ids: [id] },
    })
  }

  /** Merge the current viewport members/shells into a set (idempotent union). */
  assignSelectionToSelectionSet = (setId: number, refs: readonly EntityReference[]) => {
    const current = this.structuralDocument.selectionSets.get(setId)
    if (!current || current.kind !== 'set') return
    const merged = new Map<string, EntityReference>()
    for (const ref of [...current.entityRefs, ...refs]) {
      if (ref.collection !== 'members' && ref.collection !== 'shells') continue
      merged.set(`${ref.collection}:${ref.id}`, ref)
    }
    this.updateSelectionSet(setId, { entityRefs: [...merged.values()] })
  }

  /** Select the entities stored in a set in the viewport (resolving straight
   *  from the canonical document, so stale refs are dropped silently). */
  selectFromSelectionSet = (setId: number) => {
    const current = this.structuralDocument.selectionSets.get(setId)
    if (!current || current.kind !== 'set') return
    const entities = current.entityRefs.filter(ref =>
      (ref.collection === 'members' || ref.collection === 'shells') &&
      this.structuralDocument[ref.collection].has(ref.id),
    )
    if (!entities.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'SetSelection', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { entities },
    })
  }

  /** Remove one entity (member/shell) from a set without touching the rest. */
  removeEntityFromSelectionSet = (setId: number, ref: EntityReference) => {
    const current = this.structuralDocument.selectionSets.get(setId)
    if (!current || current.kind !== 'set') return
    const key = `${ref.collection}:${ref.id}`
    const remaining = current.entityRefs.filter(item => `${item.collection}:${item.id}` !== key)
    if (remaining.length !== current.entityRefs.length) {
      this.updateSelectionSet(setId, { entityRefs: remaining })
    }
  }

  /** Select a single entity (member/shell) in the viewport — used by the
   *  entity rows nested inside a selection-set node. */
  selectEntity = (ref: EntityReference) => {
    this.selectEntityRefs([ref])
  }

  /** Select a list of members/shells in the viewport (open + dwell). Resolves
   *  straight from the canonical document so dead refs drop silently. */
  selectEntityRefs = (refs: readonly EntityReference[]) => {
    const entities = refs.filter(ref =>
      (ref.collection === 'members' || ref.collection === 'shells') &&
      this.structuralDocument[ref.collection].has(ref.id),
    )
    if (!entities.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'SetSelection', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { entities },
    })
  }

  /** Show / hide arbitrary members / shells in one undoable transaction. */
  setRefsHidden = (refs: readonly EntityReference[], hidden: boolean) => {
    const entities = refs.filter(ref =>
      (ref.collection === 'members' || ref.collection === 'shells') &&
      this.structuralDocument[ref.collection].has(ref.id),
    )
    if (!entities.length) return
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { operations: [hidden
        ? { type: 'HideEntities', payload: { entities } }
        : { type: 'ShowEntities', payload: { entities } },
      ] },
    })
  }

  /** Isolate entities: reveal [refs] and hide every other member/shell. */
  isolateRefs = (refs: readonly EntityReference[]) => {
    const keep = new Set(refs.filter(ref =>
      (ref.collection === 'members' || ref.collection === 'shells') &&
      this.structuralDocument[ref.collection].has(ref.id),
    ).map(ref => `${ref.collection}:${ref.id}`))
    if (!keep.size) return
    const show: EntityReference[] = []
    for (const key of keep) {
      const [collection, rawId] = key.split(':') as ['members' | 'shells', string]
      show.push({ collection, id: Number(rawId) })
    }
    const hide: EntityReference[] = [
      ...[...this.structuralDocument.members.values()].map(member => ({ collection: 'members' as const, id: member.id })),
      ...[...this.structuralDocument.shells.values()].map(shell => ({ collection: 'shells' as const, id: shell.id })),
    ].filter(ref => !keep.has(`${ref.collection}:${ref.id}`))
    const hideOperations: CommandTransactionOperation[] = hide.length
      ? [{ type: 'HideEntities', payload: { entities: hide } }]
      : []
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'Transaction', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui',
      payload: { operations: [
        { type: 'ShowEntities', payload: { entities: show } },
        ...hideOperations,
      ] },
    })
  }

  /** Frame the camera to a set of nodes/members/shells (union of world bounds). */
  zoomToRefs = (refs: readonly EntityReference[]) => {
    const box = new THREE.Box3()
    for (const ref of refs) {
      if (ref.collection === 'nodes') {
        const node = this.nodes.find(n => n.id === ref.id)
        if (!node) continue
        box.expandByPoint(new THREE.Vector3(node.x, node.y, node.z))
      } else if (ref.collection === 'members') {
        const member = this.members.find(m => m.id === ref.id)
        if (!member) continue
        for (const endpoint of member.nodes) box.expandByPoint(new THREE.Vector3(endpoint.x, endpoint.y, endpoint.z))
      } else if (ref.collection === 'shells') {
        const shell = this.shells.find(s => s.id === ref.id)
        if (!shell) continue
        for (const node of shell.nodes) box.expandByPoint(new THREE.Vector3(node.x, node.y, node.z))
      }
    }
    if (!box.isEmpty()) this.camera.fitBoxToView(box)
  }

  /** Zoom the camera to the current viewport selection (nodes/members/shells). */
  zoomToSelected = () => {
    const refs: EntityReference[] = [
      ...[...this.selectedNodeIds].map(id => ({ collection: 'nodes' as const, id })),
      ...[...this.selectedMemberIds].map(id => ({ collection: 'members' as const, id })),
      ...[...this.selectedShellIds].map(id => ({ collection: 'shells' as const, id })),
    ]
    if (!refs.length) return
    this.zoomToRefs(refs)
  }

  /** Whether the entity ref (members/shells) is currently hidden in the
   *  workspace. Reads the hidden revision so observers re-render on change. */
  isRefHidden = (ref: EntityReference) => {
    const revision = this.workspaceHiddenRevision
    return revision >= 0 && this.workspaceContext.hiddenEntityRefs.has(`${ref.collection}:${ref.id}`)
  }

  /** Collect the entity refs of every member / shell set that lives under the
   *  folder `folderId` (children + grandchildren + …). A set that is itself a
   *  child is included; the folder node (kind='folder') contributes nothing. */
  selectionSetSubtreeRefs = (folderId: number): EntityReference[] => {
    const refs: EntityReference[] = []
    const visit = (id: number | null) => {
      for (const node of this.selectionSetChildren(id)) {
        if (node.kind === 'folder') visit(node.id)
        else refs.push(...node.entityRefs)
      }
    }
    visit(folderId)
    return refs
  }

  /** Select all entities under a folder (recursively) in the viewport —
   *  folder click behaviour. */
  selectSelectionSetSubtree = (folderId: number) => {
    this.selectEntityRefs(this.selectionSetSubtreeRefs(folderId))
  }

  /** Execute one validated canonical command and refresh renderer projections. */
  executeCommand(command: CommandEnvelope, options: { allowDestructive?: boolean } = {}): CommandResult {
    return this.commandGateway.execute(command, this.commandContext(options.allowDestructive === true))
  }

  /** Create a provider-neutral AI tool session wired to the live viewport projection. */
  createAiToolExecutor(
    parametricGenerators: Readonly<Record<string, ParametricGeneratorBinding>> = {},
    agentBudget: AgentBudget = {},
  ) {
    return new AiToolExecutor(this.structuralDocument, this.commandGateway, {
      getWorkspaceState: () => this.workspaceContext.getCommandState(),
      applyWorkspaceState: state => this.workspaceContext.applyCommandState(state),
      executeCommand: command => this.executeCommand(command),
      undoCommand: () => this.undoCommand(),
      parametricGenerators,
    }, agentBudget)
  }

  undoCommand(): CommandResult | null {
    return this.commandGateway.undo(this.commandContext(false))
  }

  redoCommand(): CommandResult | null {
    return this.commandGateway.redo(this.commandContext(false))
  }

  private commandContext(allowDestructive: boolean): CommandGatewayContext {
    return {
      getWorkspaceState: () => this.workspaceContext.getCommandState(),
      applyWorkspaceState: state => {
        const beforeSelection = this.workspaceContext.getCommandState().selection
          .map(ref => `${ref.collection}:${ref.id}`).sort().join('|')
        const afterSelection = state.selection
          .map(ref => `${ref.collection}:${ref.id}`).sort().join('|')
        const beforeHidden = this.workspaceContext.getCommandState().hidden
          .map(ref => `${ref.collection}:${ref.id}`).sort().join('|')
        const afterHidden = state.hidden
          .map(ref => `${ref.collection}:${ref.id}`).sort().join('|')
        this.workspaceContext.applyCommandState(state)
        if (!this.selector) return
        this.selector.selectedNodeIds = [...this.workspaceContext.selectedNodeIds]
        this.selector.selectedCenterlineIds = [...this.workspaceContext.selectedMemberIds]
        if (beforeSelection !== afterSelection) {
          this.workspaceSelectionRevision++
          this.syncSelectionLinkedPanel()
        }
        if (beforeHidden !== afterHidden) this.workspaceHiddenRevision++
      },
      allowDestructive: () => allowDestructive,
      onCommitted: result => {
        if (!result.changed) return
        if (result.changes) {
          this.invalidateResults()
          applyStructuralChangeToLegacy(this, this.structuralDocument, result.changes)
          this.refreshCommandRenderProjection()
          const selectionSetsChanges = result.changes.changes.selectionSets
          if (selectionSetsChanges.created.length || selectionSetsChanges.updated.length || selectionSetsChanges.deleted.length) {
            this.selectionSetRevision++
          }
        } else {
          this.refreshWorkspaceRenderProjection()
        }
      },
    }
  }

  /** Upload the bridge-maintained DB without reconciling back from legacy arrays. */
  private refreshCommandRenderProjection() {
    if (!this.centerlineRenderer || !this.thinShellRenderer || !this.diagramRenderer || !this.structuralPicker) return
    const selectedNodes = this.workspaceContext.selectedNodeIds
    const selectedMembers = this.workspaceContext.selectedMemberIds
    const hidden = this.workspaceContext.hiddenEntityRefs
    for (let index = 0; index < this.structuralSceneDB.nodeCount; index++) {
      const id = this.structuralSceneDB.nodeIds[index]
      this.structuralSceneDB.setNodeFlag(id, ENTITY_SELECTED, selectedNodes.has(id))
      this.structuralSceneDB.setNodeFlag(id, ENTITY_VISIBLE, !hidden.has(`nodes:${id}`))
    }
    for (let index = 0; index < this.structuralSceneDB.memberCount; index++) {
      const id = this.structuralSceneDB.memberIds[index]
      this.structuralSceneDB.setMemberFlag(id, ENTITY_SELECTED, selectedMembers.has(id))
      this.structuralSceneDB.setMemberFlag(id, ENTITY_VISIBLE, !hidden.has(`members:${id}`))
    }
    this.centerlineRenderer.upload(this.structuralSceneDB)
    this.thinShellRenderer.upload(this.structuralSceneDB)
    this.diagramRenderer.upload(this.structuralSceneDB)
    this.structuralPicker.upload(this.structuralSceneDB)
    this.applyRenderModeVisibility()
  }

  /** Selection/visibility commands do not alter topology or geometry. Update
   * their compact flag streams without rebuilding any renderer batches. */
  private refreshWorkspaceRenderProjection() {
    if (!this.centerlineRenderer || !this.thinShellRenderer || !this.diagramRenderer || !this.structuralPicker) return
    const selectedNodes = this.workspaceContext.selectedNodeIds
    const selectedMembers = this.workspaceContext.selectedMemberIds
    const hidden = this.workspaceContext.hiddenEntityRefs
    for (let index = 0; index < this.structuralSceneDB.nodeCount; index++) {
      const id = this.structuralSceneDB.nodeIds[index]
      this.structuralSceneDB.setNodeFlag(id, ENTITY_SELECTED, selectedNodes.has(id))
      this.structuralSceneDB.setNodeFlag(id, ENTITY_VISIBLE, !hidden.has(`nodes:${id}`))
    }
    for (let index = 0; index < this.structuralSceneDB.memberCount; index++) {
      const id = this.structuralSceneDB.memberIds[index]
      this.structuralSceneDB.setMemberFlag(id, ENTITY_SELECTED, selectedMembers.has(id))
      this.structuralSceneDB.setMemberFlag(id, ENTITY_VISIBLE, !hidden.has(`members:${id}`))
    }
    this.centerlineRenderer.syncAllEntityStates()
    this.thinShellRenderer.syncAllMemberStates()
    this.diagramRenderer.syncAllMemberStates()
    this.structuralPicker.syncAllEntityStates()
    this.gpuAnnotations.markDirty()
    this.applyRenderModeVisibility()
  }

  createAnalysisSnapshot(): AnalysisSnapshot {
    this.reconcileStructuralDocument()
    return this.structuralDocument.createAnalysisSnapshot()
  }

  /** Coalesce property edits/deletes made in one UI action into one render-DB rebuild. */
  scheduleStructuralSceneSync() {
    if (this.structuralSceneSyncScheduled || !this.centerlineRenderer || !this.thinShellRenderer || !this.diagramRenderer || !this.structuralPicker) return
    this.structuralSceneSyncScheduled = true
    queueMicrotask(() => {
      this.structuralSceneSyncScheduled = false
      this.syncStructuralSceneDB()
      this.applyRenderModeVisibility()
    })
  }

  /**
   * Midas-style Shrink display: shorten every member at both of its ends so
   * adjacent elements read as separate bodies around shared joints.
   * Display-only — node coordinates, GPU picking and analysis are untouched.
   */
  setShrinkEnabled(value: boolean) {
    this.shrinkEnabled = value
    const perEnd = value ? SHRINK_RATIO_PER_END : 0
    this.centerlineRenderer?.setShrink(perEnd)
    this.thinShellRenderer?.setShrink(perEnd)
    for (const member of this.members) member.applyShrink()
  }

  /** Change the viewer/editor canvas background colour (Settings → View). */
  setViewerBackground(hex: string) {
    this.viewerBackground = hex
    this.scene.background = new THREE.Color(hex)
  }

  /** Coalesce load add/edit/delete into one instanced-batch rebuild (3 draw calls). */
  scheduleLoadGpuSync() {
    if (!this.loadGpuRenderer) return
    queueMicrotask(() => {
      if (!this.loadGpuRenderer) return
      this.loadGpuRenderer.upload(buildLoadInstances(this))
      this.loadGpuRenderer.setVisible(this.visibility?.loads ?? true)
    })
  }


  async setRenderMode(mode: RenderMode) {
    if (!isRenderMode(mode)) throw new Error(`Unsupported render mode: ${mode}`)
    const wasDataDriven = this.renderMode !== 'solid-extrude'
    const willBeDataDriven = mode !== 'solid-extrude'
    if (willBeDataDriven && !wasDataDriven) {
      this.selector?.syncCenterlineSelectionFromLegacy()
    }
    this.renderMode = mode
    localStorage.setItem('buckle.renderMode', mode)
    const token = ++this.solidPreparationToken
    if (!willBeDataDriven && wasDataDriven) {
      this.solidPreparation = {
        active: true,
        progress: 0,
        // Conservative preview; exact renderer.info is available after upload.
        estimatedTriangles: estimateSolidTriangles(this.members.length, this.nodes.length),
      }
      const entities = [...this.nodes, ...this.members]
      for (let offset = 0; offset < entities.length; offset += 200) {
        if (token !== this.solidPreparationToken || this.renderMode !== 'solid-extrude') return
        for (const entity of entities.slice(offset, offset + 200)) entity.materializeSolid()
        this.solidPreparation = { ...this.solidPreparation, progress: Math.round(100 * Math.min(entities.length, offset + 200) / Math.max(1, entities.length)) }
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      this.solidPreparation = { ...this.solidPreparation, active: false, progress: 100 }
      this.selector?.syncLegacySelectionFromCenterline()
    } else if (willBeDataDriven && shouldEvictSolidResources(this.members.length)) {
      // Large solids are evicted immediately; small inspection models retain
      // their shared cache for instant toggling.
      this.legacyStructuralRoot.removeFromParent()
      this.solidPreparation = { active: true, progress: 0, estimatedTriangles: 0 }
      const entities = [...this.members, ...this.nodes]
      for (let offset = 0; offset < entities.length; offset += 500) {
        if (token !== this.solidPreparationToken) return
        for (const entity of entities.slice(offset, offset + 500)) entity.releaseSolid()
        this.solidPreparation = { ...this.solidPreparation, progress: Math.round(100 * Math.min(entities.length, offset + 500) / Math.max(1, entities.length)) }
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      this.members[0]?.evictUnusedSolidCache()
      this.solidPreparation = { active: false, progress: 100, estimatedTriangles: 0 }
    }
    this.applyRenderModeVisibility()
  }

  setQualityProfile(profile: QualityProfile) {
    if (!isQualityProfile(profile)) throw new Error(`Unsupported quality profile: ${profile}`)
    this.qualityProfile = profile
    localStorage.setItem('buckle.qualityProfile', profile)
    this.centerlineRenderer.setQualityProfile(profile)
    this.thinShellRenderer.setQualityProfile(profile)
  }

  setSelectionMode(mode: SelectionMode) {
    if (!isSelectionMode(mode) || mode === this.selectionMode) return
    this.selector.clear()
    this.closeContextMenu()
    this.selectionMode = mode
    localStorage.setItem('buckle.selectionMode', mode)
  }

  setStructuralMemberState(entityId: number, state: { visible?: boolean; selected?: boolean; hovered?: boolean }) {
    this.centerlineRenderer.setMemberState(entityId, state)
    this.thinShellRenderer.syncMemberState(entityId)
    this.diagramRenderer.syncMemberState(entityId)
    this.structuralPicker.syncMemberState(entityId)
    this.gpuAnnotations.markDirty()
  }

  setStructuralNodeState(entityId: number, state: { visible?: boolean; selected?: boolean; hovered?: boolean }) {
    this.centerlineRenderer.setNodeState(entityId, state)
    this.structuralPicker.syncNodeState(entityId)
    this.gpuAnnotations.markDirty()
  }

  /** Rebuild the compact support-symbol stream. Other structural symbol kinds
   * use this same renderer as their data paths are migrated. */
  syncGpuAnnotations() {
    const symbols: import('./Rendering/GpuAnnotations').SymbolCandidate[] = this.boundaryConditions.flatMap((condition) =>
      condition.targets.flatMap((target) => {
        const node = this.nodes.find(item => item.id === target)
        const dofs = [condition.dx, condition.dy, condition.dz, condition.rx, condition.ry, condition.rz]
        const state = dofs.reduce<number>((mask, value, index) => mask | (value ? 1 << index : 0), 0)
        return node ? [{ anchor: [node.x, node.y, node.z] as const, kind: 0, state, color: [0.08, 0.82, 0.28] as const }] : []
      }),
    )
    const labels: import('./Rendering/GpuAnnotations').WorldLabelCandidate[] = []
    if (this.visibility?.loads ?? true) for (const load of this.loads) {
      for (const target of load.targets) {
        const node = this.nodes.find(item => item.id === target)
        const memberIndex = this.structuralSceneDB.memberIndexById.get(target)
        const shell = this.shells.find(item => item.id === target)
        let anchor: readonly [number, number, number] | null = node ? [node.x, node.y, node.z] : null
        if (!anchor && memberIndex !== undefined) {
          const o = memberIndex * 6
          anchor = [
            (this.structuralSceneDB.memberEndpoints[o] + this.structuralSceneDB.memberEndpoints[o + 3]) * .5,
            (this.structuralSceneDB.memberEndpoints[o + 1] + this.structuralSceneDB.memberEndpoints[o + 4]) * .5,
            (this.structuralSceneDB.memberEndpoints[o + 2] + this.structuralSceneDB.memberEndpoints[o + 5]) * .5,
          ]
        }
        if (!anchor && shell?.nodes.length) {
          const center = shell.nodes.reduce((sum, item) => [sum[0] + item.x, sum[1] + item.y, sum[2] + item.z] as [number, number, number], [0, 0, 0])
          anchor = [center[0] / shell.nodes.length, center[1] / shell.nodes.length, center[2] / shell.nodes.length]
        }
        if (!anchor) continue
        const components = [load.value.x, load.value.y, load.value.z].filter(value => Math.abs(value) > 1e-9)
        const text = load.magnitude !== undefined
          ? load.magnitude.toFixed(3)
          : components.length <= 1
            ? (components[0] ?? 0).toFixed(3)
            : `(${load.value.x.toFixed(3)}, ${load.value.y.toFixed(3)}, ${load.value.z.toFixed(3)})`
        labels.push({ id: `load-${load.id}-${target}`, text, anchor, priority: 'value', forceVisible: true, color: [1, .86, .12] })
      }
    }
    const active = (['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'] as const).filter(key => this.reactionViz?.show[key])
    for (const reaction of this.output?.reactions ?? []) for (const component of active) {
        const value = Number(reaction[component] ?? 0)
        if (Math.abs(value) < 1e-9) continue
        const anchor = [Number(reaction.x ?? 0), Number(reaction.z ?? 0), Number(reaction.y ?? 0)] as const
        const sign = value >= 0 ? 1 : -1
        const direction = component[1] === 'x' ? [sign, 0, 0] as const : component[1] === 'y' ? [0, 0, sign] as const : [0, sign, 0] as const
        symbols.push({ anchor, direction, kind: component[0] === 'M' ? 3 : 2, color: component[0] === 'M' ? [1, .62, .05] : [0.2, .45, 1] })
        labels.push({ id: `reaction-${component}-${reaction.id}`, text: `${component} ${value.toPrecision(4)}`, anchor, priority: 'value', forceVisible: true, color: [1, .45, .72] })
    }
    // Selected member local axes share the same symbol batch (RGB = local
    // x/y/z); there is no Line/ArrowHelper allocation per selected member.
    for (let i = 0; i < this.structuralSceneDB.memberCount; i++) if (this.structuralSceneDB.memberFlags[i] & ENTITY_SELECTED) {
      const o = i * 6
      const anchor = [
        (this.structuralSceneDB.memberEndpoints[o] + this.structuralSceneDB.memberEndpoints[o + 3]) * .5,
        (this.structuralSceneDB.memberEndpoints[o + 1] + this.structuralSceneDB.memberEndpoints[o + 4]) * .5,
        (this.structuralSceneDB.memberEndpoints[o + 2] + this.structuralSceneDB.memberEndpoints[o + 5]) * .5,
      ] as const
      const r = i * 3
      const start = [this.structuralSceneDB.memberEndpoints[o], this.structuralSceneDB.memberEndpoints[o + 1], this.structuralSceneDB.memberEndpoints[o + 2]] as const
      const end = [this.structuralSceneDB.memberEndpoints[o + 3], this.structuralSceneDB.memberEndpoints[o + 4], this.structuralSceneDB.memberEndpoints[o + 5]] as const
      const reference = [this.structuralSceneDB.memberReferenceAxes[r], this.structuralSceneDB.memberReferenceAxes[r + 1], this.structuralSceneDB.memberReferenceAxes[r + 2]] as const
      const frame = computeMemberFrame(start, end, reference, this.structuralSceneDB.memberGammaRadians[i])
      symbols.push(
        { anchor, direction: frame.x, kind: 4, color: [1, .15, .15] },
        { anchor, direction: frame.y, kind: 5, color: [.15, 1, .3] },
        { anchor, direction: frame.z, kind: 6, color: [.2, .5, 1] },
      )
    }
    this.gpuAnnotations.setData(symbols, labels)
  }

  isStructuralMemberVisible(entityId: number) {
    const index = this.structuralSceneDB.memberIndexById.get(entityId)
    return index === undefined || Boolean(this.structuralSceneDB.memberFlags[index] & ENTITY_VISIBLE)
  }

  /** Keep legacy objects resident so switching mode is immediate and lossless. */
  applyRenderModeVisibility() {
    const useCenterlines = this.renderMode === 'centerline-only'
    const useThinShell = this.renderMode === 'thin-shell'
    const useDataDriven = useCenterlines || useThinShell
    this.centerlineRenderer.setVisible(useDataDriven)
    this.centerlineRenderer.setMembersVisible(useCenterlines && (this.visibility?.members ?? true))
    this.centerlineRenderer.setNodesVisible(useDataDriven && (this.visibility?.nodes ?? true))
    this.thinShellRenderer.setVisible(useThinShell)
    this.thinShellRenderer.setMembersVisible(
      (this.visibility?.members ?? true) && (this.visibility?.sections ?? true),
    )

    if (useDataDriven) {
      this.legacyStructuralRoot.removeFromParent()
    } else if (this.legacyStructuralRoot.parent !== this.scene) {
      this.scene.add(this.legacyStructuralRoot)
    }

    for (const member of this.members) {
      const entityVisible = this.isStructuralMemberVisible(member.id)
      if (member.group) member.group.visible = !useDataDriven && entityVisible
      if (member.mesh) member.mesh.visible = !useDataDriven && entityVisible && (this.visibility?.sections ?? true)
      if (member.edges) member.edges.visible = !useDataDriven && entityVisible && (this.visibility?.sections ?? true)
      if (member.line) member.line.mesh.visible = !useDataDriven && entityVisible && (this.visibility?.members ?? true)
    }
    for (const node of this.nodes) if (node.mesh) node.mesh.visible = !useDataDriven && (this.visibility?.nodes ?? true)
    // 2D shell elements keep their own legacy meshes — gate them by the shared
    // workspace hidden set so the tree / context menu Show/Hide works for shells.
    for (const shell of this.shells) {
      if (shell.mesh) shell.mesh.visible = !useDataDriven && !this.workspaceContext.hiddenEntityRefs.has(`shells:${shell.id}`)
    }
    // Loads intentionally remain true 3D geometry in every structural render
    // mode. Only their numeric text is emitted by the GPU annotation stream.
    // Loads render through ONE instanced batch (3 draw calls total); the whole
    // layer flips via group.visible. Numeric labels ride the annotation stream.
    this.loadGpuRenderer.setVisible(this.visibility?.loads ?? true)
    this.reactionViz?.refresh()
    this.syncGpuAnnotations()
  }

  private onResize = () => 

  {
    const width = this.container?.clientWidth || window.innerWidth
    const height = this.container?.clientHeight || window.innerHeight
    this.camera.handleResize()
    this.renderer.setSize(width, height)
    this.gizmo.update()
    this.labeler.renderer.setSize(width, height)
  }

  private update = () => {
    // FPS meter (Settings → View → Show FPS): smooth over a ~500 ms window.
    // The first frame only seeds the baseline so the initial sample is not
    // polluted by the time spent before the loop started.
    const now = performance.now()
    const frameUpdateStartedAt = now
    if (this.fpsLastFrameTime) {
      this.fpsFrameCount++
      this.fpsAccumMs += now - this.fpsLastFrameTime
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
    if (this.renderMode === 'thin-shell') this.thinShellRenderer?.syncDirty()
    if (this.renderMode !== 'solid-extrude') this.centerlineRenderer?.syncDirty()
    this.nodes?.forEach((node) => node.updateScreenScale?.());
    this.gpuAnnotations?.update(
      this.structuralSceneDB,
      this.camera.cam,
      this.container?.clientWidth || window.innerWidth,
      this.container?.clientHeight || window.innerHeight,
    )
    // Grid end bubbles keep a constant on-screen size, just like the nodes.
    this.grids?.forEach((grid) => grid.updateScreenScale());
    const renderStartedAt = performance.now()
    const updateMs = renderStartedAt - frameUpdateStartedAt
    this.renderer.render(this.scene, this.camera.cam);
    const renderSubmitMs = performance.now() - renderStartedAt
    this.performanceBenchmark?.recordFrame(now, updateMs, renderSubmitMs)
    // While the nav cube animates a face-click it owns the camera pose; a
    // concurrent OrbitControls update() would re-roll the orientation mid-flight.
    if (!this.gizmo?.animating) this.camera.controls.update()
    this.camera.directionalLight.target.position.copy(this.camera.controls.target)
    this.camera.directionalLight.target.updateMatrixWorld()
    requestAnimationFrame(this.update);
    this.gizmo?.render()
    const labelRenderStartedAt = performance.now()
    this.labeler?.renderer.render(this.scene, this.camera.cam)
    this.performanceBenchmark?.recordLabelRender(performance.now() - labelRenderStartedAt)
  }

  public dispose = () => {
    function removeObjWithChildren(obj: THREE.Object3D) {
      if (obj.children.length > 0) {
        for (let x = obj.children.length - 1; x >= 0; x--) {
          removeObjWithChildren(obj.children[x])
        }
      }
      if (obj instanceof THREE.Mesh) {
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
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost)
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.container.removeChild(this.renderer.domElement)
    this.containerResizeObserver?.disconnect()
    this.containerResizeObserver = null
    this.selector.dispose()
    this.labeler.dispose()
    this.levelVisual?.dispose()
    this.workPlaneReferenceVisual?.dispose()
    this.centerlineRenderer?.dispose()
    this.thinShellRenderer?.dispose()
    this.diagramRenderer?.dispose()
    this.gpuAnnotations?.dispose()
    this.loadGpuRenderer?.dispose()
    this.resultStore?.dispose()
    this.structuralPicker?.dispose()
    this.structuralDocumentBridge.dispose()
    this.legacyStructuralRoot.clear()
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
    this.executeCommand({
      commandId: crypto.randomUUID(), type: 'ClearModel', schemaVersion: '1.0',
      modelRevision: this.structuralDocument.revision, source: 'ui', payload: { confirmed: true },
    }, { allowDestructive: true })
    this.selector?.clear()
    // GridSystem remains a legacy editor datum until its own command lands.
    const grids = [...this.grids]
    grids.forEach(grid => grid.delete())
    this.grids = []
    this.labeler.deleteAll('effort')
  }

  public invalidateResults = () => {
    this.postProcessing.dispose()
    this.reactionViz.dispose()
    this.resultStore.clear()
    this.clearStructuralResult()
    this.output = null
    this.analysisRevision = null
    this.analysisSnapshotHash = null
  }

  private onContextLost = (event: Event) => {
    event.preventDefault()
    this.contextLost = true
  }

  private onContextRestored = () => {
    this.contextLost = false
    this.syncStructuralSceneDB()
    this.gpuAnnotations.markDirty()
    if (this.activeResultBinding) this.bindStructuralResult(this.resultStore.getBinding(
      this.activeResultBinding.caseKey,
      this.activeResultBinding.component,
    ))
    this.applyRenderModeVisibility()
  }

  public bindStructuralResult = (binding: ResultBinding | null, min?: number, max?: number) => {
    this.activeResultBinding = binding
    this.gpuAnnotations?.setSelectedValueProvider(binding ? (entityId) => {
      const value = this.resultStore.sample(binding.caseKey, binding.component, entityId)
      return Number.isFinite(value) ? `${binding.component}=${value.toPrecision(5)}` : null
    } : null)
    this.centerlineRenderer.bindResult(binding)
    this.thinShellRenderer.bindResult(binding)
    if (binding && min !== undefined && max !== undefined) {
      this.centerlineRenderer.setResultRange(min, max)
      this.thinShellRenderer.setResultRange(min, max)
    }
  }

  public clearStructuralResult = () => {
    this.centerlineRenderer?.bindResult(null)
    this.thinShellRenderer?.bindResult(null)
    this.diagramRenderer?.hide()
    this.gpuAnnotations?.setResultLabels([])
  }

  public setDiagramExtremaLabels(
    component: string,
    scale: number,
    extrema: { min: number; max: number; minMemberId: number | null; maxMemberId: number | null; minU: number; maxU: number },
    unit = '',
  ) {
    const at = (entityId: number | null, u: number, value: number, prefix: 'MIN' | 'MAX') => {
      if (entityId === null) return null
      const index = this.structuralSceneDB.memberIndexById.get(entityId)
      if (index === undefined) return null
      const o = index * 6
      const start = [this.structuralSceneDB.memberEndpoints[o], this.structuralSceneDB.memberEndpoints[o + 1], this.structuralSceneDB.memberEndpoints[o + 2]] as const
      const end = [this.structuralSceneDB.memberEndpoints[o + 3], this.structuralSceneDB.memberEndpoints[o + 4], this.structuralSceneDB.memberEndpoints[o + 5]] as const
      const r = index * 3
      const reference = [this.structuralSceneDB.memberReferenceAxes[r], this.structuralSceneDB.memberReferenceAxes[r + 1], this.structuralSceneDB.memberReferenceAxes[r + 2]] as const
      const frame = computeMemberFrame(start, end, reference, this.structuralSceneDB.memberGammaRadians[index])
      const direction = component === 'V3' || component === 'M2' ? frame.z : frame.y
      const anchor = [
        start[0] + (end[0] - start[0]) * u + direction[0] * value * scale,
        start[1] + (end[1] - start[1]) * u + direction[1] * value * scale,
        start[2] + (end[2] - start[2]) * u + direction[2] * value * scale,
      ] as const
      return {
        id: `result-${prefix}-${entityId}`,
        text: `${prefix} ${component} ${Number(value.toPrecision(5))}${unit ? ` ${unit}` : ''}`,
        anchor,
        priority: 'extrema' as const,
        color: [1, .75, .14] as const,
      }
    }
    this.gpuAnnotations.setResultLabels([
      at(extrema.minMemberId, extrema.minU, extrema.min, 'MIN'),
      at(extrema.maxMemberId, extrema.maxU, extrema.max, 'MAX'),
    ].filter(Boolean) as import('./Rendering/GpuAnnotations').WorldLabelCandidate[])
  }

  public runResultBenchmark = async () => {
    const benchmark = this.performanceBenchmark
    if (benchmark.resultRunning || this.structuralSceneDB.memberCount === 0) return
    benchmark.resultRunning = true
    try {
      const stationCount = 20
      const caseInput = (key: string, phase: number) => ({
        key,
        members: Array.from({ length: this.structuralSceneDB.memberCount }, (_, memberIndex) => ({
          entityId: this.structuralSceneDB.memberIds[memberIndex],
          stations: Array.from({ length: stationCount }, (_, stationIndex) => {
            const u = stationIndex / (stationCount - 1)
            const wave = Math.sin(u * Math.PI * (1 + memberIndex % 3) + phase)
            return {
              position: u,
              values: {
                N: wave * 800, V2: wave * 240, V3: -wave * 180,
                T: wave * 90, M2: wave * 420, M3: -wave * 360,
                stress: wave * 500, strain: wave * .002,
              },
            }
          }),
        })),
      })
      const ingestStarted = performance.now()
      this.resultStore.ingest(caseInput('benchmark-LC1', 0), this.structuralSceneDB)
      this.resultStore.ingest(caseInput('benchmark-LC2', Math.PI / 3), this.structuralSceneDB)
      const ingestMs = performance.now() - ingestStarted
      const lineGeometry = this.centerlineRenderer.lineGeometry
      const shellKeys = ['h', 'channel', 'angle', 'box', 'pipe']
      const shellGeometries = shellKeys.map(key => this.thinShellRenderer.batchGeometry(key))
      const diagramRibbonGeometry = this.diagramRenderer.ribbonGeometry
      const diagramLineGeometry = this.diagramRenderer.lineGeometry
      const switches: Array<{ caseKey: string; component: string; durationMs: number }> = []
      for (const [caseKey, component] of [
        ['benchmark-LC1', 'N'], ['benchmark-LC1', 'M2'], ['benchmark-LC2', 'stress'], ['benchmark-LC2', 'strain'],
      ] as const) {
        const started = performance.now()
        const binding = this.resultStore.getBinding(caseKey, component)
        this.bindStructuralResult(binding, binding?.min, binding?.max)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        switches.push({ caseKey, component, durationMs: Number((performance.now() - started).toFixed(2)) })
      }
      const identitiesStable = lineGeometry === this.centerlineRenderer.lineGeometry &&
        shellKeys.every((key, index) => shellGeometries[index] === this.thinShellRenderer.batchGeometry(key))
      const diagramSwitches: Array<{ component: string; durationMs: number }> = []
      for (const component of ['N', 'V2', 'V3', 'T', 'M2', 'M3']) {
        const started = performance.now()
        const binding = this.resultStore.getBinding('benchmark-LC1', component)
        if (!binding) continue
        this.diagramRenderer.show(binding, {
          component, scale: .01, min: binding.min, max: binding.max,
          contour: true, ribbon: true, hatch: true,
        })
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        diagramSwitches.push({ component, durationMs: Number((performance.now() - started).toFixed(2)) })
      }
      const diagramFrameSamples: number[] = []
      let previousFrame = performance.now()
      for (let index = 0; index < 30; index++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        const now = performance.now()
        diagramFrameSamples.push(now - previousFrame)
        previousFrame = now
      }
      const sortedFrames = [...diagramFrameSamples].sort((a, b) => a - b)
      const diagramFrameAvgMs = diagramFrameSamples.reduce((total, value) => total + value, 0) / diagramFrameSamples.length
      const diagramFrameP95Ms = sortedFrames[Math.min(sortedFrames.length - 1, Math.ceil(sortedFrames.length * .95) - 1)]
      const diagramIdentitiesStable = diagramRibbonGeometry === this.diagramRenderer.ribbonGeometry &&
        diagramLineGeometry === this.diagramRenderer.lineGeometry
      runInAction(() => {
        benchmark.resultReport = JSON.stringify({
          benchmarkVersion: 'viewer3d-result-v2',
          timestamp: new Date().toISOString(),
          backend: 'webgl2',
          fixture: { members: this.structuralSceneDB.memberCount, stationsPerMember: stationCount, cases: 2 },
          ingestMs: Number(ingestMs.toFixed(2)),
          switches,
          maxSwitchMs: Math.max(...switches.map(item => item.durationMs)),
          targetMs: 150,
          identitiesStable,
          diagram: {
            switches: diagramSwitches,
            maxSwitchMs: Math.max(...diagramSwitches.map(item => item.durationMs)),
            frameMsAvg: Number(diagramFrameAvgMs.toFixed(2)),
            frameMsP95: Number(diagramFrameP95Ms.toFixed(2)),
            fpsApprox: Number((1000 / diagramFrameAvgMs).toFixed(2)),
            drawCalls: this.renderer.info.render.calls,
            objects: 2,
            identitiesStable: diagramIdentitiesStable,
            targetFrameMs: 33.34,
          },
          pass: identitiesStable && diagramIdentitiesStable &&
            switches.every(item => item.durationMs <= 150) &&
            diagramSwitches.every(item => item.durationMs <= 150) && diagramFrameP95Ms <= 33.34,
        }, null, 2)
      })
    } finally {
      runInAction(() => { benchmark.resultRunning = false })
    }
  }

  public runAnnotationBenchmark = async () => {
    const benchmark = this.performanceBenchmark
    if (benchmark.resultRunning || this.structuralSceneDB.memberCount === 0) return
    benchmark.resultRunning = true
    try {
      this.visibility.showOrHideMemberLabels(true)
      const syntheticSymbols: import('./Rendering/GpuAnnotations').SymbolCandidate[] = []
      for (let i = 0; i < this.structuralSceneDB.memberCount; i++) {
        const o = i * 6
        syntheticSymbols.push({ anchor: [
          (this.structuralSceneDB.memberEndpoints[o] + this.structuralSceneDB.memberEndpoints[o + 3]) * .5,
          (this.structuralSceneDB.memberEndpoints[o + 1] + this.structuralSceneDB.memberEndpoints[o + 4]) * .5,
          (this.structuralSceneDB.memberEndpoints[o + 2] + this.structuralSceneDB.memberEndpoints[o + 5]) * .5,
        ], kind: 1, color: [1, .2, .15] })
      }
      this.gpuAnnotations.setData(syntheticSymbols)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const stats = this.gpuAnnotations.getStats()
      benchmark.resultReport = JSON.stringify({
        benchmarkVersion: 'viewer3d-annotations-v1',
        timestamp: new Date().toISOString(),
        model: { members: this.structuralSceneDB.memberCount, nodes: this.structuralSceneDB.nodeCount },
        ...stats,
        cssEntityLabels: this.labeler.count,
        pass: stats.drawObjects === 2 && stats.labelBudget <= 200 && this.labeler.count === 0,
      }, null, 2)
      this.syncGpuAnnotations()
    } finally {
      runInAction(() => { benchmark.resultRunning = false })
    }
  }

  updatePointerCoords = (event : MouseEvent) =>
  {

    const mouseLoc =  this.getMouseLocation(event)
    runInAction(() => {
      this.pointerCoords = new THREE.Vector3(mouseLoc.x, mouseLoc.y, this.pointerCoords.z)
    })
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
