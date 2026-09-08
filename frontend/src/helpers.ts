
import * as THREE from 'three';
// import { useModel } from './model/Context';

import Node from './model/Elements/Node/Node';
import ElasticBeamColumnClass from './model/Elements/ElasticBeamColumn/ElasticBeamColumn';
import BoundaryCondition from './model/BoundaryCondition/BoundaryCondition';
import Load from './model/Load/Load';
import Shell from './model/Elements/Shell/Shell';
import Model from './model/Model';
import { threeToJson, jsonToThree } from './utils/axis';
import { runInAction } from 'mobx';
import type { StructuralModelDto } from './contracts/structuralModel';
import { analysisTransportToDocumentSeed, type AnalysisTransportInput } from './core/structural';

/**
 * Export the model to the shared JSON schema.
 *
 * The JSON schema / backend is the single source of truth and stays Z-up
 * (X horizontal, Y horizontal, Z vertical — Midas/SAP/OpenSees convention).
 * The Three.js scene is Y-up (WebGL). The only conversion between the two
 * happens HERE, at this boundary:
 *
 *   UI (three.js Y-up)  --exportModelJson-->  JSON / OpenSees (Z-up)
 *   JSON / OpenSees (Z-up) --buildModelFromJson-->  UI (three.js Y-up)
 *
 * Any other render engine can consume/publish the same Z-up JSON without
 * knowing about the Y<->Z permutation.
 */
export const exportModelJson = (model: Model) => {
  // Return a mutable transport clone for Axios/download consumers; the source
  // AnalysisSnapshot remains deeply frozen and tied to its model revision.
  return structuredClone(model.createAnalysisSnapshot().model) as unknown as StructuralModelDto;
};

/**
 * Build the Three.js scene from a Z-up JSON payload (the shared schema).
 * Converts nodes, member vecxz, boundary conditions and load values from the
 * Z-up engineering frame into the three.js Y-up scene frame. Created shells
 * too when the payload provides them.
 */
export const buildModelFromJson = (model: Model, input: StructuralModelDto) => {
  const document = analysisTransportToDocumentSeed(input as unknown as AnalysisTransportInput)
  model.executeCommand({
    commandId: crypto.randomUUID(),
    type: 'ImportModel',
    schemaVersion: '1.0',
    modelRevision: model.structuralDocument.revision,
    payload: { document, replace: true, confirmed: true },
    source: 'ui',
  }, { allowDestructive: true })

  // Fit the camera to the model so large models are not culled by the far plane
  model.camera.fitModelToView()

  console.log('Model loaded successfully from JSON!')
}

export const buildModelOnjson = async (model: Model, path: string) => {
  try {
    const response = await fetch(path)
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`)
    }
    const jsonData = await response.json()
    buildModelFromJson(model, jsonData)
  } catch (error) {
    console.error('Error loading model from JSON:', error)
    alert('Error loading model: ' + error)
  }
}

