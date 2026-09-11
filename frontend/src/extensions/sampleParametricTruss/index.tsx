import { useLayoutEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import { useContributions, useModel } from '../../model/Context';
import { createPluginCommandBroker } from '../../core/plugins';
import type { ContributionBundle, ContributionOwner, PluginCommandBroker } from '../../core/plugins';
import type { StructuralCommand } from '../../core/structural/commands';

/**
 * Goal 5 sample: a parametric truss generator. The plugin reads the canonical
 * snapshot for collision-free ids, derives a simply-supported Pratt truss from
 * its parameters (bays / bay width / height) and commits the whole structure —
 * material, section, nodes, chords, verticals and diagonals — as one previewed
 * Transaction (one undo step). Geometry-only: no host internals imported.
 */
const owner: ContributionOwner = { kind: 'plugin', id: 'com.buckle.samples.truss', version: '0.1.0' };
const NS = `${owner.id}.`;
const GRANTS = [
  'model.read',
  'model.write.nodes', 'model.write.members',
  'model.write.materials', 'model.write.sections',
] as const;

const bundle: ContributionBundle = {
  ribbonTabs: [{ id: `${NS}tab`, label: 'Samples', order: 62 }],
  commands: [
    {
      id: `${NS}generate`,
      title: 'Generate a parametric Pratt truss in one undo step',
      execute: () => void generateTruss({ bays: 4, bayWidth: 4, height: 3 }),
    },
    {
      id: `${NS}generateWide`,
      title: 'Generate a wide parametric truss (8 bays) in one undo step',
      execute: () => void generateTruss({ bays: 8, bayWidth: 3, height: 3.5 }),
    },
  ],
  ribbon: [
    {
      id: `${NS}ribbon.truss`,
      tabId: `${NS}tab`,
      groupId: 'truss',
      groupLabel: 'Truss',
      commandId: `${NS}generate`,
      label: 'Truss 4×4m',
      title: 'Sample plugin — parametric Pratt truss, 4 bays × 4 m, height 3 m',
    },
    {
      id: `${NS}ribbon.trussWide`,
      tabId: `${NS}tab`,
      groupId: 'truss',
      groupLabel: 'Truss',
      commandId: `${NS}generateWide`,
      label: 'Truss 8×3m',
      title: 'Sample plugin — parametric Pratt truss, 8 bays × 3 m, height 3.5 m',
    },
  ],
};

let session: PluginCommandBroker | null = null;

type Operation = Extract<StructuralCommand, { type: 'Transaction' }>['payload']['operations'][number];
type NodeInput = { id: number; position: readonly [number, number, number] };
type MemberInput = { id: number; nodeI: number; nodeJ: number; sectionId: number };
export type TrussParams = Readonly<{ bays: number; bayWidth: number; height: number }>;

/** Build the node/member chain of a Pratt truss from parameters. */
export const planTruss = (params: TrussParams, baseId: number, sectionId: number) => {
  const { bays, bayWidth, height } = params;
  const nodes: NodeInput[] = [];
  const members: MemberInput[] = [];
  let id = baseId;
  const bottom: number[] = [];
  for (let index = 0; index <= bays; index++) {
    const nodeId = id++;
    nodes.push({ id: nodeId, position: [index * bayWidth, 0, 0] });
    bottom.push(nodeId);
  }
  const top: number[] = [];
  for (let index = 0; index < bays; index++) {
    const nodeId = id++;
    nodes.push({ id: nodeId, position: [(index + 0.5) * bayWidth, height, 0] });
    top.push(nodeId);
  }
  const member = (nodeI: number, nodeJ: number) => members.push({ id: id++, nodeI, nodeJ, sectionId });
  for (let index = 0; index < bays; index++) {
    member(bottom[index], bottom[index + 1]);        // bottom chord
    if (index + 1 < bays) member(top[index], top[index + 1]); // top chord
    member(bottom[index + 1], top[index]);           // vertical
    member(bottom[index], top[index]);               // diagonal
  }
  return { nodes, members };
};

const generateTruss = async (params: TrussParams) => {
  if (!session) return;
  try {
    const snapshot = session.query() as Record<string, readonly { id: number }[] | undefined>;
    const ids: number[] = [];
    for (const key of ['nodes', 'materials', 'sections', 'members']) {
      for (const record of snapshot[key] ?? []) ids.push(record.id);
    }
    let next = (ids.length ? Math.max(...ids) : 0) + 1;

    const operations: Operation[] = [];
    let sectionId = (snapshot.sections ?? [])[0]?.id;
    if (sectionId === undefined) {
      const materialId = next++;
      sectionId = next++;
      operations.push(
        { type: 'CreateOrUpdateMaterials', payload: { materials: [{ id: materialId, name: 'Truss steel (sample)', E: 210e9, nu: 0.3 }] } },
        { type: 'CreateOrUpdateSections', payload: { sections: [{ id: sectionId, name: 'Truss chord (sample)', type: 'I', materialId, depth: 200, width: 100 }] } },
      );
    }

    const planned = planTruss(params, next, sectionId);
    if (planned.nodes.length) operations.push({ type: 'CreateNodes', payload: { nodes: planned.nodes } });
    operations.push({ type: 'CreateMembers', payload: { members: planned.members } });

    const request = { command: { type: 'Transaction', payload: { operations } } } as const;
    const previewed = session.preview(request);
    if (!previewed.ok) {
      session.notify(`Preview rejected: ${previewed.message}`, 'error');
      return;
    }
    const committed = session.execute(request);
    if (!committed.ok) {
      session.notify(`Commit failed: ${committed.message}`, 'error');
      return;
    }
    session.notify(
      `Generated a ${params.bays}-bay truss (${planned.nodes.length} nodes, ${planned.members.length} members) in one undo step (rev ${committed.result.previousRevision} → ${committed.result.revision}).`,
      'success',
    );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
};

const SampleParametricTruss = () => {
  const model = useModel();
  const contributions = useContributions();
  useLayoutEffect(() => contributions.register(owner, bundle), [contributions]);
  useMemo(() => {
    session = model
      ? createPluginCommandBroker({
        ...model.pluginCommandServices(),
        notify: (message, kind) => {
          if (kind === 'error') toast.error(message, { position: 'bottom-right', autoClose: 4000 });
          else if (kind === 'success') toast.success(message, { position: 'bottom-right', autoClose: 4000 });
          else toast.info(message, { position: 'bottom-right', autoClose: 4000 });
        },
        approver: info => window.confirm(`${info.message}\n\nAllow the sample plugin to proceed?`),
      }, owner, GRANTS)
      : null;
  }, [model, contributions]);
  return null;
};

export default SampleParametricTruss;
