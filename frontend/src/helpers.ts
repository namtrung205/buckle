
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
import { isBuckleProjectFile, PROJECT_FILE_KIND, PROJECT_FILE_VERSION, type BuckleProjectFile } from './contracts/projectFile';
import { analysisTransportToDocumentSeed, analysisTransportToDocumentSeedWithOrganizational, type AnalysisTransportInput } from './core/structural';

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
 * Export the model as a full Buckle project file: the backend-compatible
 * analysis transport plus the organizational document collections (selection
 * sets, groups, parametric objects, grids, levels) that the transport
 * deliberately omits, so a save/open round-trip restores the whole workspace.
 */
export const exportProjectJson = (model: Model): BuckleProjectFile => {
  const transport = structuredClone(model.createAnalysisSnapshot().model) as unknown as StructuralModelDto;
  const snapshot = model.structuralDocument.getSnapshot();
  return {
    kind: PROJECT_FILE_KIND,
    version: PROJECT_FILE_VERSION,
    model: transport,
    organizational: {
      selectionSets: snapshot.selectionSets,
      groups: snapshot.groups,
      parametricObjects: snapshot.parametricObjects,
      grids: snapshot.grids,
      levels: snapshot.levels,
    },
  };
};

/**
 * Build the Three.js scene from a Z-up JSON payload (the shared schema).
 * Converts nodes, member vecxz, boundary conditions and load values from the
 * Z-up engineering frame into the three.js Y-up scene frame. Created shells
 * too when the payload provides them.
 */
export const buildModelFromJson = (model: Model, input: StructuralModelDto | BuckleProjectFile) => {
  // Buckle project files carry the organizational collections (selection sets,
  // groups, parametric objects, grids, levels) under a separate top-level key;
  // plain backend transport JSON keeps working unchanged.
  const document = isBuckleProjectFile(input)
    ? analysisTransportToDocumentSeedWithOrganizational(
        input.model as unknown as AnalysisTransportInput,
        input.organizational,
      )
    : analysisTransportToDocumentSeed(input as unknown as AnalysisTransportInput)
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

