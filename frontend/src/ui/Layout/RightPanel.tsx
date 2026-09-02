import React, { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Box, IconButton, Typography } from '@mui/material';
import * as THREE from 'three';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  CallSplit as MemberIcon,
  Room as NodeIcon,
} from '@mui/icons-material';
import { colors, fieldLabelSx } from '../../theme';
import { useModel } from '../../model/Context';
import PropertyRow from '../Model/PropertyRow';
import SectionChanger from '../Model/Sections/SectionChanger';
import MaterialPresetSelector from '../Model/Materials/MaterialPresetSelector';
import { Section } from '../../types';
import Select from '../../components/Select';
import ElasticBeamColumn from '../../model/Elements/ElasticBeamColumn/ElasticBeamColumn';

/**
 * Right dock panel — Stabileo's PropertyPanel, adapted to Buckle's data model.
 *
 * Context-sensitive: shows the focused member's properties (Section + Material,
 * each with the ⊞ / ✎ / + icon cluster) or the focused node's coordinates,
 * plus a faint context-help strip. It replaces the floating member-edit dialog
 * with inline `PropertyRow` controls, keeping the picker/select/edit/new
 * language consistent app-wide.
 */
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
  const section: Section | null = member?.section ?? null;

  if (!model?.rightPanelOpen) return null;

  const sectionOptions = model.sections.map((s) => ({ id: s.id, name: s.name }));
  const materialOptions = model.materials.map((m) => ({ id: m.id, name: m.name }));
  const nodeOptions = model.nodes.map((n) => ({ id: n.id, name: n.name ?? `Node ${n.id}` }));

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
    // Buckle's section owns its material; reassigning the material updates the
    // section, which every member built from it inherits.
    section.material = mat;
  };

  const deleteMember = () => {
    if (!member) return;
    member.remove();
    model.clearFocus();
  };

  const deleteNode = () => {
    if (!node) return;
    node.delete();
    model.clearFocus();
  };

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
            {member && <MemberIcon sx={{ fontSize: 16, color: colors.accentSoft }} />}
            {node && <NodeIcon sx={{ fontSize: 16, color: colors.accentSoft }} />}
            {member ? 'Member properties' : node ? 'Node properties' : 'Properties'}
          </Typography>
          <IconButton size="small" onClick={() => model.clearFocus()}
            sx={{ color: colors.textDim, '&:hover': { color: colors.text, backgroundColor: colors.hover } }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* body */}
        <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {member && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: colors.text }}>{member.label}</Typography>
                <IconButton size="small" onClick={deleteMember} title="Delete member"
                  sx={{ color: colors.danger, '&:hover': { backgroundColor: 'rgba(229,72,77,0.15)' } }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>

              {/* Section row */}
              <PropertyRow
                label="Section"
                handlers={{
                  onPick: () => { model.selectedMemberDialogs.section = true; },
                  onEdit: () => { model.selectedMemberDialogs.section = true; },
                  onNew: () => { model.selectedMemberDialogs.section = true; },
                }}
                titles={{ pick: 'Choose from catalogue', edit: 'Edit section', new: 'New section' }}
              >
                <Select label="" size="small" list={sectionOptions} value={section?.id ?? ''} onChange={(e: any) => reassignSection(e.target.value)} />
              </PropertyRow>

              {/* Material row (material lives on the section in Buckle) */}
              <PropertyRow
                label="Material"
                handlers={{
                  onPick: () => { model.selectedMemberDialogs.material = true; },
                  onNew: () => { model.selectedMemberDialogs.material = true; },
                }}
                titles={{ pick: 'Choose material', new: 'New material' }}
              >
                <Select label="" size="small" list={materialOptions} value={section?.material?.id ?? ''} onChange={(e: any) => reassignMaterial(e.target.value)} />
              </PropertyRow>

              {/* Nodes */}
              <PropertyRow label="Node I">
                <Select label="" size="small" list={nodeOptions} value={member.nodes[0]?.id ?? ''} onChange={(e: any) => {
                  const n = model.nodes.find((x) => x.id === Number(e.target.value));
                  if (n) member.update([n, member.nodes[1]], member.section, member.gamma, member.label, member.release);
                }} />
              </PropertyRow>
              <PropertyRow label="Node J">
                <Select label="" size="small" list={nodeOptions} value={member.nodes[1]?.id ?? ''} onChange={(e: any) => {
                  const n = model.nodes.find((x) => x.id === Number(e.target.value));
                  if (n) member.update([member.nodes[0], n], member.section, member.gamma, member.label, member.release);
                }} />
              </PropertyRow>

              {/* Rotation / gamma */}
              <PropertyRow label="Rotation">
                <input type="number" value={member.gamma}
                  onChange={(e) => { const v = Number(e.target.value) || 0; member.update(member.nodes, member.section, v, member.label, member.release); }}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', borderRadius: '4px', border: `1px solid ${colors.borderDark}`, background: colors.surfaceAlt, color: colors.text, fontSize: '0.82rem', outline: 'none' }} />
              </PropertyRow>
            </>
          )}

          {node && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: colors.text }}>{node.name}</Typography>
                <IconButton size="small" onClick={deleteNode} title="Delete node"
                  sx={{ color: colors.danger, '&:hover': { backgroundColor: 'rgba(229,72,77,0.15)' } }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <PropertyRow key={axis} label={`${axis.toUpperCase()} coord`}>
                  <input type="number" value={node[axis]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) {
                        const pos = { x: node.x, y: node.y, z: node.z };
                        pos[axis] = v;
                        node.update(new THREE.Vector3(pos.x, pos.y, pos.z), node.name);
                      }
                    }}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', borderRadius: '4px', border: `1px solid ${colors.borderDark}`, background: colors.surfaceAlt, color: colors.text, fontSize: '0.82rem', outline: 'none' }} />
                </PropertyRow>
              ))}
            </>
          )}

          {!member && !node && (
            <Typography sx={{ fontSize: '0.8rem', color: colors.textFaint, textAlign: 'center', mt: 3 }}>
              Select a member or node to edit its properties.
            </Typography>
          )}
        </Box>

        {/* context help strip */}
        <Box sx={{ px: 1.5, py: 0.75, borderTop: `1px solid ${colors.divider}` }}>
          <Typography sx={{ fontSize: '0.68rem', color: colors.textFaint, lineHeight: 1.4 }}>
            ⊞ opens the catalogue · ✎ edits · + creates new. Sections carry their own material.
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