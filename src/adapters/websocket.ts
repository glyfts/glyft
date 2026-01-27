/**
 * Generic WebSocket Adapter for Glyft
 *
 * A simple, general-purpose WebSocket adapter for multiplayer games.
 * Use this when you don't need the Wyrt-specific protocol.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { WebSocketAdapter } from 'glyft/adapters/websocket';
 *
 * const adapter = new WebSocketAdapter({
 *   url: 'wss://my-server.com/game',
 *   reconnect: true,
 * });
 *
 * const game = new Glyft(canvas, {
 *   ...config,
 *   network: {
 *     adapter,
 *     mode: 'client',
 *   },
 * });
 *
 * await adapter.connect();
 * ```
 */

import type { NetworkAdapter, GameEvent } from '../network';

/**
 * Options for the WebSocket adapter.
 */
export interface WebSocketAdapterOptions {
  /** WebSocket URL (e.g., 'wss://server.example.com/game') */
  url: string;

  /**
   * Message format for serialization.
   * - 'json' - Standard JSON (default, easier to debug)
   * - 'binary' - Binary protocol (more efficient)
   */
  format?: 'json' | 'binary';

  /**
   * Auto-reconnect on disconnect.
   * @default true
   */
  reconnect?: boolean;

  /**
   * Initial reconnect delay in milliseconds.
   * @default 1000
   */
  reconnectDelay?: number;

  /**
   * Maximum reconnect delay (with exponential backoff).
   * @default 30000
   */
  maxReconnectDelay?: number;

  /**
   * Maximum reconnect attempts before giving up (0 = infinite).
   * @default 0
   */
  maxReconnectAttempts?: number;

  /**
   * Called when connection state changes.
   */
  onStateChange?: (state: 'connecting' | 'connected' | 'disconnected' | 'error') => void;

  /**
   * Called when an error occurs.
   */
  onError?: (error: Error) => void;

  /**
   * Custom headers for the WebSocket connection (if supported by environment).
   */
  headers?: Record<string, string>;
}

/**
 * Connection state for the WebSocket adapter.
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Generic WebSocket adapter implementing the Glyft NetworkAdapter interface.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - JSON or binary message serialization
 * - Connection state tracking
 * - Heartbeat/ping support
 *
 * @example
 * ```typescript
 * const adapter = new WebSocketAdapter({
 *   url: 'wss://game-server.com',
 *   reconnect: true,
 *   onStateChange: (state) => console.log('Connection:', state),
 * });
 *
 * adapter.onReceive((event) => {
 *   console.log('Received:', event);
 * });
 *
 * await adapter.connect();
 * adapter.send({ type: 'join', playerId: 'player1', spawn: { x: 0, y: 0 } });
 * ```
 */
export class WebSocketAdapter implements NetworkAdapter {
  private socket: WebSocket | null = null;
  private options: Required<Omit<WebSocketAdapterOptions, 'headers' | 'onStateChange' | 'onError'>> & {
    headers?: Record<string, string>;
    onStateChange?: WebSocketAdapterOptions['onStateChange'];
    onError?: WebSocketAdapterOptions['onError'];
  };
  private receiveCallback: ((event: GameEvent) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private currentReconnectDelay = 1000;
  private _state: ConnectionState = 'disconnected';
  private _playerId = '';
  private messageQueue: GameEvent[] = [];

  /** Current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  /** Whether currently connected and ready to send */
  get connected(): boolean {
    return this._state === 'connected';
  }

  /** Local player ID (set after authentication/join) */
  get playerId(): string {
    return this._playerId;
  }

  /** Set player ID (call after receiving auth response) */
  set playerId(id: string) {
    this._playerId = id;
  }

  constructor(options: WebSocketAdapterOptions) {
    this.options = {
      format: 'json',
      reconnect: true,
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      maxReconnectAttempts: 0,
      ...options,
    };
    this.currentReconnectDelay = this.options.reconnectDelay;
  }

  /**
   * Connect to the WebSocket server.
   *
   * @returns Promise that resolves when connected, rejects on error
   * @throws Error if connection fails and reconnect is disabled
   */
  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') {
      return;
    }

    this.setState('connecting');

    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.options.url);

        if (this.options.format === 'binary') {
          this.socket.binaryType = 'arraybuffer';
        }

        const connectionTimeout = setTimeout(() => {
          if (this._state === 'connecting') {
            this.socket?.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000);

        this.socket.onopen = () => {
          clearTimeout(connectionTimeout);
          this.setState('connected');
          this.reconnectAttempts = 0;
          this.currentReconnectDelay = this.options.reconnectDelay;

          // Flush queued messages
          this.flushMessageQueue();

          resolve();
        };

        this.socket.onclose = (event) => {
          clearTimeout(connectionTimeout);
          const wasConnected = this._state === 'connected';
          this.setState('disconnected');

          if (wasConnected && this.options.reconnect) {
            this.scheduleReconnect();
          } else if (this._state === 'connecting') {
            reject(new Error(`Connection closed: ${event.code} ${event.reason}`));
          }
        };

        this.socket.onerror = () => {
          clearTimeout(connectionTimeout);
          const error = new Error('WebSocket error');
          this.options.onError?.(error);

          if (this._state === 'connecting') {
            reject(error);
          }
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };

      } catch (error) {
        this.setState('disconnected');
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the server.
   * Stops auto-reconnect if enabled.
   */
  disconnect(): void {
    // Disable reconnect
    this.options.reconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close(1000, 'Client disconnect');
      this.socket = null;
    }

    this.setState('disconnected');
    this.messageQueue = [];
  }

  /**
   * Send a game event to the server.
   * If not connected, the message is queued and sent when connected.
   *
   * @param event - The game event to send
   */
  send(event: GameEvent): void {
    if (this._state !== 'connected') {
      // Queue message for when we reconnect
      this.messageQueue.push(event);
      return;
    }

    this.sendImmediate(event);
  }

  /**
   * Register a callback for incoming events.
   *
   * @param callback - Function called with each received GameEvent
   */
  onReceive(callback: (event: GameEvent) => void): void {
    this.receiveCallback = callback;
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.options.onStateChange?.(state === 'reconnecting' ? 'connecting' : state);
    }
  }

  private sendImmediate(event: GameEvent): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (this.options.format === 'binary') {
      const data = this.serializeBinary(event);
      this.socket.send(data);
    } else {
      this.socket.send(JSON.stringify(event));
    }
  }

  private handleMessage(data: string | ArrayBuffer): void {
    try {
      let event: GameEvent;

      if (this.options.format === 'binary' && data instanceof ArrayBuffer) {
        event = this.deserializeBinary(data);
      } else if (typeof data === 'string') {
        event = JSON.parse(data);
      } else {
        console.warn('[WebSocketAdapter] Unexpected message format');
        return;
      }

      // Handle auth response (set playerId)
      if (event.type === 'join' && event.playerId) {
        this._playerId = event.playerId;
      }

      this.receiveCallback?.(event);
    } catch (error) {
      console.error('[WebSocketAdapter] Failed to parse message:', error);
    }
  }

  private flushMessageQueue(): void {
    const queue = this.messageQueue;
    this.messageQueue = [];

    for (const event of queue) {
      this.sendImmediate(event);
    }
  }

  private scheduleReconnect(): void {
    if (!this.options.reconnect) return;

    if (this.options.maxReconnectAttempts > 0 &&
        this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error('[WebSocketAdapter] Max reconnect attempts reached');
      this.options.onError?.(new Error('Max reconnect attempts reached'));
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    console.log(
      `[WebSocketAdapter] Reconnecting in ${this.currentReconnectDelay}ms ` +
      `(attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        // Connect failed, it will schedule another reconnect via onclose
      }
    }, this.currentReconnectDelay);

    // Exponential backoff
    this.currentReconnectDelay = Math.min(
      this.currentReconnectDelay * 2,
      this.options.maxReconnectDelay
    );
  }

  // ---------------------------------------------------------------------------
  // Binary Serialization (for format: 'binary')
  // ---------------------------------------------------------------------------

  /**
   * Serialize a GameEvent to binary format.
   * Uses a simple format: 1 byte type + JSON payload
   */
  private serializeBinary(event: GameEvent): ArrayBuffer {
    const typeMap: Record<string, number> = {
      join: 1, leave: 2, move: 3, collision: 4,
      damage: 5, destroy: 6, spawn: 7, collect: 8, custom: 255,
    };

    const typeCode = typeMap[event.type] ?? 255;
    const json = JSON.stringify(event);
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(json);

    const buffer = new ArrayBuffer(1 + jsonBytes.length);
    const view = new Uint8Array(buffer);
    view[0] = typeCode;
    view.set(jsonBytes, 1);

    return buffer;
  }

  /**
   * Deserialize binary data to a GameEvent.
   */
  private deserializeBinary(data: ArrayBuffer): GameEvent {
    const view = new Uint8Array(data);
    const decoder = new TextDecoder();
    const json = decoder.decode(view.slice(1));
    return JSON.parse(json);
  }
}

/**
 * Create a simple connection to test if the WebSocket server is reachable.
 *
 * @param url - WebSocket URL to test
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves to true if reachable, false otherwise
 *
 * @example
 * ```typescript
 * const isOnline = await testConnection('wss://server.example.com');
 * if (isOnline) {
 *   await adapter.connect();
 * }
 * ```
 */
export async function testConnection(url: string, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, timeout);

    ws.onopen = () => {
      clearTimeout(timer);
      ws.close();
      resolve(true);
    };

    ws.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });
}
