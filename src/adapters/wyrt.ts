/**
 * Wyrt Network Adapter for Glyft
 *
 * Connects Glyft games to Wyrt multiplayer servers.
 * @see https://wyrt.dev
 */

import type { NetworkAdapter, GameEvent } from '../network';

export interface WyrtAdapterOptions {
  /** WebSocket URL (e.g., 'wss://server.wyrt.dev') */
  url: string;

  /** Game module ID registered in Wyrt (e.g., 'my_game') */
  gameId: string;

  /** JWT token for authentication */
  token?: string;

  /** Auto-reconnect on disconnect */
  reconnect?: boolean;

  /** Reconnect delay in ms */
  reconnectDelay?: number;
}

/** Wyrt message types */
enum MessageType {
  System = 0,
  Error = 1,
  Chat = 2,
}

/** Wyrt wrapped message format */
interface WyrtMessage {
  type: MessageType | string;
  msg?: string;
  time?: number;
  [key: string]: unknown;
}

/**
 * Glyft adapter for Wyrt multiplayer servers.
 *
 * @example
 * ```typescript
 * import { WyrtAdapter } from 'glyft/adapters/wyrt';
 *
 * const game = new Glyft(canvas, {
 *   ...config,
 *   network: {
 *     adapter: new WyrtAdapter({
 *       url: 'wss://server.wyrt.dev',
 *       gameId: 'my_game',
 *       token: authToken,
 *     }),
 *     mode: 'client',
 *   },
 * });
 * ```
 */
export class WyrtAdapter implements NetworkAdapter {
  private socket: WebSocket | null = null;
  private options: Required<WyrtAdapterOptions>;
  private receiveCallback: ((event: GameEvent) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  public connected = false;
  public playerId = '';

  constructor(options: WyrtAdapterOptions) {
    this.options = {
      reconnect: true,
      reconnectDelay: 3000,
      token: '',
      ...options,
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.options.url);

      this.socket.onopen = () => {
        this.connected = true;

        // Authenticate if token provided
        if (this.options.token) {
          this.sendRaw({
            type: 'auth',
            token: this.options.token,
            gameId: this.options.gameId,
          });
        }

        resolve();
      };

      this.socket.onclose = () => {
        this.connected = false;
        this.handleDisconnect();
      };

      this.socket.onerror = () => {
        reject(new Error('WebSocket connection failed'));
      };

      this.socket.onmessage = (e) => {
        this.handleMessage(e.data);
      };
    });
  }

  disconnect(): void {
    this.options.reconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }

  send(event: GameEvent): void {
    this.sendRaw({
      ...event,
      gameId: this.options.gameId,
    });
  }

  onReceive(callback: (event: GameEvent) => void): void {
    this.receiveCallback = callback;
  }

  // --- Private ---

  private sendRaw(data: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  private handleMessage(raw: string): void {
    try {
      const msg: WyrtMessage = JSON.parse(raw);

      // Handle Wyrt wrapped messages (type is number)
      if (typeof msg.type === 'number') {
        switch (msg.type) {
          case MessageType.System:
            // Unwrap nested JSON in msg field
            if (msg.msg) {
              const inner = JSON.parse(msg.msg);
              this.dispatchEvent(inner);
            }
            break;
          case MessageType.Error:
            console.error('[Wyrt]', msg.msg);
            break;
          case MessageType.Chat:
            this.dispatchEvent({ type: 'chat', message: msg.msg });
            break;
        }
        return;
      }

      // Handle direct game messages (type is string)
      this.dispatchEvent(msg);

    } catch (e) {
      console.error('[WyrtAdapter] Failed to parse message:', e);
    }
  }

  private dispatchEvent(msg: WyrtMessage): void {
    // Handle auth response
    if (msg.type === 'auth_success') {
      this.playerId = msg.playerId as string || '';
      this.receiveCallback?.({
        type: 'join',
        playerId: this.playerId,
        spawn: msg.spawn as { x: number; y: number } || { x: 0, y: 0 },
      });
      return;
    }

    // Map Wyrt message types to Glyft events
    const event = this.mapToGameEvent(msg);
    if (event) {
      this.receiveCallback?.(event);
    }
  }

  private mapToGameEvent(msg: WyrtMessage): GameEvent | null {
    switch (msg.type) {
      case 'playerMoved':
      case 'move':
        return {
          type: 'move',
          id: msg.playerId as string || msg.id as string,
          x: msg.x as number,
          y: msg.y as number,
          vx: msg.vx as number || 0,
          vy: msg.vy as number || 0,
        };

      case 'playerJoined':
        return {
          type: 'join',
          playerId: msg.playerId as string,
          spawn: { x: msg.x as number || 0, y: msg.y as number || 0 },
        };

      case 'playerLeft':
        return {
          type: 'leave',
          playerId: msg.playerId as string,
        };

      case 'damage':
      case 'playerDamaged':
        return {
          type: 'damage',
          target: msg.target as string || msg.playerId as string,
          amount: msg.amount as number || msg.damage as number,
          hp: msg.hp as number,
        };

      case 'destroy':
      case 'mobDied':
      case 'playerDied':
        return {
          type: 'destroy',
          id: msg.id as string || msg.playerId as string || msg.mobId as string,
          animation: msg.animation as string,
        };

      case 'spawn':
      case 'mobSpawn':
        return {
          type: 'spawn',
          entityType: msg.entityType as string || msg.mobType as string,
          id: msg.id as string || msg.mobId as string,
          x: msg.x as number,
          y: msg.y as number,
        };

      case 'collect':
      case 'itemPickup':
        return {
          type: 'collect',
          player: msg.playerId as string,
          stat: msg.stat as string || msg.item as string,
          amount: msg.amount as number || 1,
        };

      case 'collision':
        return {
          type: 'collision',
          pattern: msg.pattern as string,
          a: msg.a as string,
          b: msg.b as string,
        };

      case 'room':
      case 'sync':
        // Full state sync - emit as custom for game to handle
        return {
          type: 'custom',
          name: 'sync',
          data: msg,
        };

      default:
        // Pass through as custom event
        return {
          type: 'custom',
          name: String(msg.type),
          data: msg,
        };
    }
  }

  private handleDisconnect(): void {
    if (this.options.reconnect) {
      console.log('[WyrtAdapter] Reconnecting in', this.options.reconnectDelay, 'ms');
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch(console.error);
      }, this.options.reconnectDelay);
    }
  }
}
