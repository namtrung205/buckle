/**
 * The 3-D workspace's own state: what is open, what is selected, what is shown.
 *
 * ── Why a store and not component state ────────────────────────────
 *
 * The workspace is an overlay, and an overlay that is `{#if open}` unmounts when it closes.
 * Component state would therefore reset every time the user stepped back to the model to
 * check something — losing the layers they had turned off, the member they were looking at,
 * and the section they had cut. That is the opposite of "step out and come back".
 *
 * The MODEL is never touched by any of this. Nothing here writes to `modelStore`; opening and
 * closing the workspace is a view operation and the project is identical either side of it.
 *
 * ── What survives what: the persistence policy ─────────────────────
 *
 * Stated here because "does it remember my layers" has three different right answers depending
 * on what happened, and a viewer that is vague about which is which reads as broken:
 *
 *   CLOSING the workspace keeps everything — layers, section, selection, isolation, history.
 *   The user is stepping out to look at the model, not abandoning the inspection.
 *
 *   RELOADING the page resets every switch to its default: all families on, reinforcement on,
 *   concrete on, conflicts on, nothing isolated. Nothing here is written to storage, and that is
 *   deliberate rather than unfinished. The autosave restores the PROJECT, which is the user's
 *   work; the switch positions are a view of it, and a restore that brought back "columns
 *   hidden" would hand a returning user an incomplete picture of their own building with no
 *   indication that anything was missing. A default open shows everything the document contains.
 *
 *   A DOCUMENT CHANGE under the workspace calls `reset()`, which drops the selection, the
 *   isolation, the status filter and the section — they name things that may no longer exist —
 *   and leaves the LAYER switches alone, because a family is a family whatever the revision.
 *
 * ── Why the selection history is a stack ───────────────────────────
 *
 * Inspecting a cage is a walk: this column, then the footing under it, then back. A single
 * "previous" slot handles one step and then lies about the one before. A bounded stack
 * handles the walk and cannot grow without limit.
 */

import {
  SCENE_SOLID_KINDS, type SceneConflictMarker, type SceneFilter, type SceneSolidKind,
} from '../engine/detailing/scene-model';
import type { ElementStatus } from '../engine/detailing/element-status';

/** What the user has selected, however they selected it. */
export interface WorkspaceSelection {
  barId?: string;
  solidId?: string;
  /**
   * The conflict marker that was clicked, when the selection came from one.
   *
   * Carried on the selection rather than in a channel of its own so that "what is selected"
   * has exactly one answer. A second selection channel is how a panel comes to highlight one
   * thing while the viewport highlights another.
   */
  conflict?: SceneConflictMarker;
  /** The members involved. A bar continuous over a support names both. */
  elementIds: number[];
}

/** A section plane through the model. */
export interface WorkspaceSection {
  axis: 'x' | 'y' | 'z';
  /** Position along the axis, in model coordinates (m). */
  at: number;
  flip: boolean;
}

/**
 * Every concrete family, in the order the layer switches present them.
 *
 * Re-exported rather than re-listed. The renderer batches its meshes per family and the tally
 * counts per family, and a fourth copy of the same six strings is a fourth chance for one of them
 * to drift — a family missing from one list is a switch that quietly governs nothing.
 */
export const SOLID_KINDS: readonly SceneSolidKind[] = SCENE_SOLID_KINDS;

/** How deep the "go back" stack goes. */
const HISTORY_LIMIT = 20;

/**
 * The switch positions the scene filter is derived from.
 *
 * A plain record rather than the store itself, so the derivation below is a pure function of
 * its inputs and can be exercised without a component, a rune or a browser.
 */
export interface WorkspaceLayerState {
  /** Families the user has switched OFF. */
  hiddenKinds: readonly SceneSolidKind[];
  showBars: boolean;
  hideUnreinforced: boolean;
  /** Members the user has isolated. Empty means no isolation. */
  isolated: readonly number[];
  /**
   * Members a status filter admits, or null when no status filter is active.
   *
   * Null and `[]` are different states: `[]` means "no member matches" and must show nothing.
   * Passed in rather than read here because it is a join between the scene and the design
   * outcomes, and this module knows about neither.
   */
  statusElementIds: readonly number[] | null;
}

/**
 * The switch positions that are filter-shaped, as one `SceneFilter`.
 *
 * ── Why this is a function and not four lines in the component ─────
 *
 * It was four lines in the component, and that is where it was unreachable. This is the whole
 * translation from "what the user clicked" into "what the renderer draws", and the unit suite
 * could not see it: `RebarWorkspace.svelte` cannot be mounted in this project's test
 * environment, so every test that wanted to assert a toggle had to restate the translation
 * itself — and a test that restates the thing under test cannot fail when the thing under test
 * is wrong.
 *
 * `showConcrete` and `showConflicts` are deliberately NOT here. They are not filter axes: the
 * renderer answers them with a flag on a mesh, and folding them into the filter would make the
 * concrete's own switch a reason to recompute which bars are drawn.
 */
export function workspaceFilter(s: WorkspaceLayerState): SceneFilter {
  const f: SceneFilter = {};
  const kinds = SOLID_KINDS.filter((k) => !s.hiddenKinds.includes(k));
  // Absent means "no restriction". Writing the full list instead would make every switch-on
  // state look like a restriction to `needsPerBar`, which is the difference between a flag and
  // an index rewrite on a scene of 20 917 bars.
  if (kinds.length !== SOLID_KINDS.length) f.solidKinds = kinds;
  if (!s.showBars) f.hideBars = true;
  if (s.hideUnreinforced) f.hideUnreinforced = true;
  // Isolation wins over the status filter: it is the more specific gesture, and the user
  // performed it more recently.
  if (s.isolated.length > 0) f.elementIds = [...s.isolated];
  else if (s.statusElementIds) f.elementIds = [...s.statusElementIds];
  return f;
}

/**
 * Whether two selections point at the same thing.
 *
 * Exported so the rule is testable on its own: it is the whole reason the history works, and
 * it failed silently the first time by comparing only fields that are usually undefined.
 */
export function sameSelection(
  a: WorkspaceSelection | null, b: WorkspaceSelection | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.barId === b.barId
    && a.solidId === b.solidId
    && a.elementIds.length === b.elementIds.length
    && a.elementIds.every((id, i) => id === b.elementIds[i]);
}

function createRebarWorkspace() {
  let open = $state(false);
  let selection = $state<WorkspaceSelection | null>(null);
  let history = $state<WorkspaceSelection[]>([]);

  // ── Layers ──────────────────────────────────────────────────
  let hiddenKinds = $state<SceneSolidKind[]>([]);
  let showBars = $state(true);
  let showConcrete = $state(true);
  let showConflicts = $state(true);
  let hideUnreinforced = $state(false);
  let diameterScale = $state(1);
  let concreteOpacity = $state(1);

  // ── Status filter ───────────────────────────────────────────
  let statusFilter = $state<ElementStatus[]>([]);
  /** Members the user has isolated. Empty means no isolation, which is not the same as none. */
  let isolated = $state<number[]>([]);

  // ── Section ─────────────────────────────────────────────────
  let section = $state<WorkspaceSection | null>(null);

  /**
   * A monotonic request to point the camera at a member.
   *
   * A nonce rather than a plain id, because focusing the SAME member twice is a real
   * gesture — the user has orbited away and wants to come back — and an id that has not
   * changed would not re-trigger the effect that performs it.
   */
  let focusRequest = $state<{ elementId: number; nonce: number } | null>(null);
  let nonce = 0;

  return {
    get open() { return open; },
    get selection() { return selection; },
    get history() { return history; },
    get canGoBack() { return history.length > 0; },

    get hiddenKinds() { return hiddenKinds; },
    get showBars() { return showBars; },
    set showBars(v: boolean) { showBars = v; },
    get showConcrete() { return showConcrete; },
    set showConcrete(v: boolean) { showConcrete = v; },
    get showConflicts() { return showConflicts; },
    set showConflicts(v: boolean) { showConflicts = v; },
    get hideUnreinforced() { return hideUnreinforced; },
    set hideUnreinforced(v: boolean) { hideUnreinforced = v; },
    get diameterScale() { return diameterScale; },
    set diameterScale(v: number) { diameterScale = v; },
    get concreteOpacity() { return concreteOpacity; },
    set concreteOpacity(v: number) { concreteOpacity = v; },
    get statusFilter() { return statusFilter; },
    get isolated() { return isolated; },
    get section() { return section; },
    get focusRequest() { return focusRequest; },

    /** The kinds to DRAW, which is what the scene filter wants. */
    visibleKinds(): SceneSolidKind[] {
      return SOLID_KINDS.filter((k) => !hiddenKinds.includes(k));
    },

    /**
     * The scene filter these switches describe.
     *
     * Every field it reads is `$state`, so a `$derived` that calls this subscribes to all of
     * them — the switches stay reactive and the translation stays testable, which is the point
     * of it being a function at all.
     */
    filterFor(statusElementIds: readonly number[] | null): SceneFilter {
      return workspaceFilter({
        hiddenKinds, showBars, hideUnreinforced, isolated, statusElementIds,
      });
    },

    openWorkspace() { open = true; },
    /**
     * Close, keeping everything else.
     *
     * The user is stepping out to look at the model, not abandoning the inspection. Resetting
     * the layers and the selection here would make "check something and come back" cost the
     * whole setup every time.
     */
    close() { open = false; },

    toggleKind(kind: SceneSolidKind) {
      hiddenKinds = hiddenKinds.includes(kind)
        ? hiddenKinds.filter((k) => k !== kind)
        : [...hiddenKinds, kind];
    },

    toggleStatus(s: ElementStatus) {
      statusFilter = statusFilter.includes(s)
        ? statusFilter.filter((x) => x !== s)
        : [...statusFilter, s];
    },
    clearStatusFilter() { statusFilter = []; },

    isolate(elementIds: number[]) { isolated = [...elementIds]; },
    clearIsolation() { isolated = []; },

    /**
     * Select a conflict, isolate the two members it names, and point the camera at it.
     *
     * One call, because these three are one intent. A user who clicks a red dot in a cage of
     * twenty thousand bars is asking "what is this and where am I" — answering only the first
     * leaves them looking at the same wall of steel with a fuller panel.
     *
     * `isolateMembers` is optional because the same conflict is also reached from the detailing
     * panel's row, where the user may be stepping through a list and would not thank an
     * isolation that changes what they can see between rows.
     */
    selectConflict(conflict: SceneConflictMarker, opts: { isolateMembers?: boolean } = {}) {
      this.select({ conflict, elementIds: [...conflict.elementIds] });
      if (opts.isolateMembers && conflict.elementIds.length > 0) {
        isolated = [...conflict.elementIds];
      }
      const first = conflict.elementIds[0];
      if (first !== undefined) {
        nonce += 1;
        focusRequest = { elementId: first, nonce };
      }
    },

    setSection(next: WorkspaceSection | null) { section = next; },

    /**
     * Select something, remembering what was selected before.
     *
     * The previous selection goes on the stack only when it exists and differs, so clicking
     * the same member twice does not fill the history with itself.
     */
    select(next: WorkspaceSelection | null) {
      /**
       * Identity includes the MEMBERS, not only the bar and solid ids.
       *
       * Selecting from the member list produces a selection with neither a `barId` nor a
       * `solidId` — just the element. Comparing on those two alone made every list selection
       * identical to every other (`undefined === undefined` twice), so nothing was ever
       * pushed and "go back" never appeared. The bug is invisible when clicking in the
       * viewport, where bar ids differ, and total when clicking in the list.
       */
      if (selection && !sameSelection(selection, next)) {
        history = [...history, selection].slice(-HISTORY_LIMIT);
      }
      selection = next;
    },

    /** Step back to the previous selection, and point the camera at it. */
    goBack(): WorkspaceSelection | null {
      const prev = history[history.length - 1];
      if (!prev) return null;
      history = history.slice(0, -1);
      selection = prev;
      if (prev.elementIds.length > 0) {
        nonce += 1;
        focusRequest = { elementId: prev.elementIds[0], nonce };
      }
      return prev;
    },

    /** Ask the viewport to centre on a member. */
    focus(elementId: number) {
      nonce += 1;
      focusRequest = { elementId, nonce };
    },

    /**
     * Select a member from the list AND point the camera at it.
     *
     * One action because they are one intention. A list that selects without moving the
     * camera makes the user hunt for what they just clicked in a cage of thousands of bars.
     */
    selectAndFocus(elementId: number) {
      this.select({ elementIds: [elementId] });
      this.focus(elementId);
    },

    /** Full reset. Used when the document changes under the workspace. */
    reset() {
      selection = null;
      history = [];
      isolated = [];
      statusFilter = [];
      section = null;
      focusRequest = null;
    },
  };
}

export const rebarWorkspace = createRebarWorkspace();
