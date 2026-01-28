/**
 * Glyft Type Definitions
 *
 * Complete type definitions for the Glyft game engine.
 *
 * @packageDocumentation
 */

// -----------------------------------------------------------------------------
// Config Types
// -----------------------------------------------------------------------------

/**
 * Sprite animation mode - determines how velocity maps to sprite directions.
 *
 * The mode you choose affects how your spritesheet should be organized:
 *
 * | Mode | Rows | Description |
 * |------|------|-------------|
 * | `'4dir'` | 4 | Down, Right, Up, Left (RPG-style) |
 * | `'8dir'` | 8 | 8 compass directions |
 * | `'2dir-side'` | 1 | Left/Right, GPU flips for left (platformer) |
 * | `'2dir-top'` | 2 | Down, Up only |
 * | `'1dir'` | 1 | Single direction, use rotation for facing |
 * | `'iso4'` | 4 | Isometric SE, SW, NW, NE |
 * | `'iso8'` | 8 | 8 isometric directions |
 *
 * @example
 * ```typescript
 * const config: GlyftConfig = {
 *   settings: {
 *     tileSize: 16,
 *     viewport: [320, 240],
 *     spriteMode: '4dir',  // 4-direction RPG-style
 *   }
 * };
 * ```
 */
export type SpriteMode =
  | '4dir'      // Down, Right, Up, Left
  | '8dir'      // 8 compass directions
  | '2dir-side' // Left, Right (flip for left)
  | '2dir-top'  // Down, Up
  | '1dir'      // Single direction (use rotation)
  | 'iso4'      // Isometric 4-way
  | 'iso8';     // Isometric 8-way

/**
 * Core engine settings - required for every Glyft game.
 *
 * @example
 * ```typescript
 * const settings: GlyftSettings = {
 *   tileSize: 16,           // Standard retro tile size
 *   viewport: [320, 240],   // 4:3 aspect ratio
 *   spriteMode: '4dir',     // RPG-style 4 directions
 *   backgroundColor: 0x1a1a2e, // Dark blue background
 * };
 * ```
 */
export interface GlyftSettings {
  /**
   * Tile size in pixels. Must be a power of 2 for optimal GPU alignment.
   *
   * Common choices:
   * - `8` - Very retro (Game Boy style)
   * - `16` - Classic retro (SNES, Genesis)
   * - `32` - Modern pixel art
   * - `64` - High-detail pixel art
   */
  tileSize: 8 | 16 | 32 | 64;

  /**
   * Virtual viewport size as [width, height] in pixels.
   * This is the game's internal resolution - CSS handles scaling to screen.
   *
   * Common sizes:
   * - `[256, 144]` - Very retro (16:9)
   * - `[320, 240]` - Classic (4:3)
   * - `[384, 216]` - Widescreen (16:9)
   * - `[480, 270]` - Larger widescreen (16:9)
   */
  viewport: [number, number];

  /** Number of tilemap layers (default: auto-managed) */
  layers?: number;

  /** Sprite animation mode (default: '4dir') */
  spriteMode?: SpriteMode;

  /**
   * Background clear color as hex (0xRRGGBB).
   * @example 0x000000 (black), 0x1a1a2e (dark blue), 0x2d3436 (dark gray)
   */
  backgroundColor?: number;

  /**
   * Depth sorting mode for sprites.
   * - `'y'` - Sort by Y position (lower = in front). Good for top-down RPGs.
   * - `'none'` - No sorting, render in creation order.
   * @default 'none'
   */
  depthSort?: 'y' | 'none';

  /**
   * How often to perform depth sorting (every N frames).
   * Higher values reduce CPU cost but may cause brief visual glitches.
   * Only applies when depthSort is not 'none'.
   * @default 5
   */
  depthSortInterval?: number;
}

/** Stat definition */
export interface StatDef {
  default: number;
  max?: number;
  min?: number;
}

/**
 * Declarative sound effect definition.
 *
 * Each SfxDef describes a procedurally-generated sound using Web Audio oscillators.
 * All fields are serializable JSON — no callbacks, no audio files needed.
 *
 * @example
 * ```typescript
 * sfx: {
 *   laser:  { wave: 'sine', freq: 880, duration: 0.15, sweep: 440 },
 *   coin:   { wave: 'square', freq: 1400, duration: 0.1, sweep: 2100, sweepTime: 0.05 },
 *   hurt:   { wave: 'sawtooth', freq: 200, duration: 0.2, decay: 'exp' },
 *   step:   { wave: 'triangle', freq: [100, 150], duration: 0.05 },
 *   explode:{ wave: 'sawtooth', freq: 80, duration: 0.4, noise: 0.3, filter: 'lowpass', filterFreq: 600 },
 * }
 * ```
 */
export interface SfxDef {
  /** Oscillator waveform (default: 'square') */
  wave?: 'sine' | 'square' | 'sawtooth' | 'triangle';
  /** Base frequency in Hz, or [min, max] for random (default: 440) */
  freq?: number | [number, number];
  /** Duration in seconds (default: 0.1) */
  duration?: number;
  /** Frequency to sweep to over sweepTime (pitch bend) */
  sweep?: number;
  /** Time in seconds for the frequency sweep (default: duration) */
  sweepTime?: number;
  /** Gain envelope decay curve: 'exp' for exponential, 'linear' for linear (default: 'exp') */
  decay?: 'exp' | 'linear';
  /** Attack time in seconds — fade in from silence (default: 0) */
  attack?: number;
  /** Detune in cents — shifts pitch (default: 0) */
  detune?: number;
  /** Noise mix 0-1 — blends white noise with the oscillator (default: 0) */
  noise?: number;
  /** Biquad filter type (default: none) */
  filter?: 'lowpass' | 'highpass' | 'bandpass';
  /** Filter cutoff frequency in Hz (default: 1000) */
  filterFreq?: number;
  /** Filter Q / resonance (default: 1) */
  filterQ?: number;
}

/** Sound rule options */
export interface SoundRule {
  sound: string;
  cooldown?: number;
  interval?: number;
  volume?: number | [number, number];
  pitch?: number | [number, number];
  spatial?: boolean;
}

/**
 * Music track definition.
 *
 * Three modes:
 * - **File**: Set `track` to an audio URL (e.g. `'music/overworld.mp3'`)
 * - **Preset**: Set `track` to a `$name` (e.g. `'$peaceful'`)
 * - **Melody**: Provide `notes` array for declarative procedural music
 *
 * @example
 * ```typescript
 * music: {
 *   // File-based
 *   overworld: { track: 'music/overworld.mp3', loop: true },
 *   // Declarative melody
 *   village: {
 *     bpm: 72, wave: 'sine',
 *     notes: ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'C4'],
 *     pad: { wave: 'sine', freq: 131, volume: 0.3 },
 *     volume: 0.8,
 *   },
 * }
 * ```
 */
export interface MusicTrack {
  /** Audio file URL or $preset name (omit for declarative melody) */
  track?: string;
  loop?: boolean;
  fadeIn?: number;
  /** Master volume for this track (default: 1.0) */
  volume?: number;
  /** Tempo in BPM — enables declarative melody mode (default: 120) */
  bpm?: number;
  /** Oscillator waveform for melody notes (default: 'sine') */
  wave?: 'sine' | 'square' | 'sawtooth' | 'triangle';
  /** Note sequence — note names ('C4', 'D#4'), Hz frequencies, or [note, duration] tuples.
   *  When a note is a tuple, the second element is its duration in beats (default: 1).
   *  Simple notes use the global noteLength. Example:
   *  `['C4', 'E4', ['G4', 0.5], 'C5']` */
  notes?: (string | number | [string | number, number])[];
  /** Default duration of each note in beats (default: 1). Overridden per-note with tuple syntax. */
  noteLength?: number;
  /** Background pad/drone played under the melody */
  pad?: {
    wave?: 'sine' | 'square' | 'sawtooth' | 'triangle';
    /** Root frequency in Hz for the pad chord */
    freq: number;
    /** Pad volume relative to track volume (default: 0.3) */
    volume?: number;
  };
}

/** Named animation definition for override animations */
export interface AnimationDef {
  /** Frame indices in the spritesheet row (0-based column indices) */
  frames: number[];
  /** Frames per second */
  fps: number;
  /** Whether to loop the animation (default: false) */
  loop?: boolean;
  /** Which row in the spritesheet to use (overrides direction-based row) */
  row?: number;
}

/** Float text display style */
export type FloatTextStyle = 'rise' | 'pop';

/** Options for floating text */
export interface FloatTextOptions {
  /** Text color as 0xRRGGBB (default: 0xffffff) */
  color?: number;
  /** Animation style (default: 'rise') */
  style?: FloatTextStyle;
  /** Duration in seconds (default: 1.0) */
  duration?: number;
  /** Rise speed in pixels/second (default: 30) */
  speed?: number;
  /** Font scale multiplier (default: 1) */
  scale?: number;
}

/** Config for floatText in collision actions: true = auto, or override options */
export type FloatTextAction = boolean | FloatTextOptions;

/** Label visibility mode */
export type LabelVisible = 'always' | 'hover' | 'proximity';

/** Collision action */
export interface CollisionAction {
  damage?: number;
  heal?: number;
  knockback?: number;
  flash?: number;
  destroy?: boolean;
  animation?: string;
  collect?: string;
  cooldown?: number;
  /** Attract sprite B toward sprite A when within range (px). Speed in px/s. */
  magnetize?: { range: number; speed: number };
  /** Show floating text on collision. true = auto from damage/heal/collect. */
  floatText?: FloatTextAction;
  /** Emit particles on collision. String = emitter name at collision point. */
  particles?: string;
}

/** Particle emitter definition */
export interface ParticleEmitterDef {
  /** Number of particles per burst (default: 10) */
  count?: number;
  /** Initial speed in pixels/second (default: 50) */
  speed?: number;
  /** Speed variance +/- (default: 0) */
  speedVariance?: number;
  /** Emission angle in degrees, 0=right, -90=up (default: -90) */
  angle?: number;
  /** Spread arc in degrees centered on angle (default: 360) */
  spread?: number;
  /** Lifetime in seconds (default: 0.5) */
  lifetime?: number;
  /** Lifetime variance +/- seconds (default: 0) */
  lifetimeVariance?: number;
  /** Gravity in px/s², positive=down (default: 0) */
  gravity?: number;
  /** Start color as 0xRRGGBB (default: 0xffffff) */
  color?: number;
  /** End color as 0xRRGGBB (default: same as color) */
  colorEnd?: number;
  /** Start size in pixels (default: 3) */
  size?: number;
  /** End size in pixels (default: 0) */
  sizeEnd?: number;
}

/** Custom handler function */
export type Handler = (a: Sprite, b: Sprite, game: Glyft) => void;

/** Network configuration */
export interface NetworkConfig {
  adapter: NetworkAdapter;
  mode: 'local' | 'client' | 'server' | 'host';
  authoritative?: ('position' | 'hp' | 'damage' | 'destroy')[];
  local?: ('sounds' | 'flash' | 'particles')[];
  prediction?: boolean;
  predict?: ('position' | 'velocity')[];
  wait?: ('damage' | 'destroy' | 'collect')[];
}

/**
 * Main configuration object for a Glyft game.
 *
 * Glyft is config-driven: game rules are defined as data, not scattered code.
 * This enables hot-reload, easy serialization, and cleaner game logic.
 *
 * @example
 * ```typescript
 * const config: GlyftConfig = {
 *   settings: {
 *     tileSize: 16,
 *     viewport: [320, 240],
 *     spriteMode: '4dir',
 *   },
 *   autoTags: {
 *     'enemy_': ['enemy', 'hostile'],
 *     'pickup_': ['item', 'collectible'],
 *   },
 *   stats: {
 *     hp: { default: 100, max: 100 },
 *     coins: { default: 0 },
 *   },
 *   sounds: {
 *     '[player]:moving': { sound: '$step', interval: 0.2 },
 *     '[player]:[enemy]': { sound: '$hurt', cooldown: 0.5 },
 *   },
 *   collisions: {
 *     '[player]:[enemy]': { damage: 10, knockback: 100 },
 *     '[player]:[coin]': { collect: 'coins', destroy: true },
 *   },
 * };
 * ```
 */
export interface GlyftConfig {
  /** Core engine settings (required) */
  settings: GlyftSettings;

  /**
   * Auto-tag sprites based on type prefix.
   * @example { 'enemy_': ['enemy'], 'npc_': ['friendly', 'npc'] }
   */
  autoTags?: Record<string, string[]>;

  /**
   * Player/game stats (HP, coins, score, etc.)
   * @example { hp: { default: 100, max: 100 }, coins: { default: 0 } }
   */
  stats?: Record<string, StatDef>;

  /**
   * Named sound effect definitions — procedurally generated, no audio files needed.
   * Referenced by name in sound rules and addon configs.
   * @example { laser: { wave: 'sine', freq: 880, duration: 0.15, sweep: 440 } }
   */
  sfx?: Record<string, SfxDef>;

  /**
   * Reactive sound rules - sounds trigger automatically.
   * @example { '[player]:moving': '$step', '[player]:[enemy]': '$hurt' }
   */
  sounds?: Record<string, string | SoundRule>;

  /**
   * Music track definitions.
   * @example { 'overworld': { track: 'music/overworld.mp3', loop: true } }
   */
  music?: Record<string, MusicTrack>;

  /**
   * Collision rules - define what happens when sprites collide.
   * @example { '[player]:[enemy]': { damage: 10, knockback: 50 } }
   */
  collisions?: Record<string, string | CollisionAction>;

  /**
   * Custom handler functions referenced by collision rules.
   * @example { openChest: (player, chest, game) => { ... } }
   */
  handlers?: Record<string, Handler>;

  /** Particle emitter definitions */
  particles?: Record<string, ParticleEmitterDef>;

  /** Network configuration for multiplayer */
  network?: NetworkConfig;
}

// -----------------------------------------------------------------------------
// Pointer Event Types
// -----------------------------------------------------------------------------

/** Pointer event fired on interactive sprites or the game canvas. */
export interface SpritePointerEvent {
  /** The sprite involved (non-null for sprite events, null for game-level miss). */
  sprite: Sprite | null;
  /** Pointer world X coordinate. */
  worldX: number;
  /** Pointer world Y coordinate. */
  worldY: number;
}

// -----------------------------------------------------------------------------
// Core Types
// -----------------------------------------------------------------------------

/** Direction (for 4dir mode) */
export type Direction = 'down' | 'right' | 'up' | 'left';

/** Direction (for 8dir mode) */
export type Direction8 = Direction | 'down-right' | 'up-right' | 'up-left' | 'down-left';

/**
 * A game sprite with GPU-driven animation.
 *
 * Sprites use velocity-driven animation: set `vx` and `vy`, and the GPU shader
 * automatically selects the correct direction and walk/idle frames.
 *
 * @example
 * ```typescript
 * const player = game.createSprite(atlas, 'hero');
 * player.x = 100;
 * player.y = 100;
 * player.tags = ['player'];
 *
 * // Movement: just set velocity, GPU handles animation
 * player.vx = 100;  // Move right at 100 px/s
 * player.vy = 0;    // GPU shows "walk right" animation
 *
 * // Later: stop moving
 * player.vx = 0;
 * player.vy = 0;    // GPU shows "idle facing right" animation
 * ```
 */
export interface Sprite {
  /** Unique ID (auto-generated, e.g., "sprite_42") */
  readonly id: string;

  /** Sprite type name (from atlas frame name, e.g., "hero", "goblin") */
  readonly type: string;

  /** X position in world pixels */
  x: number;

  /** Y position in world pixels */
  y: number;

  /**
   * X velocity in pixels/second.
   * The GPU shader uses velocity to determine direction and animation.
   * Set this for movement - don't modify `x` directly in the game loop.
   */
  vx: number;

  /**
   * Y velocity in pixels/second.
   * Combined with `vx`, determines the facing direction and walk animation.
   */
  vy: number;

  /** Rotation in radians (used by '1dir' sprites, or for effects) */
  rotation: number;

  /** Uniform scale factor (1.0 = normal size) */
  scale: number;

  /** Opacity from 0 (invisible) to 1 (opaque) */
  alpha: number;

  /**
   * Tint color as 0xRRGGBB hex.
   * @example 0xFFFFFF (white/no tint), 0xFF0000 (red), 0x00FF00 (green)
   */
  tint: number;

  /** Flip sprite horizontally */
  flipX: boolean;

  /** Flip sprite vertically */
  flipY: boolean;

  /** Bob amplitude in pixels (0 = off). GPU-driven sinusoidal Y oscillation. */
  bob: number;

  /** Bob frequency in Hz (default 1.5). */
  bobSpeed: number;

  /** Render a dark ellipse shadow at sprite base position. */
  shadow: boolean;

  /** Text label displayed above sprite (null = no label). Max 16 characters. */
  label: string | null;

  /** Label text color as 0xRRGGBB (default: 0xffffff) */
  labelColor: number;

  /** Label visibility mode (default: 'always') */
  labelVisible: LabelVisible;

  /** Proximity range in pixels for 'proximity' mode (default: 80) */
  labelRange: number;

  /** Icon character above label text (e.g. "!" for quest). null = no icon. */
  labelIcon: string | null;

  /** Icon color as 0xRRGGBB (default: 0xffff00) */
  labelIconColor: number;

  /** Whether to show an HP bar above the sprite. */
  hpBarVisible: boolean;

  /** HP bar fill value 0.0–1.0 (fraction of max HP). */
  hpBarValue: number;

  /** HP bar width in pixels (default: 40). */
  hpBarWidth: number;

  /** HP bar fill color: 'auto' for green/yellow/red preset, or 0xRRGGBB for fixed color (default: 'auto'). */
  hpBarColor: 'auto' | number;

  /** HP bar background color as 0xRRGGBB (default: 0x000000). */
  hpBarBgColor: number;

  /**
   * Tags for collision/sound pattern matching.
   * @example ['player'], ['enemy', 'boss'], ['item', 'collectible']
   */
  tags: string[];

  /**
   * Current facing direction (computed from last non-zero velocity).
   * Use this for attacks, projectiles, etc.
   */
  readonly facing: Direction;

  /**
   * Custom data storage for game-specific properties.
   * @example sprite.data.inventory = []; sprite.data.dialogueId = 'npc_01';
   */
  data: Record<string, unknown>;

  /** Current HP (only present if stats.hp is defined in config) */
  hp?: number;

  /** Whether this sprite triggers reactive sounds (default: true) */
  sounds: boolean;

  /** Whether this sprite responds to hit-testing/clicks (default: false) */
  interactive: boolean;

  /**
   * Custom hitbox override for hit-testing.
   * Offsets are relative to sprite position (top-left).
   * If not set, uses the sprite's frame dimensions.
   */
  hitbox: { x: number; y: number; w: number; h: number } | null;

  /** Reference to the sprite's texture atlas */
  readonly atlas: Atlas;

  /** False after destroy() is called */
  readonly exists: boolean;

  /**
   * Width of the sprite frame in pixels.
   */
  readonly width: number;

  /**
   * Height of the sprite frame in pixels.
   */
  readonly height: number;

  /**
   * Define a named animation for this sprite.
   *
   * @param name - Animation name (e.g., 'attack', 'death', 'idle')
   * @param def - Animation definition (frames, fps, loop)
   *
   * @example
   * ```typescript
   * sprite.defineAnimation('attack', { frames: [0, 1, 2, 3, 4], fps: 12 });
   * sprite.defineAnimation('death', { frames: [0, 1, 2], fps: 8, loop: false });
   * ```
   */
  defineAnimation(name: string, def: AnimationDef): void;

  /**
   * Play a named animation, overriding velocity-driven animation.
   * The animation must be defined first with defineAnimation().
   *
   * @param name - Animation name
   * @param options - Callbacks
   *
   * @example
   * ```typescript
   * sprite.defineAnimation('attack', { frames: [0, 1, 2, 3], fps: 12 });
   * sprite.playAnimation('attack', {
   *   onComplete: () => sprite.clearOverride()
   * });
   * ```
   */
  playAnimation(name: string, options?: { onComplete?: () => void; onFrame?: (frame: number) => void }): void;

  /**
   * Play a special animation, overriding velocity-driven animation.
   * Useful for attacks, deaths, emotes, etc.
   *
   * @param animation - Animation name (maps to atlas frames)
   * @param options - loop: repeat animation, onComplete: callback when done
   *
   * @example
   * ```typescript
   * // Attack animation, then return to normal
   * player.playOverride('attack', {
   *   loop: false,
   *   onComplete: () => player.clearOverride()
   * });
   * ```
   */
  playOverride(animation: string, options?: { loop?: boolean; onComplete?: () => void }): void;

  /** Clear animation override, return to velocity-driven animation */
  clearOverride(): void;

  /** Register a pointer event listener. Requires interactive = true. */
  on(event: 'pointerdown' | 'pointerover' | 'pointerout', callback: (e: SpritePointerEvent) => void): void;

  /** Remove a pointer event listener (specific callback, or all for that event). */
  off(event: 'pointerdown' | 'pointerover' | 'pointerout', callback?: (e: SpritePointerEvent) => void): void;

  /**
   * Destroy this sprite (removes from game).
   * After calling, `exists` becomes false.
   */
  destroy(): void;
}

/** Texture atlas */
export interface Atlas {
  /** Atlas name/ID */
  readonly name: string;
  /** WebGL texture */
  readonly texture: WebGLTexture;
  /** Texture width */
  readonly width: number;
  /** Texture height */
  readonly height: number;
  /** Get tile index by name */
  index(name: string): number;
  /** Get frame data by name */
  frame(name: string): AtlasFrame;
}

/** Atlas frame data */
export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tilemap */
export interface TileMap {
  /** Map width in tiles */
  readonly width: number;
  /** Map height in tiles */
  readonly height: number;
  /** Map width in pixels */
  readonly widthPx: number;
  /** Map height in pixels */
  readonly heightPx: number;
  /** Layer index */
  readonly layer: number;

  /** Set tile at position */
  set(x: number, y: number, tileIndex: number): void;
  /** Get tile at position */
  get(x: number, y: number): number;
  /** Fill rectangle with tile */
  fill(x: number, y: number, w: number, h: number, tileIndex: number): void;
  /** Set region from 2D array */
  setRegion(x: number, y: number, data: number[][]): void;
  /** Set collision flag */
  setCollision(x: number, y: number, solid: boolean): void;
  /** Get collision flag */
  getCollision(x: number, y: number): boolean;
  /** Set music zone */
  setMusicZone(x: number, y: number, w: number, h: number, track: string): void;
  /** Destroy this tilemap (removes from collision checks and rendering) */
  destroy(): void;
}

/** Camera */
export interface Camera {
  /** Camera X position */
  x: number;
  /** Camera Y position */
  y: number;
  /** Zoom level */
  zoom: number;

  /** Follow a sprite */
  follow(target: Sprite, options?: { smoothing?: number; deadzone?: number }): void;
  /** Stop following */
  unfollow(): void;
  /** Set camera bounds */
  setBounds(x: number, y: number, w: number, h: number): void;
  /** Clear bounds */
  clearBounds(): void;
  /** Shake the camera */
  shake(intensity: number, duration: number): void;
}

/** Input manager */
export interface Input {
  /** Check if key is currently down */
  isDown(key: string): boolean;
  /** Check if key was just pressed this frame */
  justPressed(key: string): boolean;
  /** Check if key was just released this frame */
  justReleased(key: string): boolean;
  /** Pointer state */
  readonly pointer: { x: number; y: number; down: boolean };
}

/** Stats manager */
export interface Stats {
  [key: string]: number;
}

// -----------------------------------------------------------------------------
// Network Types
// -----------------------------------------------------------------------------

/** Game event for network sync */
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

/** Network adapter interface */
export interface NetworkAdapter {
  send(event: GameEvent): void;
  onReceive(callback: (event: GameEvent) => void): void;
  connect(options?: unknown): Promise<void>;
  disconnect(): void;
  readonly connected: boolean;
  readonly playerId: string;
}

// -----------------------------------------------------------------------------
// Main Class Interface
// -----------------------------------------------------------------------------

/** Main Glyft engine interface */
export interface Glyft {
  /** Canvas element */
  readonly canvas: HTMLCanvasElement;
  /** WebGL2 context */
  readonly gl: WebGL2RenderingContext;
  /** Current config */
  readonly config: GlyftConfig;
  /** Camera */
  readonly camera: Camera;
  /** Input manager */
  readonly input: Input;
  /** Player stats */
  readonly stats: Stats;
  /** Current time */
  readonly time: number;
  /** Delta time */
  readonly dt: number;

  /** Load texture atlas */
  loadAtlas(imagePath: string, dataPath: string | object): Promise<Atlas>;
  /**
   * Load a single image as a texture atlas.
   * Optionally split into frames using frameWidth/frameHeight.
   *
   * @param key - Unique name for this texture
   * @param url - URL to the image file
   * @param options - Frame dimensions for spritesheets
   */
  loadTexture(key: string, url: string, options?: { frameWidth?: number; frameHeight?: number }): Promise<Atlas>;
  /** Create procedural test atlas for development */
  createTestAtlas(name: string, tilesX: number, tilesY: number): Atlas;
  /** Create tilemap */
  createMap(atlas: Atlas, width: number, height: number, options?: { layer?: number }): TileMap;
  /** Create sprite */
  createSprite(atlas: Atlas, type: string): Sprite;
  /** Spawn entity by type name */
  spawn(type: string, x: number, y: number): Sprite;
  /** Get all sprites with tag */
  getTagged(tag: string): Sprite[];
  /** Get sprite by ID */
  getById(id: string): Sprite | undefined;
  /**
   * Get all interactive sprites at a world coordinate.
   * Returns sprites sorted by Y (front-most first).
   */
  getSpritesAtPoint(worldX: number, worldY: number): Sprite[];
  /** Check AABB collision with tilemap */
  collidesWithMap(x: number, y: number, w: number, h: number): boolean;
  /** Check if sprite collides with tilemap at given position (uses sprite's frame size) */
  spriteCollidesWithMap(sprite: Sprite, x?: number, y?: number): boolean;
  /**
   * Tween a target's properties over time.
   *
   * @param target - Object to tween (sprite, camera, any object with numeric props)
   * @param props - Target property values
   * @param duration - Duration in milliseconds
   * @param options - Easing, callbacks, delay
   */
  tween(target: object, props: { x?: number; y?: number; alpha?: number; scale?: number; rotation?: number }, duration: number, options?: { ease?: string; onUpdate?: (t: object) => void; onComplete?: (t: object) => void; delay?: number }): { cancel(): void; readonly active: boolean };
  /** Spawn floating text at world position */
  floatText(x: number, y: number, text: string, options?: FloatTextOptions): void;
  /** Register update callback */
  onUpdate(callback: (dt: number) => void): void;
  /** Start game loop */
  start(): void;
  /** Pause game loop */
  pause(): void;
  /** Resume game loop */
  resume(): void;
  /** Reload config (hot reload) */
  reloadConfig(config: Partial<GlyftConfig>): void;

  /** Register an addon to extend engine functionality */
  use(addon: import('./addon').GlyftAddon): this;

  /** Get a registered addon by name */
  addon<T extends import('./addon').GlyftAddon>(name: string): T | undefined;

  /** Register a game-level pointer event listener. */
  on(event: 'pointerdown', callback: (e: SpritePointerEvent) => void): void;

  /** Remove a game-level pointer event listener. */
  off(event: 'pointerdown', callback?: (e: SpritePointerEvent) => void): void;

  /** Sound system */
  readonly sounds: {
    define(rules: Record<string, string | SoundRule>): void;
    defineSfx(defs: Record<string, SfxDef>): void;
    play(sound: string, options?: { volume?: number; pitch?: number; x?: number }): void;
  };

  /** Music system */
  readonly music: {
    define(tracks: Record<string, MusicTrack>): void;
    play(track: string, options?: { fade?: number }): void;
    stop(options?: { fade?: number }): void;
    volume: number;
  };

  /** Collision system */
  readonly collisions: {
    define(rules: Record<string, string | CollisionAction>): void;
    on(pattern: string, callback: (a: Sprite, b: Sprite) => void): void;
  };

  /** Particle system */
  readonly particles: {
    define(name: string, def: ParticleEmitterDef): void;
    emit(name: string, x: number, y: number): void;
  };

  /** Network (if configured) */
  readonly network?: {
    readonly connected: boolean;
    readonly playerId: string;
    send(event: GameEvent): void;
    on(type: string, callback: (event: GameEvent) => void): void;
  };
}
