/**
 * Room System Addon
 *
 * Manages rooms with spawn definitions, exits, and build callbacks.
 * Handles room transitions, sprite cleanup, and exit detection.
 *
 * @example
 * ```typescript
 * import { rooms } from 'glyft/addons/rooms';
 *
 * game.use(rooms({
 *   atlas,
 *   startRoom: 'village',
 *   rooms: {
 *     village: {
 *       width: 24, height: 18,
 *       music: 'peaceful',
 *       spawn: [12, 9],
 *       build: (map, game) => { map.fill(0, 0, 24, 18, 1); },
 *       spawns: [
 *         { type: 'npc', x: 5, y: 5, tags: ['npc'], configure: (s) => { s.label = 'Elder'; } },
 *       ],
 *       exits: [{ x: 23, y: 9, to: 'forest', spawnX: 1, spawnY: 9 }],
 *     },
 *   },
 * }));
 *
 * const roomSys = game.addon<RoomAddon>('rooms')!;
 * roomSys.setPlayer(player);
 * ```
 *
 * @packageDocumentation
 */

import type { GlyftAddon } from '../addon';
import type { Glyft, Sprite, Atlas, TileMap } from '../types';
import type { ProjectileAddon } from './projectiles';
import type { AIAddon } from './ai';
import type { DeathAddon } from './death';
import type { DialogueAddon } from './dialogue';

/** Spawn definition for a room */
export interface SpawnDef {
  /** Sprite type name from atlas */
  type: string;
  /** Tile X position */
  x: number;
  /** Tile Y position */
  y: number;
  /** Extra tags to apply */
  tags?: string[];
  /** AI behavior name (from AI addon) */
  ai?: string;
  /** Dialogue ID (from dialogue addon) */
  dialogue?: string;
  /** Custom configuration callback */
  configure?: (sprite: Sprite) => void;
}

/** Exit definition connecting rooms */
export interface ExitDef {
  /** Exit tile X */
  x: number;
  /** Exit tile Y */
  y: number;
  /** Target room ID */
  to: string;
  /** Spawn tile X in target room */
  spawnX: number;
  /** Spawn tile Y in target room */
  spawnY: number;
  /** Detection radius in tiles (default: 2) */
  radius?: number;
}

/** Room definition */
export interface RoomDef {
  /** Display name */
  name?: string;
  /** Map width in tiles */
  width: number;
  /** Map height in tiles */
  height: number;
  /** Music track key from config.music */
  music?: string;
  /** Default player spawn position [tileX, tileY] */
  spawn?: [number, number];
  /** Terrain generation callback — called after map creation */
  build?: (map: TileMap, game: Glyft) => void;
  /** Sprites to create in this room */
  spawns?: SpawnDef[];
  /** Room exits */
  exits?: ExitDef[];
  /** Called after room is fully loaded */
  onEnter?: () => void;
  /** Called before room is unloaded */
  onExit?: () => void;
}

/** Room addon configuration */
export interface RoomConfig {
  /** Atlas to use for creating sprites and maps */
  atlas: Atlas;
  /** Starting room ID */
  startRoom: string;
  /** Room definitions */
  rooms: Record<string, RoomDef>;
  /** Exit cooldown in seconds (default: 0.5) */
  exitCooldown?: number;
}

/** Room addon public API */
export interface RoomAddon extends GlyftAddon {
  /** Load a room by ID */
  load(roomId: string, spawnX?: number, spawnY?: number): void;
  /** Current room ID */
  readonly currentRoom: string | null;
  /** Current room definition */
  readonly currentDef: RoomDef | null;
  /** Sprites created in the current room */
  readonly roomSprites: Sprite[];
  /** Set the player sprite (needed for exit detection and camera) */
  setPlayer(player: Sprite): void;
  /** Current tilemap */
  readonly map: TileMap | null;
}

/**
 * Create the rooms addon.
 */
export function rooms(config: RoomConfig): RoomAddon {
  let game: Glyft;
  let currentRoom: string | null = null;
  let currentDef: RoomDef | null = null;
  let currentMap: TileMap | null = null;
  let playerSprite: Sprite | null = null;
  const roomSprites: Sprite[] = [];
  let exitCooldown = 0;
  const exitCooldownDuration = config.exitCooldown ?? 0.5;

  function _load(roomId: string, spawnX?: number, spawnY?: number) {
    const def = config.rooms[roomId];
    if (!def) {
      console.warn(`[Glyft:rooms] Unknown room '${roomId}'`);
      return;
    }

    // Call onExit for current room
    if (currentDef?.onExit) {
      currentDef.onExit();
    }

    // Destroy room-owned sprites
    for (const sprite of roomSprites) {
      if (sprite.exists) sprite.destroy();
    }
    roomSprites.length = 0;

    // Clear projectiles if addon is registered
    const projAddon = game.addon<ProjectileAddon>('projectiles');
    if (projAddon) projAddon.clear();

    // Destroy old map
    if (currentMap) {
      currentMap.destroy();
      currentMap = null;
    }

    // Update state
    currentRoom = roomId;
    currentDef = def;

    // Create new map
    const tileSize = game.config.settings.tileSize;
    currentMap = game.createMap(config.atlas, def.width, def.height);

    // Build terrain
    if (def.build) {
      def.build(currentMap, game);
    }

    // Spawn entities
    const aiAddon = game.addon<AIAddon>('ai');
    const deathAddon = game.addon<DeathAddon>('death');
    const dialogueAddon = game.addon<DialogueAddon>('dialogue');

    if (def.spawns) {
      for (const spawnDef of def.spawns) {
        const sprite = game.createSprite(config.atlas, spawnDef.type);
        sprite.x = spawnDef.x * tileSize;
        sprite.y = spawnDef.y * tileSize;

        if (spawnDef.tags) {
          sprite.tags = [...sprite.tags, ...spawnDef.tags];
        }

        // Apply AI behavior
        if (spawnDef.ai && aiAddon) {
          aiAddon.assign(sprite, spawnDef.ai);
        }

        // Assign dialogue
        if (spawnDef.dialogue && dialogueAddon) {
          dialogueAddon.assign(sprite, spawnDef.dialogue);
        }

        // Auto-track enemies for death addon
        if (deathAddon && sprite.tags.includes('enemy')) {
          const isBoss = sprite.tags.includes('boss');
          deathAddon.track(sprite, isBoss ? 'boss' : 'enemy');
        }

        // Custom configuration
        if (spawnDef.configure) {
          spawnDef.configure(sprite);
        }

        // Track maxHp for HP bar rendering
        if (sprite.hp !== undefined) {
          sprite.data.maxHp = sprite.hp;
        }

        roomSprites.push(sprite);
      }
    }

    // Position player
    if (playerSprite) {
      const sx = spawnX ?? def.spawn?.[0] ?? Math.floor(def.width / 2);
      const sy = spawnY ?? def.spawn?.[1] ?? Math.floor(def.height / 2);
      playerSprite.x = sx * tileSize;
      playerSprite.y = sy * tileSize;

      // Setup camera
      game.camera.follow(playerSprite, { smoothing: 0.1 });
      if (currentMap) {
        game.camera.setBounds(0, 0, currentMap.widthPx, currentMap.heightPx);
      }
    }

    // Change music
    if (def.music) {
      game.music.play(def.music, { fade: 1 });
    }

    // Set exit cooldown
    exitCooldown = exitCooldownDuration;

    // Call onEnter
    if (def.onEnter) {
      def.onEnter();
    }
  }

  return {
    name: 'rooms',

    init(g: Glyft) {
      game = g;
    },

    postPhysics(dt: number) {
      // Exit checking
      if (!playerSprite || !currentDef?.exits) return;

      if (exitCooldown > 0) {
        exitCooldown -= dt;
        return;
      }

      const tileSize = game.config.settings.tileSize;
      const playerTileX = Math.floor(playerSprite.x / tileSize);
      const playerTileY = Math.floor(playerSprite.y / tileSize);

      for (const exit of currentDef.exits) {
        const radius = exit.radius ?? 2;
        if (Math.abs(playerTileX - exit.x) < radius && Math.abs(playerTileY - exit.y) < radius) {
          _load(exit.to, exit.spawnX, exit.spawnY);
          return;
        }
      }
    },

    load(roomId: string, spawnX?: number, spawnY?: number) {
      _load(roomId, spawnX, spawnY);
    },

    get currentRoom() {
      return currentRoom;
    },

    get currentDef() {
      return currentDef;
    },

    get roomSprites() {
      return roomSprites.filter(s => s.exists);
    },

    setPlayer(player: Sprite) {
      playerSprite = player;

      // If a start room is configured and no room is loaded yet, load it
      if (!currentRoom && config.startRoom) {
        _load(config.startRoom);
      }
    },

    get map() {
      return currentMap;
    },

    destroy() {
      for (const sprite of roomSprites) {
        if (sprite.exists) sprite.destroy();
      }
      roomSprites.length = 0;
      if (currentMap) {
        currentMap.destroy();
        currentMap = null;
      }
      currentRoom = null;
      currentDef = null;
      playerSprite = null;
    },
  };
}
