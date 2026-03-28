import React, { useState, ChangeEvent } from 'react';
import {
  Box,
  Typography,
  Grid,
  Button,
  FormControlLabel,
  Checkbox,
  Divider,
} from '@mui/material';
import { observer } from 'mobx-react-lite';
import * as THREE from 'three';
import { useModel } from '../../../model/Context';
import Dialog from '../../../components/Dialog/Dialog';
import TextField from '../../../components/TextField';
import { Node, ElasticBeamColumn, Load } from '../../../model';
import BoundaryCondition from '../../../model/BoundaryCondition/BoundaryCondition';
import { Section } from '../../../types';

interface WarehouseWizardProps {
  open: boolean;
  onClose: () => void;
}

const WarehouseWizard = ({ open, onClose }: WarehouseWizardProps) => {
  const model = useModel();

  // State for parameters
  const [params, setParams] = useState({
    width: 20,
    length: 10,
    height: 6,
    pitch: 15,
    numBays: 2,
    numPurlins: 4, // spaces per roof side
    hasBracing: true,
    addSelfWeight: true,
    addWindLoad: true,
    windMagnitude: 2.0, // kN/m
    clearExisting: true
  });

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
    }
    return areaMm2 * 1e-6; // Convert mm2 to m2
  };

  const handleGenerate = () => {
    if (!model) return;

    if (params.clearExisting) {
      model.clear();
    }

    const { width, length, height, pitch, numBays, numPurlins, hasBracing, addSelfWeight, addWindLoad, windMagnitude } = params;
    
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

    // --- 4. LOADING ---
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

    if (addWindLoad) {
        const q = windMagnitude * 1000;
        const windwardCols = frameData.map(f => f.columns[0].id);
        const leewardCols = frameData.map(f => f.columns[1].id);
        const allRafters = frameData.flatMap(f => f.rafters.map(r => r.id));

        new Load(model, { name: "Wind-Pressure", targets: windwardCols, type: 'linear', value: new THREE.Vector3(q, 0, 0) } as any).createOrUpdate();
        new Load(model, { name: "Wind-Suction", targets: leewardCols, type: 'linear', value: new THREE.Vector3(q * 0.5, 0, 0) } as any).createOrUpdate();
        new Load(model, { name: "Wind-Lift", targets: allRafters, type: 'linear', value: new THREE.Vector3(0, q * 0.8, 0) } as any).createOrUpdate();
    }

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
      <Box sx={{ mt: 1 }}>
        <Typography variant="subtitle2" gutterBottom sx={{ color: '#aaa', fontWeight: 600 }}>
          DIMENSIONS (m)
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField label="Width" name="width" type="number" value={params.width} onChange={handleChange} fullWidth size="small" placeholder="20" />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Length" name="length" type="number" value={params.length} onChange={handleChange} fullWidth size="small" placeholder="30" />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Height" name="height" type="number" value={params.height} onChange={handleChange} fullWidth size="small" placeholder="6" />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Roof Pitch (°)" name="pitch" type="number" value={params.pitch} onChange={handleChange} fullWidth size="small" placeholder="15" />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2, bgcolor: '#444' }} />

        <Typography variant="subtitle2" gutterBottom sx={{ color: '#aaa', fontWeight: 600 }}>
          STRUCTURAL & LOADING
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField label="Number of Bays" name="numBays" type="number" value={params.numBays} onChange={handleChange} fullWidth size="small" placeholder="5" />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Purlins (count/side)" name="numPurlins" type="number" value={params.numPurlins} onChange={handleChange} fullWidth size="small" placeholder="6" />
          </Grid>
          
          <Grid item xs={8}>
            <FormControlLabel
              control={<Checkbox name="addWindLoad" checked={params.addWindLoad} onChange={handleChange} sx={{ color: '#666', '&.Mui-checked': { color: '#03a9f4' } }} />}
              label={<Typography variant="body2" sx={{ color: '#e0e0e0' }}>Add Automatic Wind Load</Typography>}
            />
          </Grid>
          <Grid item xs={4}>
            <TextField label="Wind (kN/m)" name="windMagnitude" type="number" value={params.windMagnitude} onChange={handleChange} fullWidth size="small" placeholder="2.0" disabled={!params.addWindLoad} />
          </Grid>

          <Grid item xs={12}>
            <FormControlLabel
              control={<Checkbox name="addSelfWeight" checked={params.addSelfWeight} onChange={handleChange} sx={{ color: '#666', '&.Mui-checked': { color: '#ffeb3b' } }} />}
              label={<Typography variant="body2" sx={{ color: '#e0e0e0' }}>Calculate & Add Self-Weight (Steel)</Typography>}
            />
          </Grid>

          <Grid item xs={12}>
            <FormControlLabel
              control={<Checkbox name="hasBracing" checked={params.hasBracing} onChange={handleChange} sx={{ color: '#666', '&.Mui-checked': { color: '#4caf50' } }} />}
              label={<Typography variant="body2" sx={{ color: '#e0e0e0' }}>Add Cross Bracing</Typography>}
            />
          </Grid>

          <Grid item xs={12}>
            <FormControlLabel
              control={<Checkbox name="clearExisting" checked={params.clearExisting} onChange={handleChange} sx={{ color: '#666', '&.Mui-checked': { color: '#f44336' } }} />}
              label={<Typography variant="body2" sx={{ color: '#e0e0e0', fontWeight: 500 }}>Clear existing model before generation</Typography>}
            />
          </Grid>
        </Grid>

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          <Button onClick={onClose} sx={{ color: '#aaa' }}>Cancel</Button>
          <Button
            onClick={handleGenerate}
            variant="contained"
            sx={{ bgcolor: '#4caf50', '&:hover': { bgcolor: '#388e3c' }, textTransform: 'none', px: 4, fontWeight: 600 }}
          >
            Generate & Load Model
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default observer(WarehouseWizard);
