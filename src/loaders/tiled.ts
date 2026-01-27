/**
 * Tiled JSON Map Loader
 *
 * Parses Tiled editor JSON format into Glyft tilemap data.
 * Supports multiple tilesets, collision layers, and object layers.
 *
 * @example
 * ```typescript
 * const mapData = await fetch('/maps/grassland.json').then(r => r.json());
 * const result = loadTiledMap(game, mapData, {
 *   tilesetAtlases: { 'terrain': terrainAtlas, 'props': propsAtlas },
 *   collisionLayerName: 'collision',
 * });
 * // result.maps - array of TileMap objects
 * // result.collisionMap - TileMap with collision data
 * // result.objects - parsed object layers
 * ```
 */

import type { Atlas, TileMap } from '../types';

// ---------------------------------------------------------------------------
// Tiled JSON Types (subset we care about)
// ---------------------------------------------------------------------------

/** Tiled JSON root */
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
  properties?: TiledProperty[];
}

/** Tiled layer (tile or object) */
export interface TiledLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup' | 'group';
  data?: number[];
  width?: number;
  height?: number;
  visible?: boolean;
  opacity?: number;
  properties?: TiledProperty[];
  objects?: TiledObject[];
  layers?: TiledLayer[];
}

/** Tiled tileset reference */
export interface TiledTileset {
  firstgid: number;
  name: string;
  tilewidth?: number;
  tileheight?: number;
  tilecount?: number;
  columns?: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  source?: string;
}

/** Tiled object */
export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProperty[];
  visible?: boolean;
}

/** Tiled custom property */
export interface TiledProperty {
  name: string;
  type: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// Loader Options & Result
// ---------------------------------------------------------------------------

/** Options for loading a Tiled map */
export interface TiledLoadOptions {
  /**
   * Map of tileset name → Glyft Atlas.
   * The tileset names must match the names in the Tiled JSON.
   */
  tilesetAtlases: Record<string, Atlas>;

  /**
   * Name of the layer to treat as collision data.
   * Tiles in this layer become solid collision flags.
   * @default 'collision'
   */
  collisionLayerName?: string;

  /**
   * If true, collision layer tiles are only used for collision data
   * and not rendered as a visible tilemap.
   * @default true
   */
  collisionLayerHidden?: boolean;
}

/** Result from loading a Tiled map */
export interface TiledLoadResult {
  /** Loaded tilemap layers (in order) */
  maps: TileMap[];

  /** Map width in tiles */
  width: number;

  /** Map height in tiles */
  height: number;

  /** Map width in pixels */
  widthPx: number;

  /** Map height in pixels */
  heightPx: number;

  /** Parsed object layers (NPCs, spawns, triggers, etc.) */
  objects: TiledObject[];

  /** Custom properties from the map */
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/** Interface for the Glyft engine methods we need */
interface GlyftMapCreator {
  createMap(atlas: Atlas, width: number, height: number, options?: { layer?: number }): TileMap;
  config: { settings: { tileSize: number } };
}

/**
 * Load a Tiled JSON map into Glyft tilemaps.
 *
 * @param game - Glyft engine instance (needs createMap)
 * @param data - Parsed Tiled JSON data
 * @param options - Atlas mappings and options
 * @returns Loaded map data
 */
export function loadTiledMap(
  game: GlyftMapCreator,
  data: TiledMap,
  options: TiledLoadOptions,
): TiledLoadResult {
  const collisionLayerName = options.collisionLayerName ?? 'collision';
  const collisionHidden = options.collisionLayerHidden ?? true;

  const maps: TileMap[] = [];
  const allObjects: TiledObject[] = [];
  const properties: Record<string, unknown> = {};

  // Parse map-level properties
  if (data.properties) {
    for (const prop of data.properties) {
      properties[prop.name] = prop.value;
    }
  }

  // Sort tilesets by firstgid (ascending) for correct tile ID resolution
  const tilesets = [...data.tilesets].sort((a, b) => a.firstgid - b.firstgid);

  // Process layers
  let layerIndex = 0;
  processLayers(data.layers);

  function processLayers(layers: TiledLayer[]): void {
    for (const layer of layers) {
      if (layer.type === 'group' && layer.layers) {
        processLayers(layer.layers);
        continue;
      }

      if (layer.type === 'objectgroup') {
        if (layer.objects) {
          allObjects.push(...layer.objects);
        }
        continue;
      }

      if (layer.type === 'tilelayer' && layer.data) {
        const isCollision = layer.name.toLowerCase() === collisionLayerName.toLowerCase();

        if (isCollision) {
          // Process collision layer - apply collision flags to all maps
          processCollisionLayer(layer, maps);
          if (!collisionHidden) {
            processTileLayer(layer, layerIndex++);
          }
        } else if (layer.visible !== false) {
          processTileLayer(layer, layerIndex++);
        }
      }
    }
  }

  function processTileLayer(layer: TiledLayer, layerIdx: number): void {
    if (!layer.data) return;

    const width = layer.width ?? data.width;
    const height = layer.height ?? data.height;

    // Find which atlas to use: check the first non-zero tile
    const atlas = resolveLayerAtlas(layer.data, tilesets, options.tilesetAtlases);
    if (!atlas) {
      console.warn(`[Glyft] No atlas found for layer '${layer.name}', skipping`);
      return;
    }

    const map = game.createMap(atlas, width, height, { layer: layerIdx });

    // Set tile data
    for (let i = 0; i < layer.data.length; i++) {
      const gid = layer.data[i];
      if (gid === 0) continue; // Empty tile

      const x = i % width;
      const y = Math.floor(i / width);

      // Resolve global tile ID to local tile index
      const localIndex = resolveLocalTileIndex(gid, tilesets);
      if (localIndex >= 0) {
        map.set(x, y, localIndex);
      }
    }

    maps.push(map);
  }

  function processCollisionLayer(layer: TiledLayer, existingMaps: TileMap[]): void {
    if (!layer.data) return;

    const width = layer.width ?? data.width;

    for (let i = 0; i < layer.data.length; i++) {
      const gid = layer.data[i];
      if (gid === 0) continue; // Not solid

      const x = i % width;
      const y = Math.floor(i / width);

      // Set collision on all existing maps
      for (const map of existingMaps) {
        map.setCollision(x, y, true);
      }
    }
  }

  return {
    maps,
    width: data.width,
    height: data.height,
    widthPx: data.width * data.tilewidth,
    heightPx: data.height * data.tileheight,
    objects: allObjects,
    properties,
  };
}

/**
 * Resolve a Tiled global tile ID to a local tile index.
 * Strips flip flags and subtracts the tileset's firstgid.
 */
function resolveLocalTileIndex(gid: number, tilesets: TiledTileset[]): number {
  // Strip flip flags (bits 29-31)
  const tileId = gid & 0x1FFFFFFF;
  if (tileId === 0) return -1;

  // Find the tileset this tile belongs to
  for (let i = tilesets.length - 1; i >= 0; i--) {
    if (tileId >= tilesets[i].firstgid) {
      return tileId - tilesets[i].firstgid;
    }
  }

  return -1;
}

/**
 * Find the atlas for a tile layer by checking the first non-zero tile.
 */
function resolveLayerAtlas(
  layerData: number[],
  tilesets: TiledTileset[],
  atlasMap: Record<string, Atlas>,
): Atlas | null {
  for (const gid of layerData) {
    const tileId = gid & 0x1FFFFFFF;
    if (tileId === 0) continue;

    // Find tileset
    for (let i = tilesets.length - 1; i >= 0; i--) {
      if (tileId >= tilesets[i].firstgid) {
        const tilesetName = tilesets[i].name;
        return atlasMap[tilesetName] ?? null;
      }
    }
  }

  // Fallback: return first atlas
  const keys = Object.keys(atlasMap);
  return keys.length > 0 ? atlasMap[keys[0]] : null;
}

/**
 * Set collision data on a tilemap from a Tiled collision layer.
 * Useful when applying collision after initial load.
 */
export function applyTiledCollision(
  map: TileMap,
  collisionData: number[],
  mapWidth: number,
): void {
  for (let i = 0; i < collisionData.length; i++) {
    if (collisionData[i] !== 0) {
      const x = i % mapWidth;
      const y = Math.floor(i / mapWidth);
      map.setCollision(x, y, true);
    }
  }
}
