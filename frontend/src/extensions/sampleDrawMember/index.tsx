import { useEffect, useLayoutEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import { useContributions, useModel } from '../../model/Context';
import { createPluginCommandBroker } from '../../core/plugins';
import { pluginSessions } from '../../core/plugins/PluginSessionRegistry';
import type { ContributionBundle, ContributionOwner, PluginCommandBroker } from '../../core/plugins';
import type { DrawPolylineSpec, InteractionSnapOption } from '../../core/interaction';
import type { StructuralCommand } from '../../core/structural/commands';

/**
 * Goal 3 exit-gate slice: a plugin-driven "Draw Member" flow. The plugin asks
 * the host for one viewport interaction session (single-owner, snap-aware),
 * turns the returned polyline into a node/member chain — reusing snapped
 * nodes instead of creating duplicates — and commits everything as one
 * previewed Transaction (one undo step). Works on the active workplane
 * (plan mode) and node-to-node in true 3D.
 */
const owner: ContributionOwner = { kind: 'plugin', id: 'com.buckle.samples.drawmember', version: '0.1.0' };
const NS = `${owner.id}.`;
const GRANTS = [
  'model.read', 'viewport.draw', 'viewport.zoomTo',
  'model.write.nodes', 'model.write.members',
  'model.write.materials', 'model.write.sections',
] as const;

const bundle: ContributionBundle = {
  ribbonTabs: [{ id: `${NS}tab`, label: 'Draw', order: 61 }],
  commands: [
    {
      id: `${NS}drawPlan`,
      title: 'Draw members on the active workplane (grid + node snapping)',
      execute: () => void drawMembers('activeWorkplane', ['node', 'endpoint', 'member', 'grid']),
    },
    {
      id: `${NS}draw3d`,
      title: 'Draw members node-to-node in 3D (existing geometry snapping only)',
      execute: () => void drawMembers('world', ['node', 'endpoint', 'member']),
    },
  ],
  ribbon: [
    {
      id: `${NS}ribbon.plan`,
      tabId: `${NS}tab`,
      groupId: 'draw',
      groupLabel: 'Draw',
      commandId: `${NS}drawPlan`,
      label: 'Member (plan)',
      title: 'Sample plugin — draw a member chain on the active workplane in one undo step',
    },
    {
      id: `${NS}ribbon.3d`,
      tabId: `${NS}tab`,
      groupId: 'draw',
      groupLabel: 'Draw',
      commandId: `${NS}draw3d`,
      label: 'Member (3D)',
      title: 'Sample plugin — draw a member chain node-to-node in 3D in one undo step',
    },
  ],
};

let session: PluginCommandBroker | null = null;

type Operation = Extract<StructuralCommand, { type: 'Transaction' }>['payload']['operations'][number];

/** Run one draw session and commit the resulting chain as one Transaction. */
const drawMembers = async (plane: DrawPolylineSpec['plane'], snap: readonly InteractionSnapOption[]) => {
  if (!session) return;
  try {
    const drawn = await session.drawPolyline({ kind: 'drawPolyline', plane, snap, minVertices: 2 });
    if (!drawn.ok) {
      session.notify(`Draw failed: ${drawn.message}`, drawn.code === 'CANCELLED' ? 'info' : 'error');
      return;
    }
    if (drawn.result.kind !== 'drawPolyline') return;
    const vertices = drawn.result.vertices;

    // Collision-free ids from the canonical snapshot (model.read grant).
    const snapshot = session.query() as Record<string, readonly { id: number }[] | undefined>;
    const ids: number[] = [];
    for (const key of ['nodes', 'materials', 'sections', 'members', 'loads']) {
      for (const record of snapshot[key] ?? []) ids.push(record.id);
    }
    let next = (ids.length ? Math.max(...ids) : 0) + 1;

    const operations: Operation[] = [];
    // Reuse an existing section, or create material + section in this transaction.
    let sectionId = (snapshot.sections ?? [])[0]?.id;
    if (sectionId === undefined) {
      const materialId = next++;
      sectionId = next++;
      operations.push(
        { type: 'CreateOrUpdateMaterials', payload: { materials: [{ id: materialId, name: 'Sample steel (draw)', E: 210e9, nu: 0.3 }] } },
        { type: 'CreateOrUpdateSections', payload: { sections: [{ id: sectionId, name: 'Sample I200 (draw)', type: 'I', materialId, depth: 200, width: 100 }] } },
      );
    }

    // Snap provenance: a vertex snapped to an existing node reuses it instead
    // of creating a duplicate at the same position (3D node-to-node support).
    const createdNodes: { id: number; position: readonly [number, number, number] }[] = [];
    const vertexNodeIds = vertices.map(vertex => {
      if (vertex.snappedNodeId !== undefined) return vertex.snappedNodeId;
      const id = next++;
      createdNodes.push({ id, position: vertex.position });
      return id;
    });
    if (createdNodes.length) {
      operations.push({ type: 'CreateNodes', payload: { nodes: createdNodes } });
    }

    const members: { id: number; nodeI: number; nodeJ: number; sectionId: number }[] = [];
    for (let index = 0; index + 1 < vertices.length; index++) {
      const nodeI = vertexNodeIds[index];
      const nodeJ = vertexNodeIds[index + 1];
      if (nodeI === nodeJ) continue;
      members.push({ id: next++, nodeI, nodeJ, sectionId });
    }
    if (!members.length) {
      session.notify('Nothing to create — pick distinct points (Esc to cancel).', 'info');
      return;
    }
    operations.push({ type: 'CreateMembers', payload: { members } });

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
      `Drew ${members.length} member(s) (${createdNodes.length} new node(s)) in one undo step (rev ${committed.result.previousRevision} → ${committed.result.revision}).`,
      'success',
    );
    session.zoomTo({ kind: 'entities', entities: members.map(member => ({ collection: 'members' as const, id: member.id })) });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
};

const SampleDrawMember = () => {
  const model = useModel();
  const contributions = useContributions();
  useLayoutEffect(() => contributions.register(owner, bundle), [contributions]);
  // Publish the live session (no panel yet, keeps the registry consistent).
  useEffect(() => () => { pluginSessions.set(owner.id, null); }, []);
  useMemo(() => {
    session = model
      ? createPluginCommandBroker({
        ...model.pluginCommandServices(),
        notify: (message, kind) => {
          if (kind === 'error') toast.error(message, { position: 'bottom-right', autoClose: 4000 });
          else if (kind === 'success') toast.success(message, { position: 'bottom-right', autoClose: 4000 });
          else toast.info(message, { position: 'bottom-right', autoClose: 4000 });
        },
        // Host approval prompt for destructive plugin commits.
        approver: info => window.confirm(`${info.message}\n\nAllow the sample plugin to proceed?`),
      }, owner, GRANTS)
      : null;
    if (session) pluginSessions.set(owner.id, session);
  }, [model, contributions]);
  return null;
};

export default SampleDrawMember;
