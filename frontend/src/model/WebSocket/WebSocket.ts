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
                for (const item of data as NodeMutation[]) {
                  const node = new Node(jsonToThree(item.x, item.y, item.z), item.name, item.id);
                  node.model = this.model;
                  node.create();
                  this.model.nodes.push(node);
                }
                answer = { message: 'The nodes have been created', id, success: true };
                break;
              }
              case 'add_members': {
                if (!Array.isArray(data)) throw new Error('add_members data must be an array');
                for (const item of data as MemberMutation[]) {
                  const nodei = this.model.nodes.find((node) => node.id === item.nodei);
                  const nodej = this.model.nodes.find((node) => node.id === item.nodej);
                  const section = this.model.sections.find((value) => value.id === item.section);
                  if (!nodei || !nodej || !section) {
                    throw new Error(`Member ${item.id} references a missing node or section`);
                  }
                  const member = new ElasticBeamColumn(
                    this.model,
                    item.label ?? `Member ${item.id}`,
                    [nodei, nodej],
                    section,
                    item.id,
                  );
                  member.gamma = item.gamma ?? 0;
                  member.release = item.release ?? '';
                  if (item.vecxz) member.vecxz = jsonToThree(...item.vecxz);
                  member.create();
                  this.model.members.push(member);
                }
                answer = { message: 'The members have been created', id, success: true };
                break;
              }
              case 'add_bc': {
                if (!Array.isArray(data)) throw new Error('add_bc data must be an array');
                for (const item of data as BoundaryConditionDto[]) {
                  new BoundaryCondition(this.model, item).createOrUpdate();
                }
                answer = { message: 'The boundary conditions have been created', id, success: true };
                break;
              }
              case 'add_linear_load': {
                if (!Array.isArray(data)) throw new Error('add_linear_load data must be an array');
                for (const item of data as LoadDto[]) {
                  new Load(this.model, {
                    ...item,
                    value: jsonToThree(item.value.x, item.value.y, item.value.z),
                  }).createOrUpdate();
                }
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
