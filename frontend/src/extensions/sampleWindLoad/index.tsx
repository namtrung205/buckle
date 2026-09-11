import { useLayoutEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import { useContributions, useModel } from '../../model/Context';
import { createPluginCommandBroker } from '../../core/plugins';
import type { ContributionBundle, ContributionOwner, PluginCommandBroker } from '../../core/plugins';

/**
 * Goal 2 vertical slice (roadmap §10 + exit gate): a real plugin-kind owner
 * driving every mutation through the plugin command broker — selection read,
 * dry-run preview, host approval prompt for destructive commits, audited
 * transactions and host-owned undo. External package loading stays a Goal 4
 * deliverable; this slice validates the broker from in-host code.
 */
const owner: ContributionOwner = { kind: 'plugin', id: 'com.buckle.samples.windload', version: '0.0.2' };
const NS = `${owner.id}.`;
const GRANTS = [
  'model.read', 'workspace.readSelection',
  'model.write.nodes', 'model.write.members',
  'model.write.materials', 'model.write.sections', 'model.write.loads',
  'ui.panel',
] as const;

const bundle: ContributionBundle = {
  ribbonTabs: [{ id: `${NS}tab`, label: 'Samples', order: 60 }],
  commands: [
    {
      id: `${NS}openPanel`,
      title: 'Open the sample wind load dock panel',
      execute: () => session?.openPanel(`${NS}panel`),
    },
    {
      id: `${NS}assign`,
      title: 'Assign a sample wind load to the selected members',
      execute: () => assignSampleWindLoad(),
    },
    {
      id: `${NS}build`,
      title: 'Build a sample frame with a wind load in one undo step',
      execute: () => buildSampleFrame(),
    },
  ],
  ribbon: [
    {
      id: `${NS}ribbon.build`,
      tabId: `${NS}tab`,
      groupId: 'sample',
      groupLabel: 'Sample',
      commandId: `${NS}build`,
      label: 'Build frame',
      title: 'Sample plugin — material, section, nodes, member and wind load in one undo step',
    },
    {
      id: `${NS}ribbon.assign`,
      tabId: `${NS}tab`,
      groupId: 'sample',
      groupLabel: 'Sample',
      commandId: `${NS}assign`,
      label: 'Assign wind',
      title: 'Sample plugin — preview then assign one linear wind load to selected members',
    },
    {
      id: `${NS}ribbon.panel`,
      tabId: `${NS}tab`,
      groupId: 'sample',
      groupLabel: 'Sample',
      commandId: `${NS}openPanel`,
      label: 'Wind panel',
      title: 'Sample plugin — sandboxed dock panel',
    },
  ],
  panels: [{
    id: `${NS}panel`,
    title: 'Wind load (sample)',
    entry: '/extensions/sample-wind-load/panel.html',
  }],
};

let session: PluginCommandBroker | null = null;

/** Exit gate: create nodes/members and assign a load in one undo step. */
const buildSampleFrame = () => {
  if (!session) return;
  try {
    // Read the canonical snapshot (model.read grant) to pick collision-free ids.
    const snapshot = session.query() as Record<string, readonly { id: number }[] | undefined>;
    const ids: number[] = [];
    for (const key of ['nodes', 'materials', 'sections', 'members', 'loads']) {
      for (const record of snapshot[key] ?? []) ids.push(record.id);
    }
    const base = (ids.length ? Math.max(...ids) : 0) + 1;
    const request = {
      command: { type: 'Transaction', payload: { operations: [
        { type: 'CreateOrUpdateMaterials', payload: { materials: [
          { id: base, name: 'Sample steel (plugin)', E: 210e9, nu: 0.3 },
        ] } },
        { type: 'CreateOrUpdateSections', payload: { sections: [
          { id: base + 1, name: 'Sample I200 (plugin)', type: 'I', materialId: base, depth: 200, width: 100 },
        ] } },
        { type: 'CreateNodes', payload: { nodes: [
          { id: base + 2, position: [0, 0, 0] },
          { id: base + 3, position: [4, 0, 0] },
        ] } },
        { type: 'CreateMembers', payload: { members: [
          { id: base + 4, nodeI: base + 2, nodeJ: base + 3, sectionId: base + 1 },
        ] } },
        { type: 'CreateOrUpdateLoads', payload: { loads: [
          { type: 'linear', targetIds: [base + 4], value: [0, -1, 0], magnitude: 5, name: 'Sample wind (plugin)' },
        ] } },
      ] } },
    } as const;
    const previewed = session.preview(request);
    if (!previewed.ok) {
      session.notify(`Preview rejected: ${previewed.message}`, 'error');
      return;
    }
    const outcome = session.execute(request);
    if (!outcome.ok) {
      session.notify(`Build failed: ${outcome.message}`, 'error');
      return;
    }
    session.notify(
      `Sample frame built in one undo step (rev ${outcome.result.previousRevision} → ${outcome.result.revision}).`,
      'success',
    );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
};

const assignSampleWindLoad = () => {
  if (!session) return;
  try {
    const memberIds = session.getSelection()
      .filter(ref => ref.collection === 'members')
      .map(ref => ref.id);
    if (!memberIds.length) {
      session.notify('Select members first, then assign the sample wind load.', 'error');
      return;
    }
    const request = {
      command: {
        type: 'Transaction',
        payload: {
          operations: [{
            type: 'CreateOrUpdateLoads',
            payload: {
              loads: [{
                type: 'linear',
                targetIds: memberIds,
                value: [0, -1, 0],
                magnitude: 5,
                name: 'Wind (sample)',
              }],
            },
          }],
        },
      },
    } as const;
    const previewed = session.preview(request);
    if (!previewed.ok) {
      session.notify(`Preview rejected: ${previewed.message}`, 'error');
      return;
    }
    const outcome = session.execute(request);
    if (!outcome.ok) {
      session.notify(`Assign failed: ${outcome.message}`, 'error');
      return;
    }
    session.notify(
      `Wind load assigned to ${memberIds.length} member(s) in one undo step (rev ${outcome.result.previousRevision} → ${outcome.result.revision}).`,
      'success',
    );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
};

const SampleWindLoad = () => {
  const model = useModel();
  const contributions = useContributions();
  useLayoutEffect(() => contributions.register(owner, bundle), [contributions]);
  useMemo(() => {
    session = model
      ? createPluginCommandBroker({
        ...model.pluginCommandServices(),
        events: model.pluginEventBus(),
        hasPanel: id => contributions.listPanels().some(panel => panel.id === id),
        openPanel: id => contributions.openPanel(id),
        notify: (message, kind) => {
          if (kind === 'error') toast.error(message, { position: 'bottom-right', autoClose: 4000 });
          else if (kind === 'success') toast.success(message, { position: 'bottom-right', autoClose: 4000 });
          else toast.info(message, { position: 'bottom-right', autoClose: 4000 });
        },
        // Host approval prompt for destructive plugin commits.
        approver: info => window.confirm(`${info.message}\n\nAllow the sample plugin to proceed?`),
      }, owner, GRANTS)
      : null;
  }, [model, contributions]);
  return null;
};

export default SampleWindLoad;

