import type { Material, Section } from '../types';

export type Vector3Dto = { x: number; y: number; z: number };

export type NodeDto = Vector3Dto & {
  id: number;
  name?: string;
};

export type MemberDto = {
  id: number;
  label?: string;
  nodei: NodeDto;
  nodej: NodeDto;
  section: number;
  vecxz?: [number, number, number];
  gamma?: number;
  release?: string;
};

export type BoundaryConditionDto = {
  id: number;
  targets: number[];
  type: 'fixed' | 'pinned' | 'roller' | 'roller-x' | 'roller-y' | 'custom' | 'elastic';
  name?: string;
  dx?: number;
  dy?: number;
  dz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  rotation?: number;
};

export type LoadDto = {
  id: number;
  targets: number[];
  type: 'nodal' | 'linear' | 'area' | 'pressure';
  name?: string;
  value: Vector3Dto;
  magnitude?: number;
};

export type ShellDto = {
  id: number;
  name?: string;
  nodes: [number, number, number, number];
  thickness: number;
  material: Material;
};

export type StructuralModelDto = {
  schemaVersion: '1.0';
  nodes: NodeDto[];
  members: MemberDto[];
  materials: Material[];
  sections: Section[];
  loads: LoadDto[];
  boundary_conditions: BoundaryConditionDto[];
  shells: ShellDto[];
  metadata?: Record<string, unknown>;
};

export type AnalysisDisplacement = {
  ux: number;
  uy: number;
  uz: number;
  rx?: number;
  ry?: number;
  rz?: number;
};

export type AnalysisEffort = {
  value: number;
  displaced_positions?: number[];
};

export type AnalysisStation = {
  coord: number[];
  position?: number;
  xi?: number;
  values?: Record<string, number>;
  plot_points?: Record<string, number[]>;
  efforts?: Record<string, AnalysisEffort>;
  disp?: AnalysisDisplacement;
};

export type AnalysisMember = {
  id: number;
  label?: string;
  stations?: AnalysisStation[];
  node_efforts?: AnalysisStation[];
  displacement_stations?: AnalysisStation[];
};

export type AnalysisNode = NodeDto & {
  displacements: AnalysisDisplacement;
};

export type AnalysisReaction = NodeDto & {
  Fx?: number;
  Fy?: number;
  Fz?: number;
  Mx?: number;
  My?: number;
  Mz?: number;
};

export type AnalysisOutput = {
  nodes: AnalysisNode[];
  members: AnalysisMember[];
  reactions: AnalysisReaction[];
};
