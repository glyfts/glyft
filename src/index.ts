/**
 * Glyft - GPU-first, config-driven WebGL2 framework for tile-based 2D games.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { Glyft, type GlyftConfig } from 'glyft';
 *
 * const config: GlyftConfig = {
 *   settings: {
 *     tileSize: 16,
 *     viewport: [320, 240],
 *     spriteMode: '4dir',
 *   },
 *   collisions: {
 *     '[player]:[enemy]': { damage: 10, knockback: 50 },
 *   },
 * };
 *
 * const game = new Glyft(canvas, config);
 * const atlas = game.createTestAtlas('test', 8, 8);
 * const player = game.createSprite(atlas, 'player');
 * game.start();
 * ```
 */

// Core engine
export { GlyftEngine as Glyft } from './glyft';

// Error class for catching Glyft-specific errors
export { GlyftError } from './renderer';

// Addon system
export type { GlyftAddon } from './types';

// Tween system
export { TweenManager } from './tween';
export type { TweenProps, TweenOptions, TweenHandle, EaseName } from './tween';

// Tiled map loader
export { loadTiledMap, applyTiledCollision } from './loaders/tiled';
export type { TiledMap, TiledLayer, TiledTileset, TiledObject, TiledLoadOptions, TiledLoadResult } from './loaders/tiled';

// Types
export type {
  GlyftConfig,
  GlyftSettings,
  SpriteMode,
  StatDef,
  SfxDef,
  SoundRule,
  MusicTrack,
  CollisionAction,
  AnimationDef,
  Handler,
  NetworkConfig,
  Sprite,
  Atlas,
  AtlasFrame,
  TileMap,
  Camera,
  Input,
  Stats,
  GameEvent,
  NetworkAdapter,
  Direction,
  Direction8,
  SpritePointerEvent,
  FloatTextOptions,
  FloatTextStyle,
  FloatTextAction,
  LabelVisible,
  ParticleEmitterDef,
} from './types';

// Re-export from network for convenience
export type { NetworkAdapter as INetworkAdapter } from './network';

// Re-export helpers for convenience (also available as 'glyft/helpers')
export * from './helpers';
