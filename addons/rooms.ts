/**
 * Room System Addon
 *
 * Manages rooms with spawn definitions, exits, and build callbacks.
 * Handles room transitions, sprite cleanup, and exit detection.
 *
 * ## Connections (Recommended)
 *
 * Use `connections` to define bidirectional room links. This automatically
 * creates exits in both directions and calculates spawn positions.
 *
 * @example
 * ```typescript
 * game.use(rooms({
 *   atlas,
 *   startRoom: 'village',
 *   rooms: {
 *     village: { width: 24, height: 18, spawn: [12, 9], build: buildVillage },
 *     forest:  { width: 32, height: 24, build: buildForest },
 *     dungeon: { width: 20, height: 16, build: buildDungeon },
 *   },
 *   connections: [
 *     { rooms: ['village', 'forest'], exits: [[23, 9], [0, 9]] },
 *     { rooms: ['forest', 'dungeon'], exits: [[31, 12], [0, 6]] },
 *   ],
 * }));
 * ```
 *
 * ## Manual Exits (Legacy)
 *
 * You can still define exits manually on each room, but you must remember
 * to create exits in both directions. The addon warns about one-way exits.
 *
 * @packageDocumentation
 */

import type { GlyftAddon, Glyft, Sprite, Atlas, TileMap } from '../src/types';
import type { ProjectileAddon } from './projectiles';
import type { AIAddon } from './ai';
import type { DeathAddon } from './death';
import type { DialogueAddon } from './dialogue';
import type { HudAddon } from './hud';

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
  /** Room exits (prefer using connections instead for bidirectional exits) */
  exits?: ExitDef[];
  /** Tile index to use for walls (used by edge system). Default: 6 */
  wallTile?: number;
  /** Called after room is fully loaded */
  onEnter?: () => void;
  /** Called before room is unloaded */
  onExit?: () => void;
}

/**
 * Connection definition — bidirectional link between two rooms.
 * Automatically creates exits in both directions.
 *
 * @example
 * ```typescript
 * connections: [
 *   { rooms: ['village', 'forest'], exits: [[23, 9], [0, 9]] },
 *   { rooms: ['forest', 'dungeon'], exits: [[31, 12], [0, 6]] },
 * ]
 * ```
 */
export interface ConnectionDef {
  /** The two rooms being connected: [roomA, roomB] */
  rooms: [string, string];
  /** Exit tile positions: [[roomA exit x, y], [roomB exit x, y]] */
  exits: [[number, number], [number, number]];
}

/** Edge direction */
export type Edge = 'north' | 'south' | 'east' | 'west';

/**
 * Edge connection definition — connects entire edges of two rooms.
 * Walking off one edge spawns you on the opposite edge of the connected room.
 *
 * @example
 * ```typescript
 * edges: [
 *   { rooms: ['village', 'forest'], edges: ['east', 'west'] },
 *   { rooms: ['clearing', 'edge'], edges: ['north', 'south'] },
 * ]
 * ```
 */
export interface EdgeConnectionDef {
  /** The two rooms being connected: [roomA, roomB] */
  rooms: [string, string];
  /** Which edge of each room connects: [roomA edge, roomB edge] */
  edges: [Edge, Edge];
}

/** Room addon configuration */
export interface RoomConfig {
  /** Atlas to use for creating sprites and maps */
  atlas: Atlas;
  /** Starting room ID */
  startRoom: string;
  /** Room definitions */
  rooms: Record<string, RoomDef>;
  /**
   * Bidirectional room connections using specific tile positions.
   * Each connection automatically creates exits in both rooms.
   */
  connections?: ConnectionDef[];
  /**
   * Edge-based room connections. Walking off one edge spawns you on the
   * opposite edge of the connected room. Simpler than tile-based connections.
   *
   * When using edges, the addon automatically:
   * - Adds walls to all room edges
   * - Creates doorway openings where connections exist
   * - Handles collision for walls and doorways
   *
   * @example
   * ```typescript
   * edges: [
   *   { rooms: ['village', 'forest'], edges: ['east', 'west'] },
   * ]
   * ```
   */
  edges?: EdgeConnectionDef[];
  /** Doorway width in tiles (default: 4) */
  doorwaySize?: number;
  /** Default wall tile index when using edges (default: 6). Can be overridden per-room. */
  defaultWallTile?: number;
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

  // Calculate spawn position 1 tile inward from exit
  function calculateSpawn(exitX: number, exitY: number, width: number, height: number): [number, number] {
    let spawnX = exitX;
    let spawnY = exitY;

    // West edge → spawn 1 tile right
    if (exitX <= 1) spawnX = exitX + 1;
    // East edge → spawn 1 tile left
    else if (exitX >= width - 2) spawnX = exitX - 1;

    // North edge → spawn 1 tile down
    if (exitY <= 1) spawnY = exitY + 1;
    // South edge → spawn 1 tile up
    else if (exitY >= height - 2) spawnY = exitY - 1;

    return [spawnX, spawnY];
  }

  // Process connections into bidirectional exits
  function processConnections() {
    if (!config.connections) return;

    for (const conn of config.connections) {
      const [roomA, roomB] = conn.rooms;
      const [[exitAx, exitAy], [exitBx, exitBy]] = conn.exits;

      const defA = config.rooms[roomA];
      const defB = config.rooms[roomB];

      if (!defA) {
        console.warn(`[Glyft:rooms] Connection references unknown room '${roomA}'`);
        continue;
      }
      if (!defB) {
        console.warn(`[Glyft:rooms] Connection references unknown room '${roomB}'`);
        continue;
      }

      // Calculate spawn positions (1 tile inward from exit in target room)
      const [spawnAx, spawnAy] = calculateSpawn(exitAx, exitAy, defA.width, defA.height);
      const [spawnBx, spawnBy] = calculateSpawn(exitBx, exitBy, defB.width, defB.height);

      // Add exit A → B (exit in A, spawn in B)
      defA.exits = defA.exits || [];
      defA.exits.push({ x: exitAx, y: exitAy, to: roomB, spawnX: spawnBx, spawnY: spawnBy });

      // Add exit B → A (exit in B, spawn in A)
      defB.exits = defB.exits || [];
      defB.exits.push({ x: exitBx, y: exitBy, to: roomA, spawnX: spawnAx, spawnY: spawnAy });
    }
  }

  // Validate that all exits have return paths (warn about one-way exits)
  function validateExits() {
    for (const [roomId, def] of Object.entries(config.rooms)) {
      if (!def.exits) continue;

      for (const exit of def.exits) {
        const targetDef = config.rooms[exit.to];
        if (!targetDef) {
          console.warn(`[Glyft:rooms] Exit in '${roomId}' points to unknown room '${exit.to}'`);
          continue;
        }

        // Check if target room has an exit back
        const hasReturn = targetDef.exits?.some(e => e.to === roomId);
        if (!hasReturn) {
          console.warn(
            `[Glyft:rooms] One-way exit detected: '${roomId}' → '${exit.to}' ` +
            `(no return exit). Consider using 'connections' for bidirectional exits.`
          );
        }
      }
    }
  }

  // Store edge connections for runtime detection
  interface EdgeLink {
    edge: Edge;
    toRoom: string;
    toEdge: Edge;
  }
  const edgeLinks: Record<string, EdgeLink[]> = {};

  // Process edge connections
  function processEdges() {
    if (!config.edges) return;

    for (const conn of config.edges) {
      const [roomA, roomB] = conn.rooms;
      const [edgeA, edgeB] = conn.edges;

      const defA = config.rooms[roomA];
      const defB = config.rooms[roomB];

      if (!defA) {
        console.warn(`[Glyft:rooms] Edge connection references unknown room '${roomA}'`);
        continue;
      }
      if (!defB) {
        console.warn(`[Glyft:rooms] Edge connection references unknown room '${roomB}'`);
        continue;
      }

      // Store edge links for both rooms
      edgeLinks[roomA] = edgeLinks[roomA] || [];
      edgeLinks[roomA].push({ edge: edgeA, toRoom: roomB, toEdge: edgeB });

      edgeLinks[roomB] = edgeLinks[roomB] || [];
      edgeLinks[roomB].push({ edge: edgeB, toRoom: roomA, toEdge: edgeA });
    }
  }

  // Calculate spawn position when entering from an edge (always center of edge)
  function getSpawnFromEdge(
    toEdge: Edge,
    toWidth: number,
    toHeight: number
  ): [number, number] {
    const spawnOffset = 2; // Spawn 2 tiles inward from edge

    switch (toEdge) {
      case 'north':
        return [Math.floor(toWidth / 2), spawnOffset];
      case 'south':
        return [Math.floor(toWidth / 2), toHeight - 1 - spawnOffset];
      case 'west':
        return [spawnOffset, Math.floor(toHeight / 2)];
      case 'east':
        return [toWidth - 1 - spawnOffset, Math.floor(toHeight / 2)];
    }
  }

  // Check if player has crossed outside the room boundary
  function checkEdgeCrossing(
    playerTileX: number,
    playerTileY: number,
    width: number,
    height: number
  ): { edge: Edge; relativePos: number } | null {
    if (playerTileX < 0) return { edge: 'west', relativePos: Math.max(0, Math.min(1, playerTileY / height)) };
    if (playerTileX >= width) return { edge: 'east', relativePos: Math.max(0, Math.min(1, playerTileY / height)) };
    if (playerTileY < 0) return { edge: 'north', relativePos: Math.max(0, Math.min(1, playerTileX / width)) };
    if (playerTileY >= height) return { edge: 'south', relativePos: Math.max(0, Math.min(1, playerTileX / width)) };
    return null;
  }

  // Process connections immediately (before init, so rooms are ready)
  processConnections();
  processEdges();

  const doorwaySize = config.doorwaySize ?? 4;
  const defaultWallTile = config.defaultWallTile ?? 6;

  // Build walls and doorways for a room based on edge connections
  function buildEdgeWalls(roomId: string, map: TileMap) {
    const def = config.rooms[roomId];
    if (!def) return;

    const w = def.width;
    const h = def.height;
    const wallTile = def.wallTile ?? defaultWallTile;
    const roomEdges = edgeLinks[roomId] || [];

    // Check which edges have connections
    const hasNorth = roomEdges.some(l => l.edge === 'north');
    const hasSouth = roomEdges.some(l => l.edge === 'south');
    const hasWest = roomEdges.some(l => l.edge === 'west');
    const hasEast = roomEdges.some(l => l.edge === 'east');

    // North wall
    const northDoorStart = Math.floor(w / 2) - Math.floor(doorwaySize / 2);
    for (let x = 0; x < w; x++) {
      const inDoorway = hasNorth && x >= northDoorStart && x < northDoorStart + doorwaySize;
      if (!inDoorway) {
        map.set(x, 0, wallTile);
        map.setCollision(x, 0, true);
      }
    }

    // South wall
    const southDoorStart = Math.floor(w / 2) - Math.floor(doorwaySize / 2);
    for (let x = 0; x < w; x++) {
      const inDoorway = hasSouth && x >= southDoorStart && x < southDoorStart + doorwaySize;
      if (!inDoorway) {
        map.set(x, h - 1, wallTile);
        map.setCollision(x, h - 1, true);
      }
    }

    // West wall
    const westDoorStart = Math.floor(h / 2) - Math.floor(doorwaySize / 2);
    for (let y = 0; y < h; y++) {
      const inDoorway = hasWest && y >= westDoorStart && y < westDoorStart + doorwaySize;
      if (!inDoorway) {
        map.set(0, y, wallTile);
        map.setCollision(0, y, true);
      }
    }

    // East wall
    const eastDoorStart = Math.floor(h / 2) - Math.floor(doorwaySize / 2);
    for (let y = 0; y < h; y++) {
      const inDoorway = hasEast && y >= eastDoorStart && y < eastDoorStart + doorwaySize;
      if (!inDoorway) {
        map.set(w - 1, y, wallTile);
        map.setCollision(w - 1, y, true);
      }
    }
  }

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

    // Auto-generate walls and doorways if using edge connections
    if (config.edges && config.edges.length > 0) {
      buildEdgeWalls(roomId, currentMap);
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

    // Announce room name via HUD
    const hudAddon = game.addon<HudAddon>('hud');
    if (hudAddon) {
      hudAddon.announce(def.name ?? roomId);
    }
  }

  return {
    name: 'rooms',

    init(g: Glyft) {
      game = g;
      validateExits();
    },

    postPhysics(dt: number) {
      // Exit checking
      if (!playerSprite || !currentRoom || !currentDef) return;

      if (exitCooldown > 0) {
        exitCooldown -= dt;
        return;
      }

      const tileSize = game.config.settings.tileSize;
      const playerTileX = Math.floor(playerSprite.x / tileSize);
      const playerTileY = Math.floor(playerSprite.y / tileSize);

      // Check edge-based exits first
      const roomEdges = edgeLinks[currentRoom];
      if (roomEdges) {
        const crossing = checkEdgeCrossing(
          playerTileX,
          playerTileY,
          currentDef.width,
          currentDef.height
        );

        if (crossing) {
          const link = roomEdges.find(l => l.edge === crossing.edge);
          if (link) {
            const targetDef = config.rooms[link.toRoom];
            if (targetDef) {
              const [spawnX, spawnY] = getSpawnFromEdge(
                link.toEdge,
                targetDef.width,
                targetDef.height
              );
              _load(link.toRoom, spawnX, spawnY);
              return;
            }
          }
        }
      }

      // Check tile-based exits
      if (currentDef.exits) {
        for (const exit of currentDef.exits) {
          const radius = exit.radius ?? 2;
          if (Math.abs(playerTileX - exit.x) < radius && Math.abs(playerTileY - exit.y) < radius) {
            _load(exit.to, exit.spawnX, exit.spawnY);
            return;
          }
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
