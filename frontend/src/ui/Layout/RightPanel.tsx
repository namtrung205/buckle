import React, { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Box, IconButton, Typography, Chip, Checkbox, FormControlLabel, Tabs, Tab } from '@mui/material';
import * as THREE from 'three';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  CallSplit as MemberIcon,
  Room as NodeIcon,
  Lock as SupportIcon,
  TrendingDown as LoadIcon,
  BarChart as ResultsIcon,
  Gesture as DrawIcon,
} from '@mui/icons-material';
import { colors } from '../../theme';
import { useModel } from '../../model/Context';
import PropertyRow from '../Model/PropertyRow';
import SectionChanger from '../Model/Sections/SectionChanger';
import MaterialPresetSelector from '../Model/Materials/MaterialPresetSelector';
import DrawPanel from '../Draw/Draw';
import Reactions from '../Results/Components/Reactions/Reactions';
import Diagrams from '../Results/Components/Diagrams/Diagrams';
import { Section } from '../../types';
import Select from '../../components/Select';
import TextField from '../../components/TextField/TextField';
import ElasticBeamColumn from '../../model/Elements/ElasticBeamColumn/ElasticBeamColumn';
import BoundaryCondition from '../../model/BoundaryCondition/BoundaryCondition';
import Load from '../../model/Load/Load';

/**
 * Right dock panel — Stabileo's PropertyPanel, adapted to Buckle's data model.
 *
 * Context-sensitive: shows the focused entity's properties for EVERY editable
 * entity type — member, node, support (boundary condition), and load — each
 * rendered with the inline `PropertyRow` controls and the ⊞ / ✎ / + icon cluster
 * so the picker/select/edit/new language stays consistent app-wide. It replaces
 * the floating add/edit dialogs with inline editing for the focused entity.
 */

/* ── shared inline input styling (matches the existing `<input>` rows) ────── */
const INLINE_INPUT_SX = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '5px 8px',
  borderRadius: '4px',
  border: `1px solid ${colors.borderDark}`,
  background: colors.surfaceAlt,
  color: colors.text,
  fontSize: '0.82rem',
  outline: 'none',
};

/** Per-DOF restraint list (mirrors the support dialog + hexagon order). */
const restraintDefs = [
  { key: 'dx', label: 'Dx' },
  { key: 'dy', label: 'Dy' },
  { key: 'dz', label: 'Dz' },
  { key: 'rx', label: 'Rx' },
  { key: 'ry', label: 'Ry' },
  { key: 'rz', label: 'Rz' },
] as const;

type RestraintKey = typeof restraintDefs[number]['key'];

const base_vectors = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const RELEASES = [
  { id: 'fixed-pinned', name: 'Fixed-Pinned' },
  { id: 'pinned-fixed', name: 'Pinned-Fixed' },
  { id: 'pinned-pinned', name: 'Pinned-Pinned' },
];

const SUPPORT_TYPES = [
  { id: 'fixed', name: 'Fixed' },
  { id: 'pinned', name: 'Pinned' },
  { id: 'roller', name: 'Roller' },
  { id: 'custom', name: 'Custom' },
];

const LOAD_TYPES = [
  { id: 'nodal', name: 'Nodal' },
  { id: 'linear', name: 'Linear' },
];

const LOAD_DIRECTIONS = [
  { id: 'x', name: 'X' },
  { id: 'z', name: 'Y' },
  { id: 'y', name: 'Z' },
];

const RightPanel = observer(() => {
  const model = useModel();

  const member: ElasticBeamColumn | null = useMemo(
    () => (model?.selectedMemberId != null ? model.members.find((m) => m.id === model.selectedMemberId) ?? null : null),
    [model?.selectedMemberId, model?.members],
  );
  const node = useMemo(
    () => (model?.selectedNodeId != null ? model.nodes.find((n) => n.id === model.selectedNodeId) ?? null : null),
    [model?.selectedNodeId, model?.nodes],
  );
  const support: BoundaryCondition | null = useMemo(
    () => (model?.selectedBoundaryConditionId != null ? model.boundaryConditions.find((b) => b.id === model.selectedBoundaryConditionId) ?? null : null),
    [model?.selectedBoundaryConditionId, model?.boundaryConditions],
  );
  const load: Load | null = useMemo(
    () => (model?.selectedLoadId != null ? model.loads.find((l) => l.id === model.selectedLoadId) ?? null : null),
    [model?.selectedLoadId, model?.loads],
  );

  const section: Section | null = member?.section ?? null;

  // Results mode: the ribbon "Results" / "Reactions" buttons open this same dock.
  const isResults = model?.activeDialog === 'results' || model?.activeDialog === 'reactions';
  // Draw mode: the ribbon "Draw" button opens the member drawing tool here.
  const isDraw = model?.activeDialog === 'draw';
  // Results tab follows the ribbon button that opened it (Reactions vs Forces).
  const [resultsTab, setResultsTab] = useState<number>(model?.activeDialog === 'reactions' ? 0 : 1);

  // Re-sync the initial tab when switching between the two ribbon buttons while
  // the dock stays mounted (Results → Forces, Reactions → Reactions).
  React.useEffect(() => {
    if (model?.activeDialog === 'reactions') setResultsTab(0);
    else if (model?.activeDialog === 'results') setResultsTab(1);
  }, [model?.activeDialog]);

  if (!model?.rightPanelOpen) return null;
  if (!isResults && !isDraw && !model?.hasFocus()) return null;

  const sectionOptions = model.sections.map((s) => ({ id: s.id, name: s.name }));
  const materialOptions = model.materials.map((m) => ({ id: m.id, name: m.name }));
  const nodeOptions = model.nodes.map((n) => ({ id: n.id, name: n.name ?? `Node ${n.id}` }));

  /* ── header title + icon per entity type ──────────────────────────────── */
  let title = 'Properties';
  let icon: React.ReactNode = null;
  if (isResults) { title = 'Results'; icon = <ResultsIcon sx={{ fontSize: 16, color: colors.accentSoft }} />; }
  else if (isDraw) { title = 'Draw member'; icon = <DrawIcon sx={{ fontSize: 16, color: colors.accentSoft }} />; }
  else if (member) { title = 'Member properties'; icon = <MemberIcon sx={{ fontSize: 16, color: colors.accentSoft }} />; }
  else if (node) { title = 'Node properties'; icon = <NodeIcon sx={{ fontSize: 16, color: colors.accentSoft }} />; }
  else if (support) { title = 'Support properties'; icon = <SupportIcon sx={{ fontSize: 16, color: colors.accentSoft }} />; }
  else if (load) { title = 'Load properties'; icon = <LoadIcon sx={{ fontSize: 16, color: colors.accentSoft }} />; }

  const closePanel = () => {
    if (isResults || isDraw) model.closeDialog();
    else model.clearFocus();
  };

  /* ── member helpers ───────────────────────────────────────────────────── */
  const reassignSection = (secId: number) => {
    if (!member) return;
    const sec = model.sections.find((s) => s.id === Number(secId));
    if (!sec) return;
    member.update(member.nodes, sec, member.gamma, member.label, member.release);
  };

  const reassignMaterial = (matId: number) => {
    if (!section) return;
    const mat = model.materials.find((m) => m.id === Number(matId));
    if (!mat) return;
    section.material = mat;
  };

  const reassignNode = (index: 0 | 1, nodeId: number) => {
    if (!member) return;
    const n = model.nodes.find((x) => x.id === Number(nodeId));
    if (!n) return;
    const nodes = [...member.nodes];
    nodes[index] = n;
    member.update(nodes, member.section, member.gamma, member.label, member.release);
  };

  const updateMemberLabel = (label: string) => {
    if (!member) return;
    member.update(member.nodes, member.section, member.gamma, label, member.release);
  };

  const updateMemberGamma = (gamma: number) => {
    if (!member) return;
    member.update(member.nodes, member.section, gamma, member.label, member.release);
  };

  const updateMemberRelease = (release: string) => {
    if (!member) return;
    member.update(member.nodes, member.section, member.gamma, member.label, release);
  };

  /* ── node helpers ─────────────────────────────────────────────────────── */
  const updateNodeName = (name: string) => {
    if (!node) return;
    node.update(new THREE.Vector3(node.x, node.y, node.z), name);
  };

  const updateNodeCoord = (axis: 'x' | 'y' | 'z', value: number) => {
    if (!node || !Number.isFinite(value)) return;
    const pos = { x: node.x, y: node.y, z: node.z };
    pos[axis] = value;
    node.update(new THREE.Vector3(pos.x, pos.y, pos.z), node.name);
  };

  /* ── support helpers ──────────────────────────────────────────────────── */
  const applySupportPreset = (preset: string) => {
    if (!support) return;
    const flags: Record<string, string> = {
      fixed: '111111',
      pinned: '111100',
      roller: '011100',
    };
    const f = flags[preset];
    if (!f) return;
    // Presets apply to translations/rotations; custom type left as-is otherwise.
    support.type = preset as BoundaryCondition['type'];
    if (!['elastic', 'roller-x', 'roller-y'].includes(support.type)) {
      support.dx = Number(f[0]);
      support.dy = Number(f[1]);
      support.dz = Number(f[2]);
      support.rx = Number(f[3]);
      support.ry = Number(f[4]);
      support.rz = Number(f[5]);
    }
    support.createOrUpdate();
  };

  const toggleSupportRestraint = (field: RestraintKey, checked: boolean) => {
    if (!support) return;
    support.type = support.type === 'elastic' ? 'elastic' : 'custom';
    support[field] = checked ? 1 : 0;
    support.createOrUpdate();
  };

  const updateSupportName = (name: string) => {
    if (!support) return;
    support.name = name;
    support.createOrUpdate();
  };

  const updateSupportRotation = (rotation: number) => {
    if (!support) return;
    support.rotation = rotation;
    support.createOrUpdate();
  };

  const updateSupportElastic = (field: 'dx' | 'dy' | 'dz' | 'rx' | 'ry' | 'rz', value: number) => {
    if (!support) return;
    (support as any)[field] = value;
    support.createOrUpdate();
  };

  /* ── load helpers ─────────────────────────────────────────────────────── */
  const loadDirectionOf = (l: Load): string => {
    let dir = 'x';
    Object.entries(base_vectors).forEach(([axis, vec]) => {
      const v = (l.value ?? new THREE.Vector3()).clone();
      const cross = vec.clone().cross(v.normalize()).length();
      if (cross < 0.001) dir = axis;
    });
    return dir;
  };

  const loadMagnitudeOf = (l: Load): number => {
    const dir = base_vectors[loadDirectionOf(l) as 'x' | 'y' | 'z'];
    return (l.value ?? new THREE.Vector3()).dot(dir);
  };

  const updateLoad = (patch: Partial<{ name: string; type: Load['type']; direction: string; value: number; targets: number[] }>) => {
    if (!load) return;
    const nextType = patch.type ?? load.type;
    const nextDirection = patch.direction ?? loadDirectionOf(load);
    const nextMagnitude = patch.value ?? loadMagnitudeOf(load);
    const dir = base_vectors[nextDirection as 'x' | 'y' | 'z'] ?? base_vectors.x;
    const data: any = {
      id: load.id,
      name: patch.name ?? load.name,
      type: nextType,
      targets: patch.targets ?? load.targets,
      value: dir.clone().multiplyScalar(nextMagnitude),
    };
    load.targets = data.targets;
    load.name = data.name;
    load.type = data.type;
    load.value = data.value;
    load.createOrUpdate();
  };

  const updateLoadName = (name: string) => updateLoad({ name });
  const updateLoadType = (type: Load['type']) => {
    // Changing type invalidates the target set (nodes ⇄ members), mirroring the dialog.
    updateLoad({ type, targets: [] });
  };
  const updateLoadDirection = (direction: string) => updateLoad({ direction });
  const updateLoadValue = (value: number) => updateLoad({ value });

  /* ── delete helpers ───────────────────────────────────────────────────── */
  const deleteEntity = () => {
    if (member) member.remove();
    else if (node) node.delete();
    else if (support) support.delete();
    else if (load) load.delete();
    model.clearFocus();
  };

  const entityLabel = member?.label || node?.name || support?.name || load?.name || '';

  /* ── support target chip labels ───────────────────────────────────────── */
  const getNodeName = (id: number) => model.nodes.find((n) => n.id === id)?.name || `Node ${id}`;
  const getMemberName = (id: number) => model.members.find((m) => m.id === id)?.label || `Member ${id}`;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
      {/* the dock itself */}
      <Box
        sx={{
          width: 332,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        }}
      >
        {/* header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 0.75, borderBottom: `1px solid ${colors.divider}` }}>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: colors.text, display: 'flex', alignItems: 'center', gap: 1 }}>
            {icon}
            {title}
          </Typography>
          <IconButton size="small" onClick={closePanel}
            sx={{ color: colors.textDim, '&:hover': { color: colors.text, backgroundColor: colors.hover } }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* body */}
        <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {isResults ? (
            <>
              {/* Results tabs (Reactions / Forces / Deformation) */}
              <Tabs
                value={resultsTab}
                onChange={(_e, value) => setResultsTab(value as number)}
                variant="fullWidth"
                sx={{
                  minHeight: 36,
                  flexShrink: 0,
                  mb: 1.5,
                  borderBottom: `1px solid ${colors.border}`,
                  '& .MuiTab-root': { minHeight: 36, fontSize: '0.72rem', textTransform: 'none', fontWeight: 600, color: colors.textFaint, '&.Mui-selected': { color: colors.accentSoft } },
                  '& .MuiTabs-indicator': { backgroundColor: colors.accent, height: 2 },
                }}
              >
                <Tab label="Reactions" />
                <Tab label="Forces" />
                <Tab label="Deformation" />
              </Tabs>
              <Box sx={{ flex: 1, overflowY: 'auto' }}>
                {resultsTab === 0 && <Reactions />}
                {resultsTab === 1 && <Diagrams variant="forces" />}
                {resultsTab === 2 && <Diagrams variant="deformation" />}
              </Box>
            </>
          ) : isDraw ? (
            <>
              {/* Member drawing tool (section pick + start/stop) */}
              <DrawPanel />
            </>
          ) : (
          <>
          {/* entity label row + delete */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: colors.text }}>{entityLabel}</Typography>
            <IconButton size="small" onClick={deleteEntity} title="Delete"
              sx={{ color: colors.danger, '&:hover': { backgroundColor: 'rgba(229,72,77,0.15)' } }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* ── MEMBER ─────────────────────────────────────────────── */}
          {member && (
            <>
              <PropertyRow label="Label">
                <TextField name="label" value={member.label} onChange={(e: any) => updateMemberLabel(e.target.value)} placeholder="Member" size="small" />
              </PropertyRow>

              <PropertyRow
                label="Section"
                handlers={{ onPick: () => { model.selectedMemberDialogs.section = true; }, onEdit: () => { model.selectedMemberDialogs.section = true; }, onNew: () => { model.selectedMemberDialogs.section = true; } }}
                titles={{ pick: 'Choose from catalogue', edit: 'Edit section', new: 'New section' }}
              >
                <Select label="" size="small" list={sectionOptions} value={section?.id ?? ''} onChange={(e: any) => reassignSection(e.target.value)} />
              </PropertyRow>

              <PropertyRow
                label="Material"
                handlers={{ onPick: () => { model.selectedMemberDialogs.material = true; }, onNew: () => { model.selectedMemberDialogs.material = true; } }}
                titles={{ pick: 'Choose material', new: 'New material' }}
              >
                <Select label="" size="small" list={materialOptions} value={section?.material?.id ?? ''} onChange={(e: any) => reassignMaterial(e.target.value)} />
              </PropertyRow>

              <PropertyRow label="Node I">
                <Select label="" size="small" list={nodeOptions} value={member.nodes[0]?.id ?? ''} onChange={(e: any) => reassignNode(0, e.target.value)} />
              </PropertyRow>
              <PropertyRow label="Node J">
                <Select label="" size="small" list={nodeOptions} value={member.nodes[1]?.id ?? ''} onChange={(e: any) => reassignNode(1, e.target.value)} />
              </PropertyRow>

              <PropertyRow label="Rotation">
                <input type="number" value={member.gamma}
                  onChange={(e) => updateMemberGamma(Number(e.target.value) || 0)}
                  style={INLINE_INPUT_SX} />
              </PropertyRow>

              <PropertyRow label="Release">
                <Select label="" size="small" list={RELEASES} value={member.release ?? ''} onChange={(e: any) => updateMemberRelease(e.target.value)} />
              </PropertyRow>
            </>
          )}

          {/* ── NODE ───────────────────────────────────────────────── */}
          {node && (
            <>
              <PropertyRow label="Name">
                <TextField name="name" value={node.name ?? ''} onChange={(e: any) => updateNodeName(e.target.value)} placeholder="Node name" size="small" />
              </PropertyRow>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <PropertyRow key={axis} label={`${axis.toUpperCase()} coord`}>
                  <input type="number" value={node[axis]}
                    onChange={(e) => updateNodeCoord(axis, Number(e.target.value))}
                    style={INLINE_INPUT_SX} />
                </PropertyRow>
              ))}
            </>
          )}

          {/* ── SUPPORT (boundary condition) ────────────────────────── */}
          {support && (
            <>
              <PropertyRow label="Name">
                <TextField name="name" value={support.name ?? ''} onChange={(e: any) => updateSupportName(e.target.value)} placeholder="Support name" size="small" />
              </PropertyRow>

              <PropertyRow label="Type">
                <Select label="" size="small" list={SUPPORT_TYPES} value={support.type === 'elastic' ? 'fixed' : support.type} onChange={(e: any) => applySupportPreset(e.target.value)} />
              </PropertyRow>

              {support.type !== 'elastic' ? (
                <>
                  <Box sx={{ my: 0.5 }}>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textDim, mb: 0.5, fontWeight: 500 }}>Restraints</Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 0.25, columnGap: 1 }}>
                      {restraintDefs.map((def) => (
                        <FormControlLabel
                          key={def.key}
                          control={
                            <Checkbox
                              checked={(support[def.key] as any) === 1}
                              onChange={(e) => toggleSupportRestraint(def.key, e.target.checked)}
                              size="small"
                              sx={{ color: colors.textDim, p: 0.25, '&.Mui-checked': { color: colors.accent } }}
                            />
                          }
                          label={def.label}
                          sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.7rem', color: colors.text } }}
                        />
                      ))}
                    </Box>
                  </Box>

                  <PropertyRow label="Rotation">
                    <input type="number" value={support.rotation ?? 0}
                      onChange={(e) => updateSupportRotation(Number(e.target.value) || 0)}
                      style={INLINE_INPUT_SX} />
                  </PropertyRow>
                </>
              ) : (
                <>
                  {(['dx', 'dy', 'dz', 'rx', 'ry', 'rz'] as const).map((field) => (
                    <PropertyRow key={field} label={`${field.toUpperCase()} (kN/m)`}>
                      <input type="number" value={(support as any)[field] ?? 0}
                        onChange={(e) => updateSupportElastic(field, Number(e.target.value) || 0)}
                        style={INLINE_INPUT_SX} />
                    </PropertyRow>
                  ))}
                </>
              )}

              <Box sx={{ mt: 0.5 }}>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textDim, mb: 0.5, fontWeight: 500 }}>Targets</Typography>
                {support.targets.map((id) => (
                  <Chip key={id} label={getNodeName(id)} size="small" sx={{ mr: 0.5, mb: 0.5, backgroundColor: colors.surfaceAlt, color: colors.text }} />
                ))}
              </Box>
            </>
          )}

          {/* ── LOAD ────────────────────────────────────────────────── */}
          {load && (
            <>
              <PropertyRow label="Name">
                <TextField name="name" value={load.name ?? ''} onChange={(e: any) => updateLoadName(e.target.value)} placeholder="Load name" size="small" />
              </PropertyRow>

              <PropertyRow label="Type">
                <Select label="" size="small" list={LOAD_TYPES} value={load.type} onChange={(e: any) => updateLoadType(e.target.value)} />
              </PropertyRow>

              <PropertyRow label="Direction">
                <Select label="" size="small" list={LOAD_DIRECTIONS} value={loadDirectionOf(load)} onChange={(e: any) => updateLoadDirection(e.target.value)} />
              </PropertyRow>

              <PropertyRow label="Value">
                <input type="number" value={loadMagnitudeOf(load)}
                  onChange={(e) => updateLoadValue(Number(e.target.value) || 0)}
                  style={INLINE_INPUT_SX} />
              </PropertyRow>

              <Box sx={{ mt: 0.5 }}>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textDim, mb: 0.5, fontWeight: 500 }}>
                  {load.type === 'nodal' ? 'Target nodes' : 'Target members'}
                </Typography>
                {load.targets.map((id) => (
                  <Chip key={id} label={load.type === 'nodal' ? getNodeName(id) : getMemberName(id)} size="small" sx={{ mr: 0.5, mb: 0.5, backgroundColor: colors.surfaceAlt, color: colors.text }} />
                ))}
              </Box>
            </>
          )}
          </>
          )}
        </Box>

        {/* context help strip */}
        <Box sx={{ px: 1.5, py: 0.75, borderTop: `1px solid ${colors.divider}` }}>
          <Typography sx={{ fontSize: '0.68rem', color: colors.textFaint, lineHeight: 1.4 }}>
            {isResults
              ? 'Reactions, internal force diagrams and deflected shape for the last analysis.'
              : isDraw
                ? 'Start to draw members by clicking in the viewport. Esc or Stop ends the current stroke.'
                : member
                  ? '⊞ opens the catalogue · ✎ edits · + creates new. Sections carry their own material.'
                  : support
                    ? 'Checked DOF = restrained. Pick a preset (Fixed/Pinned/Roller) or toggle for a custom support.'
                    : load
                      ? 'Choose load type, direction and magnitude. Targets are shown as chips.'
                      : 'Edit the node name and its coordinates.'}
          </Typography>
        </Box>
      </Box>

      {/* pickers triggered by the dock (kept here so they render beside the panel) */}
      <SectionChanger
        open={model.selectedMemberDialogs.section}
        onClose={() => { model.selectedMemberDialogs.section = false; }}
        section={section}
      />
      <MaterialPresetSelector
        open={model.selectedMemberDialogs.material}
        onClose={() => { model.selectedMemberDialogs.material = false; }}
        selectedMaterial={section?.material ?? null}
      />
    </Box>
  );
});

export default RightPanel;