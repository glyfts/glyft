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
   * Depth sorting mode for sprites (2D). Sorted every frame; the order carries over
   * between frames, so the cost is close to linear when little moves.
   * - `'y'` - Sort by the bottom edge (y + height): lower on screen draws in front. Use for top-down games.
   * - `'z'` - Sort by Z layer (lower = behind). Good for layered 2D games.
   * - `'zy'` - Sort by Z first, then Y within same layer. Best of both.
   * - `'none'` - No sorting, render in creation order.
   * @default 'none'
   */
  depthSort?: 'y' | 'z' | 'zy' | 'none';

  /**
   * @deprecated Ignored. Sorting now runs every frame and is cheap because the order
   * carries over between frames.
   */
  depthSortInterval?: number;

  /**
   * Enable depth buffer for 3D terrain rendering.
   * When true, the WebGL context is created with a depth buffer.
   * Required when using the terrain subsystem.
   * @default false
   */
  depth?: boolean;

  /**
   * Enable alpha channel for transparent canvas.
   * When true, the canvas background is transparent, useful for overlays.
   * @default false
   */
  alpha?: boolean;

  /**
   * Backing resolution relative to the viewport. 'auto' renders at the canvas's on-screen size
   * times the device pixel ratio, so text and HUDs stay sharp when a small viewport is shown
   * large. 2D uses whole-number steps so pixel art stays square. 1 renders at viewport size
   * and lets the browser scale it (the old behaviour).
   * @default 'auto'
   */
  pixelRatio?: number | 'auto';

  /**
   * Rendering mode. In '3d', sprites keep their 2D logic (x/y in pixels on the
   * ground plane) and Glyft lifts them onto the terrain declared in `world`.
   * One tile (tileSize px) is one world unit. Implies `depth: true`.
   * @default '2d'
   */
  mode?: '2d' | '3d';
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
 * All fields are serializable JSON: no callbacks, no audio files needed.
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
  /** Base frequency in Hz, [min, max] for random, or [f1, f2, ...] for multi-step sweep (default: 440) */
  freq?: number | number[];
  /** Duration in seconds (default: 0.1) */
  duration?: number;
  /** Frequency to sweep to over sweepTime (pitch bend) */
  sweep?: number;
  /** Time in seconds for the frequency sweep (default: duration) */
  sweepTime?: number;
  /** Gain envelope decay curve: 'exp' for exponential, 'linear' for linear (default: 'exp') */
  decay?: 'exp' | 'linear';
  /** Attack time in seconds: fade in from silence (default: 0) */
  attack?: number;
  /** Detune in cents: shifts pitch (default: 0) */
  detune?: number;
  /** Noise mix 0-1: blends white noise with the oscillator (default: 0) */
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
/**
 * A Glyft addon extends the engine with new capabilities via `game.use()`.
 *
 * Lifecycle:
 * 1. Factory function creates addon config → GlyftAddon object
 * 2. `game.use(addon)` calls `init()` with the game instance
 * 3. Each frame, hooks are called in order:
 *    - `preUpdate(dt)` → before user `onUpdate` callbacks
 *    - `postUpdate(dt)` → after user callbacks, before collision detection
 *    - `postPhysics(dt)` → after collisions + reactive sounds
 * 4. `destroy()` called on addon removal
 */
export interface GlyftAddon {
  /** Unique addon name (used for `game.addon('name')` lookup and duplicate detection) */
  readonly name: string;

  /** Called once when `game.use()` is invoked. Store the game reference, set up initial state. */
  init(game: Glyft): void;

  /** Called every frame BEFORE user `onUpdate` callbacks. */
  preUpdate?(dt: number): void;

  /** Called every frame AFTER user callbacks, BEFORE collision detection. */
  postUpdate?(dt: number): void;

  /** Called every frame AFTER collisions + reactive sounds, BEFORE render. */
  postPhysics?(dt: number): void;

  /** Called when the addon is removed or the game is destroyed. */
  destroy?(): void;
}

export interface MusicTrack {
  /** Audio file URL or $preset name (omit for declarative melody) */
  track?: string;
  loop?: boolean;
  fadeIn?: number;
  /** Master volume for this track (default: 1.0) */
  volume?: number;
  /** Tempo in BPM: enables declarative melody mode (default: 120) */
  bpm?: number;
  /** Oscillator waveform for melody notes (default: 'sine') */
  wave?: 'sine' | 'square' | 'sawtooth' | 'triangle';
  /** Note sequence: note names ('C4', 'D#4'), Hz frequencies, or [note, duration] tuples.
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
   * Named sound effect definitions: procedurally generated, no audio files needed.
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

  /** 3D world: terrain, sky, camera, controller, buildings, models, ships. Requires settings.mode '3d'. */
  world?: WorldConfig;
}

// -----------------------------------------------------------------------------
// 3D World Config
// -----------------------------------------------------------------------------

/**
 * Texture source for terrain and ship surfaces: a built-in material name
 * ('sand', 'grass', 'rock', 'snow', 'dirt', 'mud', 'stone', 'wood'...), a hex colour,
 * or an image URL.
 */
export type WorldTexture = string | number;

/** Procedural heightmap generator. */
export interface HeightmapGenerator {
  /** 'island' (one island), 'archipelago' (several), 'hills' (rolling land), 'cave' (enclosed cavern), 'flat' */
  generate: 'island' | 'archipelago' | 'hills' | 'cave' | 'flat';
  /** Grid size in cells (square). @default 128 */
  size?: number;
  /** Random seed. Same seed, same world. @default 1 */
  seed?: number;
}

/** Terrain declaration. */
export interface TerrainDef {
  /** Heightmap: image URL (red channel = height), 2D array of 0..1 heights, or a generator. */
  heightmap: string | number[][] | HeightmapGenerator;
  /** World units per heightmap cell. @default 1 */
  cellSize?: number;
  /** Height of a 1.0 heightmap value, in world units. @default 16 */
  maxHeight?: number;
  /** Surface textures blended by height and slope. */
  textures?: { low?: WorldTexture; mid?: WorldTexture; steep?: WorldTexture; high?: WorldTexture };
  /** Water (or lava) plane. Omit for no water. */
  water?: {
    /** Surface height in world units */
    height: number;
    /** @default 'ocean' */
    style?: 'ocean' | 'lake' | 'lava';
    /** Wave strength: 0 = flat, 1 = normal, 3 = storm. @default 1 */
    waves?: number;
  };
  /** Distance fog in world units. Colour follows the sky when one is declared. */
  fog?: { near?: number; far?: number; color?: number };
  /** Flat cells with vertical walls (dungeon look). @default false */
  stepped?: boolean;
}

/** Sky and day/night cycle. Drives fog colour and lighting for the whole world. */
export interface SkyDef {
  /** Time of day 0..1 (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset). @default 0.4 */
  time?: number;
  /** Real seconds per in-game day. 0 freezes time. @default 0 */
  dayLength?: number;
  /** @default true */
  stars?: boolean;
  /** @default true */
  clouds?: boolean;
}

/** Camera declaration. */
export interface CameraDef {
  /**
   * 'follow': chase a sprite, drag to rotate, wheel to zoom.
   * 'orbit': circle a fixed point (or a sprite), drag to rotate, wheel to zoom.
   * 'fps': first person from the target sprite's eyes, mouse look with pointer lock.
   * 'fixed': stays at `position`, looking at `lookAt`.
   */
  mode: 'follow' | 'orbit' | 'fps' | 'fixed';
  /** Sprite id or type to follow (follow, orbit, fps). */
  target?: string;
  /** Distance from target in world units. @default 14 */
  distance?: number;
  /** Zoom range for the mouse wheel. @default [4, 60] */
  zoom?: [number, number];
  /** Starting pitch in radians (0 level, PI/2 straight down). @default 0.5 */
  pitch?: number;
  /** Starting yaw in radians. @default 0 */
  yaw?: number;
  /** Field of view in radians. @default PI/4 (PI/3 for fps) */
  fov?: number;
  /** Far clip in world units. @default 400 */
  far?: number;
  /** Pull in when terrain is between camera and target (follow). @default true */
  collide?: boolean;
  /** Eye height above the sprite's feet (fps). @default 1.6 */
  eyeHeight?: number;
  /** Fixed/orbit position: [x, y] in ground pixels plus height in world units. */
  position?: [number, number, number];
  /** Point to look at: [x, y] in ground pixels plus height in world units. */
  lookAt?: [number, number, number];
}

/** Keyboard movement for one sprite, relative to the camera. */
export interface ControllerDef {
  /** Sprite id or type to drive */
  sprite: string;
  /** Speed in pixels per second (same units as vx/vy). @default 96 */
  speed?: number;
  /** Sprint multiplier while Shift is held. @default 1.6 */
  sprint?: number;
  /** Jump height in world units (Space). 0 disables. @default 0 */
  jump?: number;
  /** What stops the player. Defaults to world.blockedBy. */
  blockedBy?: ('water' | 'steep' | 'buildings' | 'land')[];
  /** Steepest walkable slope as the minimum surface normal Y (1 flat, 0 wall). @default 0.65 */
  maxSlope?: number;
  /**
   * Vehicles and mounts: press `key` near a sprite of one of these types to take control of it.
   * Ships carry the rider below deck and steer like boats; any other type is a mount the rider sits
   * on, driven with the walking controls. Press again to step off (ships need land nearby).
   * @example { vehicles: ['cutter'], key: 'KeyF', range: 80 }
   */
  board?: {
    /** Sprite types that can be boarded. Ships carry the rider below deck; anything else is a mount the rider sits on. */
    vehicles: string[];
    /** @default 'KeyF' */
    key?: string;
    /** Pixels from the vehicle's edge. @default 64 */
    range?: number;
    /** Mounts: rider height above the mount's feet in world units. @default 45% of the mount's drawn height */
    seat?: number;
    /** Mounts: speed in pixels per second. @default 1.5x the controller speed */
    speed?: number;
  };
  /**
   * Attacking: on click (or `key`) the player plays its attack frames and a short-lived,
   * invisible hitbox sprite of type `spawn` appears in front of it. What a hit does is a
   * collision rule, like any other: '[enemy]:slash': { damage: 25, knockback: 90 }.
   * @example { spawn: 'slash', frames: [4, 1] }
   */
  attack?: AttackDef;
}

/** Melee attack for the controlled sprite. */
export interface AttackDef {
  /** Hitbox sprite type (no art needed). Write collision rules against it. */
  spawn: string;
  /** 'Click' (left click without dragging) or a KeyboardEvent.code. @default 'Click' */
  key?: string;
  /** Distance in pixels from the attacker's centre to the hitbox centre. @default 20 */
  reach?: number;
  /** Hitbox size in pixels. @default 28 */
  size?: number;
  /** Seconds the hitbox exists. @default 0.15 */
  duration?: number;
  /** Seconds between attacks. @default 0.4 */
  cooldown?: number;
  /** Attack animation in the attacker's sheet: [first column, frame count] */
  frames?: [number, number];
  /** Attack animation speed. @default 12 */
  fps?: number;
}

/**
 * Where a rule puts things. Named areas are read from the terrain:
 * - 'land': dry walkable ground
 * - 'flat': dry, nearly level ground (good for buildings)
 * - 'hills': high dry ground
 * - 'shore': water right next to land (boats waiting at the beach)
 * - 'sea': open water away from land
 * - [x, y]: an exact ground position in pixels
 */
export type WorldArea = 'land' | 'flat' | 'hills' | 'shore' | 'sea' | [number, number];

/** Placement rule shared by world.spawns and world.place. */
export interface PlacementRule {
  /** How many to place. @default 1 */
  count?: number;
  /** Area to place in. @default 'land' ('sea' for ships) */
  where?: WorldArea;
  /** Stay within `radius` of something placed earlier: a sprite type, a building name, or 'center'. */
  near?: string;
  /** Radius for `near` in pixels. @default 240 */
  radius?: number;
  /** Minimum gap in pixels between this and anything else placed. Relaxed if there's no room. @default 2 tiles */
  spacing?: number;
  /** Keep at least `awayDistance` from everything with this name (a sprite type, building or exit). Never relaxed. */
  awayFrom?: string;
  /** Pixels for awayFrom. @default 320 */
  awayDistance?: number;
}

/** Spawn rule: sprites of this type are created at game start. */
export interface SpawnRule extends PlacementRule {
  /** Heading in radians, or 'out' to face away from land (boats). @default random for ships, 0 otherwise */
  facing?: number | 'out';
  /**
   * Sprite properties applied to every sprite this rule creates.
   * @example { label: 'Boat', hpBarVisible: true, visualOffsetY: 9 }
   */
  with?: { [K in keyof Sprite]?: Sprite[K] };
}

/** A building part. Faces take material names from the built-in atlas or tile indices of `world.buildingAtlas`. */
export interface BuildingPart {
  type: 'box' | 'roof' | 'wedge';
  /** Offset from the building origin in world units [x, y, z]: the part's centre on x/z, its base on y */
  position: [number, number, number];
  /** Size in world units [width, height, depth] */
  size: [number, number, number];
  /**
   * Material per face. Box: north/south/east/west/top/bottom. Roof: slope1/slope2/gable1/gable2.
   * Wedge: slope/back/side1/side2/bottom. 'all' sets the default.
   */
  faces: Record<string, string | number>;
  /** Wedge only: the direction the ramp descends toward */
  direction?: 'north' | 'south' | 'east' | 'west';
}

/** glTF model declaration. Sprites of this type render as the model. */
export interface ModelDef {
  /** .glb or .gltf URL */
  src: string;
  /** @default 1 */
  scale?: number;
  /** Ground footprint in pixels for collisions [w, h]. @default one tile */
  footprint?: [number, number];
  /** Ride the waves when over water. @default false */
  floats?: boolean;
}

/**
 * Procedural ship. Sprites of this type render as the ship, float, and turn to face their velocity.
 * `sprite.rotation` is the heading in radians (0 faces +y on the ground, PI/2 faces +x).
 */
export interface ShipDef {
  /** Base hull: 'cutter', 'sloop', 'brig', 'frigate', 'galleon'. @default 'sloop' */
  preset?: 'cutter' | 'sloop' | 'brig' | 'frigate' | 'galleon';
  /** Overrides on the preset. */
  hullLength?: number;
  hullBeam?: number;
  hullDraft?: number;
  hullFreeboard?: number;
  bowSharpness?: number;
  sternWidth?: number;
  sternCastle?: number;
  foreCastle?: number;
  mastCount?: number;
  mastHeight?: number;
  sailsPerMast?: number[];
  cannonsPerSide?: number;
  bowsprit?: boolean;
  /** Surface colours or textures */
  colors?: { hull?: WorldTexture; deck?: WorldTexture; sail?: WorldTexture; trim?: WorldTexture };
  /** Turn rate in radians per second when changing heading. @default 1.5 */
  turnRate?: number;
}

/**
 * A static placement in the world. Exactly one of building/model.
 * Give an exact `at`, or rule fields (where, near, count...) and Glyft finds the spots.
 */
export interface PlacementDef extends PlacementRule {
  building?: string;
  model?: string;
  /** Exact ground position in pixels [x, y] */
  at?: [number, number];
  /** Rotation in radians. @default 0 */
  rotation?: number;
}

/** Built-in 3D prop kinds for world.scatter. */
export type PropKind = 'pine' | 'oak' | 'bush' | 'rock' | 'boulder' | 'stalagmite' | 'crystal' | 'mushroom' | 'grass';

/** Scatter rule: how many of a prop and where. Trees, rocks, boulders, stalagmites and crystals block movement. */
export interface ScatterRule extends PlacementRule {
  /** Random size range. @default [0.8, 1.25] */
  scale?: [number, number];
}

/** A building: its parts, plus an optional door (local [x, z] in world units) that exits can use. */
export interface BuildingDef {
  parts: BuildingPart[];
  /** Where the door is, relative to the building origin before rotation. Exits through this building start here. */
  door?: [number, number];
}

/** One area of the world: its own terrain, sky (or none), lighting, buildings, props and spawns. */
export interface AreaDef {
  /** Name shown when entering (world.areaLabel). @default the area key */
  label?: string;
  terrain?: TerrainDef;
  /** Sky and day/night, or false for underground (fixed lighting from `light`). */
  sky?: SkyDef | false;
  /** Fixed lighting when there is no sky: hex colours. @default dim cave light */
  light?: { ambient?: number; sun?: number; fog?: number };
  place?: PlacementDef[];
  /** Props by kind: one rule, or several (e.g. boulders on the hills and around a cave mouth) */
  scatter?: Partial<Record<PropKind, ScatterRule | ScatterRule[]>>;
  spawns?: Record<string, SpawnRule>;
}

/**
 * A way from one area to another. It sits at a building's door, an exact spot, or a spot found by rule,
 * and walking into it fades to the other area.
 */
export interface ExitDef extends PlacementRule {
  from: string;
  to: string;
  /** Name other exits can arrive at. @default '<from>-<to>' */
  name?: string;
  /** Use the door of this building (placed in the `from` area). */
  building?: string;
  /** Exact ground position in pixels. */
  at?: [number, number];
  /** Exit in the `to` area to arrive at. @default the exit there that leads back to `from` */
  arrive?: string;
  /** Trigger radius in pixels. @default 14 */
  trigger?: number;
}

/** The 3D world. */
export interface WorldConfig {
  /**
   * Several areas joined by exits. Without this, the top-level terrain, sky, place, scatter and
   * spawns form a single area.
   */
  areas?: Record<string, AreaDef>;
  /** Area to start in. @default the first area */
  start?: string;
  exits?: ExitDef[];
  /** Props for the single-area world (see areas for several). */
  scatter?: Partial<Record<PropKind, ScatterRule | ScatterRule[]>>;
  terrain?: TerrainDef;
  sky?: SkyDef;
  camera?: CameraDef;
  controller?: ControllerDef;
  /** Buildings by name: a list of parts, or { parts, door } when exits use the door. */
  buildings?: Record<string, BuildingPart[] | BuildingDef>;
  /** Custom building tile atlas (image URL) and its tile size in pixels. Defaults to the built-in material atlas. */
  buildingAtlas?: { src: string; tileSize: number };
  models?: Record<string, ModelDef>;
  ships?: Record<string, ShipDef>;
  /** Buildings and models, placed in order when the world loads (before spawns). */
  place?: PlacementDef[];
  /**
   * Sprites created at game start, keyed by sprite type, placed in order.
   * @example { hero: { near: 'tower', radius: 120 }, orc: { count: 6, where: 'hills' }, sloop: { where: 'sea' } }
   */
  spawns?: Record<string, SpawnRule>;
  /** What stops every moving sprite (AI, physics). Ships are always stopped by land. @default ['water', 'steep', 'buildings'] */
  blockedBy?: ('water' | 'steep' | 'buildings' | 'land')[];
  /** World units per sprite pixel for billboards. @default 1 / tileSize */
  spriteScale?: number;
  /** Wind direction in radians (sails, clouds). @default PI/4 */
  wind?: number;
}

/** Result of a world pick (screen to ground). */
export interface WorldHit {
  /** Ground position in pixels */
  x: number;
  y: number;
  /** Height in world units */
  height: number;
  /** True if the ray hit water before land */
  water: boolean;
}

/** Runtime access to the 3D world (null in 2D mode). */
export interface World {
  /** Time of day 0..1. Settable. */
  time: number;
  /** Wind direction in radians. Settable. */
  wind: number;
  /** Wave strength (0 flat, 1 normal, 3 storm). Settable. */
  waves: number;
  /** Ground height in world units at a ground-pixel position (terrain or roof). */
  heightAt(x: number, y: number): number;
  /** True if the ground-pixel position is under water. */
  isWater(x: number, y: number): boolean;
  /** Add a building or model at runtime (same shape as a world.place entry). */
  place(def: PlacementDef): void;
  /** Cast from a canvas pixel to the ground. Null when the ray misses. */
  pick(screenX: number, screenY: number): WorldHit | null;
  /** Camera yaw in radians (the direction 'forward' points for controllers). */
  readonly cameraYaw: number;
  /** Type of the vehicle the player is riding (controller.board), or null on foot. */
  readonly riding: string | null;
  /** Type of the vehicle close enough to board right now, or null. Use it for a "Press F" prompt. */
  readonly boardable: string | null;
  /** Find a ground spot matching a rule (null if none). Handy for respawns. */
  findSpot(rule: PlacementRule): [number, number] | null;
  /** Exits out of the current area (ground pixels), e.g. for a minimap. */
  readonly exits: { name: string; to: string; x: number; y: number }[];
  /** Current area key. */
  readonly area: string;
  /** Current area's display name. */
  readonly areaLabel: string;
  /** Travel to an area now (the player and anything they ride come along). */
  go(area: string, arrive?: string): void;
  /** Called after each area change with the new area key. */
  onAreaChange(callback: (area: string, label: string) => void): void;
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
   * Z layer for depth sorting.
   * Higher values render on top. Only used when depthSort is 'z' or 'zy'.
   * @default 0
   */
  z: number;

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

  /** Uniform scale factor (1.0 = normal size). Sets both scaleX and scaleY. */
  scale: number;

  /** Horizontal scale factor (1.0 = normal width) */
  scaleX: number;

  /** Vertical scale factor (1.0 = normal height) */
  scaleY: number;

  /** Opacity from 0 (invisible) to 1 (opaque) */
  alpha: number;

  /**
   * Tint color as 0xRRGGBB hex.
   * @example 0xFFFFFF (white/no tint), 0xFF0000 (red), 0x00FF00 (green)
   */
  tint: number;

  /** Number of idle animation frames (default: 1) */
  idleFrames: number;

  /** Number of walk animation frames (default: 4) */
  walkFrames: number;

  /**
   * Row offset added to direction for state-based animation switching.
   * Use this to switch between animation states (e.g., normal vs swimming).
   * @example rowOffset = 4 shifts from rows 0-3 to rows 4-7
   */
  rowOffset: number;

  /** Flip sprite horizontally */
  flipX: boolean;

  /** Flip sprite vertically */
  flipY: boolean;

  /** Bob amplitude in pixels (0 = off). GPU-driven sinusoidal Y oscillation. */
  bob: number;

  /** Bob frequency in Hz (default 1.5). */
  bobSpeed: number;

  /** 3D mode: height above the ground in world units (jumps, flying). @default 0 */
  elevation: number;

  /** 3D mode: ride the waves when over water. @default false (true for ships) */
  floats: boolean;

  /**
   * Enable velocity-based movement. When true, Glyft updates x/y from vx/vy each frame.
   * Use this for sprites that move continuously (enemies, projectiles).
   * @default false
   */
  physics: boolean;

  /**
   * Enable automatic horizontal flip based on vx direction.
   * When true and vx !== 0, flipX is set automatically (left = flipped).
   * Use for side-profile sprites that should face their movement direction.
   * @default false
   */
  autoFlip: boolean;

  /**
   * Per-sprite mode override. Set to override the global spriteMode for this sprite.
   * @default null (uses global config)
   */
  spriteMode: '4dir' | '8dir' | '2dir-side' | '2dir-top' | '1dir' | 'iso4' | 'iso8' | null;

  /** Render a dark ellipse shadow at sprite base position. */
  shadow: boolean;

  /**
   * Vertical offset for shadow position in pixels.
   * Use negative values to move shadow up (closer to sprite), positive to move down.
   * Useful when sprite artwork has feet not at the bottom of the frame.
   * @default 0
   */
  shadowOffsetY: number;

  /**
   * Visual Y offset for rendering. Moves sprite down (positive) or up (negative)
   * without affecting collision/logical position. Use to align sprite with shadow.
   * @default 0
   */
  visualOffsetY: number;

  /**
   * Shadow scale multiplier (0.0-2.0).
   * Controls shadow size relative to sprite. 1.0 = normal, 0.5 = half size.
   * Useful for elevation effects - smaller shadow when sprite is higher.
   * @default 1.0
   */
  shadowScale: number;

  /**
   * Shadow opacity (0.0-1.0).
   * Controls shadow darkness. 1.0 = full opacity, 0.0 = invisible.
   * Useful for elevation effects - lighter shadow when sprite is higher.
   * @default 0.5
   */
  shadowAlpha: number;

  /**
   * Glow intensity from 0 (off) to 1 (full).
   * GPU-driven additive glow rendered behind the sprite.
   */
  glow: number;

  /**
   * Glow color as 0xRRGGBB hex. Defaults to sprite tint if not set.
   * @example 0xFF0000 (red glow), 0x00FFFF (cyan glow)
   */
  glowColor: number | null;

  /**
   * Glow radius multiplier (default 1.5).
   * Controls how far the glow extends beyond sprite bounds.
   */
  glowRadius: number;

  /**
   * Clip bottom portion of sprite (0.0-1.0).
   * 0.0 = no clipping, 0.5 = hide bottom half, 1.0 = fully hidden.
   * Useful for wading in water, sinking, etc.
   */
  clipBottom: number;

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

  /** HP bar fill value 0.0-1.0 (fraction of max HP). */
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
   * Set the sprite's facing direction explicitly.
   * Accepts a direction string ('down', 'right', 'up', 'left') or angle in radians.
   * Use this when you need to face a target without moving (e.g., attacking while stationary).
   */
  setFacing(direction: Direction | number): void;

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
  fill(x: number, y: number, w: number, h: number, tileIndex: number, animFrames?: number): void;
  /** Set animation frame count for a tile (0 = static, N = cycle through N consecutive tiles) */
  setAnim(x: number, y: number, animFrames: number): void;
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
  /** Update viewport dimensions (for dynamic resize) */
  setViewport(width: number, height: number): void;
  /** Get current viewport dimensions */
  getViewport(): [number, number];
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
  /** Current frames per second (updated every 500ms) */
  readonly fps: number;
  /** Average time per frame in milliseconds */
  readonly frameTime: number;
  /** Total number of active sprites */
  readonly spriteCount: number;
  /** Screen-space overlay for HUD/UI. Lazily initialized, cleared each frame. */
  readonly overlay: CanvasRenderingContext2D;
  /** The 3D world (settings.mode '3d'), or null in 2D. */
  readonly world: World | null;
  /** Resolves when the 3D world has loaded (immediately in 2D). */
  readonly ready: Promise<void>;

  /**
   * Set a static background image that covers the world bounds.
   * The camera viewport scrolls over this background.
   *
   * @param url - URL to the background image
   * @param worldWidth - Width of the world in pixels
   * @param worldHeight - Height of the world in pixels
   */
  setBackground(url: string, worldWidth: number, worldHeight: number): Promise<void>;

  /** Clear the background image */
  clearBackground(): void;

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
  /** Start the loop. In 3D, waits for the world and creates world.spawns first. */
  start(): Promise<void>;
  /** Pause game loop */
  pause(): void;
  /** Resume game loop */
  resume(): void;
  /** Reload config (hot reload) */
  reloadConfig(config: Partial<GlyftConfig>): void;

  /** Register an addon to extend engine functionality */
  use(addon: GlyftAddon): this;

  /** Get a registered addon by name */
  addon<T extends GlyftAddon>(name: string): T | undefined;

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
