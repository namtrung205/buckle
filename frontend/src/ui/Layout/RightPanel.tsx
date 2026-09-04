import React, { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Button, Chip, Checkbox, FormControl, FormControlLabel, FormHelperText, IconButton, MenuItem, Select as MUISelect, Typography, Tabs, Tab } from '@mui/material';
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

/* ── staged-draft types for the Apply-button workflow ────────────────────
 * Support/Load edits in the dock are staged in a local draft and only pushed
 * to the model (rebuilding the 3D visuals) when the user presses Apply — the
 * same explicit-commit language as the Add/Edit dialogs. */
interface SupportDraft {
  name: string;
  type: BoundaryCondition['type'];
  rotation: string;
  dx: number;
  dy: number;
  dz: number;
  rx: number;
  ry: number;
  rz: number;
  targets: number[];
}

interface LoadDraft {
  name: string;
  type: Load['type'];
  direction: string;
  value: string;
  targets: number[];
}

const supportDraftOf = (s: BoundaryCondition): SupportDraft => ({
  name: s.name ?? '',
  type: s.type,
  rotation: String(s.rotation ?? 0),
  dx: Number(s.dx ?? 0),
  dy: Number(s.dy ?? 0),
  dz: Number(s.dz ?? 0),
  rx: Number(s.rx ?? 0),
  ry: Number(s.ry ?? 0),
  rz: Number(s.rz ?? 0),
  targets: [...(s.targets ?? [])],
});

const loadDraftOf = (l: Load): LoadDraft => ({
  name: l.name ?? '',
  type: l.type,
  direction: loadDirectionOf(l),
  value: String(loadMagnitudeOf(l)),
  targets: [...(l.targets ?? [])],
});

/* ── load direction/magnitude helpers (module scope — no component deps) ── */
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

/* ── shared target multi-select (identical in Support & Load docks) ────── */
const TARGET_SELECT_SX = {
  backgroundColor: colors.surfaceAlt,
  fontSize: '0.875rem',
  '& .MuiSelect-select': {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 0.5,
    minHeight: '32px',
    alignItems: 'center',
    py: '4px',
  },
};

const TARGET_MENU_PROPS = {
  PaperProps: { sx: { maxHeight: 300 } },
};

/** Chips renderer for the selected targets — shared by Support & Load docks. */
const renderTargetValue = (
  selected: number[],
  placeholder: string,
  labelOf: (id: number) => string,
  onRemove: (id: number) => void,
) => {
  if (!selected.length) {
    return <Typography sx={{ fontSize: '0.875rem', color: colors.textFaint }}>{placeholder}</Typography>;
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {selected.map((id) => (
        <Chip key={id} label={labelOf(id)} size="small" onDelete={() => onRemove(id)} />
      ))}
    </Box>
  );
};

/** Compact action row used by every dock that stages edits behind Apply. */
const ApplyRow: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
    <Button size="small" variant="contained" disableElevation onClick={onClick} sx={{ minWidth: 72 }}>
      Apply
    </Button>
  </Box>
);


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
  // Section dialog context: which section the dock dialog edits. `null` means
  // the "+" new-section flow — the dialog then creates a fresh section that is
  // added to the project's section list and assigned to this member on save.
  const [sectionDialogSection, setSectionDialogSection] = useState<Section | null>(null);

  // Re-sync the initial tab when switching between the two ribbon buttons while
  // the dock stays mounted (Results → Forces, Reactions → Reactions).
  React.useEffect(() => {
    if (model?.activeDialog === 'reactions') setResultsTab(0);
    else if (model?.activeDialog === 'results') setResultsTab(1);
  }, [model?.activeDialog]);

  /* ── staged drafts for the Support / Load docks (Apply to commit) ─────── */
  const [supportDraft, setSupportDraft] = useState<SupportDraft | null>(null);
  const [loadDraft, setLoadDraft] = useState<LoadDraft | null>(null);
  const [targetsError, setTargetsError] = useState(false);

  // (Re)seed the drafts whenever the focused entity changes or the dock reopens.
  React.useEffect(() => {
    setSupportDraft(support ? supportDraftOf(support) : null);
    setTargetsError(false);
  }, [support?.id, model?.rightPanelOpen]);

  React.useEffect(() => {
    setLoadDraft(load ? loadDraftOf(load) : null);
    setTargetsError(false);
  }, [load?.id, model?.rightPanelOpen]);


  if (!model?.rightPanelOpen) return null;
  if (!isResults && !isDraw && !model?.hasFocus()) return null;

  const sectionOptions = model.sections.map((s) => ({ id: s.id, name: s.name }));
  const materialOptions = model.materials.map((m) => ({ id: m.id, name: m.name }));
  const nodeOptions = model.nodes.map((n) => ({ id: n.id, name: n.name ?? `Node ${n.id}` }));
  const memberOptions = model.members.map((m) => ({ id: m.id, name: m.label || `Member ${m.id}` }));

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

  /* ── support draft handlers (staged — committed by Apply) ─────────────── */
  const updateSupportDraft = (patch: Partial<SupportDraft>) =>
    setSupportDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  const applySupportDraftPreset = (preset: string) => {
    const flags: Record<string, string> = {
      fixed: '111111',
      pinned: '111100',
      roller: '011100',
    };
    const f = flags[preset];
    if (!f || !supportDraft) return;
    setSupportDraft({
      ...supportDraft,
      type: preset as BoundaryCondition['type'],
      dx: Number(f[0]),
      dy: Number(f[1]),
      dz: Number(f[2]),
      rx: Number(f[3]),
      ry: Number(f[4]),
      rz: Number(f[5]),
    });
  };

  const toggleSupportDraftRestraint = (field: RestraintKey, checked: boolean) => {
    setSupportDraft((prev) =>
      prev ? { ...prev, type: prev.type === 'elastic' ? 'elastic' : 'custom', [field]: checked ? 1 : 0 } : prev,
    );
  };

  const applySupport = () => {
    if (!support || !supportDraft) return;
    // A support must reference at least one node (mirrors the support dialog).
    if (!supportDraft.targets.length) {
      setTargetsError(true);
      return;
    }
    support.name = supportDraft.name;
    support.type = supportDraft.type;
    support.rotation = Number(supportDraft.rotation) || 0;
    support.targets = supportDraft.targets;
    support.dx = supportDraft.dx;
    support.dy = supportDraft.dy;
    support.dz = supportDraft.dz;
    support.rx = supportDraft.rx;
    support.ry = supportDraft.ry;
    support.rz = supportDraft.rz;
    support.createOrUpdate();
    // Re-seed the draft from the model object — createOrUpdate normalises the
    // per-DOF flags for the preset types (fixed/pinned/roller).
    setSupportDraft(supportDraftOf(support));
  };

  /* ── load draft handlers (staged — committed by Apply) ────────────────── */
  const updateLoadDraft = (patch: Partial<LoadDraft>) =>
    setLoadDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  const applyLoad = () => {
    if (!load || !loadDraft) return;
    // A load must reference at least one node/member.
    if (!loadDraft.targets.length) {
      setTargetsError(true);
      return;
    }
    const dir = base_vectors[loadDraft.direction as 'x' | 'y' | 'z'] ?? base_vectors.x;
    load.name = loadDraft.name;
    load.type = loadDraft.type;
    load.targets = loadDraft.targets;
    load.value = dir.clone().multiplyScalar(Number(loadDraft.value) || 0);
    load.createOrUpdate();
    // Re-seed the draft from the committed model object.
    setLoadDraft(loadDraftOf(load));
  };

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
                <Tab label="Stress" />
              </Tabs>
              <Box sx={{ flex: 1, overflowY: 'auto' }}>
                {resultsTab === 0 && <Reactions />}
                {resultsTab === 1 && <Diagrams variant="forces" />}
                {resultsTab === 2 && <Diagrams variant="deformation" />}
                {resultsTab === 3 && <Diagrams variant="stress" />}
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
                handlers={{
                  // ⊞/✎ edit the member's current section in place (a confirm
                  // warns when other members share it — SectionModel then
                  // re-points and rebuilds every linked member). + creates a
                  // brand-new section that joins the project list and is
                  // assigned to this member only.
                  onPick: () => { setSectionDialogSection(member.section ?? null); model.selectedMemberDialogs.section = true; },
                  onEdit: () => { setSectionDialogSection(member.section ?? null); model.selectedMemberDialogs.section = true; },
                  onNew: () => { setSectionDialogSection(null); model.selectedMemberDialogs.section = true; },
                }}
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
          {support && supportDraft && (
            <>
              <PropertyRow label="Name">
                <TextField name="name" value={supportDraft.name} onChange={(e: any) => updateSupportDraft({ name: e.target.value })} placeholder="Support name" size="small" />
              </PropertyRow>

              <PropertyRow label="Type">
                <Select label="" size="small" list={SUPPORT_TYPES} value={supportDraft.type === 'elastic' ? 'fixed' : supportDraft.type} onChange={(e: any) => applySupportDraftPreset(e.target.value)} />
              </PropertyRow>

              {supportDraft.type !== 'elastic' ? (
                <>
                  <Box sx={{ my: 0.5 }}>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textDim, mb: 0.5, fontWeight: 500 }}>Restraints</Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 0.25, columnGap: 1 }}>
                      {restraintDefs.map((def) => (
                        <FormControlLabel
                          key={def.key}
                          control={
                            <Checkbox
                              checked={supportDraft[def.key] === 1}
                              onChange={(e) => toggleSupportDraftRestraint(def.key, e.target.checked)}
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
                    <input type="number" value={supportDraft.rotation}
                      onChange={(e) => updateSupportDraft({ rotation: e.target.value })}
                      style={INLINE_INPUT_SX} />
                  </PropertyRow>
                </>
              ) : (
                <>
                  {(['dx', 'dy', 'dz', 'rx', 'ry', 'rz'] as const).map((field) => (
                    <PropertyRow key={field} label={`${field.toUpperCase()} (kN/m)`}>
                      <input type="number" value={supportDraft[field] ?? 0}
                        onChange={(e) => updateSupportDraft({ [field]: Number(e.target.value) || 0 })}
                        style={INLINE_INPUT_SX} />
                    </PropertyRow>
                  ))}
                </>
              )}

              <PropertyRow label="Targets">
                <FormControl fullWidth size="small" error={targetsError}>
                  <MUISelect
                    multiple
                    value={supportDraft.targets}
                    onChange={(e: any) => {
                      setTargetsError(false);
                      updateSupportDraft({ targets: e.target.value as number[] });
                    }}
                    size="small"
                    fullWidth
                    renderValue={(selected) =>
                      renderTargetValue(
                        selected as number[],
                        'Select nodes',
                        getNodeName,
                        (id) => updateSupportDraft({ targets: supportDraft.targets.filter((t) => t !== id) }),
                      )
                    }
                    sx={TARGET_SELECT_SX}
                    MenuProps={TARGET_MENU_PROPS}
                  >
                    {nodeOptions.map((option) => (
                      <MenuItem key={option.id} value={option.id}>
                        {option.name}
                      </MenuItem>
                    ))}
                  </MUISelect>
                  {targetsError && (
                    <FormHelperText>Select at least one node</FormHelperText>
                  )}
                </FormControl>
              </PropertyRow>

              <ApplyRow onClick={applySupport} />
            </>
          )}

          {/* ── LOAD ────────────────────────────────────────────────── */}
          {load && loadDraft && (
            <>
              <PropertyRow label="Name">
                <TextField name="name" value={loadDraft.name} onChange={(e: any) => updateLoadDraft({ name: e.target.value })} placeholder="Load name" size="small" />
              </PropertyRow>

              <PropertyRow label="Type">
                {/* Changing type invalidates the target set (nodes ⇄ members), mirroring the dialog. */}
                <Select label="" size="small" list={LOAD_TYPES} value={loadDraft.type} onChange={(e: any) => updateLoadDraft({ type: e.target.value, targets: [] })} />
              </PropertyRow>

              <PropertyRow label="Direction">
                <Select label="" size="small" list={LOAD_DIRECTIONS} value={loadDraft.direction} onChange={(e: any) => updateLoadDraft({ direction: e.target.value })} />
              </PropertyRow>

              <PropertyRow label="Value">
                <input type="number" value={loadDraft.value}
                  onChange={(e) => updateLoadDraft({ value: e.target.value })}
                  style={INLINE_INPUT_SX} />
              </PropertyRow>

              <PropertyRow label="Targets">
                <FormControl fullWidth size="small" error={targetsError}>
                  <MUISelect
                    multiple
                    value={loadDraft.targets}
                    onChange={(e: any) => {
                      setTargetsError(false);
                      updateLoadDraft({ targets: e.target.value as number[] });
                    }}
                    size="small"
                    fullWidth
                    renderValue={(selected) =>
                      renderTargetValue(
                        selected as number[],
                        loadDraft.type === 'nodal' ? 'Select nodes' : 'Select members',
                        (id) => (loadDraft.type === 'nodal' ? getNodeName(id) : getMemberName(id)),
                        (id) => updateLoadDraft({ targets: loadDraft.targets.filter((t) => t !== id) }),
                      )
                    }
                    sx={TARGET_SELECT_SX}
                    MenuProps={TARGET_MENU_PROPS}
                  >
                    {(loadDraft.type === 'nodal' ? nodeOptions : memberOptions).map((option) => (
                      <MenuItem key={option.id} value={option.id}>
                        {option.name}
                      </MenuItem>
                    ))}
                  </MUISelect>
                  {targetsError && (
                    <FormHelperText>
                      {loadDraft.type === 'nodal' ? 'Select at least one node' : 'Select at least one member'}
                    </FormHelperText>
                  )}
                </FormControl>
              </PropertyRow>

              <ApplyRow onClick={applyLoad} />
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
                    ? 'Pick target nodes, choose a preset (Fixed/Pinned/Roller) or toggle DOF restraints, then press Apply to commit.'
                    : load
                      ? 'Pick target nodes or members, set type, direction and magnitude, then press Apply to commit.'
                      : 'Edit the node name and its coordinates.'}
          </Typography>
        </Box>
      </Box>

      {/* pickers triggered by the dock (kept here so they render beside the panel) */}
      <SectionChanger
        open={model.selectedMemberDialogs.section}
        onClose={() => { model.selectedMemberDialogs.section = false; setSectionDialogSection(null); }}
        section={sectionDialogSection}
        onSaved={(sec) => {
          if (!member) return;
          // Same-id save = section edit: SectionModel.createOrUpdate already
          // re-pointed every linked member and rebuilt its geometry. A brand
          // new id (the + flow) still has to be assigned to this member here.
          if (member.section && sec.id === member.section.id) return;
          member.update(member.nodes, sec, member.gamma, member.label, member.release);
        }}
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