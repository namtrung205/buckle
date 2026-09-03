import { Box, Typography, Collapse, IconButton } from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  AccountTree as NodesIcon,
  Polyline as MembersIcon,
  Science as MaterialsIcon,
  ViewInAr as SectionsIcon,
  Lock as BoundaryConditionsIcon,
  TrendingDown as LoadsIcon,
  GridOn as GridIcon,
  Visibility as VisibleIcon,
  VisibilityOff as HiddenIcon,
  Straighten as LevelsIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useState } from 'react';
import { colors, fontFamily } from '../../theme';
import { observer } from 'mobx-react-lite';
import { useModel } from '../../model/Context';
import AddOrEditNode from '../Model/Nodes/AddOrEdit';
import AddOrEditSection from '../Model/Sections/AddOrEdit'
import AddOrEditMember from '../Model/Members/AddOrEdit';
import Node from '../../model/Elements/Node/Node';
import { Load } from '../../model';
import { ElasticIsotropicMaterial, Section as SectionType } from '../../types';
import AddOrEditMaterial from '../Model/Materials/AddOrEdit';
import AddOrEditGrid from '../Model/Grids/AddOrEdit';
import GridSystem from '../../model/Grid/GridSystem';
import AddOrEditLevel from '../Model/Levels/AddOrEdit';
import { Level } from '../../types';
import ElasticBeamColumn from '../../model/Elements/ElasticBeamColumn/ElasticBeamColumn';
import BoundaryCondition from '../../model/BoundaryCondition/BoundaryCondition';
interface LeftBarProps {
  isCollapsed?: boolean;
}

interface TreeItemProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
  level?: number;
  onAdd?: () => void;
  /** Disable the add button (e.g. while the results lock is active). */
  disabled?: boolean;
}

const TreeItem = ({ id, label, icon, children, level = 0, onAdd, disabled }: TreeItemProps) => {
  const [expanded, setExpanded] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const hasChildren = children !== undefined;

  return (
    <>
      <Box
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          pl: 2 + level * 1.5,
          py: 1,
          color: colors.text,
          transition: 'all 0.15s ease-in-out',
          '&:hover': {
            backgroundColor: colors.hover,
          },
        }}
      >
        <Box 
          onClick={() => hasChildren && setExpanded(!expanded)}
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 1, 
            flex: 1,
            cursor: hasChildren ? 'pointer' : 'default',
          }}
        >
          {hasChildren && (
            <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 20 }}>
              {expanded ? (
                <ExpandMoreIcon sx={{ fontSize: 18, color: colors.textDim }} />
              ) : (
                <ChevronRightIcon sx={{ fontSize: 18, color: colors.textDim }} />
              )}
            </Box>
          )}
          {!hasChildren && <Box sx={{ minWidth: 20 }} />}
          {/* <Box sx={{ display: 'flex', alignItems: 'center', color: '#555' }}>
            {icon}
          </Box> */}
          <Typography
            sx={{
              fontSize: '0.8rem',
              fontWeight: level === 0 ? 600 : 500,
              color: level === 0 ? colors.text : colors.textDim,
              fontFamily,
            }}
          >
            {label}
          </Typography>
        </Box>
        {onAdd && (
          <IconButton
            size="small"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            sx={{
              opacity: isHovered ? 1 : 0.5,
              transition: 'all 0.2s ease-in-out',
              padding: '4px',
              color: colors.textDim,
              '&:hover': {
                backgroundColor: colors.hover,
                color: colors.text,
                opacity: 1,
              },
              '&.Mui-disabled': {
                color: colors.textFaint,
              },
            }}
          >
            <AddIcon sx={{ fontSize: 18 }} />
          </IconButton>
        )}
      </Box>
      {hasChildren && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {children}
        </Collapse>
      )}
    </>
  );
};

const LeftBar = observer(({ isCollapsed = false }: LeftBarProps) => {
  const model = useModel();
  // Results lock: while locked, every tree editing action is disabled
  const isLocked = model?.isLocked ?? false;
  const [addOrEditNode, setAddOrEditNode] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const [addOrEditSection, setAddOrEditSection] = useState(false);
  const [selectedSection, setSelectedSection] = useState<SectionType | null>(null);

  const [addOrEditMaterial, setAddOrEditMaterial] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<ElasticIsotropicMaterial | null>(null);

  const [addOrEditMember, setAddOrEditMember] = useState(false);
  const [selectedMember, setSelectedMember] = useState<ElasticBeamColumn | null>(null);

  const [addOrEditGrid, setAddOrEditGrid] = useState(false);
  const [selectedGrid, setSelectedGrid] = useState<GridSystem | null>(null);

  const [addOrEditLevel, setAddOrEditLevel] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);

  

  return (
    <Box
      sx={{
        width: isCollapsed ? 0 : '280px',
        backgroundColor: colors.surface,
        borderRight: isCollapsed ? 'none' : '2px solid ' + colors.border,
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.3s ease-in-out, opacity 0.3s ease-in-out, border 0.3s ease-in-out',
        overflow: 'hidden',
        opacity: isCollapsed ? 0 : 1,
        pointerEvents: isCollapsed ? 'none' : 'auto',
      }}
    >
      {/* Tree View */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          py: 1,
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: colors.surfaceAlt,
          },
          '&::-webkit-scrollbar-thumb': {
            background: colors.border,
            borderRadius: '4px',
            '&:hover': {
              background: colors.borderDark,
            },
          },
        }}
      >
        {/* Materials */}
        <TreeItem
          id="materials"
          label="Materials"
          icon={<MaterialsIcon sx={{ fontSize: 20 }} />}
          disabled={isLocked}
          onAdd={() => {
            setSelectedMaterial(null);
            setAddOrEditMaterial(true);
          }}
        >
          {model?.materials?.map((material: ElasticIsotropicMaterial) => (
            <Box
              key={material.id}
              sx={{
                px: 2,
                pl: 6,
                py: 0.8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                '&:hover': {
                  backgroundColor: colors.hover,
                },
              }}
            >
              <Typography sx={{ fontSize: '0.75rem', color: colors.textDim }}>
                {material.name || `Material ${material.id}`}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedMaterial(material);
                    setAddOrEditMaterial(true);
                  }}
                  sx={{ padding: '2px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    const index = model?.materials.findIndex((m) => m.id === material.id);
                    if (index !== undefined && index !== -1 && model) {
                      model.materials.splice(index, 1);
                    }
                  }}
                  sx={{ padding: '2px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          ))}
        </TreeItem>

        {/* Sections */}
        <TreeItem
          id="sections"
          label="Sections"
          icon={<SectionsIcon sx={{ fontSize: 20 }} />}
          disabled={isLocked}
          onAdd={() => {
            // "+" must create a NEW section — never re-edit the one left over
            // from a previous tree edit.
            setSelectedSection(null);
            setAddOrEditSection(true);
          }}
        >
          {model?.sections?.map((section: SectionType) => (
            <Box
              key={section.id}
              sx={{
                px: 2,
                pl: 6,
                py: 0.8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                '&:hover': {
                  backgroundColor: colors.hover,
                },
              }}
            >
              <Typography sx={{ fontSize: '0.75rem', color: colors.textDim }}>
                {section.name || `Section ${section.id}`}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSection(section)
                    setAddOrEditSection(true)
                  }}
                  sx={{ padding: '2px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log('Delete section', section.id);
                  }}
                  sx={{ padding: '2px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          ))}
        </TreeItem>

        {/* Grid systems (SAP2000/ETABS-style axis grids) */}
        <TreeItem
          id="grids"
          label="Grid"
          icon={<GridIcon sx={{ fontSize: 20 }} />}
          disabled={isLocked}
          onAdd={() => {
            setSelectedGrid(null);
            setAddOrEditGrid(true);
          }}
        >
          {(model?.grids?.length || 0) > 0 ? (
            model.grids.map((grid) => (
              <Box
                key={grid.id}
                sx={{
                  px: 2,
                  pl: 6,
                  py: 0.8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  '&:hover': {
                    backgroundColor: colors.hover,
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Typography sx={{
                    fontSize: '0.75rem',
                    color: grid.visible ? colors.textDim : colors.textFaint,
                    textDecoration: grid.visible ? 'none' : 'line-through',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {grid.name}
                  </Typography>
                  <Typography sx={{ fontSize: '0.65rem', color: colors.textFaint, flexShrink: 0 }}>
                    {grid.xLines.length}×{grid.yLines.length}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      grid.toggleVisible();
                    }}
                    title={grid.visible ? 'Hide grid' : 'Show grid'}
                    sx={{ padding: '2px', color: grid.visible ? colors.accentSoft : colors.textFaint, '&:hover': { color: colors.text } }}
                  >
                    {grid.visible ? <VisibleIcon sx={{ fontSize: 14 }} /> : <HiddenIcon sx={{ fontSize: 14 }} />}
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={isLocked}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedGrid(grid);
                      setAddOrEditGrid(true);
                    }}
                    sx={{ padding: '2px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                  >
                    <EditIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={isLocked}
                    onClick={(e) => {
                      e.stopPropagation();
                      grid.delete();
                    }}
                    sx={{ padding: '2px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
                  >
                    <DeleteIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              </Box>
            ))
          ) : (
            <Box sx={{ px: 2, pl: 6, py: 0.8 }}>
              <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint, fontStyle: 'italic' }}>
                No grid defined yet
              </Typography>
            </Box>
          )}
        </TreeItem>

        {/* Levels (Revit-style horizontal datums) */}
        <TreeItem
          id="levels"
          label="Levels"
          icon={<LevelsIcon sx={{ fontSize: 20 }} />}
          disabled={isLocked}
          onAdd={() => {
            setSelectedLevel(null);
            setAddOrEditLevel(true);
          }}
        >
          {model?.levels?.map((level: Level) => (
            <Box
              key={level.value}
              onClick={() => model.handleLevelChange(level)}
              sx={{
                px: 2,
                pl: 6,
                py: 0.8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                '&:hover': {
                  backgroundColor: colors.hover,
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textDim }}>
                  {level.label || `Level ${level.value}`}
                </Typography>
                <Typography sx={{ fontSize: '0.65rem', color: colors.textFaint, fontFamily: '"Consolas", "Roboto Mono", ui-monospace, monospace' }}>
                  {level.value.toFixed(3)} m
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  size="small"
                  disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedLevel(level);
                    setAddOrEditLevel(true);
                  }}
                  sx={{ padding: '2px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                  disabled={isLocked || (model?.levels?.length ?? 0) <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete level ${level.label}?`)) {
                      model.deleteLevel(level.value);
                    }
                  }}
                  sx={{ padding: '2px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          ))}
        </TreeItem>

        {/* Nodes */}
        <TreeItem
          id="nodes"
          label="Nodes"
          icon={<NodesIcon sx={{ fontSize: 20 }} />}
          disabled={isLocked}
          onAdd={() => {
            model.addNewNode();
          }}
        >
          {model?.nodes?.slice(0, 50).map((node: Node) => (
            <Box
              key={node.id}
              onClick={() => model.focusNode(node.id)}
              sx={{
                px: 2,
                pl: 6,
                py: 0.8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                '&:hover': {
                  backgroundColor: colors.hover,
                },
              }}
            >
              <Typography sx={{ fontSize: '0.75rem', color: colors.textDim }}>
                {node.name || `Node ${node.id}`}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                      e.stopPropagation();                    
                      model.focusNode(node.id);
                  }}
                  sx={{ padding: '2px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    node.delete()
                  }}
                  sx={{ padding: '2px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          ))}
          {(model?.nodes?.length || 0) > 50 && (
            <Box sx={{ px: 2, pl: 6, py: 0.8 }}>
              <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint, fontStyle: 'italic' }}>
                ... and {(model?.nodes?.length || 0) - 50} more
              </Typography>
            </Box>
          )}
        </TreeItem>

        {/* Members */}
        <TreeItem
          id="members"
          label="Members"
          icon={<MembersIcon sx={{ fontSize: 20 }} />}
          disabled={isLocked}
          onAdd={() => {
            setSelectedMember(null);
            setAddOrEditMember(true);
          }}
        >
          {model?.members?.slice(0, 50).map((member: ElasticBeamColumn) => (
            <Box
              key={member.id}
              onClick={() => model.focusMember(member.id)}
              sx={{
                px: 2,
                pl: 6,
                py: 0.8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                '&:hover': {
                  backgroundColor: colors.hover,
                },
              }}
            >
              <Typography sx={{ fontSize: '0.75rem', color: colors.textDim }}>
                {member.label || `Member ${member.id}`}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    model.focusMember(member.id);
                  }}
                  sx={{ padding: '2px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log('Delete member', member.id);
                    member.remove()
                  }}
                  sx={{ padding: '2px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          ))}
          {(model?.members?.length || 0) > 50 && (
            <Box sx={{ px: 2, pl: 6, py: 0.8 }}>
              <Typography sx={{ fontSize: '0.7rem', color: colors.textFaint, fontStyle: 'italic' }}>
                ... and {(model?.members?.length || 0) - 50} more
              </Typography>
            </Box>
          )}
        </TreeItem>

        {/* Boundary Conditions */}
        <TreeItem
          id="boundaryConditions"
          label="Supports"
          icon={<BoundaryConditionsIcon sx={{ fontSize: 20 }} />}
          disabled={isLocked}
          onAdd={() => {
            model.addNewSupport();
          }}
        >
          {model?.boundaryConditions?.map((bc: BoundaryCondition) => (
            <Box
              key={bc.id}
              onClick={() => model.focusBoundaryCondition(bc.id)}
              sx={{
                px: 2,
                pl: 6,
                py: 0.8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                '&:hover': {
                  backgroundColor: colors.hover,
                },
              }}
            >
              <Typography sx={{ fontSize: '0.75rem', color: colors.textDim }}>
                {bc.name || `Support ${bc.id}`}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    model.focusBoundaryCondition(bc.id);
                  }}
                  sx={{ padding: '2px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    const support = model.boundaryConditions.find((b) => b.id === bc.id);
                    console.log('Delete support', support?.id);
                    if (support) {
                      support.delete();
                    }
                  }}
                  sx={{ padding: '2px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          ))}
        </TreeItem>

        {/* Loads */}
        <TreeItem
          id="loads"
          label="Loads"
          icon={<LoadsIcon sx={{ fontSize: 20 }} />}
          disabled={isLocked}
          onAdd={() => {
            model.addNewLoad();
          }}
        >
          {model?.loads?.map((load: Load) => (
            <Box
              key={load.id}
              onClick={() => model.focusLoad(load.id)}
              sx={{
                px: 2,
                pl: 6,
                py: 0.8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                '&:hover': {
                  backgroundColor: colors.hover,
                },
              }}
            >
              <Typography sx={{ fontSize: '0.75rem', color: colors.textDim }}>
                {load.name || `Load ${load.id}`}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    model.focusLoad(load.id)
                  }}
                  sx={{ padding: '2px', color: colors.textDim, '&:hover': { color: colors.text }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton
                  size="small"
                    disabled={isLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log('Delete load', load.id);
                    load.delete()
                  }}
                  sx={{ padding: '2px', color: colors.danger, '&:hover': { color: colors.danger }, '&.Mui-disabled': { color: colors.textFaint } }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          ))}
        </TreeItem>
      </Box>

      <AddOrEditNode
        open={addOrEditNode}
        onClose={() => {
          setAddOrEditNode(false);
          setSelectedNode(null);
        }}
        selectedNode={selectedNode}
      />

      <AddOrEditSection
        open={addOrEditSection}
        onClose={() => {
          setAddOrEditSection(false);
          setSelectedSection(null);
        }}
        section={selectedSection}
      />

      <AddOrEditGrid
        open={addOrEditGrid}
        onClose={() => {
          setAddOrEditGrid(false);
          setSelectedGrid(null);
        }}
        grid={selectedGrid}
      />

      <AddOrEditLevel
        open={addOrEditLevel}
        onClose={() => {
          setAddOrEditLevel(false);
          setSelectedLevel(null);
        }}
        level={selectedLevel}
      />

      <AddOrEditMaterial
        open={addOrEditMaterial}
        onClose={() => {setAddOrEditMaterial(false)}}
        selectedMaterial={selectedMaterial}
      />

      <AddOrEditMember
        open={addOrEditMember}
        onClose={() => {
          setAddOrEditMember(false);
          setSelectedMember(null);
        }}
        selectedMember={selectedMember}
      />
    </Box>
  );
});

export default LeftBar;
