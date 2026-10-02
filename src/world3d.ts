/**
 * 3D world: turns `config.world` into areas (terrain, sky, buildings, props),
 * camera, controller, models and ships, and lifts 2D sprites onto the terrain.
 *
 * Sprites keep their 2D coordinates (pixels on the ground plane).
 * One tile (tileSize px) is one world unit: world x = px / tileSize,
 * world z = py / tileSize, world y = ground height + elevation.
 *
 * Each sprite belongs to one area. Only the current area's sprites are live;
 * the engine stashes the others so they don't move, collide or render.
 */

import type { WorldConfig, World, WorldHit, ShipDef, AreaDef } from './types';
import type { Lighting } from './terrain';
import { createBillboardSystem, type BillboardSprite, type BillboardSystem } from './billboard';
import { createModelSystem, type ModelSystem, type ModelInstance } from './model';
import { createShipSystem, SHIP_PRESETS, type ShipSystem, type ShipInstance } from './ships';
import { createCameraRig, type CameraRig } from './camera3d';
import { loadWorldTexture, createMaterialAtlas } from './materials';
import { loadGltf } from './loaders/gltf';
import { sampleWaveNormal, waveParams } from './waves';
import { createArea, type Area, type PlacedExit } from './area3d';
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
  /** Take sprites out of play (another area) and bring them back */
  stash(ids: string[]): void;
  unstash(ids: string[]): void;
}

export interface WorldInput {
  isDown(key: string): boolean;
  justPressed(key: string): boolean;
}

export interface SpawnPlan { type: string; x: number; y: number; rotation: number; area: string; with?: Record<string, unknown> }

export interface WorldSystem extends World {
  readonly ready: boolean;
  /** 0..1 black fade for area transitions (the engine draws it) */
  readonly fade: number;
  /** Who is riding what right now (sprite ids), for labels */
  readonly ride: { rider: string; vehicle: string } | null;
  /** What this sprite rides (the player or another player), and whether it sits on top */
  rideOf(id: string): { vehicle: string; mounted: boolean } | null;
  /** Who rides this vehicle, if anyone */
  riderOf(id: string): string | null;
  /** Network: a sprite moved by its owner elsewhere (facing, absolute height, what it rides) */
  setRemote(id: string, facing: number, height: number, ride: { vehicle: string; mounted: boolean } | null): void;
  clearRemote(id: string): void;
  /** Network: the player's facing and anything they ride, to send to others */
  facingOf(id: string): number;
  setFacing(id: string, facing: number): void;
  /** Play the controller's attack frames on a sprite (another player's swing) */
  playAttack(id: string): void;
  /** Called when the player swings (controller.attack) */
  onAttack(callback: () => void): void;
  /** Footprint in pixels for ship/model sprite types, or null for billboards */
  footprintOf(type: string): [number, number] | null;
  /** Load assets and build GPU resources for every area */
  load(): Promise<void>;
  /** Resolve every area's spawns into positions. sizeOf gives a type's footprint in pixels. */
  planSpawns(sizeOf: (type: string) => number): SpawnPlan[];
  /** Record which area a sprite lives in */
  adopt(id: string, area: string): void;
  /** Take every sprite outside the current area out of play (after the initial spawns) */
  activate(): void;
  setHooks(hooks: WorldHooks): void;
  prePhysics(dt: number, sprites: Map<string, WorldSprite>, input: WorldInput): void;
  postPhysics(dt: number, sprites: Map<string, WorldSprite>): void;
  render(dt: number, sprites: Map<string, WorldSprite>, engineTime: number, viewportW: number, viewportH: number): void;
  project(px: number, py: number, height: number): [number, number] | null;
  spriteHeight(sprite: WorldSprite): number;
  surfaceAt(x: number, y: number): number;
  clearColor(): Vec3;
  destroy(): void;
}

const FADE_TIME = 0.35;

/** The area list, with the single-area shorthand folded in. */
function normalizeAreas(config: WorldConfig): Record<string, AreaDef> {
  if (config.areas && Object.keys(config.areas).length > 0) return config.areas;
  return {
    main: { terrain: config.terrain, sky: config.sky, place: config.place, scatter: config.scatter, spawns: config.spawns },
  };
}

export function createWorldSystem(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  config: WorldConfig,
  tileSize: number,
  spriteMode: '4dir' | '8dir' | '1dir' = '4dir',
): WorldSystem {
  const pxScale = config.spriteScale ?? 1 / tileSize;
  const shipTypes = new Map<string, ShipDef>(Object.entries(config.ships ?? {}));
  const modelTypes = new Map(Object.entries(config.models ?? {}));
  const areaDefs = normalizeAreas(config);
  const startKey = config.start ?? Object.keys(areaDefs)[0];
  if (!areaDefs[startKey]) {
    throw new Error(`world.start is '${startKey}', which isn't an area.\n\nFix: use one of ${Object.keys(areaDefs).join(', ')}.`);
  }

  let ready = false;
  const areas = new Map<string, Area>();
  let cur!: Area;
  let models: ModelSystem | null = null;
  let ships: ShipSystem | null = null;
  const billboards = new Map<string, BillboardSystem>();
  const rig: CameraRig = createCameraRig(canvas, config.camera ?? { mode: 'orbit' }, tileSize);

  const firstSky = Object.values(areaDefs).find((a) => a.sky)?.sky || undefined;
  let time = firstSky?.time ?? 0.4;
  const dayLength = firstSky?.dayLength ?? 0;
  let wind = config.wind ?? Math.PI / 4;
  let waves = Object.values(areaDefs).find((a) => a.terrain?.water)?.terrain?.water?.waves ?? 1;
  waveParams.scale = waves;

  // The scene's lighting this frame (from the current area's sky or fixed light)
  const lighting: Lighting = {
    lightDir: vec3Normalize([0.3, 1.0, 0.5]), ambient: [0.35, 0.35, 0.4], light: [1.0, 0.95, 0.85],
    fogColor: [0.62, 0.74, 0.86], fogNear: 80, fogFar: 260,
  };

  let vp: Mat4 = new Float32Array(16);
  let viewW = 1, viewH = 1;

  // Per-sprite state the 2D sprite doesn't carry
  const facing = new Map<string, number>();
  const prevPos = new Map<string, [number, number]>();
  // Airborne sprites (jumping or falling): absolute feet height and vertical speed, world units
  const air = new Map<string, { y: number; vy: number; base: number }>();
  const GRAVITY = 40;
  const groundY = new Map<string, number>();
  const tilt = new Map<string, [number, number]>();
  const membership = new Map<string, string>();
  const billboardCache = new Map<string, BillboardSprite>();
  const billboardGroups = new Map<string, { atlas: WorldSprite['atlas']; list: BillboardSprite[] }>();
  const modelInstances: ModelInstance[] = [];
  const shipInstances: ShipInstance[] = [];
  const areaListeners: ((area: string, label: string) => void)[] = [];
  // Sprites another player moves: their facing, absolute height and ride come over the network
  const remote = new Map<string, { f: number; h: number; ride: { vehicle: string; mounted: boolean } | null }>();
  const attackListeners: (() => void)[] = [];

  function rideOf(id: string): { vehicle: string; mounted: boolean } | null {
    if (riding && riding.rider === id) return { vehicle: riding.vehicle, mounted: riding.mounted };
    return remote.get(id)?.ride ?? null;
  }

  // ---- Helpers (current area) ----

  const terrainHeight = (wx: number, wz: number) => cur.terrainHeight(wx, wz);
  const isWaterAt = (wx: number, wz: number) => cur.isWaterAt(wx, wz);

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

  // ---- Controller ----

  const ctrl = config.controller;
  const walkerBlocked = new Set<string>(config.blockedBy ?? ['water', 'steep', 'buildings']);
  const playerBlocked = new Set<string>(ctrl?.blockedBy ?? config.blockedBy ?? ['water', 'steep', 'buildings']);
  const maxSlope = ctrl?.maxSlope ?? 0.65;
  const shipBlocked = new Set(['land']);
  const floaterBlocked = new Set([...walkerBlocked].filter((b) => b !== 'water'));

  // Vehicles and mounts (controller.board)
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
    const [W, H] = cur.worldSize;
    if (wx < 0.5 || wz < 0.5 || wx > W - 0.5 || wz > H - 0.5) return true;
    const wet = isWaterAt(wx, wz);
    if (blocked.has('water') && wet) return true;
    if (blocked.has('land') && !wet) return true;
    const flying = air.get(s.id);
    if (blocked.has('steep') && !wet && !flying && cur.terrain && cur.terrain.getNormal(wx, wz)[1] < maxSlope) return true;
    if (blocked.has('buildings')) {
      // A building is a wall unless you're already up on its roof or high enough to land on it
      const roof = cur.meshes?.getTopHeight(wx, wz);
      if (roof != null) {
        const feet = flying ? flying.y : groundY.get(s.id) ?? -Infinity;
        if (feet < roof - 0.3) return true;
      }
      if (!flying && cur.propBlocks(wx, wz)) return true;
    }
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
          if (!cur.inArea(x, y, 'land')) continue;
          // Never step off into a doorway: that would carry you away and leave the mount behind
          if (cur.exits.some((e) => Math.hypot(e.x - x, e.y - y) < e.trigger + 8)) continue;
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
    const best = nearestVehicle(sprites);
    if (!best) return;
    // Out of play while riding: no tags means no collision rules match the rider
    const mounted = !shipTypes.has(best.type);
    riding = { rider: rider.id, vehicle: best.id, tags: rider.tags.splice(0), alpha: rider.alpha, mounted, elevation: rider.elevation };
    if (mounted) rider.elevation = board!.seat ?? best.frameH * pxScale * best.scale * 0.45;
    else rider.alpha = 0;
    rider.physics = false;
    rider.vx = 0; rider.vy = 0;
  }

  function nearestVehicle(sprites: Map<string, WorldSprite>): WorldSprite | null {
    const rider = ctrl ? findSprite(sprites, ctrl.sprite) : null;
    if (!board || !rider || riding) return null;
    const range = board.range ?? 64;
    const rx = rider.x + rider.frameW / 2, ry = rider.y + rider.frameH / 2;
    let best: WorldSprite | null = null, bestD = Infinity;
    for (const s of sprites.values()) {
      if (!s.exists || !board.vehicles.includes(s.type) || remote.has(s.id)) continue;
      const d = Math.hypot(s.x + s.frameW / 2 - rx, s.y + s.frameH / 2 - ry) - Math.max(s.frameW, s.frameH) / 2;
      if (d < range && d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  let lastSprites: Map<string, WorldSprite> | null = null;

  // ---- Combat (controller.attack) ----
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
    for (const cb of attackListeners) cb();
    const id = hooks.spawn(attack.spawn, 0, 0);
    if (!id) return;
    membership.set(id, cur.key);
    const hb = sprites.get(id);
    if (hb) placeHitbox(hb, attacker);
    hitboxes.push({ id, owner: attacker.id, until: now + (attack.duration ?? 0.15) });
  }

  function placeHitbox(hb: WorldSprite, owner: WorldSprite): void {
    const f = facing.get(owner.id) ?? 0;
    const reach = attack?.reach ?? 20;
    hb.x = owner.x + owner.frameW / 2 + Math.sin(f) * reach - hb.frameW / 2;
    hb.y = owner.y + owner.frameH / 2 + Math.cos(f) * reach - hb.frameH / 2;
  }

  // ---- Areas and exits ----

  let transition: { phase: 'out' | 'in'; t: number; to: string; arrive?: string } | null = null;
  let fade = 0;
  // An exit you just arrived at stays quiet until you step out of it
  let disarmed: string | null = null;

  function startTravel(to: string, arrive?: string): void {
    if (transition || !areas.has(to)) return;
    transition = { phase: 'out', t: 0, to, arrive };
  }

  /** Swap the live sprites and move the traveller (and what they ride) to the arrival spot. */
  function switchArea(sprites: Map<string, WorldSprite>, to: string, arrive?: string): void {
    const from = cur;
    const next = areas.get(to)!;
    const travellers = new Set<string>();
    const player = ctrl ? findSprite(sprites, ctrl.sprite) : null;
    if (player) travellers.add(player.id);
    if (riding) { travellers.add(riding.rider); travellers.add(riding.vehicle); }

    // Arrival spot: the named exit (or the one leading back), stepped out of its doorway
    const back = next.exits.find((e) => (arrive ? e.name === arrive : e.def.to === from.key));
    let ax: number, ay: number;
    let lookOut: [number, number] | null = null;
    if (back) {
      if (back.out) {
        ax = back.x + back.out[0] * (back.trigger + 14);
        ay = back.y + back.out[1] * (back.trigger + 14);
        lookOut = back.out;
      } else {
        const spot = next.findSpot({ where: 'land', near: back.name, radius: 72, spacing: 0 }, 8, 'land');
        [ax, ay] = spot ?? [back.x, back.y];
      }
      disarmed = back.name;
    } else {
      const spot = next.findSpot({ where: 'flat', near: 'center', radius: 200 }, 8, 'land');
      [ax, ay] = spot ?? [next.worldSize[0] * tileSize / 2, next.worldSize[1] * tileSize / 2];
    }

    // Everything else in the old area leaves play; the new area's sprites come back
    const leaving: string[] = [];
    for (const [id, key] of membership) if (key === from.key && !travellers.has(id)) leaving.push(id);
    const arriving: string[] = [];
    for (const [id, key] of membership) if (key === to) arriving.push(id);
    hooks?.stash(leaving);
    hooks?.unstash(arriving);
    for (const id of hitboxes.splice(0).map((h) => h.id)) hooks?.destroy(id);

    for (const id of travellers) {
      membership.set(id, to);
      const s = sprites.get(id);
      if (!s) continue;
      s.x = ax - s.frameW / 2;
      s.y = ay - s.frameH / 2;
      s.vx = 0; s.vy = 0;
      prevPos.set(id, [s.x, s.y]);
      groundY.delete(id);
      air.delete(id);
    }
    cur = next;
    cur.terrain?.setWaveScale(waves);
    // Coming out of a doorway: face out, with the camera in front looking back at you and the door
    if (lookOut) {
      for (const id of travellers) facing.set(id, Math.atan2(lookOut[0], lookOut[1]));
      rig.setYaw(Math.atan2(lookOut[0], lookOut[1]));
    }
    rig.snap();
    for (const cb of areaListeners) cb(cur.key, cur.label);
  }

  function checkExits(sprites: Map<string, WorldSprite>): void {
    if (transition) return;
    const mover = driven(sprites);
    if (!mover) return;
    const mx = mover.x + mover.frameW / 2, my = mover.y + mover.frameH / 2;
    for (const e of cur.exits) {
      const d = Math.hypot(mx - e.x, my - e.y);
      if (e.name === disarmed) {
        if (d > e.trigger + 10) disarmed = null;
        continue;
      }
      if (d < e.trigger) {
        startTravel(e.def.to, e.def.arrive);
        return;
      }
    }
  }

  // ---- World API ----

  const world: WorldSystem = {
    get ready() { return ready; },
    get fade() { return fade; },
    get ride() { return riding ? { rider: riding.rider, vehicle: riding.vehicle } : null; },
    rideOf,
    riderOf(id) {
      if (riding && riding.vehicle === id) return riding.rider;
      for (const [rider, r] of remote) if (r.ride?.vehicle === id) return rider;
      return null;
    },
    setRemote(id, f, h, ride) {
      const r = remote.get(id);
      if (r) { r.f = f; r.h = h; r.ride = ride; }
      else remote.set(id, { f, h, ride });
    },
    clearRemote(id) {
      remote.delete(id);
      prevPos.delete(id);
      groundY.delete(id);
    },
    facingOf(id) { return facing.get(id) ?? 0; },
    setFacing(id, f) { facing.set(id, f); },
    playAttack(id) { if (attack?.frames) attackAnims.set(id, performance.now() / 1000); },
    onAttack(cb) { attackListeners.push(cb); },

    get time() { return time; },
    set time(v: number) { time = ((v % 1) + 1) % 1; },
    get wind() { return wind; },
    set wind(v: number) { wind = v; },
    get waves() { return waves; },
    set waves(v: number) {
      waves = v;
      waveParams.scale = v;
      cur?.terrain?.setWaveScale(v);
    },
    get cameraYaw() { return rig.yaw; },
    get riding() {
      return riding ? (lastSprites?.get(riding.vehicle)?.type ?? null) : null;
    },
    get boardable() { return boardable; },
    get exits() {
      return cur ? cur.exits.map((e) => ({ name: e.name, to: e.def.to, x: e.x, y: e.y })) : [];
    },
    get area() { return cur?.key ?? startKey; },
    get areaLabel() { return cur?.label ?? startKey; },

    go(area, arrive) {
      if (!areas.has(area)) {
        throw new Error(`world.go('${area}'): no such area.\n\nFix: use one of ${[...areas.keys()].join(', ')}.`);
      }
      startTravel(area, arrive);
    },

    onAreaChange(cb) {
      areaListeners.push(cb);
    },

    setHooks(h) { hooks = h; },

    findSpot(rule) {
      return cur.findSpot(rule, tileSize, 'land');
    },

    planSpawns(sizeOf) {
      const out: SpawnPlan[] = [];
      for (const area of areas.values()) {
        for (const [type, rule] of Object.entries(area.def.spawns ?? {})) {
          const isShip = shipTypes.has(type);
          const r = sizeOf(type) / 2;
          const count = rule.count ?? 1;
          for (let i = 0; i < count; i++) {
            const spot = area.findSpot(rule, r, isShip ? 'sea' : 'land');
            if (!spot) {
              console.warn(`[Glyft] No room to spawn ${type} in '${area.key}' (${i + 1} of ${count}). Try a larger radius or another area.`);
              break;
            }
            const rotation = typeof rule.facing === 'number' ? rule.facing
              : rule.facing === 'out' ? area.headingOut(spot[0], spot[1])
              : isShip ? area.rand() * Math.PI * 2 : 0;
            out.push({ type, x: spot[0], y: spot[1], rotation, area: area.key, with: rule.with as Record<string, unknown> | undefined });
            area.occupy(spot[0], spot[1], r, type);
          }
        }
      }
      return out;
    },

    adopt(id, area) {
      membership.set(id, area);
    },

    activate() {
      const away: string[] = [];
      for (const [id, key] of membership) if (key !== cur.key) away.push(id);
      hooks?.stash(away);
    },

    heightAt(x, y) {
      const wx = x / tileSize, wz = y / tileSize;
      const roof = cur.meshes?.getTopHeight(wx, wz);
      return Math.max(terrainHeight(wx, wz), roof ?? -Infinity);
    },

    isWater(x, y) {
      return isWaterAt(x / tileSize, y / tileSize);
    },

    place(p) {
      if (!ready) {
        throw new Error('world.place() called before the world loaded.\n\nFix: await game.ready first.');
      }
      cur.placeOne(p);
    },

    pick(screenX, screenY): WorldHit | null {
      if (!cur.terrain) return null;
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
      const waterHeight = cur.waterHeight;
      const surface = (p: Vec3) => Math.max(terrainHeight(p[0], p[2]), waterHeight ?? -Infinity);

      // March then bisect
      let prev = 0;
      for (let t = 0.5; t < rig.camera.far; t += 0.5) {
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
      // Building atlas: the game's own tiles, or the built-in materials
      let buildingAtlas: { texture: WebGLTexture; width: number; height: number } | null = null;
      let atlasTile = 32;
      let faceIndex: (f: string | number) => number = (f) => (typeof f === 'number' ? f : 0);
      if (config.buildings) {
        if (config.buildingAtlas) {
          const texture = await loadWorldTexture(gl, config.buildingAtlas.src);
          const img = new Image();
          img.src = config.buildingAtlas.src;
          await img.decode();
          buildingAtlas = { texture, width: img.width, height: img.height };
          atlasTile = config.buildingAtlas.tileSize;
          faceIndex = (f) => {
            if (typeof f !== 'number') {
              throw new Error(`Building face '${f}' must be a tile index when buildingAtlas is set.\n\nFix: use numbers, or remove buildingAtlas to use material names.`);
            }
            return f;
          };
        } else {
          const mats = createMaterialAtlas(gl);
          buildingAtlas = mats;
          atlasTile = mats.tileSize;
          faceIndex = mats.index;
        }
      }

      // Areas
      const ctx = { gl, tileSize, maxSlope, buildings: config.buildings ?? {}, modelTypes, buildingAtlas, atlasTile, faceIndex };
      for (const [key, def] of Object.entries(areaDefs)) areas.set(key, createArea(ctx, key, def));
      await Promise.all([...areas.values()].map((a) => a.load()));
      for (const e of config.exits ?? []) {
        if (!areas.has(e.from) || !areas.has(e.to)) {
          throw new Error(`Exit ${e.from} -> ${e.to} names an area that doesn't exist.\n\nFix: use areas from: ${[...areas.keys()].join(', ')}.`);
        }
      }
      // Rules in order: buildings, exits, props (spawns come at game start)
      for (const area of areas.values()) {
        for (const p of area.def.place ?? []) area.placeOne(p);
        area.placeExits(config.exits ?? []);
        area.scatter();
      }
      cur = areas.get(startKey)!;

      // Models
      if (modelTypes.size > 0) {
        models = createModelSystem(gl, { filter: 'nearest' });
        await Promise.all([...modelTypes.entries()].map(async ([name, def]) => {
          models!.addModel(name, await loadGltf(def.src));
        }));
      }

      // Ships
      if (shipTypes.size > 0) {
        const first = [...shipTypes.values()][0].colors ?? {};
        const [hull, deck, sail, metal, rope, windows, planks, door, trim] = await Promise.all([
          loadWorldTexture(gl, first.hull ?? 'hull'), loadWorldTexture(gl, first.deck ?? 'deck'),
          loadWorldTexture(gl, first.sail ?? 'sail'), loadWorldTexture(gl, 'metal'),
          loadWorldTexture(gl, 'rope'), loadWorldTexture(gl, 'window'),
          loadWorldTexture(gl, 'planks'), loadWorldTexture(gl, 'door'),
          loadWorldTexture(gl, first.trim ?? 0xa83228),
        ]);
        ships = createShipSystem(gl, { hull, deck, sail, sailDirty: sail, metal, cannon: metal, rope, flag: trim, windows, hatch: planks, door });
        for (const [name, def] of shipTypes) {
          const preset = SHIP_PRESETS[def.preset ?? 'sloop'];
          if (!preset) {
            throw new Error(`Unknown ship preset '${def.preset}'.\n\nFix: use one of ${Object.keys(SHIP_PRESETS).join(', ')}.`);
          }
          const { preset: _p, colors: _c, turnRate: _t, ...overrides } = def;
          ships.defineShip({ ...preset, ...overrides, name });
        }
      }

      ready = true;
    },

    prePhysics(dt, sprites, input) {
      for (const s of sprites.values()) {
        if (!s.exists) continue;
        // Sprites created during play belong to the area they appear in
        if (!membership.has(s.id) && cur) membership.set(s.id, cur.key);
        let p = prevPos.get(s.id);
        if (!p) { p = [s.x, s.y]; prevPos.set(s.id, p); }
        p[0] = s.x; p[1] = s.y;
      }
      if (!ctrl || !ready) return;

      // Fade out, switch areas in the dark, fade back in
      if (transition) {
        transition.t += dt;
        if (transition.phase === 'out') {
          fade = Math.min(1, transition.t / FADE_TIME);
          if (transition.t >= FADE_TIME) {
            switchArea(sprites, transition.to, transition.arrive);
            transition = { ...transition, phase: 'in', t: 0 };
          }
        } else {
          fade = Math.max(0, 1 - transition.t / FADE_TIME);
          if (transition.t >= FADE_TIME) { transition = null; fade = 0; }
        }
        const s = driven(sprites);
        if (s) { s.vx = 0; s.vy = 0; }
        return;
      }

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
      if (jump > 0 && input.justPressed('Space') && !air.has(s.id)) {
        // Launch speed that peaks `jump` units above where you took off
        air.set(s.id, { y: groundY.get(s.id) ?? 0, vy: Math.sqrt(2 * GRAVITY * jump), base: s.elevation });
      }
    },

    postPhysics(dt, sprites) {
      lastSprites = sprites;
      if (!ready) return;
      const ctrlSprite = driven(sprites);
      const waterTime = cur.terrain ? cur.terrain.getWaterTime() : 0;
      const waterHeight = cur.waterHeight;

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
            const curF = facing.get(s.id) ?? want;
            const diff = Math.atan2(Math.sin(want - curF), Math.cos(want - curF));
            const turn = (shipTypes.get(s.type)!.turnRate ?? 1.5) * dt;
            facing.set(s.id, curF + Math.max(-turn, Math.min(turn, diff)));
          } else {
            facing.set(s.id, want);
          }
        }

        // Ground: a roof counts once you're on it or above it; otherwise terrain; water surface when floating
        const prevGround = groundY.get(s.id);
        const flying = air.get(s.id);
        let ground = terrainHeight(wx, wz);
        const roof = cur.meshes?.getTopHeight(wx, wz);
        const feet = flying ? flying.y : prevGround ?? -Infinity;
        if (roof != null && feet >= roof - 0.3) ground = Math.max(ground, roof);
        const floats = isShip || s.floats || modelTypes.get(s.type)?.floats;
        if (floats && waterHeight != null && ground < waterHeight) {
          ground = cur.waterSurface(wx, wz);
          const n = sampleWaveNormal(wx, wz, waterTime);
          const h = facing.get(s.id) ?? 0;
          const fwdSlope = n[0] * Math.sin(h) + n[2] * Math.cos(h);
          const sideSlope = n[0] * Math.cos(h) - n[2] * Math.sin(h);
          tilt.set(s.id, [Math.asin(Math.max(-1, Math.min(1, -fwdSlope))) * 0.7, Math.asin(Math.max(-1, Math.min(1, sideSlope))) * 0.7]);
        } else {
          tilt.delete(s.id);
        }

        // Another player's sprite: their client already worked out facing and height
        const rem = remote.get(s.id);
        if (rem) {
          facing.set(s.id, rem.f);
          air.delete(s.id);
          s.elevation = 0;
          groundY.set(s.id, ground);
          if (isShip || modelTypes.has(s.type)) s.rotation = rem.f;
          continue;
        }

        // Walking off a roof or ledge: fall instead of snapping down
        if (!flying && prevGround !== undefined && prevGround - ground > 0.35 && !floats) {
          air.set(s.id, { y: prevGround, vy: 0, base: s.elevation });
        }
        // Jumping and falling: absolute height under gravity; land when the feet reach the ground
        const a = air.get(s.id);
        if (a) {
          a.vy -= GRAVITY * dt;
          a.y += a.vy * dt;
          if (a.y <= ground && a.vy <= 0) {
            s.elevation = a.base;
            air.delete(s.id);
          } else {
            s.elevation = a.base + Math.max(0, a.y - ground);
          }
        }
        groundY.set(s.id, ground);
        if (isShip || modelTypes.has(s.type)) s.rotation = facing.get(s.id) ?? 0;
      }

      checkExits(sprites);

      // Forget sprites that are gone for good (not just in another area)
      if (prevPos.size > sprites.size) {
        for (const id of prevPos.keys()) {
          const s = sprites.get(id);
          if (s && s.exists) continue;
          if (!s && membership.has(id) && membership.get(id) !== cur.key) continue;
          prevPos.delete(id); facing.delete(id); air.delete(id); groundY.delete(id);
          tilt.delete(id); billboardCache.delete(id); membership.delete(id); remote.delete(id);
        }
      }
    },

    surfaceAt(x, y) {
      const wx = x / tileSize, wz = y / tileSize;
      return Math.max(terrainHeight(wx, wz), cur.waterHeight ?? -Infinity);
    },

    spriteHeight(s) {
      const rem = remote.get(s.id);
      if (rem) return rem.h;
      // A mounted rider sits on the mount: its height (jumps included) plus the seat
      if (riding?.mounted && s.id === riding.rider && lastSprites) {
        const v = lastSprites.get(riding.vehicle);
        if (v) return (groundY.get(v.id) ?? 0) + v.elevation + s.elevation;
      }
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

      // Day/night drives every light in a sky area; underground areas keep their fixed light
      if (dayLength > 0) time = (time + dt / dayLength) % 1;
      const base = cur.lighting;
      if (cur.sky) {
        cur.sky.setTimeOfDay(time);
        lighting.fogColor = cur.sky.getFogColor();
        lighting.ambient = cur.sky.getAmbientColor();
        lighting.light = cur.sky.getLightColor();
        lighting.lightDir = cur.sky.getLightDir();
      } else {
        lighting.fogColor = base.fogColor; lighting.ambient = base.ambient;
        lighting.light = base.light; lighting.lightDir = base.lightDir;
      }
      lighting.fogNear = base.fogNear;
      lighting.fogFar = base.fogFar;
      if (cur.terrain) {
        cur.terrain.setLighting(lighting.ambient as [number, number, number], lighting.light as [number, number, number], lighting.lightDir);
        cur.terrain.setFog(lighting.fogColor as [number, number, number], lighting.fogNear, lighting.fogFar);
      }

      // Camera
      let target = findSprite(sprites, config.camera?.target);
      if (riding && target && target.id === riding.rider) target = sprites.get(riding.vehicle) ?? target;
      let focus: Vec3 | null = null;
      if (target) {
        const [wx, wz] = footOf(target);
        focus = [wx, world.spriteHeight(target), wz];
      }
      // The follow camera pulls in for hills and buildings alike
      rig.update(dt, focus, (x, z) => Math.max(terrainHeight(x, z), cur.meshes?.getTopHeight(x, z) ?? -Infinity, cur.waterHeight ?? -Infinity));
      const cam = rig.camera;
      const proj = mat4Perspective(cam.fov, viewportW / viewportH, cam.near, cam.far);
      vp = mat4Multiply(proj, mat4LookAt(cam.position, cam.target, [0, 1, 0]));

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      const nowSec = performance.now() / 1000;
      cur.sky?.render(cam.position, cam.target, vp, nowSec);
      cur.terrain?.render(cam, viewportW, viewportH);
      cur.meshes?.render(cam, vp, lighting);
      cur.props?.render(cam, vp, lighting, nowSec, wind);

      // Sort sprites into ships, models and billboard groups
      for (const g of billboardGroups.values()) g.list.length = 0;
      modelInstances.length = 0;
      for (const m of cur.staticModels) modelInstances.push(m);
      let shipCount = 0;
      const hideForFps = rig.mode === 'fps' ? target : null;

      for (const s of sprites.values()) {
        if (!s.exists || s === hideForFps) continue;
        const rideNow = rideOf(s.id);
        if (rideNow && !rideNow.mounted) continue; // below deck
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
        b.vx = s.vx * pxScale; b.vz = s.vy * pxScale; b.speed = Math.hypot(b.vx, b.vz);
        b.noShadow = false;
        if (rideNow?.mounted) {
          b.noShadow = true; // the mount's shadow covers both
          // Same test the shader uses to pick the mount's row: only when the mount faces the camera is its
          // head nearer than the rider; from the side or behind, the rider draws in front
          const cx = cam.position[0] - wx, cz = cam.position[2] - wz, len = Math.hypot(cx, cz) || 1;
          const rel = ((face - Math.atan2(cx, cz)) / (Math.PI * 2)) % 1;
          const row = Math.floor(((rel + 1) % 1) * 4 + 0.5) % 4; // 0 down, 1 right, 2 up, 3 left
          const nudge = row === 0 ? -0.12 : 0.12;
          b.x += (cx / len) * nudge; b.z += (cz / len) * nudge;
          b.speed = 0;
        }
        const flashUntil = s.data._flashUntil as number | undefined;
        b.scale = s.scale; b.alpha = s.alpha; b.flipX = s.flipX;
        b.tint = flashUntil !== undefined && flashUntil > Date.now() ? (s.data._flashColor as number) ?? 0xff0000 : s.tint;
        b.frameX = s.frameX; b.frameY = s.frameY; b.frameW = s.frameW; b.frameH = s.frameH;
        b.idleFrames = s.idleFrames; b.walkFrames = s.walkFrames; b.fps = s.fps;
        b.bob = s.bob * pxScale; b.bobSpeed = s.bobSpeed;
        b.groundOffset = s.visualOffsetY * pxScale * s.scale;
        if (cur.terrain) {
          const n = cur.terrain.getNormal(wx, wz);
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
      for (const a of areas.values()) a.destroy();
      models?.destroy();
      ships?.destroy();
      for (const b of billboards.values()) b.destroy();
    },
  };

  return world;
}

export type { PlacedExit };
