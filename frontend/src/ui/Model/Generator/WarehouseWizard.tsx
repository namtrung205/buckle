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
    length: 30,
    height: 6,
    pitch: 15,
    numBays: 5,
    numPurlins: 6, // per roof side
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
    // If area is already specified in properties, use it
    if (section.properties?.A) return section.properties.A;

    // Fallback calculation (assuming dimensions are in mm)
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
    
    const framesNodes: Node[][] = [];
    const columnsL: ElasticBeamColumn[] = [];
    const columnsR: ElasticBeamColumn[] = [];
    const raftersL: ElasticBeamColumn[] = [];
    const raftersR: ElasticBeamColumn[] = [];
    const purlins: ElasticBeamColumn[] = [];
    const bracings: ElasticBeamColumn[] = [];

    // 1. Generate Frames
    for (let i = 0; i <= numBays; i++) {
        const z = i * bayLength;
        const frameNodes: Node[] = [];

        // Base Left
        const n1 = new Node(new THREE.Vector3(0, 0, z), `Base-L-${i}`);
        n1.model = model;
        n1.create();
        model.nodes.push(n1);
        frameNodes.push(n1);

        // Eave Left
        const n2 = new Node(new THREE.Vector3(0, height, z), `Eave-L-${i}`);
        n2.model = model;
        n2.create();
        model.nodes.push(n2);
        frameNodes.push(n2);

        // Ridge
        const n3 = new Node(new THREE.Vector3(width / 2, ridgeHeight, z), `Ridge-${i}`);
        n3.model = model;
        n3.create();
        model.nodes.push(n3);
        frameNodes.push(n3);

        // Eave Right
        const n4 = new Node(new THREE.Vector3(width, height, z), `Eave-R-${i}`);
        n4.model = model;
        n4.create();
        model.nodes.push(n4);
        frameNodes.push(n4);

        // Base Right
        const n5 = new Node(new THREE.Vector3(width, 0, z), `Base-R-${i}`);
        n5.model = model;
        n5.create();
        model.nodes.push(n5);
        frameNodes.push(n5);

        framesNodes.push(frameNodes);

        // Columns
        const colL = new ElasticBeamColumn(model, `Col-L-${i}`, [n1, n2], section);
        colL.create();
        model.members.push(colL);
        columnsL.push(colL);

        const colR = new ElasticBeamColumn(model, `Col-R-${i}`, [n5, n4], section);
        colR.create();
        model.members.push(colR);
        columnsR.push(colR);

        // Rafters
        const raftL = new ElasticBeamColumn(model, `Raft-L-${i}`, [n2, n3], section);
        raftL.create();
        model.members.push(raftL);
        raftersL.push(raftL);

        const raftR = new ElasticBeamColumn(model, `Raft-R-${i}`, [n3, n4], section);
        raftR.create();
        model.members.push(raftR);
        raftersR.push(raftR);

        // Fixed Supports at base
        const bcL = new BoundaryCondition(model, {
            name: `Support-L-${i}`,
            targets: [n1.id],
            type: 'fixed',
            dx: 1, dy: 1, dz: 1, rx: 1, ry: 1, rz: 1
        } as any);
        bcL.createOrUpdate();
        model.boundaryConditions.push(bcL);

        const bcR = new BoundaryCondition(model, {
            name: `Support-R-${i}`,
            targets: [n5.id],
            type: 'fixed',
            dx: 1, dy: 1, dz: 1, rx: 1, ry: 1, rz: 1
        } as any);
        bcR.createOrUpdate();
        model.boundaryConditions.push(bcR);
    }

    // 2. Generate Purlins
    if (numPurlins > 0) {
        for (let i = 0; i < numBays; i++) {
            const zStart = framesNodes[i];
            const zEnd = framesNodes[i+1];

            // Purlins along rafters
            for (let p = 0; p <= numPurlins; p++) {
                const ratio = p / numPurlins;
                
                // Left side
                const startPosL = new THREE.Vector3().lerpVectors(zStart[1].mesh.position, zStart[2].mesh.position, ratio);
                const endPosL = new THREE.Vector3().lerpVectors(zEnd[1].mesh.position, zEnd[2].mesh.position, ratio);
                
                if (p === 0 || p === numPurlins) {
                    const nodeIdx = p === 0 ? 1 : 2;
                    const purlinMember = new ElasticBeamColumn(model, `Purlin-L-${i}-${p}`, [zStart[nodeIdx], zEnd[nodeIdx]], section);
                    purlinMember.create();
                    model.members.push(purlinMember);
                    purlins.push(purlinMember);
                } else {
                    const sn = new Node(startPosL, `Purlin-Node-L-${i}-${p}`);
                    sn.model = model;
                    sn.create();
                    model.nodes.push(sn);
                    
                    const en = new Node(endPosL, `Purlin-Node-L-${i+1}-${p}`);
                    en.model = model;
                    en.create();
                    model.nodes.push(en);

                    const purlinMember = new ElasticBeamColumn(model, `Purlin-L-${i}-${p}`, [sn, en], section);
                    purlinMember.create();
                    model.members.push(purlinMember);
                    purlins.push(purlinMember);
                }

                // Right side
                if (p === 0) { // Ridge already done above
                    const purlinMember = new ElasticBeamColumn(model, `Purlin-R-${i}-0`, [zStart[3], zEnd[3]], section);
                    purlinMember.create();
                    model.members.push(purlinMember);
                    purlins.push(purlinMember);
                } else if (p < numPurlins) {
                    const startPosR = new THREE.Vector3().lerpVectors(zStart[3].mesh.position, zStart[2].mesh.position, ratio);
                    const endPosR = new THREE.Vector3().lerpVectors(zEnd[3].mesh.position, zEnd[2].mesh.position, ratio);

                    const sn = new Node(startPosR, `Purlin-Node-R-${i}-${p}`);
                    sn.model = model;
                    sn.create();
                    model.nodes.push(sn);
                    
                    const en = new Node(endPosR, `Purlin-Node-R-${i+1}-${p}`);
                    en.model = model;
                    en.create();
                    model.nodes.push(en);

                    const purlinMember = new ElasticBeamColumn(model, `Purlin-R-${i}-${p}`, [sn, en], section);
                    purlinMember.create();
                    model.members.push(purlinMember);
                    purlins.push(purlinMember);
                }
            }
        }
    }

    // 3. Generate Bracing (Side walls and roof in first/last bays)
    if (hasBracing) {
        const bracingBays = [0, numBays - 1]; // First and last bay
        for (const b of bracingBays) {
            if (b >= numBays) continue;
            const zStart = framesNodes[b];
            const zEnd = framesNodes[b+1];

            const addBrace = (n1: Node, n2: Node, label: string) => {
                const bMember = new ElasticBeamColumn(model, label, [n1, n2], section);
                bMember.create();
                model.members.push(bMember);
                bracings.push(bMember);
            };

            addBrace(zStart[0], zEnd[1], `Brace-Side-L-${b}-1`);
            addBrace(zStart[1], zEnd[0], `Brace-Side-L-${b}-2`);
            addBrace(zStart[4], zEnd[3], `Brace-Side-R-${b}-1`);
            addBrace(zStart[3], zEnd[4], `Brace-Side-R-${b}-2`);
            addBrace(zStart[1], zEnd[2], `Brace-Roof-L-${b}-1`);
            addBrace(zStart[2], zEnd[1], `Brace-Roof-L-${b}-2`);
            addBrace(zStart[3], zEnd[2], `Brace-Roof-R-${b}-1`);
            addBrace(zStart[2], zEnd[3], `Brace-Roof-R-${b}-2`);
        }
    }

    // 4. Enhanced Loading (Self-weight & Wind)
    
    // a. Self-Weight
    if (addSelfWeight) {
        const area = calculateArea(section);
        const density = 7850; // kg/m3
        const gravity = 9.81;
        const weight = area * density * gravity; // N/m

        // Apply to all frame members and purlins (bracing usually small, but can be included)
        const allMembers = [...columnsL, ...columnsR, ...raftersL, ...raftersR, ...purlins, ...bracings];
        const selfWeightLoad = new Load(model, {
            name: "Self-Weight",
            targets: allMembers.map(m => m.id),
            type: 'linear',
            value: new THREE.Vector3(0, -weight, 0)
        } as any);
        selfWeightLoad.createOrUpdate();
    }

    // b. Wind Load (Simulated)
    if (addWindLoad) {
        // Assume wind from Left (Positive X direction)
        const q = windMagnitude * 1000; // Convert kN/m to N/m

        // Wind on Windward Columns (Pressure)
        const windwardColLoad = new Load(model, {
            name: "Wind-Pressure-L",
            targets: columnsL.map(c => c.id),
            type: 'linear',
            value: new THREE.Vector3(q, 0, 0)
        } as any);
        windwardColLoad.createOrUpdate();

        // Wind on Leeward Columns (Suction)
        const leewardColLoad = new Load(model, {
            name: "Wind-Suction-R",
            targets: columnsR.map(c => c.id),
            type: 'linear',
            value: new THREE.Vector3(q * 0.5, 0, 0) // Reduced suction
        } as any);
        leewardColLoad.createOrUpdate();

        // Wind on Rafters (Upward lift/suction)
        const rafterLoad = new Load(model, {
            name: "Wind-Lift-Rafters",
            targets: [...raftersL, ...raftersR].map(r => r.id),
            type: 'linear',
            value: new THREE.Vector3(0, q * 0.8, 0) // Upward
        } as any);
        rafterLoad.createOrUpdate();
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
            <TextField
              label="Width"
              name="width"
              type="number"
              value={params.width}
              onChange={handleChange}
              fullWidth
              size="small"
              placeholder="20"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Length"
              name="length"
              type="number"
              value={params.length}
              onChange={handleChange}
              fullWidth
              size="small"
              placeholder="50"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Height"
              name="height"
              type="number"
              value={params.height}
              onChange={handleChange}
              fullWidth
              size="small"
              placeholder="6"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Roof Pitch (°)"
              name="pitch"
              type="number"
              value={params.pitch}
              onChange={handleChange}
              fullWidth
              size="small"
              placeholder="15"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2, bgcolor: '#444' }} />

        <Typography variant="subtitle2" gutterBottom sx={{ color: '#aaa', fontWeight: 600 }}>
          STRUCTURAL & LOADING
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField
              label="Number of Bays"
              name="numBays"
              type="number"
              value={params.numBays}
              onChange={handleChange}
              fullWidth
              size="small"
              placeholder="10"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Purlins (count/side)"
              name="numPurlins"
              type="number"
              value={params.numPurlins}
              onChange={handleChange}
              fullWidth
              size="small"
              placeholder="8"
            />
          </Grid>
          
          <Grid item xs={8}>
            <FormControlLabel
              control={
                <Checkbox
                  name="addWindLoad"
                  checked={params.addWindLoad}
                  onChange={handleChange}
                  sx={{ color: '#666', '&.Mui-checked': { color: '#03a9f4' } }}
                />
              }
              label={<Typography variant="body2" sx={{ color: '#e0e0e0' }}>Add Automatic Wind Load</Typography>}
            />
          </Grid>
          <Grid item xs={4}>
            <TextField
              label="Wind (kN/m)"
              name="windMagnitude"
              type="number"
              value={params.windMagnitude}
              onChange={handleChange}
              fullWidth
              size="small"
              placeholder="2.0"
              disabled={!params.addWindLoad}
            />
          </Grid>

          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  name="addSelfWeight"
                  checked={params.addSelfWeight}
                  onChange={handleChange}
                  sx={{ color: '#666', '&.Mui-checked': { color: '#ffeb3b' } }}
                />
              }
              label={<Typography variant="body2" sx={{ color: '#e0e0e0' }}>Calculate & Add Self-Weight (Steel)</Typography>}
            />
          </Grid>

          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  name="hasBracing"
                  checked={params.hasBracing}
                  onChange={handleChange}
                  sx={{ color: '#666', '&.Mui-checked': { color: '#4caf50' } }}
                />
              }
              label={<Typography variant="body2" sx={{ color: '#e0e0e0' }}>Add Cross Bracing</Typography>}
            />
          </Grid>

          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  name="clearExisting"
                  checked={params.clearExisting}
                  onChange={handleChange}
                  sx={{ color: '#666', '&.Mui-checked': { color: '#f44336' } }}
                />
              }
              label={<Typography variant="body2" sx={{ color: '#e0e0e0', fontWeight: 500 }}>Clear existing model before generation</Typography>}
            />
          </Grid>
        </Grid>

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          <Button onClick={onClose} sx={{ color: '#aaa' }}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            variant="contained"
            sx={{
              bgcolor: '#4caf50',
              '&:hover': { bgcolor: '#388e3c' },
              textTransform: 'none',
              px: 4,
              fontWeight: 600
            }}
          >
            Generate & Load Model
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default observer(WarehouseWizard);
