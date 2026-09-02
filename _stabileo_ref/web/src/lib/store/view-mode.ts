/**
 * view-mode.ts — editing and reading results are two modes, never both.
 *
 * # The state this prevents
 *
 * The app can arm a drawing tool and show a diagram at the same time, and when
 * it does the interface claims something false: that you are placing nodes ON a
 * moment diagram. Nothing crashes; the ribbon simply lights a construction
 * command and a result command together, and the canvas shows a structure you
 * are apparently editing and a field you are apparently reading.
 *
 * They are different jobs. You build the model, you solve it, you read what
 * came out — and going back to building means the answer no longer describes
 * what is on screen.
 *
 * # Why this lives in a module rather than in a store
 *
 * The rule couples two stores: choosing a diagram must disarm a tool, and
 * arming a tool must clear the diagram. Putting it inside either one makes them
 * import each other. Putting it in the components that trigger it — which is
 * where it started — means every new entry point has to remember, and the
 * results toolbar did not: its diagram buttons wrote `diagramType` directly and
 * left whatever tool was armed exactly where it was.
 *
 * So the transitions are functions, both stores are imported here, and a caller
 * expresses INTENT ("show me this diagram") rather than performing two writes
 * and hoping they stay in step.
 */

import { uiStore, EDIT_TOOLS } from './ui.svelte';
import { resultsStore } from './results.svelte';
import type { DiagramType } from './results.svelte';

// The edit-tool list itself lives in ui.svelte.ts — this module imports that
// store, so the list cannot be defined here without closing an import cycle.
export { EDIT_TOOLS };

function isEditing(): boolean {
  return EDIT_TOOLS.includes(uiStore.currentTool);
}

/**
 * Show a diagram, leaving editing.
 *
 * Falls back to Select rather than to nothing: reading a result still needs a
 * pointer that can pick a member, and dropping the tool entirely would leave
 * the canvas inert.
 */
export function showDiagram(type: DiagramType): void {
  resultsStore.diagramType = type;
  if (type !== 'none' && isEditing()) uiStore.currentTool = 'select';
}

/**
 * Arm a build tool, putting the diagram away.
 *
 * Drawing on top of a result is the same contradiction seen from the other
 * side — and worse in practice, because the diagram is drawn over the members
 * you are trying to click.
 *
 * Thin now: the store's own setter enforces this, so every path arming a tool
 * gets it — including the floating tools, the keyboard shortcuts and the data
 * tabs, none of which call through here. This remains as the readable way to
 * say it from a component.
 */
export function armTool(tool: string): void {
  uiStore.currentTool = tool as never;
}

/**
 * Wire the store-level rule, in both directions. Called once, from the store
 * barrel.
 *
 * Registered rather than imported so neither store need know the other exists
 * — the two would otherwise import each other. The first hook covers arming a
 * tool; the second covers every direct `resultsStore.diagramType = …` write
 * (keyboard shortcuts, mobile panel, toolbars, url-sharing), which used to
 * leave an armed tool drawing on top of the diagram it had just asked for.
 */
export function installViewModeRules(): void {
  uiStore.onEditToolArmed(() => {
    if (resultsStore.diagramType !== 'none') resultsStore.diagramType = 'none';
  });
  resultsStore._setOnDiagramShown(() => {
    if (isEditing()) uiStore.currentTool = 'select';
  });
}

/**
 * The right panel's Model tabs. Reading one of these is editing, not analysing.
 */
export const MODEL_TABS = [
  'nodes', 'elements', 'supports', 'loads', 'materials', 'sections',
] as const;

/**
 * Keep "showing a diagram" and "showing the model" mutually exclusive.
 *
 * Expressed as an INVARIANT to be re-checked, not as an action performed by
 * whoever switches. The action version has been written three times now and
 * has missed a path every time: arming a tool was handled in the tool setter,
 * picking a diagram in `showDiagram`, and pressing Materials in the ribbon's
 * command handler — but the Materials TAB inside the panel changes the same
 * state without going through any of them, so after solving you could put the
 * panel on Materials and leave N lit in the ribbon beside it.
 *
 * Called from an effect on the panel state, so every path is covered by
 * construction: whatever sets the tab, the rule sees the result.
 */
export function syncModelTabWithResults(panel: string | null, tab: string): void {
  const showingModel = panel === 'data' && (MODEL_TABS as readonly string[]).includes(tab);
  if (showingModel && resultsStore.diagramType !== 'none') {
    resultsStore.diagramType = 'none';
  }
}

/** Whether a result is currently on screen. */
export function isShowingResult(): boolean {
  return resultsStore.diagramType !== 'none';
}
