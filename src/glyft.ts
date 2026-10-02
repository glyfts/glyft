/**
 * Main Glyft engine class.
 */

import type {
  GlyftConfig,
  Sprite,
  Atlas,
  TileMap,
  Camera,
  Input,
  Stats,
  SoundRule,
  MusicTrack,
  CollisionAction,
  AnimationDef,
  SpritePointerEvent,
} from './types';

import {
  createContext,
  compileShader,
  loadTexture,
  createDataTexture,
  createBuffer,
  createVAO,
  resizeCanvas,
  GlyftError,
  type ShaderProgram,
} from './renderer';

import { spriteVertexShader, spriteFragmentShader } from './shaders/sprite';
import { tilemapVertexShader, tilemapFragmentShader } from './shaders/tilemap';
import { createSoundManager, type SoundManager } from './sounds';
import { createCollisionSystem, applyCollisionAction, type CollisionSystem, type SpriteData } from './collision';
import { createMusicManager, type MusicManager } from './music';
import { CameraImpl } from './camera';
import { InputImpl } from './input';
import { TweenManager, type TweenProps, type TweenOptions } from './tween';
import { createFloatTextManager, generateFontAtlas, packColorF32, type FloatTextManager, type FontAtlas } from './floattext';
import { createLabelManager, type LabelManager, type LabelSpriteData } from './labels';
import { createHpBarManager, type HpBarManager } from './hpbars';
import { createParticleManager, type ParticleManager } from './particles';
import { createArcEffectManager, type ArcEffectManager, type ArcEffectDef, type ArcEmitOptions } from './arcs';
import { createRingEffectManager, type RingEffectManager, type RingEffectDef, type RingEmitOptions } from './rings';
import { createDomTextManager, type DomTextManager } from './domtext';
import { overlayVertexShader, overlayFragmentShader } from './shaders/overlay';
import { backgroundVertexShader, backgroundFragmentShader } from './shaders/background';
import { createWorldSystem, type WorldSystem } from './world3d';
import { drawStarterAtlas } from './starter-art';

// -----------------------------------------------------------------------------
// Internal Types
// -----------------------------------------------------------------------------

interface InternalSprite {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;  // Layer depth for sorting (higher = on top)
  vx: number;
  vy: number;
  rotation: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  tint: number;
  flipX: boolean;
  flipY: boolean;
  tags: string[];
  data: Record<string, unknown>;
  hp?: number;
  sounds: boolean;
  interactive: boolean;
  hitbox: { x: number; y: number; w: number; h: number } | null;
  bob: number;
  bobSpeed: number;
  shadow: boolean;
  // Velocity-based movement: Glyft updates x/y from vx/vy each frame
  physics: boolean;
  // Auto-flip: set flipX based on vx direction (for side-profile sprites)
  autoFlip: boolean;
  // Per-sprite mode override (null = use global config)
  spriteMode: '4dir' | '8dir' | '2dir-side' | '2dir-top' | '1dir' | 'iso4' | 'iso8' | null;
  shadowOffsetY: number;
  visualOffsetY: number;
  shadowScale: number;
  shadowAlpha: number;
  glow: number;
  glowColor: number | null;
  glowRadius: number;
  clipBottom: number;  // 0.0-1.0: clip bottom portion of sprite (for wading in water)
  elevation: number;  // 3D: height above ground in world units
  floats: boolean;    // 3D: ride the waves
  atlas: InternalAtlas;
  exists: boolean;
  // Named animation registry
  animations: Map<string, AnimationDef>;
  // Animation state
  animOverride: string | null;
  animStartTime: number;
  animLoop: boolean;
  animOnComplete: (() => void) | null;
  animOnFrame: ((frame: number) => void) | null;
  animCurrentFrame: number;
  lastDirection: number;
  rowOffset: number;  // Added to direction for state-based row switching (e.g., swimming = +4)
  // Animation config
  idleFrames: number;
  walkFrames: number;
  fps: number;
  // Frame data
  frameX: number;
  frameY: number;
  frameW: number;
  frameH: number;
  // Label
  labelText: string | null;
  labelColor: number;
  labelVisible: string;
  labelRange: number;
  labelSlot: number;
  labelIcon: string | null;
  labelIconColor: number;
  hpBarVisible: boolean;
  hpBarValue: number;
  hpBarWidth: number;
  hpBarColor: 'auto' | number;
  hpBarBgColor: number;
  // Pointer event listeners (lazily allocated)
  _listeners: Record<string, ((e: SpritePointerEvent) => void)[]> | null;
}

interface InternalAtlas {
  name: string;
  texture: WebGLTexture;
  width: number;
  height: number;
  frames: Map<string, { x: number; y: number; w: number; h: number }>;
  tags: Map<string, number[]>;
}

interface InternalTileMap {
  width: number;
  height: number;
  layer: number;
  atlas: InternalAtlas;
  dataTexture: WebGLTexture;
  data: Uint8Array;
  dirty: boolean;
}

// -----------------------------------------------------------------------------
// Glyft Engine
// -----------------------------------------------------------------------------

export class GlyftEngine {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly config: GlyftConfig;

  private _time = 0;
  private _dt = 0;
  private _running = false;
  private _lastFrameTime = 0;
  private _updateCallbacks: ((dt: number) => void)[] = [];
  private _postRenderCallbacks: ((dt: number) => void)[] = [];

  // Rendering
  private _spriteShader!: ShaderProgram;  // TODO: use for sprite rendering
  private _tilemapShader!: ShaderProgram;
  private _quadVAO!: WebGLVertexArrayObject;
  private _quadBuffer!: WebGLBuffer;
  private _spriteVAO!: WebGLVertexArrayObject;
  private _spriteInstanceBuffer!: WebGLBuffer;  // TODO: use for sprite rendering

  // Game objects
  private _sprites: Map<string, InternalSprite> = new Map();
  private _tilemaps: InternalTileMap[] = [];
  private _atlases: Map<string, InternalAtlas> = new Map();
  private _nextSpriteId = 0;

  // Systems
  private _camera: CameraImpl;
  private _input: InputImpl;
  private _stats: Record<string, number> = {};
  private _soundManager: SoundManager;
  private _musicManager: MusicManager;
  private _collisionSystem: CollisionSystem | null = null;
  private _tweenManager: TweenManager = new TweenManager();
  private _fontAtlas!: FontAtlas;
  private _floatTextManager!: FloatTextManager;
  private _labelManager!: LabelManager;
  private _hpBarManager!: HpBarManager;
  private _particleManager!: ParticleManager;
  private _arcManager!: ArcEffectManager;
  private _ringManager!: RingEffectManager;
  private _domTextManager: DomTextManager | null = null;

  // Overlay (lazy init — only created when game.overlay is accessed)
  private _overlayCanvas: HTMLCanvasElement | null = null;
  private _overlayCtx: CanvasRenderingContext2D | null = null;
  private _overlayTexture: WebGLTexture | null = null;
  private _overlayShader: ShaderProgram | null = null;
  private _overlayActive = false;

  // Background image (static, scrolls with camera)
  private _bgTexture: WebGLTexture | null = null;
  private _bgWorldWidth = 0;
  private _bgWorldHeight = 0;
  private _bgShader: ShaderProgram | null = null;

  // Depth sorting
  private _sortedSpriteCache: InternalSprite[] = [];
  private _sortedIds = new Set<string>();

  // FPS tracking
  private _fpsFrameCount = 0;
  private _fpsLastTime = 0;
  private _fps = 0;
  private _frameTime = 0;

  // Reactive rules
  private _soundRules: Map<string, SoundRule | string> = new Map();
  private _collisionRules: Map<string, CollisionAction | string> = new Map();
  private _collisionCallbacks: Map<string, ((a: Sprite, b: Sprite) => void)[]> = new Map();

  // Pointer events
  private _hoveredSprite: InternalSprite | null = null;
  private _gameListeners: Record<string, ((e: SpritePointerEvent) => void)[]> = {};

  // Magnetize system
  private _magnetizeRules: { tagA: string; tagB: string; range: number; speed: number }[] = [];
  private _magnetizeGroupA: InternalSprite[] = [];
  private _magnetizeGroupB: InternalSprite[] = [];

  // Sound timing (for intervals and cooldowns)
  private _soundLastPlayed: Map<string, number> = new Map(); // pattern -> last time

  // Addon system
  private _addons: import('./types').GlyftAddon[] = [];

  // 3D world (settings.mode '3d')
  private _world: WorldSystem | null = null;
  private _worldLoad: Promise<void> | null = null;
  private _labelScreen = new Map<string, LabelSpriteData>();

  /**
   * Create a new Glyft game engine instance.
   *
   * @param canvas - The HTML canvas element to render to
   * @param config - Game configuration (settings, sounds, collisions, etc.)
   * @throws {GlyftError} If canvas or config is invalid
   *
   * @example
   * ```typescript
   * const config: GlyftConfig = {
   *   settings: {
   *     tileSize: 16,
   *     viewport: [320, 240],
   *     spriteMode: '4dir',
   *   }
   * };
   * const game = new Glyft(canvas, config);
   * ```
   */
  constructor(canvas: HTMLCanvasElement, config: GlyftConfig) {
    // Validate config
    this._validateConfig(config);

    this.canvas = canvas;
    this.config = config;

    // A canvas with no CSS size displays at its attribute size, which would grow with the
    // render scale. Pin it to the viewport so 'auto' pixelRatio has a stable size to fill.
    if (!canvas.style.width && !canvas.style.height && canvas.clientWidth === canvas.width && canvas.clientHeight === canvas.height) {
      canvas.style.width = `${config.settings.viewport[0]}px`;
      canvas.style.height = `${config.settings.viewport[1]}px`;
    }

    // Initialize WebGL
    this.gl = createContext(canvas, { depth: config.settings.depth || config.settings.mode === '3d', alpha: config.settings.alpha });
    this._initShaders();
    this._initBuffers();

    // Initialize systems
    this._camera = new CameraImpl(config.settings.viewport, this._sprites);
    this._input = new InputImpl(canvas, config.settings.viewport[0], config.settings.viewport[1]);
    this._soundManager = createSoundManager(config.settings.viewport[0]);
    this._musicManager = createMusicManager();
    this._fontAtlas = generateFontAtlas(this.gl);
    this._floatTextManager = createFloatTextManager(this.gl, this._fontAtlas);
    this._labelManager = createLabelManager(this.gl, this._fontAtlas);
    this._hpBarManager = createHpBarManager(this.gl, this._labelManager.getPositionTexture());
    this._particleManager = createParticleManager(this.gl);
    this._arcManager = createArcEffectManager(this.gl);
    this._ringManager = createRingEffectManager(this.gl);

    // Pointer event dispatch (click → sprite callbacks + game-level event)
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // Primary button only
      const ground = this._pointerWorld();
      if (!ground) return;
      const [worldX, worldY] = ground;

      const hit = this._getTopSpriteAtPoint(worldX, worldY);
      if (hit) {
        this._fireSpriteEvent(hit, 'pointerdown', worldX, worldY);
      }

      // Fire game-level pointerdown
      const listeners = this._gameListeners['pointerdown'];
      if (listeners) {
        const ge: SpritePointerEvent = {
          sprite: hit ? this._createSpriteProxy(hit) : null,
          worldX,
          worldY,
        };
        for (const cb of listeners) cb(ge);
      }
    });

    // Clear hover state when pointer leaves canvas
    canvas.addEventListener('pointerleave', () => {
      if (this._hoveredSprite && this._hoveredSprite.exists) {
        const ground = this._pointerWorld() ?? [0, 0];
        this._fireSpriteEvent(this._hoveredSprite, 'pointerout', ground[0], ground[1]);
      }
      this._hoveredSprite = null;
    });

    // Initialize stats from config
    if (config.stats) {
      for (const [name, def] of Object.entries(config.stats)) {
        this._stats[name] = def.default;
      }
    }

    // Load sfx definitions from config
    if (config.sfx) {
      this._soundManager.defineSfx(config.sfx);
    }

    // Load reactive rules from config
    if (config.sounds) {
      this._soundManager.define(config.sounds);
      for (const [pattern, rule] of Object.entries(config.sounds)) {
        this._soundRules.set(pattern, rule);
      }
    }
    if (config.collisions) {
      for (const [pattern, rule] of Object.entries(config.collisions)) {
        this._collisionRules.set(pattern, rule);
      }
      this._collisionSystem = createCollisionSystem(this._collisionRules);
      this._parseMagnetizeRules();
    }
    if (config.music) {
      this._musicManager.define(config.music);
    }
    if (config.particles) {
      for (const [name, def] of Object.entries(config.particles)) {
        this._particleManager.define(name, def);
      }
    }

    // Set initial clear color
    const bg = config.settings.backgroundColor ?? 0x000000;
    const r = ((bg >> 16) & 0xff) / 255;
    const g = ((bg >> 8) & 0xff) / 255;
    const b = (bg & 0xff) / 255;
    this.gl.clearColor(r, g, b, config.settings.alpha ? 0 : 1);

    // Enable blending for sprite transparency
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    // 3D world: built from config.world, loads its assets in the background
    if (config.settings.mode === '3d') {
      const mode = config.settings.spriteMode;
      const bbMode = mode === '8dir' ? '8dir' : mode === '1dir' ? '1dir' : '4dir';
      this._world = createWorldSystem(this.gl, canvas, config.world ?? {}, config.settings.tileSize, bbMode);
      this._registerWorldAtlas();
      this._world.setHooks({
        spawn: (type, cx, cy) => {
          const sprite = this.spawn(type, 0, 0);
          sprite.physics = false; // placed by the world each frame, never blocked
          sprite.x = cx - sprite.width / 2;
          sprite.y = cy - sprite.height / 2;
          return sprite.id;
        },
        destroy: (id) => this.getById(id)?.destroy(),
        // Sprites in other areas leave the live set (no physics, collisions, AI targets or drawing)
        stash: (ids) => {
          for (const id of ids) {
            const sprite = this._sprites.get(id);
            if (!sprite) continue;
            this._sprites.delete(id);
            this._stashed.set(id, sprite);
          }
        },
        unstash: (ids) => {
          for (const id of ids) {
            const sprite = this._stashed.get(id);
            if (!sprite) continue;
            this._stashed.delete(id);
            if (sprite.exists) this._sprites.set(id, sprite);
          }
        },
      });
      this._worldLoad = this._world.load();
      this._worldLoad.catch((err) => console.error('[Glyft] World failed to load:', err));
    }
  }

  /** Sprites waiting in areas the player isn't in */
  private _stashed = new Map<string, InternalSprite>();

  /** Backing pixels per viewport pixel (see settings.pixelRatio). */
  private _renderScale = 1;

  private _computeRenderScale(): number {
    const setting = this.config.settings.pixelRatio ?? 'auto';
    if (typeof setting === 'number') return Math.max(0.25, setting);
    const [vw, vh] = this.config.settings.viewport;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return 1;
    const dpr = window.devicePixelRatio || 1;
    const raw = Math.min((w * dpr) / vw, (h * dpr) / vh);
    // 2D keeps whole-number steps so every sprite pixel is the same size; 3D has no pixel grid
    const scale = this._world ? raw : Math.floor(raw);
    return Math.min(8, Math.max(1, scale));
  }

  /** Ships and models are sprites too: give them atlas frames sized to their footprint. */
  private _registerWorldAtlas(): void {
    const world = this._world!;
    const attack = this.config.world?.controller?.attack?.spawn;
    const types = [
      ...Object.keys(this.config.world?.ships ?? {}),
      ...Object.keys(this.config.world?.models ?? {}),
      ...(attack ? [attack] : []),
    ];
    if (types.length === 0) return;
    const texture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    const frames = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const type of types) {
      const [w, h] = world.footprintOf(type)!;
      frames.set(type, { x: 0, y: 0, w, h });
    }
    this._atlases.set('__world', { name: '__world', texture, width: 1, height: 1, frames, tags: new Map() });
  }

  /** Pointer position on the ground in world pixels (2D: screen + camera, 3D: terrain raycast). */
  private _pointerWorld(): [number, number] | null {
    const pointer = this._input.pointer;
    if (!this._world) return [pointer.x + this._camera.x, pointer.y + this._camera.y];
    const [vw, vh] = this.config.settings.viewport;
    const sx = (pointer.x / vw) * this.canvas.width;
    const sy = (pointer.y / vh) * this.canvas.height;
    const hit = this._world.pick(sx, sy);
    return hit ? [hit.x, hit.y] : null;
  }

  /** Effect anchor: world pixels in 2D, projected viewport pixels in 3D. */
  private _fx(x: number, y: number): [number, number] {
    if (!this._world) return [x, y];
    const p = this._world.project(x, y, this._world.surfaceAt(x, y) + 1);
    if (!p) return [-10000, -10000];
    const [vw, vh] = this.config.settings.viewport;
    return [(p[0] / this.canvas.width) * vw, (p[1] / this.canvas.height) * vh];
  }

  /** The 3D world, or null in 2D mode. */
  get world(): import('./types').World | null {
    return this._world;
  }

  /** Resolves when the 3D world has loaded (immediately in 2D). Place sprites on terrain after this. */
  get ready(): Promise<void> {
    return this._worldLoad ?? Promise.resolve();
  }

  // ---------------------------------------------------------------------------
  // Config Validation
  // ---------------------------------------------------------------------------

  private _validateConfig(config: GlyftConfig): void {
    if (!config) {
      throw new GlyftError(
        'Config is required',
        'Pass a GlyftConfig object as the second argument.\n\n' +
        'Minimal example:\n' +
        'new Glyft(canvas, {\n' +
        '  settings: { tileSize: 16, viewport: [320, 240] }\n' +
        '});'
      );
    }

    if (!config.settings) {
      throw new GlyftError(
        'Config.settings is required',
        'The config must include a settings object.\n\n' +
        'Example:\n' +
        'settings: {\n' +
        '  tileSize: 16,     // 8, 16, 32, or 64\n' +
        '  viewport: [320, 240],\n' +
        '  spriteMode: "4dir"  // optional\n' +
        '}'
      );
    }

    const { settings } = config;

    if (config.world && settings.mode !== '3d') {
      throw new GlyftError(
        'config.world needs 3D mode',
        "Add mode: '3d' to settings:\n\nsettings: { tileSize: 16, viewport: [960, 540], mode: '3d' }"
      );
    }

    // Validate tileSize
    const validTileSizes = [8, 16, 32, 64];
    if (!validTileSizes.includes(settings.tileSize)) {
      throw new GlyftError(
        `Invalid tileSize: ${settings.tileSize}`,
        `tileSize must be a power of 2: ${validTileSizes.join(', ')}\n\n` +
        'This ensures optimal GPU texture alignment.\n' +
        'Example: settings: { tileSize: 16, ... }'
      );
    }

    // Validate viewport
    if (!settings.viewport || !Array.isArray(settings.viewport) || settings.viewport.length !== 2) {
      throw new GlyftError(
        'Invalid viewport setting',
        'viewport must be a [width, height] tuple.\n\n' +
        'Example: settings: { viewport: [320, 240], ... }'
      );
    }

    if (settings.viewport[0] <= 0 || settings.viewport[1] <= 0) {
      throw new GlyftError(
        `Invalid viewport dimensions: [${settings.viewport[0]}, ${settings.viewport[1]}]`,
        'Viewport width and height must be positive.\n\n' +
        'Common viewport sizes:\n' +
        '- [320, 240] - Classic (4:3, good for pixel art)\n' +
        '- [384, 216] - 16:9 widescreen\n' +
        '- [256, 144] - Very retro'
      );
    }

    // Validate spriteMode
    const validSpriteModes = ['4dir', '8dir', '2dir-side', '2dir-top', '1dir', 'iso4', 'iso8'];
    if (settings.spriteMode && !validSpriteModes.includes(settings.spriteMode)) {
      throw new GlyftError(
        `Invalid spriteMode: "${settings.spriteMode}"`,
        `spriteMode must be one of: ${validSpriteModes.join(', ')}\n\n` +
        'Common modes:\n' +
        '- "4dir" - Down/Right/Up/Left (RPG style)\n' +
        '- "2dir-side" - Left/Right with flip (platformer)\n' +
        '- "1dir" - Single direction (top-down shooter)'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get time(): number {
    return this._time;
  }

  get dt(): number {
    return this._dt;
  }

  get camera(): Camera {
    return this._camera;
  }

  get input(): Input {
    return this._input;
  }

  get stats(): Stats {
    return this._stats;
  }

  /** Current frames per second (updated every 500ms) */
  get fps(): number {
    return this._fps;
  }

  /** Average time per frame in milliseconds */
  get frameTime(): number {
    return this._frameTime;
  }

  /** Total number of active sprites */
  get spriteCount(): number {
    return this._sprites.size;
  }

  get overlay(): CanvasRenderingContext2D {
    if (!this._overlayCtx) this._initOverlay();
    return this._overlayCtx!;
  }

  /**
   * Get current viewport dimensions.
   */
  get viewport(): [number, number] {
    return this.config.settings.viewport;
  }

  /**
   * Update viewport dimensions at runtime.
   * Use this when the game canvas needs to show more or less area
   * (e.g., switching between portrait and landscape orientation).
   */
  setViewport(width: number, height: number): void {
    // Update config
    this.config.settings.viewport = [width, height];

    // Update camera
    this._camera.setViewport(width, height);

    // Update input scaling
    this._input.setViewport(width, height);

    // Update sound manager for stereo panning
    this._soundManager.setViewportWidth(width);

    // Re-initialize overlay canvas with new dimensions
    this._initOverlay();
  }

  // ---------------------------------------------------------------------------
  // Asset Loading
  // ---------------------------------------------------------------------------

  /**
   * Create the built-in starter atlas: real tiles and sprites, no image files.
   *
   * Tiles (frames tile_0, tile_1, ...): 0 sky, 1 grass, 2 stone wall, 3 bush, 4 tree,
   * 5 stone floor, 6 dungeon wall, 7 crate, 8 sand, 9 void, 10 water, 11 rock,
   * 12 dirt path, 13 boulder, 14 lava, 15 planks (higher indices repeat with variation).
   *
   * Sprites (4 directions x 5 frames, velocity-animated): player, slime, npc, coin,
   * key, heart, projectile, bullet, ship, drone, star.
   *
   * @example
   * const atlas = game.createTestAtlas('starter', 16, 16);
   * game.createMap(atlas, 20, 15).fill(0, 0, 20, 15, 1); // grass
   * game.createSprite(atlas, 'slime');
   */
  createTestAtlas(name: string, tilesX: number, tilesY: number): Atlas {
    const tileSize = this.config.settings.tileSize;
    const { canvas, frames: spriteFrames } = drawStarterAtlas(tileSize, tilesX, tilesY);
    const width = canvas.width;
    const height = canvas.height;

    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const atlas: InternalAtlas = {
      name,
      texture,
      width,
      height,
      frames: new Map(),
      tags: new Map(),
    };

    // Create frame entries for each tile
    for (let y = 0; y < tilesY; y++) {
      for (let x = 0; x < tilesX; x++) {
        const idx = x + y * tilesX;
        atlas.frames.set(`tile_${idx}`, {
          x: x * tileSize,
          y: y * tileSize,
          w: tileSize,
          h: tileSize,
        });
      }
    }

    // Sprite frames: player, slime, npc, coin, key, heart, projectile, bullet, ship, drone, star
    for (const [frameName, frame] of spriteFrames) atlas.frames.set(frameName, frame);

    this._atlases.set(name, atlas);
    return this._createAtlasProxy(atlas);
  }

  /**
   * Load a texture atlas from an image file and JSON data.
   *
   * @param imagePath - Path to the atlas image (PNG recommended)
   * @param dataPath - Path to JSON atlas data, or the data object directly
   * @returns Promise resolving to the loaded Atlas
   * @throws {GlyftError} If image or data fails to load
   *
   * @example
   * ```typescript
   * // Load from files
   * const atlas = await game.loadAtlas('sprites.png', 'sprites.json');
   *
   * // Or pass data object directly
   * const atlas = await game.loadAtlas('tiles.png', {
   *   frames: { grass: { x: 0, y: 0, w: 16, h: 16 } }
   * });
   * ```
   */
  async loadAtlas(imagePath: string, dataPath: string | object): Promise<Atlas> {
    const texture = await loadTexture(this.gl, imagePath);

    // Load or parse atlas data
    let data: Record<string, unknown>;
    if (typeof dataPath === 'string') {
      try {
        const response = await fetch(dataPath);
        if (!response.ok) {
          throw new GlyftError(
            `Failed to load atlas data: ${dataPath} (HTTP ${response.status})`,
            `Make sure the JSON file exists at: ${dataPath}\n\n` +
            'Common causes:\n' +
            '- File path is incorrect\n' +
            '- File server is not serving the directory\n' +
            '- JSON file has a different name than expected'
          );
        }
        data = await response.json();
      } catch (e) {
        if (e instanceof GlyftError) throw e;
        throw new GlyftError(
          `Failed to parse atlas JSON: ${dataPath}`,
          `The file was found but contains invalid JSON.\n\n` +
          `Error: ${e instanceof Error ? e.message : String(e)}\n\n` +
          'Make sure the JSON file is valid (no trailing commas, proper quotes).'
        );
      }
    } else {
      data = dataPath as Record<string, unknown>;
    }

    // Extract image dimensions
    const image = new Image();
    image.src = imagePath;
    await new Promise(r => (image.onload = r));

    const atlas: InternalAtlas = {
      name: imagePath,
      texture,
      width: image.width,
      height: image.height,
      frames: new Map(),
      tags: new Map(),
    };

    // Parse frames (support multiple formats)
    const frames = (data.frames as Record<string, unknown>) || data;
    for (const [name, frameData] of Object.entries(frames)) {
      const f = frameData as { x?: number; y?: number; w?: number; h?: number; frame?: { x: number; y: number; w: number; h: number } };
      if (f.frame) {
        // TexturePacker format
        atlas.frames.set(name, f.frame);
      } else if (f.x !== undefined) {
        // Simple format
        atlas.frames.set(name, { x: f.x!, y: f.y!, w: f.w!, h: f.h! });
      }
    }

    // Parse tags if present
    if (data.tags) {
      for (const [tag, indices] of Object.entries(data.tags as Record<string, number[]>)) {
        atlas.tags.set(tag, indices);
      }
    }

    this._atlases.set(imagePath, atlas);

    return this._createAtlasProxy(atlas);
  }

  /**
   * Set a static background image that covers the world bounds.
   * The camera viewport scrolls over this background.
   */
  async setBackground(url: string, worldWidth: number, worldHeight: number): Promise<void> {
    const gl = this.gl;
    const texture = await loadTexture(gl, url);

    // Use LINEAR filtering for smooth background scrolling
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this._bgTexture = texture;
    this._bgWorldWidth = worldWidth;
    this._bgWorldHeight = worldHeight;

    // Compile shader lazily
    if (!this._bgShader) {
      this._bgShader = compileShader(
        gl,
        backgroundVertexShader,
        backgroundFragmentShader,
        ['u_viewport', 'u_worldSize', 'u_camera', 'u_texture'],
        ['a_position'],
      );
    }
  }

  /**
   * Clear the background image.
   */
  clearBackground(): void {
    if (this._bgTexture) {
      this.gl.deleteTexture(this._bgTexture);
      this._bgTexture = null;
    }
    this._bgWorldWidth = 0;
    this._bgWorldHeight = 0;
  }

  /**
   * Load a single image as a texture atlas.
   * If frameWidth/frameHeight are provided, the image is split into a grid of frames.
   * Otherwise, the entire image is a single frame named after the key.
   *
   * @param key - Unique name for this texture
   * @param url - URL to the image file
   * @param options - Frame dimensions for spritesheets
   * @returns Promise resolving to the loaded Atlas
   *
   * @example
   * ```typescript
   * // Load a single image (1 frame)
   * const npcAtlas = await game.loadTexture('blacksmith', '/assets/npcs/blacksmith.png');
   *
   * // Load a spritesheet (multiple frames in a grid)
   * const heroAtlas = await game.loadTexture('hero', '/assets/hero.png', {
   *   frameWidth: 96,
   *   frameHeight: 96,
   * });
   * ```
   */
  async loadTexture(key: string, url: string, options?: { frameWidth?: number; frameHeight?: number; filter?: 'nearest' | 'linear' }): Promise<Atlas> {
    const texture = await loadTexture(this.gl, url, { filter: options?.filter });

    // Get image dimensions
    const image = new Image();
    image.src = url;
    await new Promise(r => (image.onload = r));

    const atlas: InternalAtlas = {
      name: key,
      texture,
      width: image.width,
      height: image.height,
      frames: new Map(),
      tags: new Map(),
    };

    const fw = options?.frameWidth ?? image.width;
    const fh = options?.frameHeight ?? image.height;
    const cols = Math.floor(image.width / fw);
    const rows = Math.floor(image.height / fh);

    if (cols === 1 && rows === 1) {
      // Single frame - use the key as the frame name
      atlas.frames.set(key, { x: 0, y: 0, w: fw, h: fh });
    } else {
      // Grid of frames - name as key_row_col and key (default = first frame)
      atlas.frames.set(key, { x: 0, y: 0, w: fw, h: fh });
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          atlas.frames.set(`${key}_${row}_${col}`, {
            x: col * fw,
            y: row * fh,
            w: fw,
            h: fh,
          });
        }
      }
    }

    this._atlases.set(key, atlas);
    return this._createAtlasProxy(atlas);
  }

  private _createAtlasProxy(atlas: InternalAtlas): Atlas {
    return {
      get name() { return atlas.name; },
      get texture() { return atlas.texture; },
      get width() { return atlas.width; },
      get height() { return atlas.height; },
      index(name: string): number {
        // For simple tilesets, return numeric index
        const frame = atlas.frames.get(name);
        if (!frame) {
          console.warn(`Frame '${name}' not found in atlas '${atlas.name}'`);
          return 0;
        }
        // Calculate tile index from position
        const tileSize = 16; // TODO: get from config
        return Math.floor(frame.y / tileSize) * Math.floor(atlas.width / tileSize) + Math.floor(frame.x / tileSize);
      },
      frame(name: string) {
        const frame = atlas.frames.get(name);
        if (!frame) {
          console.warn(`Frame '${name}' not found in atlas '${atlas.name}'`);
          return { x: 0, y: 0, w: 16, h: 16 };
        }
        return frame;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Tilemap
  // ---------------------------------------------------------------------------

  /**
   * Create a tilemap using the specified atlas.
   *
   * @param atlas - Texture atlas containing tile graphics
   * @param width - Map width in tiles
   * @param height - Map height in tiles
   * @param options - Optional settings (layer index)
   * @returns The created TileMap
   * @throws {GlyftError} If atlas is invalid or dimensions are invalid
   *
   * @example
   * ```typescript
   * const map = game.createMap(atlas, 64, 64);
   * map.fill(0, 0, 64, 64, 1);  // Fill with tile index 1
   * map.setCollision(10, 10, true);  // Make tile solid
   * ```
   */
  createMap(atlas: Atlas, width: number, height: number, options?: { layer?: number }): TileMap {
    if (!atlas || !atlas.name) {
      throw new GlyftError(
        'Invalid atlas passed to createMap',
        'Make sure to pass an atlas loaded with loadAtlas() or createTestAtlas().\n\n' +
        'Example:\n' +
        'const atlas = await game.loadAtlas("tiles.png", "tiles.json");\n' +
        'const map = game.createMap(atlas, 32, 32);'
      );
    }

    const internalAtlas = this._atlases.get(atlas.name);
    if (!internalAtlas) {
      throw new GlyftError(
        `Atlas '${atlas.name}' not found in game instance`,
        'The atlas might have been loaded on a different Glyft instance.\n\n' +
        'Make sure to:\n' +
        '1. Use the same game instance for loadAtlas and createMap\n' +
        '2. Call loadAtlas before createMap\n\n' +
        `Available atlases: ${Array.from(this._atlases.keys()).join(', ') || '(none)'}`
      );
    }

    if (width <= 0 || height <= 0) {
      throw new GlyftError(
        `Invalid map dimensions: ${width}x${height}`,
        'Map width and height must be positive integers.\n' +
        'Example: game.createMap(atlas, 32, 32)'
      );
    }

    if (width > 1024 || height > 1024) {
      console.warn(
        `[Glyft] Large map size (${width}x${height}) may impact performance. ` +
        'Consider using multiple smaller maps for very large worlds.'
      );
    }

    const layer = options?.layer ?? this._tilemaps.length;
    const data = new Uint8Array(width * height * 4); // RGBA
    const dataTexture = createDataTexture(this.gl, width, height, data);

    const tilemap: InternalTileMap = {
      width,
      height,
      layer,
      atlas: internalAtlas,
      dataTexture,
      data,
      dirty: false,
    };

    this._tilemaps.push(tilemap);
    this._tilemaps.sort((a, b) => a.layer - b.layer);

    return this._createTileMapProxy(tilemap);
  }

  private _createTileMapProxy(tilemap: InternalTileMap): TileMap {
    const tileSize = this.config.settings.tileSize;

    return {
      get width() { return tilemap.width; },
      get height() { return tilemap.height; },
      get widthPx() { return tilemap.width * tileSize; },
      get heightPx() { return tilemap.height * tileSize; },
      get layer() { return tilemap.layer; },

      set: (x: number, y: number, tileIndex: number) => {
        if (x < 0 || x >= tilemap.width || y < 0 || y >= tilemap.height) return;
        const i = (y * tilemap.width + x) * 4;
        tilemap.data[i] = tileIndex + 1; // +1 so 0 means empty in shader
        tilemap.dirty = true;
      },

      get: (x: number, y: number): number => {
        if (x < 0 || x >= tilemap.width || y < 0 || y >= tilemap.height) return -1;
        const i = (y * tilemap.width + x) * 4;
        return tilemap.data[i] - 1; // -1 to undo +1 offset (empty = -1)
      },

      fill: (x: number, y: number, w: number, h: number, tileIndex: number, animFrames?: number) => {
        const stored = tileIndex + 1;
        const anim = animFrames ?? 0;
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const tx = x + dx;
            const ty = y + dy;
            if (tx >= 0 && tx < tilemap.width && ty >= 0 && ty < tilemap.height) {
              const i = (ty * tilemap.width + tx) * 4;
              tilemap.data[i] = stored;
              tilemap.data[i + 2] = anim;
            }
          }
        }
        tilemap.dirty = true;
      },

      setAnim: (x: number, y: number, animFrames: number) => {
        if (x < 0 || x >= tilemap.width || y < 0 || y >= tilemap.height) return;
        const i = (y * tilemap.width + x) * 4;
        tilemap.data[i + 2] = animFrames;
        tilemap.dirty = true;
      },

      setRegion: (x: number, y: number, data: number[][]) => {
        for (let dy = 0; dy < data.length; dy++) {
          for (let dx = 0; dx < data[dy].length; dx++) {
            const tx = x + dx;
            const ty = y + dy;
            if (tx >= 0 && tx < tilemap.width && ty >= 0 && ty < tilemap.height) {
              const i = (ty * tilemap.width + tx) * 4;
              tilemap.data[i] = data[dy][dx] + 1;
            }
          }
        }
        tilemap.dirty = true;
      },

      setCollision: (x: number, y: number, solid: boolean) => {
        if (x < 0 || x >= tilemap.width || y < 0 || y >= tilemap.height) return;
        const i = (y * tilemap.width + x) * 4;
        tilemap.data[i + 1] = solid ? 1 : 0; // G = collision flag
        tilemap.dirty = true;
      },

      getCollision: (x: number, y: number): boolean => {
        if (x < 0 || x >= tilemap.width || y < 0 || y >= tilemap.height) return false;
        const i = (y * tilemap.width + x) * 4;
        return tilemap.data[i + 1] !== 0;
      },

      setMusicZone: (_x: number, _y: number, _w: number, _h: number, _track: string) => {
        // TODO: implement music zones
      },

      destroy: () => {
        const index = this._tilemaps.indexOf(tilemap);
        if (index !== -1) {
          this._tilemaps.splice(index, 1);
          // Clean up WebGL texture
          this.gl.deleteTexture(tilemap.dataTexture);
        }
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Sprites
  // ---------------------------------------------------------------------------

  /**
   * Create a sprite from an atlas frame.
   *
   * @param atlas - Texture atlas containing the sprite graphics
   * @param type - Frame name in the atlas (or "player" for test atlas)
   * @returns The created Sprite
   * @throws {GlyftError} If atlas or frame is invalid
   *
   * @example
   * ```typescript
   * const player = game.createSprite(atlas, 'hero');
   * player.x = 100;
   * player.y = 100;
   * player.tags = ['player'];
   * ```
   */
  createSprite(atlas: Atlas, type: string): Sprite {
    if (!atlas || !atlas.name) {
      throw new GlyftError(
        'Invalid atlas passed to createSprite',
        'Make sure to pass an atlas loaded with loadAtlas() or createTestAtlas().\n\n' +
        'Example:\n' +
        'const atlas = await game.loadAtlas("sprites.png", "sprites.json");\n' +
        'const sprite = game.createSprite(atlas, "hero");'
      );
    }

    const internalAtlas = this._atlases.get(atlas.name);
    if (!internalAtlas) {
      throw new GlyftError(
        `Atlas '${atlas.name}' not found in game instance`,
        'The atlas might have been loaded on a different Glyft instance.\n\n' +
        'Make sure to use the same game instance for loadAtlas and createSprite.\n' +
        `Available atlases: ${Array.from(this._atlases.keys()).join(', ') || '(none)'}`
      );
    }

    const frame = internalAtlas.frames.get(type);
    if (!frame) {
      const availableFrames = Array.from(internalAtlas.frames.keys()).slice(0, 10);
      const hasMore = internalAtlas.frames.size > 10;
      console.warn(
        `[Glyft] Frame '${type}' not found in atlas '${atlas.name}'. ` +
        `Using default frame (0, 0). ` +
        `Available frames: ${availableFrames.join(', ')}${hasMore ? '...' : ''}`
      );
    }
    const resolvedFrame = frame ?? { x: 0, y: 0, w: this.config.settings.tileSize, h: this.config.settings.tileSize };
    const id = `sprite_${this._nextSpriteId++}`;

    const sprite: InternalSprite = {
      id,
      type,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      rotation: 0,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      tint: 0xffffff,
      flipX: false,
      flipY: false,
      tags: this._getAutoTags(type),
      data: {},
      sounds: true,
      interactive: false,
      hitbox: null,
      bob: 0,
      bobSpeed: 1.5,
      shadow: false,
      shadowOffsetY: 0,
      visualOffsetY: 0,
      shadowScale: 1.0,
      shadowAlpha: 0.5,
      physics: internalAtlas.name === '__world', // ships and models move by velocity
      autoFlip: false,
      spriteMode: null,
      glow: 0,
      glowColor: null,
      glowRadius: 1.5,
      clipBottom: 0,
      elevation: 0,
      floats: false,
      atlas: internalAtlas,
      exists: true,
      animations: new Map(),
      animOverride: null,
      animStartTime: 0,
      animLoop: true,
      animOnComplete: null,
      animOnFrame: null,
      animCurrentFrame: -1,
      lastDirection: 0,
      rowOffset: 0,
      // Animation config (default: 1 idle frame, 4 walk frames, 8 fps)
      idleFrames: 1,
      walkFrames: 4,
      fps: 8,
      frameX: resolvedFrame.x,
      frameY: resolvedFrame.y,
      frameW: resolvedFrame.w,
      frameH: resolvedFrame.h,
      labelText: null,
      labelColor: 0xffffff,
      labelVisible: 'always',
      labelRange: 80,
      labelSlot: -1,
      labelIcon: null,
      labelIconColor: 0xffff00,
      hpBarVisible: false,
      hpBarValue: 1.0,
      hpBarWidth: 40,
      hpBarColor: 'auto' as 'auto' | number,
      hpBarBgColor: 0x000000,
      _listeners: null,
    };

    // Initialize HP if stats defined
    if (this.config.stats?.hp) {
      sprite.hp = this.config.stats.hp.default;
    }

    this._sprites.set(id, sprite);

    return this._createSpriteProxy(sprite);
  }

  private _getAutoTags(type: string): string[] {
    if (!this.config.autoTags) return [];

    const tags: string[] = [];
    for (const [prefix, prefixTags] of Object.entries(this.config.autoTags)) {
      if (type.startsWith(prefix)) {
        tags.push(...prefixTags);
      }
    }
    return tags;
  }

  private _createSpriteProxy(sprite: InternalSprite): Sprite {
    const self = this;

    return {
      get id() { return sprite.id; },
      get type() { return sprite.type; },
      get x() { return sprite.x; },
      set x(v: number) { sprite.x = v; },
      get y() { return sprite.y; },
      set y(v: number) { sprite.y = v; },
      get z() { return sprite.z; },
      set z(v: number) { sprite.z = v; },
      get vx() { return sprite.vx; },
      set vx(v: number) {
        if (v !== 0 || sprite.vy !== 0) {
          sprite.lastDirection = self._getDirection(v, sprite.vy);
        }
        sprite.vx = v;
      },
      get vy() { return sprite.vy; },
      set vy(v: number) {
        if (sprite.vx !== 0 || v !== 0) {
          sprite.lastDirection = self._getDirection(sprite.vx, v);
        }
        sprite.vy = v;
      },
      get rotation() { return sprite.rotation; },
      set rotation(v: number) { sprite.rotation = v; },
      get scale() { return sprite.scale; },
      set scale(v: number) { sprite.scale = v; sprite.scaleX = v; sprite.scaleY = v; },
      get scaleX() { return sprite.scaleX; },
      set scaleX(v: number) { sprite.scaleX = v; },
      get scaleY() { return sprite.scaleY; },
      set scaleY(v: number) { sprite.scaleY = v; },
      get alpha() { return sprite.alpha; },
      set alpha(v: number) { sprite.alpha = v; },
      get tint() { return sprite.tint; },
      set tint(v: number) { sprite.tint = v; },
      get idleFrames() { return sprite.idleFrames; },
      set idleFrames(v: number) { sprite.idleFrames = v; },
      get walkFrames() { return sprite.walkFrames; },
      set walkFrames(v: number) { sprite.walkFrames = v; },
      get rowOffset() { return sprite.rowOffset; },
      set rowOffset(v: number) { sprite.rowOffset = v; },
      get flipX() { return sprite.flipX; },
      set flipX(v: boolean) { sprite.flipX = v; },
      get flipY() { return sprite.flipY; },
      set flipY(v: boolean) { sprite.flipY = v; },
      get tags() { return sprite.tags; },
      set tags(v: string[]) { sprite.tags = v; },
      get data() { return sprite.data; },
      get hp() { return sprite.hp; },
      set hp(v: number | undefined) { sprite.hp = v; },
      get sounds() { return sprite.sounds; },
      set sounds(v: boolean) { sprite.sounds = v; },
      get interactive() { return sprite.interactive; },
      set interactive(v: boolean) { sprite.interactive = v; },
      get hitbox() { return sprite.hitbox; },
      set hitbox(v: { x: number; y: number; w: number; h: number } | null) { sprite.hitbox = v; },
      get bob() { return sprite.bob; },
      set bob(v: number) { sprite.bob = Math.min(255, Math.max(0, v)); },
      get bobSpeed() { return sprite.bobSpeed; },
      set bobSpeed(v: number) { sprite.bobSpeed = Math.min(25.5, Math.max(0, v)); },
      get elevation() { return sprite.elevation; },
      set elevation(v: number) { sprite.elevation = v; },
      get floats() { return sprite.floats; },
      set floats(v: boolean) { sprite.floats = v; },
      get physics() { return sprite.physics; },
      set physics(v: boolean) { sprite.physics = v; },
      get autoFlip() { return sprite.autoFlip; },
      set autoFlip(v: boolean) { sprite.autoFlip = v; },
      get spriteMode() { return sprite.spriteMode; },
      set spriteMode(v) { sprite.spriteMode = v; },
      get shadow() { return sprite.shadow; },
      set shadow(v: boolean) { sprite.shadow = v; },
      get shadowOffsetY() { return sprite.shadowOffsetY; },
      set shadowOffsetY(v: number) { sprite.shadowOffsetY = v; },
      get visualOffsetY() { return sprite.visualOffsetY; },
      set visualOffsetY(v: number) { sprite.visualOffsetY = v; },
      get shadowScale() { return sprite.shadowScale; },
      set shadowScale(v: number) { sprite.shadowScale = Math.min(2, Math.max(0, v)); },
      get shadowAlpha() { return sprite.shadowAlpha; },
      set shadowAlpha(v: number) { sprite.shadowAlpha = Math.min(1, Math.max(0, v)); },
      get glow() { return sprite.glow; },
      set glow(v: number) { sprite.glow = Math.min(1, Math.max(0, v)); },
      get glowColor() { return sprite.glowColor; },
      set glowColor(v: number | null) { sprite.glowColor = v; },
      get glowRadius() { return sprite.glowRadius; },
      set glowRadius(v: number) { sprite.glowRadius = Math.max(1, v); },
      get clipBottom() { return sprite.clipBottom; },
      set clipBottom(v: number) { sprite.clipBottom = Math.min(1, Math.max(0, v)); },
      get label() { return sprite.labelText; },
      set label(v: string | null) {
        if (v === sprite.labelText) return;
        sprite.labelText = v;
        if (v !== null) {
          if (sprite.labelSlot === -1) {
            sprite.labelSlot = self._labelManager.allocSlot(sprite.id);
          }
          if (sprite.labelSlot >= 0) {
            self._labelManager.setLabel(sprite.labelSlot, v, sprite.labelColor, sprite.labelIcon ?? undefined, sprite.labelIconColor);
            if (sprite.hpBarVisible) {
              const fc = sprite.hpBarColor === 'auto' ? 0 : packColorF32(sprite.hpBarColor);
              self._labelManager.setHpData(sprite.labelSlot, sprite.hpBarValue, sprite.hpBarWidth, true, fc, packColorF32(sprite.hpBarBgColor));
              self._labelManager.setYShift(sprite.labelSlot, -6);
            }
          }
        } else if (sprite.labelSlot >= 0 && !sprite.hpBarVisible) {
          // Only free slot if HP bar isn't using it
          self._labelManager.freeSlot(sprite.labelSlot);
          sprite.labelSlot = -1;
        }
      },
      get labelColor() { return sprite.labelColor; },
      set labelColor(v: number) {
        sprite.labelColor = v;
        if (sprite.labelText !== null && sprite.labelSlot >= 0) {
          self._labelManager.setLabel(sprite.labelSlot, sprite.labelText, v, sprite.labelIcon ?? undefined, sprite.labelIconColor);
        }
      },
      get labelVisible(): import('./types').LabelVisible { return sprite.labelVisible as import('./types').LabelVisible; },
      set labelVisible(v: import('./types').LabelVisible) { sprite.labelVisible = v; },
      get labelRange() { return sprite.labelRange; },
      set labelRange(v: number) { sprite.labelRange = v; },
      get labelIcon() { return sprite.labelIcon; },
      set labelIcon(v: string | null) {
        sprite.labelIcon = v;
        if (sprite.labelText !== null && sprite.labelSlot >= 0) {
          self._labelManager.setLabel(sprite.labelSlot, sprite.labelText, sprite.labelColor, v ?? undefined, sprite.labelIconColor);
        }
      },
      get labelIconColor() { return sprite.labelIconColor; },
      set labelIconColor(v: number) {
        sprite.labelIconColor = v;
        if (sprite.labelIcon && sprite.labelText !== null && sprite.labelSlot >= 0) {
          self._labelManager.setLabel(sprite.labelSlot, sprite.labelText, sprite.labelColor, sprite.labelIcon, v);
        }
      },
      get hpBarVisible() { return sprite.hpBarVisible; },
      set hpBarVisible(v: boolean) {
        sprite.hpBarVisible = v;
        if (v && sprite.labelSlot === -1) {
          sprite.labelSlot = self._labelManager.allocSlot(sprite.id);
        }
        if (sprite.labelSlot >= 0) {
          const fc = sprite.hpBarColor === 'auto' ? 0 : packColorF32(sprite.hpBarColor);
          const bg = packColorF32(sprite.hpBarBgColor);
          self._labelManager.setHpData(sprite.labelSlot, sprite.hpBarValue, sprite.hpBarWidth, v, fc, bg);
          self._labelManager.setYShift(sprite.labelSlot, v ? -6 : 0);
          if (sprite.labelText !== null) {
            self._labelManager.setLabel(sprite.labelSlot, sprite.labelText, sprite.labelColor, sprite.labelIcon ?? undefined, sprite.labelIconColor);
          }
          // Free slot if neither label nor HP bar needs it
          if (!v && sprite.labelText === null) {
            self._labelManager.freeSlot(sprite.labelSlot);
            sprite.labelSlot = -1;
          }
        }
      },
      get hpBarValue() { return sprite.hpBarValue; },
      set hpBarValue(v: number) {
        sprite.hpBarValue = v;
        if (sprite.labelSlot >= 0 && sprite.hpBarVisible) {
          const fc = sprite.hpBarColor === 'auto' ? 0 : packColorF32(sprite.hpBarColor);
          self._labelManager.setHpData(sprite.labelSlot, v, sprite.hpBarWidth, true, fc, packColorF32(sprite.hpBarBgColor));
        }
      },
      get hpBarWidth() { return sprite.hpBarWidth; },
      set hpBarWidth(v: number) {
        sprite.hpBarWidth = v;
        if (sprite.labelSlot >= 0 && sprite.hpBarVisible) {
          const fc = sprite.hpBarColor === 'auto' ? 0 : packColorF32(sprite.hpBarColor);
          self._labelManager.setHpData(sprite.labelSlot, sprite.hpBarValue, v, true, fc, packColorF32(sprite.hpBarBgColor));
        }
      },
      get hpBarColor() { return sprite.hpBarColor; },
      set hpBarColor(v: 'auto' | number) {
        sprite.hpBarColor = v;
        if (sprite.labelSlot >= 0 && sprite.hpBarVisible) {
          const fc = v === 'auto' ? 0 : packColorF32(v);
          self._labelManager.setHpData(sprite.labelSlot, sprite.hpBarValue, sprite.hpBarWidth, true, fc, packColorF32(sprite.hpBarBgColor));
        }
      },
      get hpBarBgColor() { return sprite.hpBarBgColor; },
      set hpBarBgColor(v: number) {
        sprite.hpBarBgColor = v;
        if (sprite.labelSlot >= 0 && sprite.hpBarVisible) {
          const fc = sprite.hpBarColor === 'auto' ? 0 : packColorF32(sprite.hpBarColor);
          self._labelManager.setHpData(sprite.labelSlot, sprite.hpBarValue, sprite.hpBarWidth, true, fc, packColorF32(v));
        }
      },
      get atlas() { return self._createAtlasProxy(sprite.atlas); },
      get exists() { return sprite.exists; },
      get width() { return sprite.frameW; },
      get height() { return sprite.frameH; },
      get facing() {
        const dirs = ['down', 'right', 'up', 'left'] as const;
        return dirs[sprite.lastDirection] ?? 'down';
      },

      setFacing(direction: 'down' | 'right' | 'up' | 'left' | number) {
        if (typeof direction === 'number') {
          // Radians - convert to 4-direction index
          // 0 = right, PI/2 = down, PI = left, -PI/2 = up
          const angle = direction;
          const normalized = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          if (normalized < Math.PI * 0.25 || normalized >= Math.PI * 1.75) {
            sprite.lastDirection = 1; // right
          } else if (normalized < Math.PI * 0.75) {
            sprite.lastDirection = 0; // down
          } else if (normalized < Math.PI * 1.25) {
            sprite.lastDirection = 3; // left
          } else {
            sprite.lastDirection = 2; // up
          }
        } else {
          const dirMap = { down: 0, right: 1, up: 2, left: 3 };
          sprite.lastDirection = dirMap[direction] ?? 0;
        }
      },

      defineAnimation(name: string, def: AnimationDef) {
        sprite.animations.set(name, def);
      },

      playAnimation(name: string, options?: { onComplete?: () => void; onFrame?: (frame: number) => void }) {
        const anim = sprite.animations.get(name);
        if (!anim) {
          console.warn(`[Glyft] Animation '${name}' not defined on sprite '${sprite.id}'`);
          return;
        }
        sprite.animOverride = name;
        sprite.animStartTime = self._time;
        sprite.animLoop = anim.loop ?? false;
        sprite.animOnComplete = options?.onComplete ?? null;
        sprite.animOnFrame = options?.onFrame ?? null;
        sprite.animCurrentFrame = -1;
      },

      playOverride(animation: string, options?: { loop?: boolean; onComplete?: () => void }) {
        sprite.animOverride = animation;
        sprite.animStartTime = self._time;
        sprite.animLoop = options?.loop ?? false;
        sprite.animOnComplete = options?.onComplete ?? null;
        sprite.animOnFrame = null;
        sprite.animCurrentFrame = -1;
      },

      clearOverride() {
        sprite.animOverride = null;
        sprite.animOnComplete = null;
        sprite.animOnFrame = null;
        sprite.animCurrentFrame = -1;
      },

      on(event: 'pointerdown' | 'pointerover' | 'pointerout', cb: (e: SpritePointerEvent) => void) {
        if (!sprite._listeners) sprite._listeners = {};
        if (!sprite._listeners[event]) sprite._listeners[event] = [];
        sprite._listeners[event].push(cb);
      },

      off(event: 'pointerdown' | 'pointerover' | 'pointerout', cb?: (e: SpritePointerEvent) => void) {
        if (!sprite._listeners?.[event]) return;
        if (cb) {
          const arr = sprite._listeners[event];
          const idx = arr.indexOf(cb);
          if (idx >= 0) arr.splice(idx, 1);
        } else {
          delete sprite._listeners[event];
        }
      },

      destroy() {
        if (self._hoveredSprite === sprite) {
          self._hoveredSprite = null;
        }
        if (sprite.labelSlot >= 0) {
          self._labelManager.freeSlot(sprite.labelSlot);
          sprite.labelSlot = -1;
        }
        sprite._listeners = null;
        sprite.exists = false;
        self._sprites.delete(sprite.id);
      },
    };
  }

  private _getDirection(vx: number, vy: number): number {
    if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) return 0;
    const angle = Math.atan2(vy, vx);
    if (angle > -0.785 && angle <= 0.785) return 1;      // Right
    if (angle > 0.785 && angle <= 2.356) return 0;       // Down
    if (angle > 2.356 || angle <= -2.356) return 3;      // Left
    return 2;                                              // Up
  }

  /**
   * Spawn a sprite by type name at tile coordinates.
   *
   * @param type - Frame name to look up across all loaded atlases
   * @param x - X position in tile coordinates
   * @param y - Y position in tile coordinates
   * @returns The spawned Sprite
   * @throws {GlyftError} If the type is not found in any atlas
   *
   * @example
   * ```typescript
   * // Spawn at tile position (5, 10)
   * const enemy = game.spawn('goblin', 5, 10);
   * enemy.tags = ['enemy'];
   * ```
   */
  spawn(type: string, x: number, y: number): Sprite {
    // Find atlas containing this type
    for (const atlas of this._atlases.values()) {
      if (atlas.frames.has(type)) {
        const sprite = this.createSprite(this._createAtlasProxy(atlas), type);
        sprite.x = x * this.config.settings.tileSize;
        sprite.y = y * this.config.settings.tileSize;
        return sprite;
      }
    }

    // Build helpful error message
    const allFrames: string[] = [];
    for (const atlas of this._atlases.values()) {
      allFrames.push(...Array.from(atlas.frames.keys()));
    }
    const suggestions = allFrames
      .filter(f => f.includes(type) || type.includes(f.substring(0, 3)))
      .slice(0, 5);

    throw new GlyftError(
      `Sprite type '${type}' not found in any loaded atlas`,
      suggestions.length > 0
        ? `Did you mean one of these? ${suggestions.join(', ')}\n\n`
        : '' +
      `Available sprite types: ${allFrames.slice(0, 15).join(', ')}${allFrames.length > 15 ? '...' : ''}\n\n` +
      'Make sure the sprite type name matches a frame defined in your atlas JSON.'
    );
  }

  getTagged(tag: string): Sprite[] {
    const result: Sprite[] = [];
    for (const sprite of this._sprites.values()) {
      if (sprite.exists && sprite.tags.includes(tag)) {
        result.push(this._createSpriteProxy(sprite));
      }
    }
    return result;
  }

  getById(id: string): Sprite | undefined {
    const sprite = this._sprites.get(id);
    if (sprite && sprite.exists) {
      return this._createSpriteProxy(sprite);
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Hit Testing
  // ---------------------------------------------------------------------------

  /**
   * Get all interactive sprites at a world coordinate.
   * Returns sprites sorted by Y (front-most first, i.e., highest Y first).
   *
   * @param worldX - World X coordinate
   * @param worldY - World Y coordinate
   * @returns Array of sprites at that point
   *
   * @example
   * ```typescript
   * // Convert screen click to world coordinates
   * const worldX = game.input.pointer.x + game.camera.x;
   * const worldY = game.input.pointer.y + game.camera.y;
   * const hits = game.getSpritesAtPoint(worldX, worldY);
   * if (hits.length > 0) {
   *   console.log('Clicked:', hits[0].type);
   * }
   * ```
   */
  getSpritesAtPoint(worldX: number, worldY: number): Sprite[] {
    const hits: InternalSprite[] = [];

    for (const sprite of this._sprites.values()) {
      if (!sprite.exists || !sprite.interactive) continue;

      let hx: number, hy: number, hw: number, hh: number;
      if (sprite.hitbox) {
        hx = sprite.x + sprite.hitbox.x;
        hy = sprite.y + sprite.hitbox.y;
        hw = sprite.hitbox.w;
        hh = sprite.hitbox.h;
      } else {
        hx = sprite.x;
        hy = sprite.y;
        hw = sprite.frameW;
        hh = sprite.frameH;
      }

      if (worldX >= hx && worldX < hx + hw && worldY >= hy && worldY < hy + hh) {
        hits.push(sprite);
      }
    }

    // Sort by Y descending (front-most first)
    hits.sort((a, b) => b.y - a.y);

    return hits.map(s => this._createSpriteProxy(s));
  }

  // ---------------------------------------------------------------------------
  // Tweens
  // ---------------------------------------------------------------------------

  /**
   * Tween a target's properties smoothly over time.
   *
   * @param target - Object to tween (sprite, camera, any object with numeric props)
   * @param props - Target values for properties
   * @param duration - Duration in milliseconds
   * @param options - Easing, callbacks, delay
   * @returns Handle for cancellation
   *
   * @example
   * ```typescript
   * // Move sprite smoothly
   * game.tween(sprite, { x: 200, y: 100 }, 500, { ease: 'easeOutQuad' });
   *
   * // Fade out and destroy
   * game.tween(sprite, { alpha: 0 }, 300, {
   *   onComplete: () => sprite.destroy()
   * });
   * ```
   */
  tween(
    target: object,
    props: { x?: number; y?: number; alpha?: number; scale?: number; rotation?: number },
    duration: number,
    options?: { ease?: string; onUpdate?: (t: object) => void; onComplete?: (t: object) => void; delay?: number },
  ): { cancel(): void; readonly active: boolean } {
    return this._tweenManager.add(
      target as Record<string, unknown>,
      props as TweenProps,
      duration,
      options as TweenOptions,
    );
  }

  /** Cancel all tweens on a target */
  cancelTweens(target: object): void {
    this._tweenManager.cancelAll(target as Record<string, unknown>);
  }

  /** Spawn floating text at world position (GPU-rendered) */
  floatText(x: number, y: number, text: string, options?: import('./types').FloatTextOptions): void {
    const [fx, fy] = this._fx(x, y);
    this._floatTextManager.spawn(fx, fy, text, this._time, options);
  }

  /**
   * DOM-based floating text system for crisp text at any scale.
   *
   * Unlike floatText() which uses GPU rendering, domText uses CSS-animated
   * DOM elements. This provides pixel-perfect text but requires the container
   * to be attached to the DOM.
   *
   * Usage:
   * ```ts
   * // Attach container to your game wrapper
   * wrapper.appendChild(game.domText.container);
   *
   * // Spawn text
   * game.domText.spawn(x, y, '+10 XP', { color: 0xffff00, style: 'rise' });
   * ```
   */
  get domText() {
    if (!this._domTextManager) {
      this._domTextManager = createDomTextManager();
    }
    const manager = this._domTextManager;
    return {
      /** The container element - attach to your game wrapper */
      get container() { return manager.getContainer(); },
      /** Spawn floating text at world coordinates */
      spawn(x: number, y: number, text: string, options?: import('./types').FloatTextOptions) {
        manager.spawn(x, y, text, options);
      },
    };
  }

  /** Particle system: define emitters and emit bursts */
  get particles() {
    const self = this;
    return {
      define(name: string, def: import('./types').ParticleEmitterDef) { self._particleManager.define(name, def); },
      emit(name: string, x: number, y: number) { const [fx, fy] = self._fx(x, y); self._particleManager.emit(name, fx, fy, self._time); },
    };
  }

  /** Arc effect system: define effects and emit melee swings */
  get arcs() {
    const self = this;
    return {
      define(name: string, def: ArcEffectDef) { self._arcManager.define(name, def); },
      emit(name: string, x: number, y: number, angle: number, arcDegrees: number, range: number, options?: ArcEmitOptions) {
        const [fx, fy] = self._fx(x, y);
        self._arcManager.emit(name, fx, fy, angle, arcDegrees, range, self._time, options);
      },
    };
  }

  /** Ring/shockwave effect system: define effects and emit expanding rings */
  get rings() {
    const self = this;
    return {
      define(name: string, def: RingEffectDef) { self._ringManager.define(name, def); },
      emit(name: string, x: number, y: number, options?: RingEmitOptions) {
        const [fx, fy] = self._fx(x, y);
        self._ringManager.emit(name, fx, fy, self._time, options);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Collision
  // ---------------------------------------------------------------------------

  collidesWithMap(x: number, y: number, w: number, h: number): boolean {
    const tileSize = this.config.settings.tileSize;

    // Find all tiles the box overlaps with
    // Box covers pixels from x to x+w-1 and y to y+h-1
    const tileX1 = Math.floor(x / tileSize);
    const tileY1 = Math.floor(y / tileSize);
    const tileX2 = Math.floor((x + w - 1) / tileSize);
    const tileY2 = Math.floor((y + h - 1) / tileSize);

    for (const tilemap of this._tilemaps) {
      for (let ty = tileY1; ty <= tileY2; ty++) {
        for (let tx = tileX1; tx <= tileX2; tx++) {
          if (tx >= 0 && tx < tilemap.width && ty >= 0 && ty < tilemap.height) {
            const i = (ty * tilemap.width + tx) * 4;
            if (tilemap.data[i + 1] !== 0) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  spriteCollidesWithMap(sprite: Sprite, x?: number, y?: number): boolean {
    // Get internal sprite to access frame dimensions
    const internal = this._sprites.get(sprite.id);
    if (!internal) return false;

    const checkX = x ?? sprite.x;
    const checkY = y ?? sprite.y;
    const width = internal.frameW || this.config.settings.tileSize;
    const height = internal.frameH || this.config.settings.tileSize;

    return this.collidesWithMap(checkX, checkY, width, height);
  }

  // ---------------------------------------------------------------------------
  // Reactive Systems
  // ---------------------------------------------------------------------------

  readonly sounds = {
    define: (rules: Record<string, string | SoundRule>) => {
      this._soundManager.define(rules);
      for (const [pattern, rule] of Object.entries(rules)) {
        this._soundRules.set(pattern, rule);
      }
    },
    defineSfx: (defs: Record<string, import('./types').SfxDef>) => {
      this._soundManager.defineSfx(defs);
    },
    play: (sound: string, options?: { volume?: number; pitch?: number; x?: number }) => {
      this._soundManager.play(sound, options);
    },
    setVolume: (volume: number) => {
      this._soundManager.setVolume(volume);
    },
    preload: (sounds: string[]) => {
      return this._soundManager.preload(sounds);
    },
  };

  readonly music = {
    define: (tracks: Record<string, MusicTrack>) => {
      this._musicManager.define(tracks);
    },
    play: (track: string, options?: { fade?: number }) => {
      this._musicManager.play(track, options);
    },
    stop: (options?: { fade?: number }) => {
      this._musicManager.stop(options);
    },
    pause: () => {
      this._musicManager.pause();
    },
    resume: () => {
      this._musicManager.resume();
    },
    setVolume: (volume: number) => {
      this._musicManager.setVolume(volume);
    },
    getVolume: () => {
      return this._musicManager.getVolume();
    },
    getCurrent: () => {
      return this._musicManager.getCurrentTrack();
    },
    preload: (tracks: string[]) => {
      return this._musicManager.preload(tracks);
    },
  };

  readonly collisions = {
    define: (rules: Record<string, string | CollisionAction>) => {
      for (const [pattern, rule] of Object.entries(rules)) {
        this._collisionRules.set(pattern, rule);
      }
      this._rebuildCollisions();
    },
    on: (pattern: string, callback: (a: Sprite, b: Sprite) => void) => {
      const callbacks = this._collisionCallbacks.get(pattern) ?? [];
      callbacks.push(callback);
      this._collisionCallbacks.set(pattern, callbacks);
    },
  };

  /** Collision rules are parsed once per change, so rules added at runtime take effect. */
  private _rebuildCollisions(): void {
    this._collisionSystem = createCollisionSystem(this._collisionRules);
    this._parseMagnetizeRules();
  }

  // ---------------------------------------------------------------------------
  // Game Loop
  // ---------------------------------------------------------------------------

  onUpdate(callback: (dt: number) => void): void {
    this._updateCallbacks.push(callback);
  }

  /** Register a callback to run after rendering (camera position is final). */
  onPostRender(callback: (dt: number) => void): void {
    this._postRenderCallbacks.push(callback);
  }

  /**
   * Start the game loop. In 3D this waits for the world to load and creates
   * world.spawns first; the returned promise resolves once the loop is running.
   */
  start(): Promise<void> {
    this._running = true;
    this._lastFrameTime = performance.now();
    if (this._worldLoad) {
      return this._worldLoad.then(() => {
        this._spawnWorld();
        this._lastFrameTime = performance.now();
        this._loop();
      });
    }
    this._loop();
    return Promise.resolve();
  }

  private _worldSpawned = false;

  /** Apply a spawn rule's `with` block: data is merged, everything else is set. */
  private _applySpriteProps(sprite: Sprite, props: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(props)) {
      if (key === 'data') {
        Object.assign(sprite.data, value as Record<string, unknown>);
        continue;
      }
      try {
        (sprite as unknown as Record<string, unknown>)[key] = value;
      } catch {
        throw new GlyftError(
          `Spawn rule for '${sprite.type}' sets '${key}', which is read-only`,
          `Remove '${key}' from the rule's with block. Settable examples: label, tint, scale, alpha, hpBarVisible, visualOffsetY, walkFrames, data.`
        );
      }
    }
  }

  /** Create the sprites declared in world.spawns (once). */
  private _spawnWorld(): void {
    if (this._worldSpawned || !this._world) return;
    this._worldSpawned = true;
    const sizeOf = (type: string): number => {
      const fp = this._world!.footprintOf(type);
      if (fp) return Math.max(fp[0], fp[1]);
      for (const atlas of this._atlases.values()) {
        const f = atlas.frames.get(type);
        if (f) return Math.max(f.w, f.h);
      }
      throw new GlyftError(
        `world.spawns has '${type}' but no atlas has that sprite type`,
        `Load it before start(): await game.loadTexture('${type}', '${type}.png', { frameWidth: 32, frameHeight: 32 })`
      );
    };
    for (const plan of this._world.planSpawns(sizeOf)) {
      const sprite = this.spawn(plan.type, 0, 0);
      sprite.x = plan.x - sprite.width / 2;
      sprite.y = plan.y - sprite.height / 2;
      sprite.rotation = plan.rotation;
      if (plan.with) this._applySpriteProps(sprite, plan.with);
      this._world.adopt(sprite.id, plan.area);
    }
    this._world.activate();
  }

  pause(): void {
    this._running = false;
  }

  resume(): void {
    this._running = true;
    this._lastFrameTime = performance.now();
    this._loop();
  }

  reloadConfig(config: Partial<GlyftConfig>): void {
    Object.assign(this.config, config);

    if (config.sfx) {
      this._soundManager.defineSfx(config.sfx);
    }
    if (config.sounds) {
      this._soundRules.clear();
      for (const [pattern, rule] of Object.entries(config.sounds)) {
        this._soundRules.set(pattern, rule);
      }
    }
    if (config.collisions) {
      this._collisionRules.clear();
      for (const [pattern, rule] of Object.entries(config.collisions)) {
        this._collisionRules.set(pattern, rule);
      }
      this._rebuildCollisions();
    }
    if (config.particles) {
      for (const [name, def] of Object.entries(config.particles)) {
        this._particleManager.define(name, def);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Addon System
  // ---------------------------------------------------------------------------

  /**
   * Register an addon to extend engine functionality.
   * Addons hook into the game loop and access the engine through the public API.
   *
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * import { projectiles } from 'glyft/addons/projectiles';
   * game.use(projectiles({ types: { bolt: { speed: 200 } } }));
   * ```
   */
  use(addon: import('./types').GlyftAddon): this {
    if (this._addons.some(a => a.name === addon.name)) {
      console.warn(`[Glyft] Addon '${addon.name}' already registered, skipping.`);
      return this;
    }
    this._addons.push(addon);
    addon.init(this as unknown as import('./types').Glyft);
    return this;
  }

  /**
   * Get a registered addon by name.
   */
  addon<T extends import('./types').GlyftAddon>(name: string): T | undefined {
    return this._addons.find(a => a.name === name) as T | undefined;
  }

  // ---------------------------------------------------------------------------
  // Game-Level Pointer Events
  // ---------------------------------------------------------------------------

  on(event: 'pointerdown', cb: (e: SpritePointerEvent) => void): void {
    if (!this._gameListeners[event]) this._gameListeners[event] = [];
    this._gameListeners[event].push(cb);
  }

  off(event: 'pointerdown', cb?: (e: SpritePointerEvent) => void): void {
    if (!this._gameListeners[event]) return;
    if (cb) {
      const idx = this._gameListeners[event].indexOf(cb);
      if (idx >= 0) this._gameListeners[event].splice(idx, 1);
    } else {
      delete this._gameListeners[event];
    }
  }

  private _loop = (): void => {
    if (!this._running) return;

    const now = performance.now();
    this._dt = Math.min((now - this._lastFrameTime) / 1000, 0.1); // Cap at 100ms
    this._time += this._dt;
    this._lastFrameTime = now;

    // FPS tracking
    this._fpsFrameCount++;
    const fpsElapsed = now - this._fpsLastTime;
    if (fpsElapsed >= 500) {
      this._fps = Math.round((this._fpsFrameCount / fpsElapsed) * 1000);
      this._frameTime = fpsElapsed / this._fpsFrameCount;
      this._fpsFrameCount = 0;
      this._fpsLastTime = now;
    }

    // Update tweens
    this._tweenManager.update(this._dt * 1000);

    // Advance named animations (CPU-driven override frame advancement)
    this._updateAnimations();

    // Update pointer hover tracking (fires pointerover/pointerout)
    this._updatePointerEvents();

    // 3D controller input (camera-relative), before sprites move
    this._world?.prePhysics(this._dt, this._sprites, this._input);

    // Update sprite physics (velocity-based movement, auto-flip)
    this._updatePhysics(this._dt);

    // 3D: blocking, ground height, jumps, buoyancy, headings
    this._world?.postPhysics(this._dt, this._sprites);

    // Clear the overlay before anyone draws on it this frame (user callbacks and addons)
    if (this._overlayActive && this._overlayCtx) {
      this._sizeOverlay();
      const [vw, vh] = this.config.settings.viewport;
      this._overlayCtx.clearRect(0, 0, vw, vh);
    }

    // Addon: preUpdate (before user callbacks)
    for (const addon of this._addons) addon.preUpdate?.(this._dt);

    // Run user update callbacks
    for (const callback of this._updateCallbacks) {
      callback(this._dt);
    }

    // Addon: postUpdate (after user callbacks, before physics)
    for (const addon of this._addons) addon.postUpdate?.(this._dt);

    // Run magnetize (attract sprites toward targets)
    this._updateMagnetize(this._dt);

    // Run collision detection
    this._updateCollisions();

    // Run reactive sound triggers
    this._updateReactiveSounds();

    // Addon: postPhysics (after collisions, before render)
    for (const addon of this._addons) addon.postPhysics?.(this._dt);

    // Update floating text (expire old entries)
    this._floatTextManager.update(this._time);

    // Update DOM text (if used)
    if (this._domTextManager) {
      const [vpW, vpH] = this.config.settings.viewport;
      this._domTextManager.update(
        this._dt,
        this._camera,
        vpW,
        vpH,
        this.canvas.clientWidth,
        this.canvas.clientHeight
      );
    }

    // Update particles (expire dead particles)
    this._particleManager.update(this._time);

    // Update arc effects (expire dead arcs)
    this._arcManager.update(this._time);

    // Update ring effects (expire dead rings)
    this._ringManager.update(this._time);

    // Clear per-frame input state (justPressed/justReleased)
    this._input.update();

    // Render
    this._render();

    // Post-render callbacks (camera position is final)
    for (const callback of this._postRenderCallbacks) {
      callback(this._dt);
    }

    // Next frame
    requestAnimationFrame(this._loop);
  };

  // ---------------------------------------------------------------------------
  // Pointer Event System
  // ---------------------------------------------------------------------------

  /** Find the topmost interactive sprite at a world point (no proxy allocation). */
  private _getTopSpriteAtPoint(worldX: number, worldY: number): InternalSprite | null {
    let top: InternalSprite | null = null;
    let topY = -Infinity;
    for (const sprite of this._sprites.values()) {
      if (!sprite.exists || !sprite.interactive) continue;
      const hx = sprite.hitbox ? sprite.x + sprite.hitbox.x : sprite.x;
      const hy = sprite.hitbox ? sprite.y + sprite.hitbox.y : sprite.y;
      const hw = sprite.hitbox ? sprite.hitbox.w : sprite.frameW;
      const hh = sprite.hitbox ? sprite.hitbox.h : sprite.frameH;
      if (worldX >= hx && worldX < hx + hw && worldY >= hy && worldY < hy + hh) {
        if (sprite.y > topY) { topY = sprite.y; top = sprite; }
      }
    }
    return top;
  }

  /** Dispatch a pointer event to a sprite's listeners. */
  private _fireSpriteEvent(sprite: InternalSprite, event: string, worldX: number, worldY: number): void {
    if (!sprite._listeners?.[event]) return;
    const e: SpritePointerEvent = { sprite: this._createSpriteProxy(sprite), worldX, worldY };
    for (const cb of sprite._listeners[event]) {
      cb(e);
    }
  }

  /** Per-frame hover tracking — fires pointerover/pointerout on interactive sprites. */
  private _updatePointerEvents(): void {
    const ground = this._pointerWorld();
    if (!ground) return;
    const [worldX, worldY] = ground;

    const hit = this._getTopSpriteAtPoint(worldX, worldY);

    // Hover exit
    if (this._hoveredSprite && this._hoveredSprite !== hit) {
      if (this._hoveredSprite.exists) {
        this._fireSpriteEvent(this._hoveredSprite, 'pointerout', worldX, worldY);
      }
      this._hoveredSprite = null;
    }

    // Hover enter
    if (hit && hit !== this._hoveredSprite) {
      this._hoveredSprite = hit;
      this._fireSpriteEvent(hit, 'pointerover', worldX, worldY);
    }
  }

  // ---------------------------------------------------------------------------
  // Named Animation Advancement (CPU-driven for overrides)
  // ---------------------------------------------------------------------------

  private _updateAnimations(): void {
    for (const sprite of this._sprites.values()) {
      if (!sprite.exists || !sprite.animOverride) continue;

      const anim = sprite.animations.get(sprite.animOverride);
      if (!anim) continue;

      const elapsed = this._time - sprite.animStartTime;
      const frameDuration = 1 / anim.fps;
      const totalFrames = anim.frames.length;
      const rawFrame = Math.floor(elapsed / frameDuration);

      let frameIndex: number;
      if (sprite.animLoop || anim.loop) {
        frameIndex = rawFrame % totalFrames;
      } else {
        frameIndex = Math.min(rawFrame, totalFrames - 1);

        // Check if animation completed
        if (rawFrame >= totalFrames) {
          const onComplete = sprite.animOnComplete;
          sprite.animOverride = null;
          sprite.animOnComplete = null;
          sprite.animOnFrame = null;
          sprite.animCurrentFrame = -1;
          if (onComplete) onComplete();
          continue;
        }
      }

      // Fire onFrame callback if frame changed
      if (frameIndex !== sprite.animCurrentFrame) {
        sprite.animCurrentFrame = frameIndex;
        if (sprite.animOnFrame) {
          sprite.animOnFrame(frameIndex);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Magnetize System
  // ---------------------------------------------------------------------------

  private _parseMagnetizeRules(): void {
    this._magnetizeRules = [];
    for (const [pattern, action] of this._collisionRules.entries()) {
      if (typeof action === 'string' || !action.magnetize) continue;
      const parts = pattern.split(':');
      if (parts.length !== 2) continue;
      const tagA = this._extractTag(parts[0]);
      const tagB = this._extractTag(parts[1]);
      if (!tagA || !tagB) continue;
      this._magnetizeRules.push({
        tagA,
        tagB,
        range: action.magnetize.range,
        speed: action.magnetize.speed,
      });
    }
  }

  private _extractTag(p: string): string | null {
    if (p.startsWith('[') && p.endsWith(']')) return p.slice(1, -1);
    return null;
  }

  private _updatePhysics(dt: number): void {
    // Update position and auto-flip for sprites with physics enabled
    for (const sprite of this._sprites.values()) {
      if (!sprite.exists) continue;

      if (sprite.physics) {
        sprite.x += sprite.vx * dt;
        sprite.y += sprite.vy * dt;
      }

      if (sprite.autoFlip && sprite.vx !== 0) {
        // For side-profile sprites: flip based on horizontal direction
        // Assumes sprite faces LEFT by default, flip when moving right
        sprite.flipX = sprite.vx > 0;
      }
    }
  }

  private _updateMagnetize(dt: number): void {
    if (this._magnetizeRules.length === 0) return;

    for (const rule of this._magnetizeRules) {
      // Collect sprites by tag (reuse arrays, no allocation)
      this._magnetizeGroupA.length = 0;
      this._magnetizeGroupB.length = 0;

      for (const sprite of this._sprites.values()) {
        if (!sprite.exists) continue;
        if (sprite.tags.includes(rule.tagA)) this._magnetizeGroupA.push(sprite);
        if (sprite.tags.includes(rule.tagB)) this._magnetizeGroupB.push(sprite);
      }

      // Move B toward closest A when in range (center-to-center)
      // (B = second pattern element = collision target, consistent with action semantics)
      for (const b of this._magnetizeGroupB) {
        const bCenterX = b.x + b.frameW / 2;
        const bCenterY = b.y + b.frameH / 2;
        let bestDist = rule.range;
        let bestA: InternalSprite | null = null;

        for (const a of this._magnetizeGroupA) {
          const aCenterX = a.x + a.frameW / 2;
          const aCenterY = a.y + a.frameH / 2;
          const dx = aCenterX - bCenterX;
          const dy = aCenterY - bCenterY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < bestDist) { bestDist = dist; bestA = a; }
        }

        if (bestA && bestDist > 1) {
          const aCenterX = bestA.x + bestA.frameW / 2;
          const aCenterY = bestA.y + bestA.frameH / 2;
          const dx = aCenterX - bCenterX;
          const dy = aCenterY - bCenterY;
          const move = Math.min(rule.speed * dt, bestDist);
          b.x += (dx / bestDist) * move;
          b.y += (dy / bestDist) * move;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Collision Detection
  // ---------------------------------------------------------------------------

  private _updateCollisions(): void {
    if (!this._collisionSystem) return;

    const tileSize = this.config.settings.tileSize;

    // Convert sprites to collision data format
    const spriteData = new Map<string, SpriteData>();
    for (const [id, sprite] of this._sprites.entries()) {
      if (!sprite.exists) continue;
      spriteData.set(id, {
        id,
        type: sprite.type,
        x: sprite.x,
        y: sprite.y,
        vx: sprite.vx,
        vy: sprite.vy,
        tags: sprite.tags,
        exists: sprite.exists,
        width: sprite.frameW || tileSize,
        height: sprite.frameH || tileSize,
      });
    }

    // Run collision detection
    this._collisionSystem.update(spriteData, this._time, (aId, bId, pattern, action) => {
      const spriteA = this._sprites.get(aId);
      const spriteB = this._sprites.get(bId);
      if (!spriteA || !spriteB) return;

      // Call custom callbacks first
      const callbacks = this._collisionCallbacks.get(pattern);
      if (callbacks) {
        const proxyA = this._createSpriteProxy(spriteA);
        const proxyB = this._createSpriteProxy(spriteB);
        for (const callback of callbacks) {
          callback(proxyA, proxyB);
        }
      }

      // Handle built-in action or handler reference
      if (typeof action === 'string') {
        // It's a handler reference
        const handler = this.config.handlers?.[action];
        if (handler) {
          const proxyA = this._createSpriteProxy(spriteA);
          const proxyB = this._createSpriteProxy(spriteB);
          handler(proxyA, proxyB, this as unknown as import('./types').Glyft);
        }
      } else {
        // Apply collision action
        const proxyA = this._createSpriteProxy(spriteA);
        const proxyB = this._createSpriteProxy(spriteB);
        applyCollisionAction(action, proxyA, proxyB, {
          stats: this._stats,
          sounds: this.sounds,
          floatText: (x, y, text, opts) => this.floatText(x, y, text, opts),
        });

        // Emit particles at collision midpoint
        if (action.particles) {
          const cx = (spriteA.x + spriteB.x) / 2 + (spriteA.frameW + spriteB.frameW) / 4;
          const cy = (spriteA.y + spriteB.y) / 2 + (spriteA.frameH + spriteB.frameH) / 4;
          const [fx, fy] = this._fx(cx, cy);
          this._particleManager.emit(action.particles, fx, fy, this._time);
        }

        // Play collision sound if defined in sound rules
        this._triggerCollisionSound(spriteA, spriteB);
      }
    });
  }

  private _triggerCollisionSound(
    a: InternalSprite,
    b: InternalSprite
  ): void {
    // Find matching sound rule for this collision
    for (const [pattern, rule] of this._soundRules.entries()) {
      if (pattern.includes(':moving') || pattern.includes(':destroyed')) continue;

      const parts = pattern.split(':');
      if (parts.length !== 2) continue;

      const matchesA = this._matchesSpritePattern(parts[0], a);
      const matchesB = this._matchesSpritePattern(parts[1], b);

      if ((matchesA && matchesB) || (this._matchesSpritePattern(parts[0], b) && this._matchesSpritePattern(parts[1], a))) {
        // Check cooldown
        const lastPlayed = this._soundLastPlayed.get(pattern) ?? 0;
        const cooldown = typeof rule === 'string' ? 0 : (rule.cooldown ?? 0.1);
        if (this._time - lastPlayed < cooldown) continue;

        // Play sound
        const sound = typeof rule === 'string' ? rule : rule.sound;
        const volume = typeof rule === 'string' ? 1 : (rule.volume ?? 1);
        const finalVolume = Array.isArray(volume)
          ? volume[0] + Math.random() * (volume[1] - volume[0])
          : volume;

        this._soundManager.play(sound, {
          volume: finalVolume,
          x: (a.x + b.x) / 2 - this._camera.x,
        });

        this._soundLastPlayed.set(pattern, this._time);
        return; // Only play one sound per collision
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Reactive Sounds
  // ---------------------------------------------------------------------------

  private _updateReactiveSounds(): void {
    // Check each sound rule for movement patterns
    for (const [pattern, rule] of this._soundRules.entries()) {
      // Only process movement patterns (pattern:moving)
      if (!pattern.endsWith(':moving')) continue;

      const parsed = typeof rule === 'string'
        ? { sound: rule, interval: 0.25, cooldown: 0, volume: 1, pitch: 1, spatial: false }
        : { sound: rule.sound, interval: rule.interval ?? 0.25, cooldown: rule.cooldown ?? 0, volume: rule.volume ?? 1, pitch: rule.pitch ?? 1, spatial: rule.spatial ?? false };

      // Check cooldown/interval
      const lastPlayed = this._soundLastPlayed.get(pattern) ?? 0;
      const interval = parsed.interval > 0 ? parsed.interval : parsed.cooldown;
      if (this._time - lastPlayed < interval) continue;

      // Find sprites matching the pattern
      const basePattern = pattern.slice(0, -7); // Remove ':moving'

      for (const sprite of this._sprites.values()) {
        if (!sprite.exists || !sprite.sounds) continue;

        // Check if sprite is moving
        const isMoving = Math.abs(sprite.vx) > 0.5 || Math.abs(sprite.vy) > 0.5;
        if (!isMoving) continue;

        // Check if sprite matches pattern
        if (!this._matchesSpritePattern(basePattern, sprite)) continue;

        // Play sound
        const volume = Array.isArray(parsed.volume)
          ? parsed.volume[0] + Math.random() * (parsed.volume[1] - parsed.volume[0])
          : parsed.volume;
        const pitch = Array.isArray(parsed.pitch)
          ? parsed.pitch[0] + Math.random() * (parsed.pitch[1] - parsed.pitch[0])
          : parsed.pitch;

        this._soundManager.play(parsed.sound, {
          volume,
          pitch,
          x: parsed.spatial ? sprite.x - this._camera.x : undefined,
        });

        this._soundLastPlayed.set(pattern, this._time);
        break; // Only trigger once per pattern per frame
      }
    }
  }

  private _matchesSpritePattern(pattern: string, sprite: InternalSprite): boolean {
    // Tag pattern: [tag] or [tag1,tag2]
    if (pattern.startsWith('[') && pattern.endsWith(']')) {
      const tagList = pattern.slice(1, -1).split(',');
      return tagList.every((tag) => sprite.tags.includes(tag.trim()));
    }

    // Wildcard: name*
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return sprite.type.startsWith(prefix);
    }

    // Exact match
    return sprite.type === pattern;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private _initShaders(): void {
    this._spriteShader = compileShader(
      this.gl,
      spriteVertexShader,
      spriteFragmentShader,
      ['u_projection', 'u_time', 'u_atlasSize', 'u_cameraPos', 'u_spriteMode', 'u_atlas', 'u_shadowPass'],
      ['a_position', 'a_posVel', 'a_frame', 'a_props', 'a_anim']
    );

    this._tilemapShader = compileShader(
      this.gl,
      tilemapVertexShader,
      tilemapFragmentShader,
      ['u_projection', 'u_mapTexture', 'u_atlasTexture', 'u_mapSize', 'u_tileSize', 'u_atlasSize', 'u_tilesPerRow', 'u_time', 'u_cameraPos', 'u_viewportSize'],
      ['a_position']
    );
  }

  private _initBuffers(): void {
    const gl = this.gl;

    // Quad geometry (for tilemaps and as base for sprites)
    const quadVertices = new Float32Array([
      0, 0, 1, 0, 0, 1,
      1, 0, 1, 1, 0, 1,
    ]);

    this._quadVAO = createVAO(gl);
    gl.bindVertexArray(this._quadVAO);

    this._quadBuffer = createBuffer(gl, quadVertices.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    // Sprite instance buffer (will be resized as needed)
    this._spriteVAO = createVAO(gl);
    gl.bindVertexArray(this._spriteVAO);

    // Quad vertices for sprites
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance buffer
    this._spriteInstanceBuffer = createBuffer(gl);
    // Will set up attributes when we have sprite data

    gl.bindVertexArray(null);
  }

  private _initOverlay(): void {
    const gl = this.gl;

    this._overlayCanvas = document.createElement('canvas');
    this._overlayCtx = this._overlayCanvas.getContext('2d')!;
    this._overlayTexture = gl.createTexture()!;
    this._sizeOverlay();
    gl.bindTexture(gl.TEXTURE_2D, this._overlayTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._overlayShader = compileShader(
      gl,
      overlayVertexShader,
      overlayFragmentShader,
      ['u_overlayTexture'],
      ['a_position'],
    );

    this._overlayActive = true;
  }

  /**
   * Match the overlay to the backing resolution. Drawing stays in viewport units
   * (the context is scaled), so HUD text is as sharp as the screen allows.
   * Resizing clears the canvas, so this only runs when the size actually changes.
   */
  private _sizeOverlay(): void {
    if (!this._overlayCanvas || !this._overlayCtx) return;
    const [vw, vh] = this.config.settings.viewport;
    const w = Math.round(vw * this._renderScale), h = Math.round(vh * this._renderScale);
    if (this._overlayCanvas.width === w && this._overlayCanvas.height === h) return;
    this._overlayCanvas.width = w;
    this._overlayCanvas.height = h;
    this._overlayCtx.setTransform(w / vw, 0, 0, h / vh, 0, 0);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this._overlayTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  private _renderOverlay(): void {
    if (!this._overlayActive || !this._overlayCanvas || !this._overlayTexture || !this._overlayShader) return;

    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this._overlayTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._overlayCanvas);

    gl.useProgram(this._overlayShader.program);
    gl.bindVertexArray(this._quadVAO);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._overlayTexture);
    gl.uniform1i(this._overlayShader.uniforms['u_overlayTexture'], 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private _renderBackground(): void {
    if (!this._bgTexture || !this._bgShader) return;

    const gl = this.gl;
    const viewport = this.config.settings.viewport;

    // Disable blending for opaque background
    gl.disable(gl.BLEND);

    gl.useProgram(this._bgShader.program);
    gl.bindVertexArray(this._quadVAO);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._bgTexture);

    // Round camera to prevent sub-pixel shimmer
    const camX = Math.round(this._camera.x);
    const camY = Math.round(this._camera.y);

    gl.uniform2f(this._bgShader.uniforms['u_viewport'], viewport[0], viewport[1]);
    gl.uniform2f(this._bgShader.uniforms['u_worldSize'], this._bgWorldWidth, this._bgWorldHeight);
    gl.uniform2f(this._bgShader.uniforms['u_camera'], camX, camY);
    gl.uniform1i(this._bgShader.uniforms['u_texture'], 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    // Re-enable blending for sprites/particles
    gl.enable(gl.BLEND);
  }

  private _render(): void {
    const gl = this.gl;
    const viewport = this.config.settings.viewport;

    // Resize canvas if needed (backing store at on-screen resolution)
    this._renderScale = this._computeRenderScale();
    resizeCanvas(this.canvas, viewport, this._renderScale);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (this._world) {
      this._render3D();
      return;
    }

    // Clear
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Update camera
    this._camera.update(this._dt);

    // Render background (behind everything)
    this._renderBackground();

    // Calculate projection matrix (orthographic, pixel-perfect)
    const projection = this._calculateProjection();

    // Render tilemaps
    this._renderTilemaps(projection);

    // Render sprites
    this._renderSprites(projection);

    // Render labels (above sprites, below float text)
    this._labelManager.updatePositions(
      this._sprites as unknown as Map<string, LabelSpriteData>,
      this._camera.x, this._camera.y,
      viewport[0], viewport[1],
      this._hoveredSprite?.id ?? null,
    );
    this._labelManager.render(projection, this._camera.x, this._camera.y);

    // Render HP bars (between labels and float text)
    const activeHpSlots: number[] = [];
    this._sprites.forEach((s) => {
      if (s.exists && s.hpBarVisible && s.labelSlot >= 0) {
        activeHpSlots.push(s.labelSlot);
      }
    });
    this._hpBarManager.updateActiveSlots(activeHpSlots);
    this._hpBarManager.render(projection, this._camera.x, this._camera.y);

    // Render particles (after HP bars, before float text)
    this._particleManager.render(projection, this._time, this._camera.x, this._camera.y);

    // Render arc effects (melee swings, after particles)
    this._arcManager.render(projection, this._time, this._camera.x, this._camera.y);

    // Render ring effects (shockwaves, after arcs)
    this._ringManager.render(projection, this._time, this._camera.x, this._camera.y);

    // Render floating text (on top of everything except overlay)
    this._floatTextManager.render(projection, this._time, this._camera.x, this._camera.y);

    // Render overlay (screen-space Canvas2D → WebGL texture)
    this._renderOverlay();
  }

  /** 3D frame: world first, then 2D effects projected to the screen (camera at 0,0). */
  private _render3D(): void {
    const gl = this.gl;
    const world = this._world!;
    const viewport = this.config.settings.viewport;
    const [cr, cg, cb] = world.clearColor();
    gl.clearColor(cr, cg, cb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    world.render(this._dt, this._sprites, this._time, this.canvas.width, this.canvas.height);

    const projection = this._calculateProjection();
    const sx = viewport[0] / this.canvas.width;
    const sy = viewport[1] / this.canvas.height;
    const pxScale = this.config.world?.spriteScale ?? 1 / this.config.settings.tileSize;

    // Labels and HP bars read sprite positions: feed them screen positions above each head
    const screen = this._labelScreen;
    const ride = world.ride;
    for (const s of this._sprites.values()) {
      if (s.labelSlot < 0) continue;
      let entry = screen.get(s.id);
      if (!entry) {
        entry = { id: s.id, x: 0, y: 0, frameW: 0, exists: true, labelSlot: -1, labelVisible: 'always', labelRange: 0, hpBarVisible: false };
        screen.set(s.id, entry);
      }
      // While riding, only the rider's name shows, above whatever is tallest (rider on a mount, the boat)
      const vehicle = ride && s.id === ride.rider ? this._sprites.get(ride.vehicle) : undefined;
      const hiddenVehicle = !!ride && s.id === ride.vehicle;
      let head = world.spriteHeight(s) + s.frameH * pxScale * s.scale;
      // (a ship's frame is its footprint, which overstates its height, so its label sits a bit lower)
      if (vehicle) head = Math.max(head, world.spriteHeight(vehicle) + vehicle.frameH * pxScale * vehicle.scale * (vehicle.alpha > 0 && s.alpha === 0 ? 0.55 : 1));
      const visible = s.exists && !hiddenVehicle && (s.alpha > 0 || !!vehicle);
      const p = visible ? world.project(s.x + s.frameW / 2, s.y + s.frameH / 2, head) : null;
      entry.exists = !!p;
      entry.frameW = s.frameW;
      entry.x = p ? p[0] * sx - s.frameW / 2 : 0;
      entry.y = p ? p[1] * sy : 0;
      entry.labelSlot = s.labelSlot;
      entry.labelVisible = s.labelVisible === 'proximity' ? 'always' : s.labelVisible;
      entry.labelRange = s.labelRange;
      entry.hpBarVisible = s.hpBarVisible;
    }
    if (screen.size > this._sprites.size) {
      for (const id of screen.keys()) if (!this._sprites.has(id)) screen.delete(id);
    }
    this._labelManager.updatePositions(screen, 0, 0, viewport[0], viewport[1], this._hoveredSprite?.id ?? null);
    this._labelManager.render(projection, 0, 0);

    const activeHpSlots: number[] = [];
    this._sprites.forEach((s) => {
      if (s.exists && s.hpBarVisible && s.labelSlot >= 0) activeHpSlots.push(s.labelSlot);
    });
    this._hpBarManager.updateActiveSlots(activeHpSlots);
    this._hpBarManager.render(projection, 0, 0);

    this._particleManager.render(projection, this._time, 0, 0);
    this._arcManager.render(projection, this._time, 0, 0);
    this._ringManager.render(projection, this._time, 0, 0);
    this._floatTextManager.render(projection, this._time, 0, 0);

    // Area transitions fade through black (over the HUD too)
    if (world.fade > 0) {
      const ctx = this.overlay;
      ctx.fillStyle = `rgba(0, 0, 0, ${world.fade})`;
      ctx.fillRect(0, 0, viewport[0], viewport[1]);
    }
    this._renderOverlay();
  }

  private _calculateProjection(): Float32Array {
    const viewport = this.config.settings.viewport;
    const scaleX = 2 / viewport[0];
    const scaleY = -2 / viewport[1];
    const offsetX = -1;
    const offsetY = 1;

    // 3x3 matrix (column-major)
    return new Float32Array([
      scaleX, 0, 0,
      0, scaleY, 0,
      offsetX, offsetY, 1,
    ]);
  }

  private _renderTilemaps(projection: Float32Array): void {
    const gl = this.gl;
    const viewport = this.config.settings.viewport;
    const tileSize = this.config.settings.tileSize;

    gl.useProgram(this._tilemapShader.program);
    gl.bindVertexArray(this._quadVAO);

    gl.uniformMatrix3fv(this._tilemapShader.uniforms.u_projection, false, projection);
    gl.uniform1f(this._tilemapShader.uniforms.u_time, this._time);
    gl.uniform2f(this._tilemapShader.uniforms.u_tileSize, tileSize, tileSize);
    gl.uniform2f(this._tilemapShader.uniforms.u_viewportSize, viewport[0], viewport[1]);
    gl.uniform2f(this._tilemapShader.uniforms.u_cameraPos, this._camera.x, this._camera.y);

    for (const tilemap of this._tilemaps) {
      // Update data texture if dirty
      if (tilemap.dirty) {
        gl.bindTexture(gl.TEXTURE_2D, tilemap.dataTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tilemap.width, tilemap.height, gl.RGBA, gl.UNSIGNED_BYTE, tilemap.data);
        tilemap.dirty = false;
      }

      // Bind textures
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tilemap.dataTexture);
      gl.uniform1i(this._tilemapShader.uniforms.u_mapTexture, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tilemap.atlas.texture);
      gl.uniform1i(this._tilemapShader.uniforms.u_atlasTexture, 1);

      gl.uniform2f(this._tilemapShader.uniforms.u_mapSize, tilemap.width, tilemap.height);
      gl.uniform2f(this._tilemapShader.uniforms.u_atlasSize, tilemap.atlas.width, tilemap.atlas.height);
      gl.uniform1i(this._tilemapShader.uniforms.u_tilesPerRow, Math.floor(tilemap.atlas.width / tileSize));

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindVertexArray(null);
  }

  private _renderSprites(projection: Float32Array): void {
    if (this._sprites.size === 0) return;

    const gl = this.gl;
    const depthSort = this.config.settings.depthSort ?? 'none';

    // Keep last frame's order: drop dead sprites, append new ones, then fix the order.
    // Insertion sort on a nearly sorted list is close to O(n), so sorting every frame is cheap
    // and nothing flickers back to creation order between sorts.
    const cache = this._sortedSpriteCache;
    let w = 0;
    for (let i = 0; i < cache.length; i++) {
      if (cache[i].exists && this._sprites.get(cache[i].id) === cache[i]) cache[w++] = cache[i];
      else this._sortedIds.delete(cache[i].id);
    }
    cache.length = w;
    if (cache.length !== this._sprites.size) {
      for (const sprite of this._sprites.values()) {
        if (sprite.exists && !this._sortedIds.has(sprite.id)) {
          cache.push(sprite);
          this._sortedIds.add(sprite.id);
        }
      }
    }

    if (depthSort !== 'none') {
      const key = depthSort === 'z'
        ? (s: InternalSprite) => s.z
        : depthSort === 'zy'
          ? (s: InternalSprite) => s.z * 1e7 + s.y + s.frameH
          : (s: InternalSprite) => s.y + s.frameH;
      for (let i = 1; i < cache.length; i++) {
        const item = cache[i];
        const k = key(item);
        let j = i - 1;
        while (j >= 0 && key(cache[j]) > k) { cache[j + 1] = cache[j]; j--; }
        cache[j + 1] = item;
      }
    }

    // Group sprites by atlas (preserving sort order)
    const spritesByAtlas = new Map<InternalAtlas, InternalSprite[]>();
    for (const sprite of this._sortedSpriteCache) {
      const list = spritesByAtlas.get(sprite.atlas) ?? [];
      list.push(sprite);
      spritesByAtlas.set(sprite.atlas, list);
    }

    // Use sprite shader
    gl.useProgram(this._spriteShader.program);

    // Set uniforms
    gl.uniformMatrix3fv(this._spriteShader.uniforms.u_projection, false, projection);
    gl.uniform1f(this._spriteShader.uniforms.u_time, this._time);
    gl.uniform2f(this._spriteShader.uniforms.u_cameraPos, this._camera.x, this._camera.y);
    gl.uniform1i(this._spriteShader.uniforms.u_spriteMode, this._getSpriteMode());
    gl.uniform1i(this._spriteShader.uniforms.u_shadowPass, 0);

    // Render each atlas group
    for (const [atlas, sprites] of spritesByAtlas) {
      this._renderSpriteGroup(atlas, sprites);
    }
  }

  private _getSpriteMode(): number {
    const mode = this.config.settings.spriteMode ?? '4dir';
    switch (mode) {
      case '4dir': return 0;
      case '8dir': return 1;
      case '2dir-side': return 2;
      case '2dir-top': return 3;
      case '1dir': return 4;
      case 'iso4': return 5;
      case 'iso8': return 6;
      default: return 0;
    }
  }

  // Reusable buffer for tint packing (avoids per-frame allocation)
  private _tintU32 = new Uint32Array(1);
  private _tintF32 = new Float32Array(this._tintU32.buffer);
  private _flagsU32 = new Uint32Array(1);
  private _flagsF32 = new Float32Array(this._flagsU32.buffer);
  private _glowColorU32 = new Uint32Array(1);
  private _glowColorF32 = new Float32Array(this._glowColorU32.buffer);

  private _renderSpriteGroup(atlas: InternalAtlas, sprites: InternalSprite[]): void {
    const gl = this.gl;

    // Build instance data
    // Per-instance: posVel(4) + frame(4) + props(4) + anim(4) + glow(4) + shadow(4) = 24 floats = 96 bytes
    const FLOATS_PER_INSTANCE = 24;
    const instanceData = new Float32Array(sprites.length * FLOATS_PER_INSTANCE);
    let hasShadows = false;
    let hasGlow = false;
    const flashNow = Date.now();

    for (let i = 0; i < sprites.length; i++) {
      const sprite = sprites[i];
      const offset = i * FLOATS_PER_INSTANCE;
      if (sprite.shadow) hasShadows = true;
      if (sprite.glow > 0) hasGlow = true;

      // Check for named animation override — CPU drives the frame
      const namedAnim = sprite.animOverride ? sprite.animations.get(sprite.animOverride) : null;

      // a_posVel: x, y, vx, vy
      instanceData[offset + 0] = sprite.x;
      instanceData[offset + 1] = sprite.y;
      instanceData[offset + 2] = sprite.vx;
      instanceData[offset + 3] = sprite.vy;

      if (namedAnim) {
        // Named animation: CPU computes exact frame position
        const frameIdx = sprite.animCurrentFrame >= 0 ? sprite.animCurrentFrame : 0;
        const col = namedAnim.frames[frameIdx] ?? 0;
        const row = namedAnim.row ?? sprite.lastDirection;

        // a_frame: exact pixel position of this frame
        instanceData[offset + 4] = sprite.frameX + col * sprite.frameW;
        instanceData[offset + 5] = sprite.frameY + row * sprite.frameH;
        instanceData[offset + 6] = sprite.frameW;
        instanceData[offset + 7] = sprite.frameH;

        // Mark as override with 0 walk frames so shader shows exactly this frame
        instanceData[offset + 12] = 1; // idleFrames = 1 (show this single frame)
        instanceData[offset + 13] = 0; // walkFrames = 0
        instanceData[offset + 14] = 0; // fps = 0 (static)
        // hasOverride = 1 so shader uses idle frame at computed position
        const flipXFlag = sprite.flipX ? 2 : 0;
        const flipYFlag = sprite.flipY ? 4 : 0;
        const shadowBit = sprite.shadow ? 8 : 0;
        const lastDirBits = (0 & 0xF) << 8; // row 0 — already baked into frame position
        const bobAmpBits = (Math.round(sprite.bob) & 0xFF) << 12;
        const bobSpdBits = (Math.round(sprite.bobSpeed * 10) & 0xFF) << 20;
        this._flagsU32[0] = 1 | flipXFlag | flipYFlag | shadowBit | lastDirBits | bobAmpBits | bobSpdBits;
        instanceData[offset + 15] = this._flagsF32[0];
      } else {
        // Velocity-driven GPU animation (standard path)
        instanceData[offset + 4] = sprite.frameX;
        instanceData[offset + 5] = sprite.frameY;
        instanceData[offset + 6] = sprite.frameW;
        instanceData[offset + 7] = sprite.frameH;

        // Update lastDirection based on current velocity (for idle facing)
        if (Math.abs(sprite.vx) > 0.5 || Math.abs(sprite.vy) > 0.5) {
          if (Math.abs(sprite.vx) > Math.abs(sprite.vy)) {
            sprite.lastDirection = sprite.vx > 0 ? 1 : 3; // Right or Left
          } else {
            sprite.lastDirection = sprite.vy > 0 ? 0 : 2; // Down or Up
          }
        }

        // a_anim: idleFrames, walkFrames, fps, flags (bit-cast uint32 → float)
        const hasOverride = sprite.animOverride !== null ? 1 : 0;
        const flipXFlag = sprite.flipX ? 2 : 0;
        const flipYFlag = sprite.flipY ? 4 : 0;
        const shadowBit = sprite.shadow ? 8 : 0;
        const rowOffsetBits = (sprite.rowOffset & 0xF) << 4;  // Bits 4-7: rowOffset
        const lastDirBits = (sprite.lastDirection & 0xF) << 8;
        const bobAmpBits = (Math.round(sprite.bob) & 0xFF) << 12;
        const bobSpdBits = (Math.round(sprite.bobSpeed * 10) & 0xFF) << 20;
        const clipBottomBits = (Math.round(sprite.clipBottom * 15) & 0xF) << 28;  // Bits 28-31: clipBottom (0-15 = 0.0-1.0)
        this._flagsU32[0] = hasOverride | flipXFlag | flipYFlag | shadowBit | rowOffsetBits | lastDirBits | bobAmpBits | bobSpdBits | clipBottomBits;
        instanceData[offset + 15] = this._flagsF32[0];

        instanceData[offset + 12] = sprite.idleFrames;
        instanceData[offset + 13] = sprite.walkFrames;
        instanceData[offset + 14] = sprite.fps;
      }

      // a_props: rotation, scaleX, alpha, tint (packed)
      instanceData[offset + 8] = sprite.rotation;
      instanceData[offset + 9] = sprite.scaleX;
      instanceData[offset + 10] = sprite.alpha;

      // Pack tint as uint32 bits into float (reuse buffer to avoid allocation)
      // Collision 'flash' action: tint until the flash ends
      const flashUntil = sprite.data._flashUntil as number | undefined;
      const tint = flashUntil !== undefined && flashUntil > flashNow ? (sprite.data._flashColor as number) ?? 0xff0000 : sprite.tint;
      this._tintU32[0] = tint | 0xFF000000;
      instanceData[offset + 11] = this._tintF32[0];

      // a_glow: intensity, color (packed), radius, shadowOffsetY
      instanceData[offset + 16] = sprite.glow;
      // Pack glow color (use tint if glowColor is null)
      const glowColorValue = sprite.glowColor !== null ? sprite.glowColor : sprite.tint;
      this._glowColorU32[0] = glowColorValue | 0xFF000000;
      instanceData[offset + 17] = this._glowColorF32[0];
      instanceData[offset + 18] = sprite.glowRadius;
      instanceData[offset + 19] = sprite.shadowOffsetY;

      // a_shadow: scale, alpha, visualOffsetY, scaleY
      instanceData[offset + 20] = sprite.shadowScale;
      instanceData[offset + 21] = sprite.shadowAlpha;
      instanceData[offset + 22] = sprite.visualOffsetY;
      instanceData[offset + 23] = sprite.scaleY;
    }

    // Bind VAO and update instance buffer
    gl.bindVertexArray(this._spriteVAO);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._spriteInstanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);

    // Set up instance attributes
    const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

    // a_posVel (location 1)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    // a_frame (location 2)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    gl.vertexAttribDivisor(2, 1);

    // a_props (location 3)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 32);
    gl.vertexAttribDivisor(3, 1);

    // a_anim (location 4)
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 48);
    gl.vertexAttribDivisor(4, 1);

    // a_glow (location 5)
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 64);
    gl.vertexAttribDivisor(5, 1);

    // a_shadow (location 6)
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 80);
    gl.vertexAttribDivisor(6, 1);

    // Bind atlas texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
    gl.uniform1i(this._spriteShader.uniforms.u_atlas, 0);
    gl.uniform2f(this._spriteShader.uniforms.u_atlasSize, atlas.width, atlas.height);

    // Three-pass rendering: glow first, then shadows, then sprites
    // Glow pass: additive blending, expanded scaled sprites
    if (hasGlow) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending
      gl.uniform1i(this._spriteShader.uniforms.u_shadowPass, 2); // 2 = glow pass
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, sprites.length);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // Restore normal blending
    }

    // Shadow pass
    if (hasShadows) {
      gl.uniform1i(this._spriteShader.uniforms.u_shadowPass, 1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, sprites.length);
    }

    // Normal sprite pass
    gl.uniform1i(this._spriteShader.uniforms.u_shadowPass, 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, sprites.length);

    gl.bindVertexArray(null);
  }
}
