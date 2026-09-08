import { exportModelJson } from '../../helpers';
import { jsonToThree } from '../../utils/axis';
import Model from '../Model';
import { Node, ElasticBeamColumn, BoundaryCondition, Load } from '..';
import type { BoundaryConditionDto, LoadDto } from '../../contracts/structuralModel';

interface WebSocketPayload {
  message: string;
  id?: string;
  data?: unknown;
}

interface NodeMutation {
  id: number;
  name?: string;
  x: number;
  y: number;
  z: number;
}

interface MemberMutation {
  id: number;
  label?: string;
  nodei: number;
  nodej: number;
  section: number;
  vecxz?: [number, number, number];
  gamma?: number;
  release?: string;
}

export default class WebSocketHandler {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectInterval = 3000;
  private readonly model: Model;

  constructor(url: string, model: Model) {
    this.url = url;
    this.model = model;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = (event) => {
          console.log('WebSocket connected:', event);
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const { message, id, data } = JSON.parse(event.data) as WebSocketPayload;
            let answer: object | undefined;

            switch (message) {
              case 'get_scene_info': {
                answer = {
                  message: 'This is the scene state',
                  data: exportModelJson(this.model),
                  id,
                };
                break;
              }
              case 'add_nodes': {
                if (!Array.isArray(data)) throw new Error('add_nodes data must be an array');
                this.model.executeCommand({
                  commandId: id ? `${id}:add_nodes` : crypto.randomUUID(), type: 'CreateNodes', schemaVersion: '1.0',
                  modelRevision: this.model.structuralDocument.revision, source: 'mcp',
                  payload: { nodes: (data as NodeMutation[]).map(item => ({
                    id: item.id, name: item.name, position: [item.x, item.y, item.z],
                  })) },
                });
                answer = { message: 'The nodes have been created', id, success: true };
                break;
              }
              case 'add_members': {
                if (!Array.isArray(data)) throw new Error('add_members data must be an array');
                this.model.executeCommand({
                  commandId: id ? `${id}:add_members` : crypto.randomUUID(), type: 'CreateMembers', schemaVersion: '1.0',
                  modelRevision: this.model.structuralDocument.revision, source: 'mcp',
                  payload: { members: (data as MemberMutation[]).map(item => ({
                    id: item.id, label: item.label ?? `Member ${item.id}`,
                    nodeI: item.nodei, nodeJ: item.nodej, sectionId: item.section,
                    referenceAxis: item.vecxz, gammaDegrees: item.gamma ?? 0, release: item.release ?? '',
                  })) },
                });
                answer = { message: 'The members have been created', id, success: true };
                break;
              }
              case 'add_bc': {
                if (!Array.isArray(data)) throw new Error('add_bc data must be an array');
                this.model.executeCommand({
                  commandId: id ? `${id}:add_bc` : crypto.randomUUID(), type: 'CreateOrUpdateBoundaryConditions', schemaVersion: '1.0',
                  modelRevision: this.model.structuralDocument.revision, source: 'mcp',
                  payload: { boundaryConditions: (data as BoundaryConditionDto[]).map(item => ({
                    id: item.id ?? Math.floor(Math.random() * 0x7fffffff), name: item.name,
                    type: item.type, targetNodeIds: item.targets,
                    dx: item.dx ?? 0, dy: item.dy ?? 0, dz: item.dz ?? 0,
                    rx: item.rx ?? 0, ry: item.ry ?? 0, rz: item.rz ?? 0,
                    rotationDegrees: item.rotation ?? 0,
                  })) },
                });
                answer = { message: 'The boundary conditions have been created', id, success: true };
                break;
              }
              case 'add_linear_load': {
                if (!Array.isArray(data)) throw new Error('add_linear_load data must be an array');
                this.model.executeCommand({
                  commandId: id ? `${id}:add_linear_load` : crypto.randomUUID(), type: 'CreateOrUpdateLoads', schemaVersion: '1.0',
                  modelRevision: this.model.structuralDocument.revision, source: 'mcp',
                  payload: { loads: (data as LoadDto[]).map(item => ({
                    id: item.id, name: item.name, type: item.type, targetIds: item.targets,
                    value: [item.value.x, item.value.y, item.value.z], magnitude: item.magnitude,
                  })) },
                });
                answer = { message: 'The linear loads have been created', id, success: true };
                break;
              }
              case 'analysis_progress': {
                this.model.console.create({
                  id: `${Date.now()}${Math.random()}`,
                  message: String(data ?? ''),
                  timestamp: new Date(),
                  type: 'INFO',
                });
                break;
              }
              default:
                console.log('Unknown message type:', message);
            }

            if (answer !== undefined) this.send(answer);
          } catch (error) {
            console.error('Error handling WebSocket message:', error, event.data);
            let requestId: string | undefined;
            try {
              requestId = (JSON.parse(event.data) as WebSocketPayload).id;
            } catch {
              // A malformed frame has no request ID to correlate.
            }
            if (requestId) {
              this.send({
                id: requestId,
                message: error instanceof Error ? error.message : String(error),
                success: false,
              });
            }
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
        this.ws.onclose = () => this.handleReconnect();
      } catch (error) {
        reject(error);
      }
    });
  }

  send(message: string | object): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
      return true;
    }
    console.warn('WebSocket is not connected');
    return false;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getConnectionState(): number {
    return this.ws ? this.ws.readyState : WebSocket.CLOSED;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => {
      this.connect().catch((error) => console.error('Reconnection failed:', error));
    }, this.reconnectInterval);
  }
}
