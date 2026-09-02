import React, { useState, ChangeEvent } from 'react';
import {
  Box,
  Typography,
  Grid,
  Button,
  FormControlLabel,
  Checkbox,
  Divider,
  Tabs,
  Tab,
} from '@mui/material';
import { observer } from 'mobx-react-lite';
import * as THREE from 'three';
import { useModel } from '../../../model/Context';
import Dialog from '../../../components/Dialog/Dialog';
import { colors } from '../../../theme';
import TextField from '../../../components/TextField';
import { Node, ElasticBeamColumn, Load, Shell } from '../../../model';
import BoundaryCondition from '../../../model/BoundaryCondition/BoundaryCondition';
import { Section } from '../../../types';

interface WarehouseWizardProps {
  open: boolean;
  onClose: () => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 2 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const WarehouseWizard = ({ open, onClose }: WarehouseWizardProps) => {
  const model = useModel();

  // State for parameters
  const [params, setParams] = useState({
    width: 20,
    length: 10,
    height: 6,
    pitch: 15,
    numBays: 5,
    numPurlins: 6, // spaces per roof side
    hasBracing: true,
    addSelfWeight: true,
    addWindLoad: true,
    windMagnitude: 1.2, // kN/m2 (Pressure)
    addSnowLoad: true,
    snowMagnitude: 0.8, // kN/m2 (Pressure)
    addMembrane: true,
    membraneThickness: 0.002,
    clearExisting: true,
    // Targeted shell loads
    windOnRoof: true,
    windOnSideWalls: true,
    windOnEndWalls: true,
    snowOnRoof: true,
  });

  const [tabIndex, setTabIndex] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabIndex(newValue);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setParams(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : Number(value)
    }));
  };

  const calculateArea = (section: Section): number => {
    if (section.properties?.A) return section.properties.A;
    let areaMm2 = 0;
    switch (section.type) {
        case 'Rectangular':
            areaMm2 = section.width * section.height;
            break;
        case 'I':
            areaMm2 = 2 * section.width * section.tf + (section.depth - 2 * section.tf) * section.tw;
            break;
        case 'IPN':
            areaMm2 = 2 * section.width * section.tf + (section.depth - 2 * section.tf) * section.tw;
            break;
        case 'HollowCircular': {
            const r_ext = section.diameter / 2;
            const r_int = r_ext - section.thickness;
            areaMm2 = Math.PI * (r_ext * r_ext - r_int * r_int);
            break;
        }
        case 'Circular': {
            const r = section.diameter / 2;
            areaMm2 = Math.PI * r * r;
            break;
        }
        case 'RectangularHollow':
            areaMm2 = section.width * section.height - (section.width - 2 * section.thickness) * (section.height - 2 * section.thickness);
            break;
        case 'Channel':
            areaMm2 = 2 * section.width * section.tf + (section.depth - 2 * section.tf) * section.tw;
            break;
        case 'UPN':
            areaMm2 = 2 * section.width * section.tf + (section.depth - 2 * section.tf) * section.tw;
            break;
        case 'Tee':
            areaMm2 = section.width * section.tf + (section.depth - section.tf) * section.tw;
            break;
        case 'Angle':
            areaMm2 = section.width * section.thickness * 2 - section.thickness * section.thickness;
            break;
    }
    return areaMm2 * 1e-6; // Convert mm2 to m2
  };

  const handleGenerate = () => {
    if (!model) return;

    if (params.clearExisting) {
      model.clear();
    }

    const { 
        width, length, height, pitch, numBays, numPurlins, hasBracing, 
        addSelfWeight, addWindLoad, windMagnitude, addSnowLoad, snowMagnitude,
        windOnRoof, windOnSideWalls, windOnEndWalls, snowOnRoof
    } = params;
    
    const section = model.sections[0];
    if (!section) {
        alert("Please define at least one section first.");
        return;
    }

    const bayLength = length / numBays;
    const pitchRad = (pitch * Math.PI) / 180;
    const ridgeHeight = height + (width / 2) * Math.tan(pitchRad);
    
    const frameData: {
        baseL: Node,
        baseR: Node,
        eaveL: Node,
        eaveR: Node,
        ridge: Node,
        raftNodesL: Node[],
        raftNodesR: Node[],
        columns: ElasticBeamColumn[],
        rafters: ElasticBeamColumn[]
    }[] = [];

    // --- 1. NODE & FRAME GENERATION ---
    for (let i = 0; i <= numBays; i++) {
        const z = i * bayLength;
        
        // Helper to create & register node
        const createNode = (x: number, y: number, z: number, name: string) => {
            const node = new Node(new THREE.Vector3(x, y, z), name);
            node.model = model;
            node.create();
            model.nodes.push(node);
            return node;
        };

        const baseL = createNode(0, 0, z, `Base-L-${i}`);
        const baseR = createNode(width, 0, z, `Base-R-${i}`);
        const eaveL = createNode(0, height, z, `Eave-L-${i}`);
        const eaveR = createNode(width, height, z, `Eave-R-${i}`);
        const ridge = createNode(width / 2, ridgeHeight, z, `Ridge-${i}`);

        // Rafter nodes - Left side (from Eave to Ridge)
        const raftNodesL: Node[] = [eaveL];
        for (let p = 1; p < numPurlins; p++) {
            const ratio = p / numPurlins;
            const pos = new THREE.Vector3().lerpVectors(eaveL.mesh.position, ridge.mesh.position, ratio);
            raftNodesL.push(createNode(pos.x, pos.y, pos.z, `Raft-L-Node-${i}-${p}`));
        }
        raftNodesL.push(ridge);

        // Rafter nodes - Right side (from Eave to Ridge)
        const raftNodesR: Node[] = [eaveR];
        for (let p = 1; p < numPurlins; p++) {
            const ratio = p / numPurlins;
            const pos = new THREE.Vector3().lerpVectors(eaveR.mesh.position, ridge.mesh.position, ratio);
            raftNodesR.push(createNode(pos.x, pos.y, pos.z, `Raft-R-Node-${i}-${p}`));
        }
        raftNodesR.push(ridge);

        // --- Create Frame Members ---
        const columns: ElasticBeamColumn[] = [];
        const rafters: ElasticBeamColumn[] = [];

        // Columns
        const colL = new ElasticBeamColumn(model, `Col-L-${i}`, [baseL, eaveL], section);
        colL.create();
        model.members.push(colL);
        columns.push(colL);

        const colR = new ElasticBeamColumn(model, `Col-R-${i}`, [baseR, eaveR], section);
        colR.create();
        model.members.push(colR);
        columns.push(colR);

        // Segmented Rafters L
        for (let s = 0; s < raftNodesL.length - 1; s++) {
            const raftSeg = new ElasticBeamColumn(model, `Raft-L-Seg-${i}-${s}`, [raftNodesL[s], raftNodesL[s+1]], section);
            raftSeg.create();
            model.members.push(raftSeg);
            rafters.push(raftSeg);
        }

        // Segmented Rafters R
        for (let s = 0; s < raftNodesR.length - 1; s++) {
            const raftSeg = new ElasticBeamColumn(model, `Raft-R-Seg-${i}-${s}`, [raftNodesR[s], raftNodesR[s+1]], section);
            raftSeg.create();
            model.members.push(raftSeg);
            rafters.push(raftSeg);
        }

        // --- Boundary Conditions ---
        [baseL, baseR].forEach((node, idx) => {
            const bc = new BoundaryCondition(model, {
                name: `Support-${idx === 0? 'L':'R'}-${i}`,
                targets: [node.id],
                type: 'fixed',
                dx: 1, dy: 1, dz: 1, rx: 1, ry: 1, rz: 1
            } as any);
            bc.createOrUpdate();
        });

        frameData.push({ baseL, baseR, eaveL, eaveR, ridge, raftNodesL, raftNodesR, columns, rafters });
    }

    // --- 2. PURLIN GENERATION (LONGITUDINAL) ---
    const allPurlins: ElasticBeamColumn[] = [];
    for (let i = 0; i < numBays; i++) {
        const f1 = frameData[i];
        const f2 = frameData[i+1];

        // Purlins on Left Rafters (skip last node as it's the Ridge, handled separately if needed or just part of loop)
        for (let p = 0; p < f1.raftNodesL.length; p++) {
            const purlin = new ElasticBeamColumn(model, `Purlin-L-${i}-${p}`, [f1.raftNodesL[p], f2.raftNodesL[p]], section);
            purlin.create();
            model.members.push(purlin);
            allPurlins.push(purlin);
        }

        // Purlins on Right Rafters (skip Ridge as it was already covered by Left Side raftNodesL[last] which IS ridge)
        for (let p = 0; p < f1.raftNodesR.length - 1; p++) {
            const purlin = new ElasticBeamColumn(model, `Purlin-R-${i}-${p}`, [f1.raftNodesR[p], f2.raftNodesR[p]], section);
            purlin.create();
            model.members.push(purlin);
            allPurlins.push(purlin);
        }
    }

    // --- 3. BRACING GENERATION ---
    const allBracings: ElasticBeamColumn[] = [];
    if (hasBracing) {
        const bracingBays = [0, numBays - 1]; // First and last bay
        for (const b of bracingBays) {
            if (b >= numBays) continue;
            const f1 = frameData[b];
            const f2 = frameData[b+1];

            const addBrace = (n1: Node, n2: Node, label: string) => {
                const bMember = new ElasticBeamColumn(model, label, [n1, n2], section);
                bMember.create();
                model.members.push(bMember);
                allBracings.push(bMember);
            };

            // Side L
            addBrace(f1.baseL, f2.eaveL, `Brace-Side-L-${b}-1`);
            addBrace(f1.eaveL, f2.baseL, `Brace-Side-L-${b}-2`);
            // Side R
            addBrace(f1.baseR, f2.eaveR, `Brace-Side-R-${b}-1`);
            addBrace(f1.eaveR, f2.baseR, `Brace-Side-R-${b}-2`);
            // Roof L (Eave to Ridge)
            addBrace(f1.eaveL, f2.ridge, `Brace-Roof-L-${b}-1`);
            addBrace(f1.ridge, f2.eaveL, `Brace-Roof-L-${b}-2`);
            // Roof R (Eave to Ridge)
            addBrace(f1.eaveR, f2.ridge, `Brace-Roof-R-${b}-1`);
            addBrace(f1.ridge, f2.eaveR, `Brace-Roof-R-${b}-2`);
        }
    }

    // --- 4. SHELL/MEMBRANE GENERATION ---
    const roofShells: Shell[] = [];
    const sideWallShells: Shell[] = [];
    const endWallShells: Shell[] = [];

    if (params.addMembrane) {
        const material = model.materials[0] || { id: 1, name: 'PVC', E: 1e9, nu: 0.3 };
        for (let i = 0; i < numBays; i++) {
            const f1 = frameData[i];
            const f2 = frameData[i+1];

            // Left Side Panels (Roof)
            for (let p = 0; p < f1.raftNodesL.length - 1; p++) {
                const shellNodes = [f1.raftNodesL[p], f2.raftNodesL[p], f2.raftNodesL[p+1], f1.raftNodesL[p+1]];
                const shell = new Shell(model, `Membrane-L-${i}-${p}`, shellNodes, params.membraneThickness, material);
                shell.create();
                model.shells.push(shell);
                roofShells.push(shell);
            }

            // Right Side Panels (Roof)
            for (let p = 0; p < f1.raftNodesR.length - 1; p++) {
                const shellNodes = [f1.raftNodesR[p], f2.raftNodesR[p], f2.raftNodesR[p+1], f1.raftNodesR[p+1]];
                const shell = new Shell(model, `Membrane-R-${i}-${p}`, shellNodes, params.membraneThickness, material);
                shell.create();
                model.shells.push(shell);
                roofShells.push(shell);
            }

            // Side Walls
            const shellL = new Shell(model, `Wall-L-${i}`, [f1.baseL, f2.baseL, f2.eaveL, f1.eaveL], params.membraneThickness, material);
            shellL.create();
            model.shells.push(shellL);
            sideWallShells.push(shellL);

            const shellR = new Shell(model, `Wall-R-${i}`, [f1.baseR, f2.baseR, f2.eaveR, f1.eaveR], params.membraneThickness, material);
            shellR.create();
            model.shells.push(shellR);
            sideWallShells.push(shellR);
        }

        // End Walls
        const endFrames = [0, numBays];
        endFrames.forEach(i => {
            const f = frameData[i];
            // End wall: rectangular panel only (eaveL, eaveR, baseR, baseL)
            // NOTE: Gable triangle (eaveL-eaveR-ridge) is NOT created as a shell because
            // ShellMITC4 requires 4 UNIQUE nodes; coincident nodes cause singular stiffness.
            const shellBottom = new Shell(model, `EndWall-Bottom-${i}`, [f.baseL, f.baseR, f.eaveR, f.eaveL], params.membraneThickness, material);
            shellBottom.create();
            model.shells.push(shellBottom);
            endWallShells.push(shellBottom);
        });
    }

    // --- 5. LOADING ---
    const area = calculateArea(section);
    const weight = (area * 7850 * 9.81) / 1000; // kN/m

    if (addSelfWeight) {
        const allMembers = model.members;
        const selfWeightLoad = new Load(model, {
            name: "Self-Weight",
            targets: allMembers.map(m => m.id),
            type: 'linear',
            value: new THREE.Vector3(0, -weight, 0)
        } as any);
        selfWeightLoad.createOrUpdate();
    }

    if (addWindLoad && params.addMembrane) {
        const q = windMagnitude;
        const windTargets: number[] = [];
        if (windOnRoof) windTargets.push(...roofShells.map(s => s.id));
        if (windOnSideWalls) windTargets.push(...sideWallShells.map(s => s.id));
        if (windOnEndWalls) windTargets.push(...endWallShells.map(s => s.id));

        if (windTargets.length > 0) {
            new Load(model, { 
                name: "Wind-Pressure", 
                targets: windTargets, 
                type: 'pressure', 
                magnitude: q,           // scalar → normal pressure on shell surface
                value: new THREE.Vector3(0, 0, 0) // fallback to avoid null in JSON
            } as any).createOrUpdate();
        }
    }

    if (addSnowLoad && params.addMembrane && snowOnRoof) {
        const s = snowMagnitude;
        new Load(model, {
            name: "Snow-Load",
            targets: roofShells.map(s => s.id),
            type: 'pressure',
            magnitude: 0,               // explicitly 0 → route via vector path in backend
            value: new THREE.Vector3(0, -s, 0) // Downward in global -Y (Three.js Y-up = gravity)
        } as any).createOrUpdate();
    }

    // Frame the generated warehouse so long spans are fully visible
    model.camera.fitModelToView();

    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      title="Warehouse Wizard"
    >
      <Box sx={{ width: '100%', mt: 1 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs
            value={tabIndex}
            onChange={handleTabChange}
            TabIndicatorProps={{ style: { backgroundColor: colors.accent } }}
            sx={{
              '& .MuiTab-root': { color: colors.textFaint, textTransform: 'none', fontWeight: 600 },
              '& .Mui-selected': { color: colors.accentSoft }
            }}
          >
            <Tab label="1. General Info" />
            <Tab label="2. Structure" />
            <Tab label="3. Bracing" />
            <Tab label="4. Shell & Loads" />
          </Tabs>
        </Box>

        <CustomTabPanel value={tabIndex} index={0}>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={6}><TextField label="Width (m)" name="width" type="number" value={params.width} onChange={handleChange} fullWidth size="small" placeholder="" /></Grid>
            <Grid item xs={6}><TextField label="Length (total m)" name="length" type="number" value={params.length} onChange={handleChange} fullWidth size="small" placeholder="" /></Grid>
            <Grid item xs={6}><TextField label="Eave Height (m)" name="height" type="number" value={params.height} onChange={handleChange} fullWidth size="small" placeholder="" /></Grid>
            <Grid item xs={6}><TextField label="Roof Pitch (°)" name="pitch" type="number" value={params.pitch} onChange={handleChange} fullWidth size="small" placeholder="" /></Grid>
            <Grid item xs={12}><TextField label="Number of Bays" name="numBays" type="number" value={params.numBays} onChange={handleChange} fullWidth size="small" placeholder="" /></Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={<Checkbox name="clearExisting" checked={params.clearExisting} onChange={handleChange} sx={{ color: colors.textFaint, '&.Mui-checked': { color: colors.danger } }} />}
                label={<Typography variant="body2" sx={{ color: colors.text, fontWeight: 500 }}>Clear existing model before generation</Typography>}
              />
            </Grid>
          </Grid>
        </CustomTabPanel>

        <CustomTabPanel value={tabIndex} index={1}>
           <Grid container spacing={2} sx={{ mt: 1 }}>
             <Grid item xs={12}><TextField label="Purlins spaces per side" name="numPurlins" type="number" value={params.numPurlins} onChange={handleChange} fullWidth size="small" placeholder="" /></Grid>
             <Grid item xs={12}>
               <Typography variant="caption" sx={{ color: colors.textFaint }}>Note: Rafters and Columns currently use the default section defined in the model.</Typography>
             </Grid>
           </Grid>
        </CustomTabPanel>

        <CustomTabPanel value={tabIndex} index={2}>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <FormControlLabel
                control={<Checkbox name="hasBracing" checked={params.hasBracing} onChange={handleChange} sx={{ color: colors.textFaint, '&.Mui-checked': { color: colors.success } }} />}
                label={<Typography variant="body2" sx={{ color: colors.text }}>Add Cross Bracing (Side Walls & Roof)</Typography>}
              />
            </Grid>
          </Grid>
        </CustomTabPanel>

        <CustomTabPanel value={tabIndex} index={3}>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={6}>
              <FormControlLabel
                control={<Checkbox name="addMembrane" checked={params.addMembrane} onChange={handleChange} sx={{ color: colors.textFaint, '&.Mui-checked': { color: colors.accent } }} />}
                label={<Typography variant="body2" sx={{ color: colors.text }}>Enable Membrane/Bạt</Typography>}
              />
            </Grid>
            <Grid item xs={6}><TextField label="Thickness (m)" name="membraneThickness" type="number" value={params.membraneThickness} onChange={handleChange} fullWidth size="small" disabled={!params.addMembrane} placeholder="" /></Grid>
            
            <Grid item xs={12}><Divider sx={{ my: 1, bgcolor: colors.border }} /></Grid>

            {/* Wind Load */}
            <Grid item xs={7}>
              <FormControlLabel
                control={<Checkbox name="addWindLoad" checked={params.addWindLoad} onChange={handleChange} sx={{ color: colors.textFaint, '&.Mui-checked': { color: colors.accent } }} />}
                label={<Typography variant="body2" sx={{ color: colors.text }}>Add Wind Load (Pressure)</Typography>}
              />
            </Grid>
            <Grid item xs={5}><TextField label="Wind (kN/m²)" name="windMagnitude" type="number" value={params.windMagnitude} onChange={handleChange} fullWidth size="small" disabled={!params.addWindLoad} placeholder="" /></Grid>
            
            {params.addWindLoad && (
              <Grid item xs={12} sx={{ pl: 4, mt: -1 }}>
                <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: colors.textDim }}>Target Shells:</Typography>
                <Grid container>
                  <Grid item xs={4}><FormControlLabel control={<Checkbox name="windOnRoof" checked={params.windOnRoof} onChange={handleChange} size="small" sx={{ color: colors.textDim, '&.Mui-checked': { color: colors.accent } }} />} label={<Typography variant="caption" sx={{ color: colors.text }}>Roof</Typography>} /></Grid>
                  <Grid item xs={4}><FormControlLabel control={<Checkbox name="windOnSideWalls" checked={params.windOnSideWalls} onChange={handleChange} size="small" sx={{ color: colors.textDim, '&.Mui-checked': { color: colors.accent } }} />} label={<Typography variant="caption" sx={{ color: colors.text }}>Sides</Typography>} /></Grid>
                  <Grid item xs={4}><FormControlLabel control={<Checkbox name="windOnEndWalls" checked={params.windOnEndWalls} onChange={handleChange} size="small" sx={{ color: colors.textDim, '&.Mui-checked': { color: colors.accent } }} />} label={<Typography variant="caption" sx={{ color: colors.text }}>Ends</Typography>} /></Grid>
                </Grid>
              </Grid>
            )}

            {/* Snow Load */}
            <Grid item xs={7}>
              <FormControlLabel
                control={<Checkbox name="addSnowLoad" checked={params.addSnowLoad} onChange={handleChange} sx={{ color: colors.textFaint, '&.Mui-checked': { color: colors.accent } }} />}
                label={<Typography variant="body2" sx={{ color: colors.text }}>Add Snow Load (Gravity)</Typography>}
              />
            </Grid>
            <Grid item xs={5}><TextField label="Snow (kN/m²)" name="snowMagnitude" type="number" value={params.snowMagnitude} onChange={handleChange} fullWidth size="small" disabled={!params.addSnowLoad} placeholder="" /></Grid>

            <Grid item xs={12}><Divider sx={{ my: 1, bgcolor: colors.border }} /></Grid>
            
            <Grid item xs={12}>
              <FormControlLabel
                control={<Checkbox name="addSelfWeight" checked={params.addSelfWeight} onChange={handleChange} sx={{ color: colors.textFaint, '&.Mui-checked': { color: colors.success } }} />}
                label={<Typography variant="body2" sx={{ color: colors.text }}>Include Steel Self-Weight</Typography>}
              />
            </Grid>
          </Grid>
        </CustomTabPanel>

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2, p: 2 }}>
          <Button onClick={onClose} sx={{ color: colors.textFaint }}>Cancel</Button>
          <Button
            onClick={handleGenerate}
            variant="contained"
            sx={{ bgcolor: colors.success, '&:hover': { bgcolor: colors.success }, textTransform: 'none', px: 4, fontWeight: 600 }}
          >
            Generate & Load Model
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default observer(WarehouseWizard);
