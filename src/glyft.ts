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
import { overlayVertexShader, overlayFragmentShader } from './shaders/overlay';

// -----------------------------------------------------------------------------
// Internal Types
// -----------------------------------------------------------------------------

interface InternalSprite {
  id: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  scale: number;
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
  glow: number;
  glowColor: number | null;
  glowRadius: number;
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

  // Overlay (lazy init — only created when game.overlay is accessed)
  private _overlayCanvas: HTMLCanvasElement | null = null;
  private _overlayCtx: CanvasRenderingContext2D | null = null;
  private _overlayTexture: WebGLTexture | null = null;
  private _overlayShader: ShaderProgram | null = null;
  private _overlayActive = false;

  // Depth sorting
  private _depthSortCounter = 0;
  private _sortedSpriteCache: InternalSprite[] = [];

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

    // Initialize WebGL
    this.gl = createContext(canvas);
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

    // Pointer event dispatch (click → sprite callbacks + game-level event)
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // Primary button only
      const pointer = this._input.pointer;
      const worldX = pointer.x + this._camera.x;
      const worldY = pointer.y + this._camera.y;

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
        const pointer = this._input.pointer;
        this._fireSpriteEvent(this._hoveredSprite, 'pointerout',
          pointer.x + this._camera.x, pointer.y + this._camera.y);
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
    this.gl.clearColor(r, g, b, 1);

    // Enable blending for sprite transparency
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
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

  get overlay(): CanvasRenderingContext2D {
    if (!this._overlayCtx) this._initOverlay();
    return this._overlayCtx!;
  }

  // ---------------------------------------------------------------------------
  // Asset Loading
  // ---------------------------------------------------------------------------

  /**
   * Create a procedural test atlas for development.
   * Generates colored tiles plus an animated character sprite.
   *
   * Layout:
   * - Rows 0-3: Regular tiles (colored grid)
   * - Rows 4-7: Player sprite (4 directions x 5 frames)
   */
  createTestAtlas(name: string, tilesX: number, tilesY: number): Atlas {
    const tileSize = this.config.settings.tileSize;
    const width = tilesX * tileSize;
    const height = tilesY * tileSize;

    // Create canvas and draw test pattern
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Draw colored tiles for tilemap
    for (let y = 0; y < 4 && y < tilesY; y++) {
      for (let x = 0; x < tilesX; x++) {
        const hue = ((x + y * tilesX) * 30) % 360;
        ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);

        // Border
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);

        // Label
        ctx.fillStyle = 'white';
        ctx.font = '8px monospace';
        ctx.fillText(`${x + y * tilesX}`, x * tileSize + 2, y * tileSize + 10);
      }
    }

    // Draw animated character sprite (rows 4-7 for 4 directions)
    // 5 frames: 1 idle + 4 walk
    // Triangles point in direction of movement and bob during walk
    const dirAngles = [Math.PI / 2, 0, -Math.PI / 2, Math.PI]; // Down, Right, Up, Left
    const dirColors = ['#4a90d9', '#5cb85c', '#d9534f', '#f0ad4e']; // Blue, Green, Red, Orange

    for (let dir = 0; dir < 4; dir++) {
      const rowY = (4 + dir) * tileSize;
      if (rowY >= height) continue;

      for (let frame = 0; frame < 5; frame++) {
        const frameX = frame * tileSize;
        if (frameX >= width) continue;

        // Background
        ctx.fillStyle = dirColors[dir];
        ctx.fillRect(frameX, rowY, tileSize, tileSize);

        // Walk animation: bob up/down
        const isWalking = frame > 0;
        const bobOffset = isWalking ? Math.sin((frame - 1) * Math.PI / 2) * 2 : 0;

        // Draw body circle
        const centerX = frameX + tileSize / 2;
        const centerY = rowY + tileSize / 2 + bobOffset;
        const bodyRadius = tileSize / 3;

        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(centerX, centerY, bodyRadius, 0, Math.PI * 2);
        ctx.fill();

        // Draw direction triangle
        const triangleSize = tileSize / 4;
        const angle = dirAngles[dir];

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        // Triangle pointing in direction
        ctx.moveTo(
          centerX + Math.cos(angle) * triangleSize,
          centerY + Math.sin(angle) * triangleSize
        );
        ctx.lineTo(
          centerX + Math.cos(angle + 2.4) * triangleSize * 0.7,
          centerY + Math.sin(angle + 2.4) * triangleSize * 0.7
        );
        ctx.lineTo(
          centerX + Math.cos(angle - 2.4) * triangleSize * 0.7,
          centerY + Math.sin(angle - 2.4) * triangleSize * 0.7
        );
        ctx.closePath();
        ctx.fill();
      }
    }

    // Create WebGL texture from canvas
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

    // Create player sprite frame (base position for animation)
    // Points to row 4 (first direction row), the shader handles animation
    atlas.frames.set('player', { x: 0, y: 4 * tileSize, w: tileSize, h: tileSize });

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
  async loadTexture(key: string, url: string, options?: { frameWidth?: number; frameHeight?: number }): Promise<Atlas> {
    const texture = await loadTexture(this.gl, url);

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
        tilemap.data[i] = tileIndex; // R = tile index
        tilemap.dirty = true;
      },

      get: (x: number, y: number): number => {
        if (x < 0 || x >= tilemap.width || y < 0 || y >= tilemap.height) return 0;
        const i = (y * tilemap.width + x) * 4;
        return tilemap.data[i];
      },

      fill: (x: number, y: number, w: number, h: number, tileIndex: number) => {
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const tx = x + dx;
            const ty = y + dy;
            if (tx >= 0 && tx < tilemap.width && ty >= 0 && ty < tilemap.height) {
              const i = (ty * tilemap.width + tx) * 4;
              tilemap.data[i] = tileIndex;
            }
          }
        }
        tilemap.dirty = true;
      },

      setRegion: (x: number, y: number, data: number[][]) => {
        for (let dy = 0; dy < data.length; dy++) {
          for (let dx = 0; dx < data[dy].length; dx++) {
            const tx = x + dx;
            const ty = y + dy;
            if (tx >= 0 && tx < tilemap.width && ty >= 0 && ty < tilemap.height) {
              const i = (ty * tilemap.width + tx) * 4;
              tilemap.data[i] = data[dy][dx];
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
      vx: 0,
      vy: 0,
      rotation: 0,
      scale: 1,
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
      glow: 0,
      glowColor: null,
      glowRadius: 1.5,
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
      set scale(v: number) { sprite.scale = v; },
      get alpha() { return sprite.alpha; },
      set alpha(v: number) { sprite.alpha = v; },
      get tint() { return sprite.tint; },
      set tint(v: number) { sprite.tint = v; },
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
      get shadow() { return sprite.shadow; },
      set shadow(v: boolean) { sprite.shadow = v; },
      get glow() { return sprite.glow; },
      set glow(v: number) { sprite.glow = Math.min(1, Math.max(0, v)); },
      get glowColor() { return sprite.glowColor; },
      set glowColor(v: number | null) { sprite.glowColor = v; },
      get glowRadius() { return sprite.glowRadius; },
      set glowRadius(v: number) { sprite.glowRadius = Math.max(1, v); },
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

  /** Spawn floating text at world position */
  floatText(x: number, y: number, text: string, options?: import('./types').FloatTextOptions): void {
    this._floatTextManager.spawn(x, y, text, this._time, options);
  }

  /** Particle system: define emitters and emit bursts */
  get particles() {
    const self = this;
    return {
      define(name: string, def: import('./types').ParticleEmitterDef) { self._particleManager.define(name, def); },
      emit(name: string, x: number, y: number) { self._particleManager.emit(name, x, y, self._time); },
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
    },
    on: (pattern: string, callback: (a: Sprite, b: Sprite) => void) => {
      const callbacks = this._collisionCallbacks.get(pattern) ?? [];
      callbacks.push(callback);
      this._collisionCallbacks.set(pattern, callbacks);
    },
  };

  // ---------------------------------------------------------------------------
  // Game Loop
  // ---------------------------------------------------------------------------

  onUpdate(callback: (dt: number) => void): void {
    this._updateCallbacks.push(callback);
  }

  start(): void {
    this._running = true;
    this._lastFrameTime = performance.now();
    this._loop();
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
      this._parseMagnetizeRules();
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

    // Update tweens
    this._tweenManager.update(this._dt * 1000);

    // Advance named animations (CPU-driven override frame advancement)
    this._updateAnimations();

    // Update pointer hover tracking (fires pointerover/pointerout)
    this._updatePointerEvents();

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

    // Clear overlay canvas before addons draw on it
    if (this._overlayActive && this._overlayCtx) {
      this._overlayCtx.clearRect(0, 0, this._overlayCanvas!.width, this._overlayCanvas!.height);
    }

    // Addon: postPhysics (after collisions, before render)
    for (const addon of this._addons) addon.postPhysics?.(this._dt);

    // Update floating text (expire old entries)
    this._floatTextManager.update(this._time);

    // Update particles (expire dead particles)
    this._particleManager.update(this._time);

    // Clear per-frame input state (justPressed/justReleased)
    this._input.update();

    // Render
    this._render();

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
    const pointer = this._input.pointer;
    const worldX = pointer.x + this._camera.x;
    const worldY = pointer.y + this._camera.y;

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
          floatText: (x, y, text, opts) => this._floatTextManager.spawn(x, y, text, this._time, opts),
        });

        // Emit particles at collision midpoint
        if (action.particles) {
          const cx = (spriteA.x + spriteB.x) / 2 + (spriteA.frameW + spriteB.frameW) / 4;
          const cy = (spriteA.y + spriteB.y) / 2 + (spriteA.frameH + spriteB.frameH) / 4;
          this._particleManager.emit(action.particles, cx, cy, this._time);
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
    const viewport = this.config.settings.viewport;

    this._overlayCanvas = document.createElement('canvas');
    this._overlayCanvas.width = viewport[0];
    this._overlayCanvas.height = viewport[1];
    this._overlayCtx = this._overlayCanvas.getContext('2d')!;

    this._overlayTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this._overlayTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, viewport[0], viewport[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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

  private _render(): void {
    const gl = this.gl;
    const viewport = this.config.settings.viewport;

    // Resize canvas if needed
    resizeCanvas(this.canvas, viewport);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Clear
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Update camera
    this._camera.update(this._dt);

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

    // Render floating text (on top of everything except overlay)
    this._floatTextManager.render(projection, this._time, this._camera.x, this._camera.y);

    // Render overlay (screen-space Canvas2D → WebGL texture)
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
    const depthSortInterval = this.config.settings.depthSortInterval ?? 5;

    // Collect live sprites
    this._sortedSpriteCache.length = 0;
    for (const sprite of this._sprites.values()) {
      if (!sprite.exists) continue;
      this._sortedSpriteCache.push(sprite);
    }

    // Y-depth sort (throttled)
    if (depthSort === 'y') {
      this._depthSortCounter++;
      if (this._depthSortCounter >= depthSortInterval) {
        this._depthSortCounter = 0;
        this._sortedSpriteCache.sort((a, b) => (a.y + a.frameH) - (b.y + b.frameH));
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
    // Per-instance: posVel(4) + frame(4) + props(4) + anim(4) + glow(4) = 20 floats = 80 bytes
    const FLOATS_PER_INSTANCE = 20;
    const instanceData = new Float32Array(sprites.length * FLOATS_PER_INSTANCE);
    let hasShadows = false;
    let hasGlow = false;

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
        const lastDirBits = (sprite.lastDirection & 0xF) << 8;
        const bobAmpBits = (Math.round(sprite.bob) & 0xFF) << 12;
        const bobSpdBits = (Math.round(sprite.bobSpeed * 10) & 0xFF) << 20;
        this._flagsU32[0] = hasOverride | flipXFlag | flipYFlag | shadowBit | lastDirBits | bobAmpBits | bobSpdBits;
        instanceData[offset + 15] = this._flagsF32[0];

        instanceData[offset + 12] = sprite.idleFrames;
        instanceData[offset + 13] = sprite.walkFrames;
        instanceData[offset + 14] = sprite.fps;
      }

      // a_props: rotation, scale, alpha, tint (packed)
      instanceData[offset + 8] = sprite.rotation;
      instanceData[offset + 9] = sprite.scale;
      instanceData[offset + 10] = sprite.alpha;

      // Pack tint as uint32 bits into float (reuse buffer to avoid allocation)
      this._tintU32[0] = sprite.tint | 0xFF000000;
      instanceData[offset + 11] = this._tintF32[0];

      // a_glow: intensity, color (packed), radius, unused
      instanceData[offset + 16] = sprite.glow;
      // Pack glow color (use tint if glowColor is null)
      const glowColorValue = sprite.glowColor !== null ? sprite.glowColor : sprite.tint;
      this._glowColorU32[0] = glowColorValue | 0xFF000000;
      instanceData[offset + 17] = this._glowColorF32[0];
      instanceData[offset + 18] = sprite.glowRadius;
      instanceData[offset + 19] = 0; // unused
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
