/**
 * Network types and interfaces for Glyft multiplayer.
 *
 * Glyft is transport-agnostic. Implement NetworkAdapter for your backend.
 */

/**
 * Game events sent between client and server.
 */
export type GameEvent =
  | { type: 'join'; playerId: string; spawn: { x: number; y: number } }
  | { type: 'leave'; playerId: string }
  | { type: 'move'; id: string; x: number; y: number; vx: number; vy: number }
  | { type: 'collision'; pattern: string; a: string; b: string }
  | { type: 'damage'; target: string; amount: number; hp: number }
  | { type: 'destroy'; id: string; animation?: string }
  | { type: 'spawn'; entityType: string; id: string; x: number; y: number }
  | { type: 'collect'; player: string; stat: string; amount: number }
  | { type: 'custom'; name: string; data: unknown };

/**
 * Network adapter interface.
 *
 * Implement this for your transport layer (WebSocket, socket.io, WebRTC, etc.)
 *
 * @example
 * ```typescript
 * class MyAdapter implements NetworkAdapter {
 *   async connect() { ... }
 *   send(event) { ... }
 *   onReceive(callback) { ... }
 *   disconnect() { ... }
 * }
 * ```
 */
export interface NetworkAdapter {
  /** Send a game event to the server */
  send(event: GameEvent): void;

  /** Register callback for incoming events */
  onReceive(callback: (event: GameEvent) => void): void;

  /** Connect to the server */
  connect(options?: unknown): Promise<void>;

  /** Disconnect from the server */
  disconnect(): void;

  /** Whether currently connected */
  readonly connected: boolean;

  /** Local player ID (set after auth) */
  readonly playerId: string;
}

/**
 * Network configuration for GlyftConfig.
 */
export interface NetworkConfig {
  /** Your NetworkAdapter implementation */
  adapter: NetworkAdapter;

  /** Network mode */
  mode: 'local' | 'client' | 'server' | 'host';

  /** State that server controls (client won't modify locally) */
  authoritative?: ('position' | 'hp' | 'damage' | 'destroy')[];

  /** Effects handled locally regardless of mode */
  local?: ('sounds' | 'flash' | 'particles')[];

  /** Enable client-side prediction for smooth movement */
  prediction?: boolean;

  /** What to predict locally */
  predict?: ('position' | 'velocity')[];

  /** What to wait for server confirmation */
  wait?: ('damage' | 'destroy' | 'collect')[];
}

/**
 * Built-in adapters (import separately)
 *
 * @example
 * ```typescript
 * import { WyrtAdapter } from 'glyft/adapters/wyrt';
 * import { WebSocketAdapter } from 'glyft/adapters/websocket';
 * ```
 */
