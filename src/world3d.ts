/**
 * 3D world: turns `config.world` into terrain, sky, camera, buildings,
 * models and ships, and lifts 2D sprites onto the terrain.
 *
 * Sprites keep their 2D coordinates (pixels on the ground plane).
 * One tile (tileSize px) is one world unit: world x = px / tileSize,
 * world z = py / tileSize, world y = ground height + elevation.
 */

import type { WorldConfig, World, WorldHit, ShipDef, BuildingPart, PlacementDef, PlacementRule, WorldArea } from './types';
import { createTerrainSystem, type TerrainSystem, type Lighting } from './terrain';
import { createBillboardSystem, type BillboardSprite, type BillboardSystem } from './billboard';
import { createMeshSystem, type MeshSystem, type MeshPart } from './mesh';
import { createModelSystem, type ModelSystem, type ModelInstance } from './model';
import { createShipSystem, SHIP_PRESETS, type ShipSystem, type ShipInstance } from './ships';
import { createSkySystem, type SkySystem } from './sky';
import { createCameraRig, type CameraRig } from './camera3d';
import { resolveHeightmap } from './heightmap';
import { loadWorldTexture, createMaterialAtlas } from './materials';
import { loadGltf } from './loaders/gltf';
import { sampleWaveHeight, sampleWaveNormal, waveParams } from './waves';
import { mat4Perspective, mat4LookAt, mat4Multiply, mat4Invert, project, vec3Normalize, type Mat4, type Vec3 } from './math3d';

/** The sprite fields the world reads and writes. GlyftEngine's internal sprites satisfy this. */
export interface WorldSprite {
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
  bob: number;
  bobSpeed: number;
  physics: boolean;
  exists: boolean;
  tags: string[];
  data: Record<string, unknown>;
  elevation: number;
  floats: boolean;
  visualOffsetY: number;
  frameX: number;
  frameY: number;
  frameW: number;
  frameH: number;
  idleFrames: number;
  walkFrames: number;
  fps: number;
  animOverride: string | null;
  animStartTime: number;
  animations: Map<string, { frames: number[]; fps: number }>;
  atlas: { name: string; texture: WebGLTexture; width: number; height: number };
}

export interface WorldHooks {
  /** Create a sprite of this type centred on a ground position; returns its id */
  spawn(type: string, cx: number, cy: number): string | null;
  destroy(id: string): void;
}

export interface WorldInput {
  isDown(key: string): boolean;
  justPressed(key: string): boolean;
}

export interface WorldSystem extends World {
  readonly ready: boolean;
  /** Footprint in pixels for ship/model sprite types, or null for billboards */
  footprintOf(type: string): [number, number] | null;
  /** Load assets and build GPU resources */
  load(): Promise<void>;
  /** Resolve world.spawns into positions. sizeOf gives a type's footprint in pixels. */
  planSpawns(sizeOf: (type: string) => number): { type: string; x: number; y: number; rotation: number; with?: Record<string, unknown> }[];
  /** How the world creates and removes sprites (attack hitboxes). Set by the engine. */
  setHooks(hooks: WorldHooks): void;
  /** Before physics: controller input */
  prePhysics(dt: number, sprites: Map<string, WorldSprite>, input: WorldInput): void;
  /** After physics: blocking, ground height, jumps, buoyancy, ship headings */
  postPhysics(dt: number, sprites: Map<string, WorldSprite>): void;
  /** Draw the world. engineTime is GlyftEngine time (for animation overrides). */
  render(dt: number, sprites: Map<string, WorldSprite>, engineTime: number, viewportW: number, viewportH: number): void;
  /** Ground-pixel position plus height (world units) to viewport pixels. Null when behind the camera. */
  project(px: number, py: number, height: number): [number, number] | null;
  /** World height of a sprite's feet (for effect anchoring) */
  spriteHeight(sprite: WorldSprite): number;
  /** Terrain or water surface height at a ground-pixel position, ignoring roofs (for effect anchoring) */
  surfaceAt(x: number, y: number): number;
  /** Background colour for the clear (fog colour) */
  clearColor(): Vec3;
  destroy(): void;
}

const DEFAULT_FOG: Vec3 = [0.62, 0.74, 0.86];
const DEFAULT_TERRAIN = { low: 'sand', mid: 'grass', steep: 'rock', high: 'snow' } as const;
const BOX_FACES = ['north', 'south', 'east', 'west', 'top', 'bottom'];
const ROOF_FACES = ['slope1', 'slope2', 'gable1', 'gable2', 'bottom'];
const WEDGE_FACES = ['slope', 'back', 'side1', 'side2', 'bottom'];
const WATER_STYLES = {
  ocean: { deepColor: [0.08, 0.22, 0.38] as [number, number, number], shallowColor: [0.18, 0.42, 0.55] as [number, number, number], alpha: 0.78, emissive: 0 },
  lake: { deepColor: [0.12, 0.26, 0.3] as [number, number, number], shallowColor: [0.24, 0.42, 0.42] as [number, number, number], alpha: 0.72, emissive: 0 },
  lava: { deepColor: [0.7, 0.15, 0.02] as [number, number, number], shallowColor: [1.0, 0.5, 0.1] as [number, number, number], alpha: 1, emissive: 1 },
};

export function createWorldSystem(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  config: WorldConfig,
  tileSize: number,
  spriteMode: '4dir' | '8dir' | '1dir' = '4dir',
): WorldSystem {
  const pxScale = config.spriteScale ?? 1 / tileSize;
  const terrainDef = config.terrain;
  const water = terrainDef?.water;
  const waterHeight = water?.height ?? null;
  const shipTypes = new Map<string, ShipDef>(Object.entries(config.ships ?? {}));
  const modelTypes = new Map(Object.entries(config.models ?? {}));

  let ready = false;
  let terrain: TerrainSystem | null = null;
  let sky: SkySystem | null = null;
  let meshes: MeshSystem | null = null;
  let models: ModelSystem | null = null;
  let ships: ShipSystem | null = null;
  const billboards = new Map<string, BillboardSystem>();
  const rig: CameraRig = createCameraRig(canvas, config.camera ?? { mode: 'orbit' }, tileSize);

  let time = config.sky?.time ?? 0.4;
  const dayLength = config.sky?.dayLength ?? 0;
  let wind = config.wind ?? Math.PI / 4;
  let waves = water?.waves ?? 1;
  waveParams.scale = waves;
  let worldSize: [number, number] = [0, 0];

  const lighting: Lighting = {
    lightDir: vec3Normalize([0.3, 1.0, 0.5]),
    ambient: [0.35, 0.35, 0.4],
    light: [1.0, 0.95, 0.85],
    fogColor: terrainDef?.fog?.color != null ? hexToVec3(terrainDef.fog.color) : DEFAULT_FOG,
    fogNear: terrainDef?.fog?.near ?? 80,
    fogFar: terrainDef?.fog?.far ?? 260,
  };

  let vp: Mat4 = new Float32Array(16);
  let viewW = 1, viewH = 1;

  // Per-sprite state the 2D sprite doesn't carry
  const facing = new Map<string, number>();
  const prevPos = new Map<string, [number, number]>();
  const jumps = new Map<string, { t: number; base: number }>();
  const groundY = new Map<string, number>();
  const tilt = new Map<string, [number, number]>();
  const billboardCache = new Map<string, BillboardSprite>();
  const billboardGroups = new Map<string, { atlas: WorldSprite['atlas']; list: BillboardSprite[] }>();
  const modelInstances: ModelInstance[] = [];
  const staticModels: ModelInstance[] = [];
  const placedBuildings: { defId: string; x: number; y: number; z: number; rotation: number }[] = [];

  // ---- Placement rules ----
  // Everything placed so far (ground pixels), so later rules can keep clear or stay near it
  const occupied: { x: number; y: number; r: number; name: string }[] = [];
  const hm = terrainDef?.heightmap;
  let rngState = ((hm && typeof hm === 'object' && !Array.isArray(hm) ? hm.seed ?? 1 : 1) * 2654435761) >>> 0 || 1;
  const rand = () => {
    rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
    return (rngState >>> 0) / 4294967296;
  };

  function landWithin(wx: number, wz: number, dist: number): boolean {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      for (let d = 1; d <= dist; d++) {
        if (!isWaterAt(wx + Math.cos(ang) * d, wz + Math.sin(ang) * d)) return true;
      }
    }
    return false;
  }

  function inArea(px: number, py: number, area: Exclude<WorldArea, [number, number]>): boolean {
    const wx = px / tileSize, wz = py / tileSize;
    if (wx < 1 || wz < 1 || wx > worldSize[0] - 1 || wz > worldSize[1] - 1) return false;
    if (!terrain) return area === 'land' || area === 'flat';
    const h = terrainHeight(wx, wz);
    const wet = isWaterAt(wx, wz);
    const sea = waterHeight ?? -Infinity;
    const ny = terrain.getNormal(wx, wz)[1];
    switch (area) {
      case 'land': return !wet && h > sea + 0.3 && ny >= maxSlope && !(meshes?.isBlocked(wx, wz));
      case 'flat': return !wet && h > sea + 0.3 && ny > 0.93 && !(meshes?.isBlocked(wx, wz));
      case 'hills': {
        const base = Math.max(sea, 0);
        return !wet && ny >= maxSlope && h > base + ((terrainDef?.maxHeight ?? 16) - base) * 0.3;
      }
      case 'shore': return wet && sea - h > 0.4 && landWithin(wx, wz, 3);
      case 'sea': return wet && sea - h > 1.5 && !landWithin(wx, wz, 8);
    }
    return false;
  }

  /** Buildings need their whole footprint on even, dry ground. */
  function footprintFits(px: number, py: number, r: number): boolean {
    const h0 = terrainHeight(px / tileSize, py / tileSize);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const x = px + dx * r * 0.8, y = py + dy * r * 0.8;
      if (!inArea(x, y, 'land')) return false;
      if (Math.abs(terrainHeight(x / tileSize, y / tileSize) - h0) > 1.2) return false;
    }
    return true;
  }

  function findSpot(rule: PlacementRule, selfR: number, fallback: WorldArea, footprint = false): [number, number] | null {
    const area = rule.where ?? fallback;
    if (Array.isArray(area)) return [area[0], area[1]];
    const spacing = rule.spacing ?? tileSize * 2;
    const W = worldSize[0] * tileSize || 1024, H = worldSize[1] * tileSize || 1024;
    let cx = W / 2, cy = H / 2, radius = Infinity;
    if (rule.near) {
      if (rule.near !== 'center') {
        const anchors = occupied.filter((o) => o.name === rule.near);
        if (anchors.length === 0) {
          throw new Error(
            `Placement near '${rule.near}' but nothing called '${rule.near}' has been placed yet.\n\n` +
            "Fix: place it first (world.place runs before world.spawns, each in order), or use near: 'center'."
          );
        }
        const anchor = anchors[Math.floor(rand() * anchors.length)];
        cx = anchor.x; cy = anchor.y;
      }
      radius = rule.radius ?? 240;
    }
    // Second pass drops the spacing so crowded rules still place something
    for (let pass = 0; pass < 2; pass++) {
      const gap = pass === 0 ? spacing : 0;
      for (let i = 0; i < 800; i++) {
        let x: number, y: number;
        if (radius === Infinity) {
          x = rand() * W; y = rand() * H;
        } else {
          const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * radius;
          x = cx + Math.cos(a) * d; y = cy + Math.sin(a) * d;
        }
        if (!inArea(x, y, area)) continue;
        if (footprint && !footprintFits(x, y, selfR)) continue;
        if (occupied.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + selfR + gap)) continue;
        return [x, y];
      }
    }
    return null;
  }

  /** Heading that points away from the nearest land (boats at the beach face the sea). */
  function headingOut(px: number, py: number): number {
    const wx = px / tileSize, wz = py / tileSize;
    let lx = 0, lz = 0;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (let d = 1; d <= 8; d++) {
        if (!isWaterAt(wx + Math.cos(ang) * d, wz + Math.sin(ang) * d)) {
          lx += Math.cos(ang) / d; lz += Math.sin(ang) / d;
          break;
        }
      }
    }
    return Math.atan2(-lx, -lz);
  }

  function buildingRadius(name: string): number {
    let r = 0;
    for (const part of config.buildings?.[name] ?? []) {
      r = Math.max(r, Math.abs(part.position[0]) + part.size[0] / 2, Math.abs(part.position[2]) + part.size[2] / 2);
    }
    return r * tileSize;
  }

  function placeOne(p: PlacementDef): void {
    const name = p.building ?? p.model;
    if (p.building && !config.buildings?.[p.building]) {
      throw new Error(`Placed building '${p.building}' is not defined.\n\nFix: add it to world.buildings.`);
    }
    if (p.model && !modelTypes.has(p.model)) {
      throw new Error(`Placed model '${p.model}' is not defined.\n\nFix: add it to world.models.`);
    }
    if (!name) {
      throw new Error("A placement needs a building or a model.\n\nFix: { building: 'hut', where: 'flat' } or { building: 'hut', at: [x, y] }");
    }
    const r = p.building ? buildingRadius(p.building) : (modelTypes.get(name)!.footprint?.[0] ?? tileSize) / 2;
    const count = p.at ? 1 : p.count ?? 1;
    for (let i = 0; i < count; i++) {
      const spot = p.at ?? findSpot(p, r, 'flat', !!p.building);
      if (!spot) {
        console.warn(`[Glyft] No room for ${name} (${i + 1} of ${count}). Try a larger radius, smaller spacing, or another area.`);
        break;
      }
      const wx = spot[0] / tileSize, wz = spot[1] / tileSize;
      const y = terrainHeight(wx, wz);
      const rotation = p.rotation ?? (p.at ? 0 : Math.floor(rand() * 4) * (Math.PI / 2));
      if (p.building) {
        placedBuildings.push({ defId: p.building, x: wx, y, z: wz, rotation });
      } else {
        staticModels.push({ modelId: name, x: wx, y, z: wz, rotation, scale: modelTypes.get(name)!.scale ?? 1 });
      }
      occupied.push({ x: spot[0], y: spot[1], r, name });
    }
  }
  const shipInstances: ShipInstance[] = [];

  // ---- Helpers ----

  function hexToVec3(c: number): Vec3 {
    return [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];
  }

  function terrainHeight(wx: number, wz: number): number {
    return terrain ? terrain.getHeight(wx, wz) : 0;
  }

  function isWaterAt(wx: number, wz: number): boolean {
    if (waterHeight == null) return false;
    return terrainHeight(wx, wz) < waterHeight;
  }

  function waterSurface(wx: number, wz: number): number {
    if (waterHeight == null) return 0;
    return waterHeight + sampleWaveHeight(wx, wz, terrain ? terrain.getWaterTime() : 0);
  }

  function footOf(s: WorldSprite): [number, number] {
    return [(s.x + s.frameW / 2) / tileSize, (s.y + s.frameH / 2) / tileSize];
  }

  function findSprite(sprites: Map<string, WorldSprite>, target: string | undefined): WorldSprite | null {
    if (!target) return null;
    const byId = sprites.get(target);
    if (byId && byId.exists) return byId;
    for (const s of sprites.values()) if (s.exists && s.type === target) return s;
    return null;
  }

  function resolveFaces(part: BuildingPart, index: (f: string | number) => number): Record<string, number> {
    const names = part.type === 'box' ? BOX_FACES : part.type === 'roof' ? ROOF_FACES : WEDGE_FACES;
    const out: Record<string, number> = {};
    const all = part.faces.all;
    for (const n of names) {
      const f = part.faces[n] ?? all;
      if (f != null) out[n] = index(f);
    }
    return out;
  }

  // ---- Controller ----

  const ctrl = config.controller;
  const walkerBlocked = new Set<string>(config.blockedBy ?? ['water', 'steep', 'buildings']);
  const playerBlocked = new Set<string>(ctrl?.blockedBy ?? config.blockedBy ?? ['water', 'steep', 'buildings']);
  const maxSlope = ctrl?.maxSlope ?? 0.65;
  const shipBlocked = new Set(['land']);
  const floaterBlocked = new Set([...walkerBlocked].filter((b) => b !== 'water'));

  // Boarding (controller.board): the player rides a vehicle sprite
  const board = ctrl?.board;
  // Ships carry the rider below deck (hidden); any other vehicle is a mount the rider sits on
  let riding: { rider: string; vehicle: string; tags: string[]; alpha: number; mounted: boolean; elevation: number } | null = null;

  /** The sprite the keyboard drives right now: the vehicle while riding, else controller.sprite. */
  function driven(sprites: Map<string, WorldSprite>): WorldSprite | null {
    if (riding) {
      const v = sprites.get(riding.vehicle);
      if (v && v.exists) return v;
      riding = null;
    }
    return ctrl ? findSprite(sprites, ctrl.sprite) : null;
  }

  function blockSetFor(s: WorldSprite, isDriven: boolean): Set<string> {
    if (shipTypes.has(s.type)) return shipBlocked;
    if (isDriven) return playerBlocked;
    return s.floats || modelTypes.get(s.type)?.floats ? floaterBlocked : walkerBlocked;
  }

  function isBlocked(px: number, py: number, s: WorldSprite, blocked: Set<string>): boolean {
    const wx = (px + s.frameW / 2) / tileSize;
    const wz = (py + s.frameH / 2) / tileSize;
    if (wx < 0.5 || wz < 0.5 || wx > worldSize[0] - 0.5 || wz > worldSize[1] - 0.5) return true;
    const wet = isWaterAt(wx, wz);
    if (blocked.has('water') && wet) return true;
    if (blocked.has('land') && !wet) return true;
    const airborne = jumps.has(s.id);
    if (blocked.has('steep') && !wet && !airborne && terrain && terrain.getNormal(wx, wz)[1] < maxSlope) return true;
    if (blocked.has('buildings') && meshes && !airborne && meshes.isBlocked(wx, wz)) return true;
    return false;
  }

  /** Board the nearest vehicle in range, or step off onto nearby land. */
  function toggleBoard(sprites: Map<string, WorldSprite>): void {
    const range = board!.range ?? 80;
    if (riding) {
      const rider = sprites.get(riding.rider), v = sprites.get(riding.vehicle);
      if (!rider || !v) { riding = null; return; }
      const cx = v.x + v.frameW / 2, cy = v.y + v.frameH / 2;
      for (let d = tileSize; d <= range + v.frameW / 2; d += tileSize / 2) {
        for (let a = 0; a < 16; a++) {
          const x = cx + Math.cos((a / 16) * Math.PI * 2) * d, y = cy + Math.sin((a / 16) * Math.PI * 2) * d;
          if (!inArea(x, y, 'land')) continue;
          rider.x = x - rider.frameW / 2;
          rider.y = y - rider.frameH / 2;
          rider.tags.push(...riding.tags);
          rider.alpha = riding.alpha;
          rider.elevation = riding.elevation;
          rider.physics = true;
          v.vx = 0; v.vy = 0;
          riding = null;
          return;
        }
      }
      return; // no land close enough: stay aboard
    }
    const rider = ctrl ? findSprite(sprites, ctrl.sprite) : null;
    if (!rider) return;
    const rx = rider.x + rider.frameW / 2, ry = rider.y + rider.frameH / 2;
    let best: WorldSprite | null = null, bestD = Infinity;
    for (const s of sprites.values()) {
      if (!s.exists || !board!.vehicles.includes(s.type)) continue;
      const d = Math.hypot(s.x + s.frameW / 2 - rx, s.y + s.frameH / 2 - ry) - Math.max(s.frameW, s.frameH) / 2;
      if (d < range && d < bestD) { best = s; bestD = d; }
    }
    if (!best) return;
    // Out of play while aboard: no tags means no collision rules match the rider
    const mounted = !shipTypes.has(best.type);
    riding = { rider: rider.id, vehicle: best.id, tags: rider.tags.splice(0), alpha: rider.alpha, mounted, elevation: rider.elevation };
    if (mounted) rider.elevation = board!.seat ?? best.frameH * pxScale * 0.45;
    else rider.alpha = 0;
    rider.physics = false;
    rider.vx = 0; rider.vy = 0;
  }

  let lastSprites: Map<string, WorldSprite> | null = null;

  // ---- Attack (controller.attack) ----
  const attack = ctrl?.attack;
  let hooks: WorldHooks | null = null;
  let attackCooldown = 0;
  const hitboxes: { id: string; owner: string; until: number }[] = [];
  const attackAnims = new Map<string, number>(); // sprite id -> start time (seconds)
  let boardable: string | null = null;

  // A click is a press and release without dragging the camera
  let clicked = false;
  let downX = 0, downY = 0;
  const onDown = (e: PointerEvent) => { if (e.button === 0) { downX = e.clientX; downY = e.clientY; } };
  const onUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (document.pointerLockElement === canvas || Math.hypot(e.clientX - downX, e.clientY - downY) < 5) clicked = true;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  function nearestVehicle(sprites: Map<string, WorldSprite>): WorldSprite | null {
    const rider = ctrl ? findSprite(sprites, ctrl.sprite) : null;
    if (!board || !rider || riding) return null;
    const range = board.range ?? 64;
    const rx = rider.x + rider.frameW / 2, ry = rider.y + rider.frameH / 2;
    let best: WorldSprite | null = null, bestD = Infinity;
    for (const s of sprites.values()) {
      if (!s.exists || !board.vehicles.includes(s.type)) continue;
      const d = Math.hypot(s.x + s.frameW / 2 - rx, s.y + s.frameH / 2 - ry) - Math.max(s.frameW, s.frameH) / 2;
      if (d < range && d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  function updateAttack(dt: number, sprites: Map<string, WorldSprite>, input: WorldInput): void {
    const now = performance.now() / 1000;
    // Hitboxes ride along in front of their owner, then vanish
    for (let i = hitboxes.length - 1; i >= 0; i--) {
      const h = hitboxes[i];
      const hb = sprites.get(h.id), owner = sprites.get(h.owner);
      if (!hb || !hb.exists || !owner || now > h.until) {
        hooks?.destroy(h.id);
        hitboxes.splice(i, 1);
        continue;
      }
      placeHitbox(hb, owner);
    }
    for (const [id, t0] of attackAnims) {
      const frames = attack?.frames?.[1] ?? 1;
      if (now - t0 > frames / (attack?.fps ?? 12)) attackAnims.delete(id);
    }

    attackCooldown -= dt;
    const pressed = (attack?.key ?? 'Click') === 'Click' ? clicked : input.justPressed(attack!.key!);
    clicked = false;
    if (!attack || !hooks || riding || !pressed || attackCooldown > 0) return;
    const attacker = ctrl ? findSprite(sprites, ctrl.sprite) : null;
    if (!attacker) return;
    attackCooldown = attack.cooldown ?? 0.4;
    if (attack.frames) attackAnims.set(attacker.id, now);
    const id = hooks.spawn(attack.spawn, 0, 0);
    if (!id) return;
    const hb = sprites.get(id);
    if (hb) placeHitbox(hb, attacker);
    hitboxes.push({ id, owner: attacker.id, until: now + (attack.duration ?? 0.15) });
  }

  function placeHitbox(hb: WorldSprite, owner: WorldSprite): void {
    const f = facing.get(owner.id) ?? 0;
    const reach = attack?.reach ?? 20;
    const cx = owner.x + owner.frameW / 2 + Math.sin(f) * reach;
    const cy = owner.y + owner.frameH / 2 + Math.cos(f) * reach;
    hb.x = cx - hb.frameW / 2;
    hb.y = cy - hb.frameH / 2;
  }

  // ---- World API ----

  const world: WorldSystem = {
    get ready() { return ready; },

    get time() { return time; },
    set time(v: number) { time = ((v % 1) + 1) % 1; },
    get wind() { return wind; },
    set wind(v: number) { wind = v; },
    get waves() { return waves; },
    set waves(v: number) {
      waves = v;
      waveParams.scale = v;
      terrain?.setWaveScale(v);
    },
    get cameraYaw() { return rig.yaw; },
    get riding() {
      return riding ? (lastSprites?.get(riding.vehicle)?.type ?? null) : null;
    },

    get boardable() { return boardable; },

    setHooks(h) { hooks = h; },

    findSpot(rule) {
      return findSpot(rule, tileSize, 'land');
    },

    planSpawns(sizeOf) {
      const out: { type: string; x: number; y: number; rotation: number; with?: Record<string, unknown> }[] = [];
      for (const [type, rule] of Object.entries(config.spawns ?? {})) {
        const isShip = shipTypes.has(type);
        const r = sizeOf(type) / 2;
        const count = rule.count ?? 1;
        for (let i = 0; i < count; i++) {
          const spot = findSpot(rule, r, isShip ? 'sea' : 'land');
          if (!spot) {
            console.warn(`[Glyft] No room to spawn ${type} (${i + 1} of ${count}). Try a larger radius or another area.`);
            break;
          }
          const rotation = typeof rule.facing === 'number' ? rule.facing
            : rule.facing === 'out' ? headingOut(spot[0], spot[1])
            : isShip ? rand() * Math.PI * 2 : 0;
          out.push({ type, x: spot[0], y: spot[1], rotation, with: rule.with as Record<string, unknown> | undefined });
          occupied.push({ x: spot[0], y: spot[1], r, name: type });
        }
      }
      return out;
    },

    heightAt(x, y) {
      const wx = x / tileSize, wz = y / tileSize;
      const roof = meshes?.getTopHeight(wx, wz);
      return Math.max(terrainHeight(wx, wz), roof ?? -Infinity);
    },

    isWater(x, y) {
      return isWaterAt(x / tileSize, y / tileSize);
    },

    place(p) {
      if (!ready) {
        throw new Error('world.place() called before the world loaded.\n\nFix: await game.ready first.');
      }
      placeOne(p);
      meshes?.placeBuildings(placedBuildings);
    },

    pick(screenX, screenY): WorldHit | null {
      if (!terrain) return null;
      const inv = mat4Invert(vp);
      if (!inv) return null;
      const ndcX = (screenX / viewW) * 2 - 1;
      const ndcY = 1 - (screenY / viewH) * 2;
      const unproject = (z: number): Vec3 => {
        const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * z + inv[12];
        const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * z + inv[13];
        const zz = inv[2] * ndcX + inv[6] * ndcY + inv[10] * z + inv[14];
        const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * z + inv[15];
        return [x / w, y / w, zz / w];
      };
      const near = unproject(-1), far = unproject(1);
      const dir = vec3Normalize([far[0] - near[0], far[1] - near[1], far[2] - near[2]]);
      const surface = (p: Vec3) => Math.max(terrainHeight(p[0], p[2]), waterHeight ?? -Infinity);

      // March then bisect
      const maxDist = rig.camera.far;
      let prev = 0;
      for (let t = 0.5; t < maxDist; t += 0.5) {
        const p: Vec3 = [near[0] + dir[0] * t, near[1] + dir[1] * t, near[2] + dir[2] * t];
        if (p[1] <= surface(p)) {
          let lo = prev, hi = t;
          for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            const m: Vec3 = [near[0] + dir[0] * mid, near[1] + dir[1] * mid, near[2] + dir[2] * mid];
            if (m[1] <= surface(m)) hi = mid; else lo = mid;
          }
          const hx = near[0] + dir[0] * hi, hz = near[2] + dir[2] * hi;
          const wet = isWaterAt(hx, hz);
          return { x: hx * tileSize, y: hz * tileSize, height: wet ? waterHeight! : terrainHeight(hx, hz), water: wet };
        }
        prev = t;
      }
      return null;
    },

    footprintOf(type) {
      const ship = shipTypes.get(type);
      if (ship) {
        const preset = SHIP_PRESETS[ship.preset ?? 'sloop'];
        const len = ship.hullLength ?? preset.hullLength;
        return [len * 0.6 * tileSize, len * 0.6 * tileSize];
      }
      const model = modelTypes.get(type);
      if (model) return model.footprint ?? [tileSize, tileSize];
      if (attack && type === attack.spawn) return [attack.size ?? 28, attack.size ?? 28];
      return null;
    },

    async load() {
      // Terrain
      if (terrainDef) {
        const heightmap = await resolveHeightmap(terrainDef.heightmap);
        const tex = { ...DEFAULT_TERRAIN, ...(terrainDef.textures ?? {}) };
        const [low, mid, steep, high] = await Promise.all([
          loadWorldTexture(gl, tex.low), loadWorldTexture(gl, tex.mid),
          loadWorldTexture(gl, tex.steep), loadWorldTexture(gl, tex.high),
        ]);
        const style = WATER_STYLES[water?.style ?? 'ocean'];
        const cellSize = terrainDef.cellSize ?? 1;
        terrain = createTerrainSystem(gl, {
          heightmap,
          cellSize,
          maxHeight: terrainDef.maxHeight ?? 16,
          texture: mid,
          textureRepeat: 2,
          splatTextures: { low, mid, steep, high },
          waterHeight: waterHeight ?? undefined,
          waterStyle: style,
          stepped: terrainDef.stepped,
          fogColor: lighting.fogColor as [number, number, number],
          fogNear: lighting.fogNear,
          fogFar: lighting.fogFar,
        });
        terrain.setWaveScale(waves);
        worldSize = terrain.getWorldSize();
      }

      // Sky
      if (config.sky) {
        sky = createSkySystem(gl, { stars: config.sky.stars, clouds: config.sky.clouds });
        sky.setTimeOfDay(time);
      }

      // Buildings
      if (config.buildings) {
        let atlas: { texture: WebGLTexture; width: number; height: number };
        let index: (f: string | number) => number;
        let atlasTile: number;
        if (config.buildingAtlas) {
          const texture = await loadWorldTexture(gl, config.buildingAtlas.src);
          const img = new Image();
          img.src = config.buildingAtlas.src;
          await img.decode();
          atlas = { texture, width: img.width, height: img.height };
          atlasTile = config.buildingAtlas.tileSize;
          index = (f) => {
            if (typeof f !== 'number') {
              throw new Error(`Building face '${f}' must be a tile index when buildingAtlas is set.\n\nFix: use numbers, or remove buildingAtlas to use material names.`);
            }
            return f;
          };
        } else {
          const mats = createMaterialAtlas(gl);
          atlas = mats;
          atlasTile = mats.tileSize;
          index = mats.index;
        }
        meshes = createMeshSystem(gl, atlas, atlasTile);
        for (const [name, parts] of Object.entries(config.buildings)) {
          const meshParts: MeshPart[] = parts.map((p) => ({
            type: p.type, position: p.position, size: p.size, direction: p.direction,
            faces: resolveFaces(p, index),
          }));
          meshes.defineBuilding(name, meshParts);
        }
      }

      // Models
      if (modelTypes.size > 0 || config.place?.some((p) => p.model)) {
        models = createModelSystem(gl, { filter: 'nearest' });
        await Promise.all([...modelTypes.entries()].map(async ([name, def]) => {
          models!.addModel(name, await loadGltf(def.src));
        }));
      }

      // Ships
      if (shipTypes.size > 0) {
        const colors = (def: ShipDef) => def.colors ?? {};
        const first = colors([...shipTypes.values()][0]);
        const [hull, deck, sail, metal, rope, windows, planks, door, trim] = await Promise.all([
          loadWorldTexture(gl, first.hull ?? 'hull'), loadWorldTexture(gl, first.deck ?? 'deck'),
          loadWorldTexture(gl, first.sail ?? 'sail'), loadWorldTexture(gl, 'metal'),
          loadWorldTexture(gl, 'rope'), loadWorldTexture(gl, 'window'),
          loadWorldTexture(gl, 'planks'), loadWorldTexture(gl, 'door'),
          loadWorldTexture(gl, first.trim ?? 0xa83228),
        ]);
        ships = createShipSystem(gl, {
          hull, deck, sail, sailDirty: sail, metal, cannon: metal, rope, flag: trim, windows, hatch: planks, door,
        });
        for (const [name, def] of shipTypes) {
          const preset = SHIP_PRESETS[def.preset ?? 'sloop'];
          if (!preset) {
            throw new Error(`Unknown ship preset '${def.preset}'.\n\nFix: use one of ${Object.keys(SHIP_PRESETS).join(', ')}.`);
          }
          const { preset: _p, colors: _c, turnRate: _t, ...overrides } = def;
          ships.defineShip({ ...preset, ...overrides, name });
        }
      }

      // Static placements (rules resolve against the terrain now that it exists)
      for (const p of config.place ?? []) placeOne(p);
      meshes?.placeBuildings(placedBuildings);

      ready = true;
    },

    prePhysics(dt, sprites, input) {
      for (const s of sprites.values()) {
        if (s.exists) {
          let p = prevPos.get(s.id);
          if (!p) { p = [s.x, s.y]; prevPos.set(s.id, p); }
          p[0] = s.x; p[1] = s.y;
        }
      }
      if (!ctrl || !ready) return;

      if (board && input.justPressed(board.key ?? 'KeyF')) toggleBoard(sprites);
      boardable = nearestVehicle(sprites)?.type ?? null;
      updateAttack(dt, sprites, input);

      const s = driven(sprites);
      if (!s) return;
      s.physics = true;

      const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? (ctrl.sprint ?? 1.6) : 1;
      const baseSpeed = riding?.mounted ? (board?.speed ?? (ctrl.speed ?? 96) * 1.5) : (ctrl.speed ?? 96);
      const speed = baseSpeed * sprint;
      let fwd = 0, right = 0;
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) fwd += 1;
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) fwd -= 1;
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) right += 1;
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) right -= 1;

      if (shipTypes.has(s.type)) {
        // Boats steer: A/D turn the bow, W/S throttle
        const turn = shipTypes.get(s.type)!.turnRate ?? 1.5;
        const heading = (facing.get(s.id) ?? 0) - right * turn * dt;
        facing.set(s.id, heading);
        const current = Math.hypot(s.vx, s.vy);
        const target = fwd > 0 ? speed : fwd < 0 ? -speed * 0.3 : 0;
        const v = current + (target - current) * Math.min(1, dt * 0.8);
        s.vx = Math.sin(heading) * v;
        s.vy = Math.cos(heading) * v;
        return;
      }

      // Walkers move relative to the camera
      const yaw = rig.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let mx = fx * fwd + Math.cos(yaw) * right;
      let mz = fz * fwd - Math.sin(yaw) * right;
      const len = Math.hypot(mx, mz);
      if (len > 0) { mx /= len; mz /= len; }
      s.vx = mx * speed;
      s.vy = mz * speed;

      const jump = ctrl.jump ?? 0;
      if (jump > 0 && input.justPressed('Space') && !jumps.has(s.id)) {
        jumps.set(s.id, { t: 0, base: s.elevation });
      }
    },

    postPhysics(dt, sprites) {
      lastSprites = sprites;
      if (!ready) return;
      const ctrlSprite = driven(sprites);
      const waterTime = terrain ? terrain.getWaterTime() : 0;

      // The rider travels with the vehicle
      if (riding) {
        const rider = sprites.get(riding.rider), v = sprites.get(riding.vehicle);
        if (rider && v) {
          rider.x = v.x + v.frameW / 2 - rider.frameW / 2;
          rider.y = v.y + v.frameH / 2 - rider.frameH / 2;
          if (riding.mounted) facing.set(rider.id, facing.get(v.id) ?? 0);
        }
      }

      for (const s of sprites.values()) {
        if (!s.exists) continue;

        // Blocking for everything that moved, with axis sliding
        const p = prevPos.get(s.id);
        const isDriven = s === ctrlSprite;
        if (p && s.physics && (isDriven || s.x !== p[0] || s.y !== p[1]) && !(riding && s.id === riding.rider)) {
          const set = blockSetFor(s, isDriven);
          // Only push back when the previous spot was free (knockback can land a sprite somewhere blocked)
          if (isBlocked(s.x, s.y, s, set) && !isBlocked(p[0], p[1], s, set)) {
            const nx = s.x, ny = s.y;
            s.x = p[0]; s.y = p[1];
            if (!isBlocked(nx, p[1], s, set)) s.x = nx;
            else if (!isBlocked(p[0], ny, s, set)) s.y = ny;
            if (shipTypes.has(s.type) && s.x === p[0] && s.y === p[1]) { s.vx *= 0.5; s.vy *= 0.5; }
          }
        }

        const [wx, wz] = footOf(s);
        const isShip = shipTypes.has(s.type);
        if (!facing.has(s.id)) facing.set(s.id, s.rotation);

        // Facing follows velocity (ships under the controller steer themselves)
        const speed = Math.hypot(s.vx, s.vy);
        if (speed > 1 && !(isShip && s === ctrlSprite)) {
          const want = Math.atan2(s.vx, s.vy);
          if (isShip) {
            const cur = facing.get(s.id) ?? want;
            let diff = want - cur;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            const turn = (shipTypes.get(s.type)!.turnRate ?? 1.5) * dt;
            facing.set(s.id, cur + Math.max(-turn, Math.min(turn, diff)));
          } else {
            facing.set(s.id, want);
          }
        }

        // Ground: roof when on or jumping onto a building, else terrain; water surface when floating
        let ground = terrainHeight(wx, wz);
        const roof = meshes?.getTopHeight(wx, wz);
        if (roof != null && (jumps.has(s.id) || (groundY.get(s.id) ?? -Infinity) >= roof - 0.3)) {
          ground = Math.max(ground, roof);
        }
        const floats = isShip || s.floats || modelTypes.get(s.type)?.floats;
        if (floats && waterHeight != null && ground < waterHeight) {
          ground = waterSurface(wx, wz);
          const n = sampleWaveNormal(wx, wz, waterTime);
          const h = facing.get(s.id) ?? 0;
          const fwdSlope = n[0] * Math.sin(h) + n[2] * Math.cos(h);
          const sideSlope = n[0] * Math.cos(h) - n[2] * Math.sin(h);
          tilt.set(s.id, [Math.asin(Math.max(-1, Math.min(1, -fwdSlope))) * 0.7, Math.asin(Math.max(-1, Math.min(1, sideSlope))) * 0.7]);
        } else {
          tilt.delete(s.id);
        }

        // Jump arc
        const j = jumps.get(s.id);
        if (j) {
          const height = ctrl?.jump ?? 0;
          j.t += dt / 0.5;
          s.elevation = j.base + 4 * j.t * (1 - j.t) * height;
          if (j.t >= 1) { s.elevation = j.base; jumps.delete(s.id); }
        }
        groundY.set(s.id, ground);
        if (isShip || modelTypes.has(s.type)) s.rotation = facing.get(s.id) ?? 0;
      }

      // Forget sprites that are gone
      if (prevPos.size > sprites.size) {
        for (const id of prevPos.keys()) {
          const s = sprites.get(id);
          if (!s || !s.exists) {
            prevPos.delete(id); facing.delete(id); jumps.delete(id); groundY.delete(id);
            tilt.delete(id); billboardCache.delete(id);
          }
        }
      }
    },

    surfaceAt(x, y) {
      const wx = x / tileSize, wz = y / tileSize;
      return Math.max(terrainHeight(wx, wz), waterHeight ?? -Infinity);
    },

    spriteHeight(s) {
      return (groundY.get(s.id) ?? 0) + s.elevation;
    },

    project(px, py, height) {
      const p = project([px / tileSize, height, py / tileSize], vp, viewW, viewH);
      return p ? [p[0], p[1]] : null;
    },

    clearColor() {
      return lighting.fogColor;
    },

    render(dt, sprites, engineTime, viewportW, viewportH) {
      if (!ready) return;
      viewW = viewportW;
      viewH = viewportH;

      // Day/night drives every light in the scene
      if (sky) {
        if (dayLength > 0) time = (time + dt / dayLength) % 1;
        sky.setTimeOfDay(time);
        lighting.fogColor = sky.getFogColor();
        lighting.ambient = sky.getAmbientColor();
        lighting.light = sky.getLightColor();
        lighting.lightDir = sky.getLightDir();
      }
      if (terrain) {
        terrain.setLighting(lighting.ambient as [number, number, number], lighting.light as [number, number, number], lighting.lightDir);
        terrain.setFog(lighting.fogColor as [number, number, number], lighting.fogNear, lighting.fogFar);
      }

      // Camera
      let target = findSprite(sprites, config.camera?.target);
      if (riding && target && target.id === riding.rider) target = sprites.get(riding.vehicle) ?? target;
      let focus: Vec3 | null = null;
      if (target) {
        const [wx, wz] = footOf(target);
        focus = [wx, world.spriteHeight(target), wz];
      }
      rig.update(dt, focus, (x, z) => Math.max(terrainHeight(x, z), waterHeight ?? -Infinity));
      const cam = rig.camera;
      const proj = mat4Perspective(cam.fov, viewportW / viewportH, cam.near, cam.far);
      vp = mat4Multiply(proj, mat4LookAt(cam.position, cam.target, [0, 1, 0]));

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      sky?.render(cam.position, cam.target, vp, performance.now() / 1000);
      terrain?.render(cam, viewportW, viewportH);
      meshes?.render(cam, vp, lighting);

      // Sort sprites into ships, models and billboard groups
      for (const g of billboardGroups.values()) g.list.length = 0;
      modelInstances.length = 0;
      for (const m of staticModels) modelInstances.push(m);
      let shipCount = 0;
      const hideForFps = rig.mode === 'fps' ? target : null;
      const nowSec = performance.now() / 1000;

      for (const s of sprites.values()) {
        if (!s.exists || s === hideForFps || (riding && !riding.mounted && s.id === riding.rider)) continue;
        if (attack && s.type === attack.spawn) continue; // hitboxes are invisible
        const [wx, wz] = footOf(s);
        const y = world.spriteHeight(s);
        const face = facing.get(s.id) ?? 0;

        if (shipTypes.has(s.type)) {
          const t = tilt.get(s.id);
          let inst = shipInstances[shipCount];
          if (!inst) { inst = { configId: s.type, x: 0, y: 0, z: 0, rotation: 0 }; shipInstances[shipCount] = inst; }
          inst.configId = s.type; inst.x = wx; inst.y = y; inst.z = wz; inst.rotation = face;
          inst.pitch = t ? t[0] : 0; inst.roll = t ? t[1] : 0;
          shipCount++;
          continue;
        }
        const modelDef = modelTypes.get(s.type);
        if (modelDef) {
          modelInstances.push({ modelId: s.type, x: wx, y, z: wz, rotation: face, scale: (modelDef.scale ?? 1) * s.scale });
          continue;
        }

        let b = billboardCache.get(s.id);
        if (!b) {
          b = {
            x: 0, y: 0, z: 0, facing: 0, vx: 0, vy: 0, vz: 0, speed: 0, scale: 1, alpha: 1, tint: 0xffffff,
            spriteHeight: pxScale, groundOffset: 0, terrainNormalX: 0, terrainNormalZ: 0,
            frameX: 0, frameY: 0, frameW: 0, frameH: 0, idleFrames: 1, walkFrames: 0, fps: 8, flipX: false,
            bob: 0, bobSpeed: 0, animOverrideStart: 0, animOverrideFrames: 0, animOverrideTime: 0, animOverrideFps: 12,
          };
          billboardCache.set(s.id, b);
        }
        b.x = wx; b.y = y; b.z = wz; b.facing = face;
        if (riding?.mounted && s.id === riding.rider) {
          // Sit just in front of the mount (toward the camera) so the two quads never fight
          const cx = cam.position[0] - wx, cz = cam.position[2] - wz, len = Math.hypot(cx, cz) || 1;
          b.x += (cx / len) * 0.12; b.z += (cz / len) * 0.12;
          const v = sprites.get(riding.vehicle);
          if (v) { b.vx = v.vx * pxScale; b.vz = v.vy * pxScale; b.speed = 0; }
        }
        b.vx = s.vx * pxScale; b.vz = s.vy * pxScale; b.speed = Math.hypot(b.vx, b.vz);
        const flashUntil = s.data._flashUntil as number | undefined;
        b.scale = s.scale; b.alpha = s.alpha; b.flipX = s.flipX;
        b.tint = flashUntil !== undefined && flashUntil > Date.now() ? (s.data._flashColor as number) ?? 0xff0000 : s.tint;
        b.frameX = s.frameX; b.frameY = s.frameY; b.frameW = s.frameW; b.frameH = s.frameH;
        b.idleFrames = s.idleFrames; b.walkFrames = s.walkFrames; b.fps = s.fps;
        b.bob = s.bob * pxScale; b.bobSpeed = s.bobSpeed;
        b.groundOffset = s.visualOffsetY * pxScale * s.scale;
        if (terrain) {
          const n = terrain.getNormal(wx, wz);
          b.terrainNormalX = n[0]; b.terrainNormalZ = n[2];
        }
        const anim = s.animOverride ? s.animations.get(s.animOverride) : null;
        const attackStart = attackAnims.get(s.id);
        if (attackStart !== undefined && attack?.frames) {
          b.animOverrideStart = attack.frames[0];
          b.animOverrideFrames = attack.frames[1];
          b.animOverrideFps = attack.fps ?? 12;
          b.animOverrideTime = attackStart;
        } else if (anim && anim.frames.length > 0) {
          b.animOverrideStart = anim.frames[0];
          b.animOverrideFrames = anim.frames.length;
          b.animOverrideFps = anim.fps;
          b.animOverrideTime = nowSec - (engineTime - s.animStartTime);
        } else {
          b.animOverrideTime = 0;
        }

        let group = billboardGroups.get(s.atlas.name);
        if (!group) { group = { atlas: s.atlas, list: [] }; billboardGroups.set(s.atlas.name, group); }
        group.list.push(b);
      }

      if (models && modelInstances.length > 0) {
        models.setInstances(modelInstances);
        models.render(cam, vp, lighting);
      }
      if (ships && shipCount > 0) {
        shipInstances.length = shipCount;
        ships.setWind(Math.sin(wind), Math.cos(wind));
        ships.setInstances(shipInstances);
        ships.render(cam, vp, nowSec, lighting);
      }

      const fog = { color: lighting.fogColor, near: lighting.fogNear, far: lighting.fogFar };
      // Billboards face the camera, so light them flat: ambient plus most of the sun
      const sunUp = Math.max(0, lighting.lightDir[1]);
      const tint: Vec3 = [
        Math.min(1, lighting.ambient[0] + lighting.light[0] * (0.4 + 0.4 * sunUp)),
        Math.min(1, lighting.ambient[1] + lighting.light[1] * (0.4 + 0.4 * sunUp)),
        Math.min(1, lighting.ambient[2] + lighting.light[2] * (0.4 + 0.4 * sunUp)),
      ];
      for (const [name, g] of billboardGroups) {
        if (g.list.length === 0) continue;
        let bb = billboards.get(name);
        if (!bb) { bb = createBillboardSystem(gl, spriteMode); billboards.set(name, bb); }
        bb.render(g.list, g.atlas, cam, vp, viewportW, viewportH, fog, tint);
      }

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    },

    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      rig.destroy();
      terrain?.destroy();
      sky?.destroy();
      meshes?.destroy();
      models?.destroy();
      ships?.destroy();
      for (const b of billboards.values()) b.destroy();
    },
  };

  return world;
}
