/**
 * One area of a 3D world: terrain, sky (or fixed underground light), buildings,
 * props, placement rules and the exits that lead out of it.
 *
 * Coordinates: rules and sprites use ground pixels; one tile (tileSize px) is one world unit.
 */

import type { AreaDef, BuildingDef, BuildingPart, ExitDef, ModelDef, PlacementDef, PlacementRule, PropKind, WorldArea } from './types';
import { createTerrainSystem, type TerrainSystem, type Lighting } from './terrain';
import { createMeshSystem, type MeshSystem, type MeshPart } from './mesh';
import type { ModelInstance } from './model';
import { createSkySystem, type SkySystem } from './sky';
import { createPropSystem, PROP_INFO, type PropInstance, type PropSystem } from './props';
import { resolveHeightmap } from './heightmap';
import { loadWorldTexture } from './materials';
import { sampleWaveHeight } from './waves';
import { vec3Normalize, type Vec3 } from './math3d';

const DEFAULT_FOG: Vec3 = [0.62, 0.74, 0.86];
const DEFAULT_TERRAIN = { low: 'sand', mid: 'grass', steep: 'rock', high: 'snow' } as const;
const CAVE_TERRAIN = { low: 'mud', mid: 'dirt', steep: 'rock', high: 'rock' } as const;
const BOX_FACES = ['north', 'south', 'east', 'west', 'top', 'bottom'];
const ROOF_FACES = ['slope1', 'slope2', 'gable1', 'gable2', 'bottom'];
const WEDGE_FACES = ['slope', 'back', 'side1', 'side2', 'bottom'];
const WATER_STYLES = {
  ocean: { deepColor: [0.08, 0.22, 0.38] as [number, number, number], shallowColor: [0.18, 0.42, 0.55] as [number, number, number], alpha: 0.78, emissive: 0 },
  lake: { deepColor: [0.12, 0.26, 0.3] as [number, number, number], shallowColor: [0.24, 0.42, 0.42] as [number, number, number], alpha: 0.72, emissive: 0 },
  lava: { deepColor: [0.7, 0.15, 0.02] as [number, number, number], shallowColor: [1.0, 0.5, 0.1] as [number, number, number], alpha: 1, emissive: 1 },
};

export function hexToVec3(c: number): Vec3 {
  return [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];
}

/** Parts of a building, whichever form it was declared in. */
export function buildingParts(def: BuildingPart[] | BuildingDef): BuildingPart[] {
  return Array.isArray(def) ? def : def.parts;
}

/** Shared things every area needs, owned by the world. */
export interface AreaContext {
  gl: WebGL2RenderingContext;
  tileSize: number;
  maxSlope: number;
  buildings: Record<string, BuildingPart[] | BuildingDef>;
  modelTypes: Map<string, ModelDef>;
  /** Building tile atlas (built-in materials or the game's own) */
  buildingAtlas: { texture: WebGLTexture; width: number; height: number } | null;
  atlasTile: number;
  faceIndex: (f: string | number) => number;
}

/** An exit resolved to a spot in its area. */
export interface PlacedExit {
  def: ExitDef;
  name: string;
  x: number;
  y: number;
  trigger: number;
  /** Unit vector pointing out of the doorway (arrivals stand this way), or null for open spots */
  out: [number, number] | null;
}

export interface Area {
  readonly key: string;
  readonly label: string;
  readonly def: AreaDef;
  terrain: TerrainSystem | null;
  sky: SkySystem | null;
  meshes: MeshSystem | null;
  props: PropSystem | null;
  readonly staticModels: ModelInstance[];
  readonly exits: PlacedExit[];
  worldSize: [number, number];
  readonly waterHeight: number | null;
  /** Lighting for this area (copied into the scene each frame) */
  readonly lighting: Lighting;

  load(): Promise<void>;
  terrainHeight(wx: number, wz: number): number;
  isWaterAt(wx: number, wz: number): boolean;
  waterSurface(wx: number, wz: number): number;
  /** A solid prop (tree trunk, rock) at this world position */
  propBlocks(wx: number, wz: number): boolean;
  inArea(px: number, py: number, area: Exclude<WorldArea, [number, number]>): boolean;
  findSpot(rule: PlacementRule, selfR: number, fallback: WorldArea, footprint?: boolean): [number, number] | null;
  headingOut(px: number, py: number): number;
  placeOne(p: PlacementDef): void;
  /** Resolve the exits leaving this area (call after place, before scatter) */
  placeExits(exits: ExitDef[]): void;
  scatter(): void;
  rand(): number;
  /** Remember something placed so later rules can keep clear of it or stay near it */
  occupy(x: number, y: number, r: number, name: string): void;
  destroy(): void;
}

export function createArea(ctx: AreaContext, key: string, def: AreaDef): Area {
  const { gl, tileSize } = ctx;
  const terrainDef = def.terrain;
  const waterHeight = terrainDef?.water?.height ?? null;
  const underground = def.sky === false || !def.sky;

  const occupied: { x: number; y: number; r: number; name: string }[] = [];
  const placedBuildings: { defId: string; x: number; y: number; z: number; rotation: number }[] = [];
  const staticModels: ModelInstance[] = [];
  const exits: PlacedExit[] = [];
  const propList: PropInstance[] = [];
  const propGrid = new Map<string, { x: number; z: number; r: number }[]>(); // 2-unit cells

  const hm = terrainDef?.heightmap;
  let rngState = ((hm && typeof hm === 'object' && !Array.isArray(hm) ? hm.seed ?? 1 : 1) * 2654435761 + key.length * 97) >>> 0 || 1;
  const rand = () => {
    rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
    return (rngState >>> 0) / 4294967296;
  };

  const light = def.light ?? {};
  const fogDef = terrainDef?.fog;
  const lighting: Lighting = underground
    ? {
      lightDir: vec3Normalize([0.2, 1.0, 0.35]),
      ambient: hexToVec3(light.ambient ?? 0x4a4258),
      light: hexToVec3(light.sun ?? 0x8c7458),
      fogColor: hexToVec3(light.fog ?? fogDef?.color ?? 0x0d0b12),
      fogNear: fogDef?.near ?? 18,
      fogFar: fogDef?.far ?? 60,
    }
    : {
      lightDir: vec3Normalize([0.3, 1.0, 0.5]),
      ambient: [0.35, 0.35, 0.4],
      light: [1.0, 0.95, 0.85],
      fogColor: fogDef?.color != null ? hexToVec3(fogDef.color) : DEFAULT_FOG,
      fogNear: fogDef?.near ?? 80,
      fogFar: fogDef?.far ?? 260,
    };

  const area: Area = {
    key,
    label: def.label ?? key,
    def,
    terrain: null,
    sky: null,
    meshes: null,
    props: null,
    staticModels,
    exits,
    worldSize: [0, 0],
    waterHeight,
    lighting,

    async load() {
      if (terrainDef) {
        const heightmap = await resolveHeightmap(terrainDef.heightmap);
        const isCave = !Array.isArray(terrainDef.heightmap) && typeof terrainDef.heightmap === 'object' && terrainDef.heightmap.generate === 'cave';
        const tex = { ...(isCave ? CAVE_TERRAIN : DEFAULT_TERRAIN), ...(terrainDef.textures ?? {}) };
        const [low, mid, steep, high] = await Promise.all([
          loadWorldTexture(gl, tex.low), loadWorldTexture(gl, tex.mid),
          loadWorldTexture(gl, tex.steep), loadWorldTexture(gl, tex.high),
        ]);
        area.terrain = createTerrainSystem(gl, {
          heightmap,
          cellSize: terrainDef.cellSize ?? 1,
          maxHeight: terrainDef.maxHeight ?? 16,
          texture: mid,
          textureRepeat: 2,
          splatTextures: { low, mid, steep, high },
          waterHeight: waterHeight ?? undefined,
          waterStyle: WATER_STYLES[terrainDef.water?.style ?? 'ocean'],
          stepped: terrainDef.stepped,
          fogColor: lighting.fogColor as [number, number, number],
          fogNear: lighting.fogNear,
          fogFar: lighting.fogFar,
        });
        area.terrain.setWaveScale(terrainDef.water?.waves ?? 1);
        area.worldSize = area.terrain.getWorldSize();
      }
      if (def.sky) area.sky = createSkySystem(gl, { stars: def.sky.stars, clouds: def.sky.clouds });

      if (ctx.buildingAtlas && Object.keys(ctx.buildings).length > 0) {
        area.meshes = createMeshSystem(gl, ctx.buildingAtlas, ctx.atlasTile);
        for (const [name, b] of Object.entries(ctx.buildings)) {
          area.meshes.defineBuilding(name, buildingParts(b).map((p): MeshPart => ({
            type: p.type, position: p.position, size: p.size, direction: p.direction,
            faces: resolveFaces(p, ctx.faceIndex),
          })));
        }
      }
      area.props = createPropSystem(gl);
    },

    terrainHeight(wx, wz) {
      return area.terrain ? area.terrain.getHeight(wx, wz) : 0;
    },

    isWaterAt(wx, wz) {
      return waterHeight != null && area.terrainHeight(wx, wz) < waterHeight;
    },

    waterSurface(wx, wz) {
      if (waterHeight == null) return 0;
      return waterHeight + sampleWaveHeight(wx, wz, area.terrain ? area.terrain.getWaterTime() : 0);
    },

    propBlocks(wx, wz) {
      const cx = Math.floor(wx / 2), cz = Math.floor(wz / 2);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const p of propGrid.get(`${cx + dx},${cz + dz}`) ?? []) {
            if ((p.x - wx) ** 2 + (p.z - wz) ** 2 < p.r * p.r) return true;
          }
        }
      }
      return false;
    },

    inArea(px, py, kind) {
      const wx = px / tileSize, wz = py / tileSize;
      const [W, H] = area.worldSize;
      if (wx < 1 || wz < 1 || wx > W - 1 || wz > H - 1) return false;
      if (!area.terrain) return kind === 'land' || kind === 'flat';
      const h = area.terrainHeight(wx, wz);
      const wet = area.isWaterAt(wx, wz);
      const sea = waterHeight ?? -Infinity;
      const ny = area.terrain.getNormal(wx, wz)[1];
      const free = !(area.meshes?.isBlocked(wx, wz)) && !area.propBlocks(wx, wz);
      switch (kind) {
        case 'land': return !wet && h > sea + 0.3 && ny >= ctx.maxSlope && free;
        case 'flat': return !wet && h > sea + 0.3 && ny > 0.93 && free;
        case 'hills': {
          const base = Math.max(sea, 0);
          return !wet && ny >= ctx.maxSlope && free && h > base + ((terrainDef?.maxHeight ?? 16) - base) * 0.3;
        }
        case 'shore': return wet && sea - h > 0.4 && landWithin(wx, wz, 3);
        case 'sea': return wet && sea - h > 1.5 && !landWithin(wx, wz, 8);
      }
      return false;
    },

    findSpot(rule, selfR, fallback, footprint = false) {
      const kind = rule.where ?? fallback;
      if (Array.isArray(kind)) return [kind[0], kind[1]];
      const spacing = rule.spacing ?? tileSize * 2;
      const W = area.worldSize[0] * tileSize || 1024, H = area.worldSize[1] * tileSize || 1024;
      let cx = W / 2, cy = H / 2, radius = Infinity;
      if (rule.near) {
        if (rule.near !== 'center') {
          const anchors = occupied.filter((o) => o.name === rule.near);
          if (anchors.length === 0) {
            throw new Error(
              `Placement near '${rule.near}' in area '${key}', but nothing called '${rule.near}' has been placed there yet.\n\n` +
              "Fix: place it first (place, then exits, scatter and spawns, each in order), or use near: 'center'."
            );
          }
          const anchor = anchors[Math.floor(rand() * anchors.length)];
          cx = anchor.x; cy = anchor.y;
        }
        radius = rule.radius ?? 240;
      }
      // Hard constraint: stay clear of everything named awayFrom
      const away = rule.awayFrom ? occupied.filter((o) => o.name === rule.awayFrom) : [];
      const awayDist = rule.awayDistance ?? 320;
      // Spacing relaxes on the second pass so crowded rules still place something; awayFrom never does
      for (let pass = 0; pass < 2; pass++) {
        const gap = pass === 0 ? spacing : 0;
        for (let i = 0; i < 800; i++) {
          let x: number, y: number;
          if (radius === Infinity) { x = rand() * W; y = rand() * H; }
          else { const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * radius; x = cx + Math.cos(a) * d; y = cy + Math.sin(a) * d; }
          if (!area.inArea(x, y, kind)) continue;
          if (footprint && !footprintFits(x, y, selfR)) continue;
          if (away.some((o) => Math.hypot(o.x - x, o.y - y) < awayDist)) continue;
          if (occupied.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + selfR + gap)) continue;
          return [x, y];
        }
      }
      return null;
    },

    headingOut(px, py) {
      const wx = px / tileSize, wz = py / tileSize;
      let lx = 0, lz = 0;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        for (let d = 1; d <= 8; d++) {
          if (!area.isWaterAt(wx + Math.cos(ang) * d, wz + Math.sin(ang) * d)) { lx += Math.cos(ang) / d; lz += Math.sin(ang) / d; break; }
        }
      }
      return Math.atan2(-lx, -lz);
    },

    placeOne(p) {
      const name = p.building ?? p.model;
      if (p.building && !ctx.buildings[p.building]) {
        throw new Error(`Placed building '${p.building}' is not defined.\n\nFix: add it to world.buildings.`);
      }
      if (p.model && !ctx.modelTypes.has(p.model)) {
        throw new Error(`Placed model '${p.model}' is not defined.\n\nFix: add it to world.models.`);
      }
      if (!name) {
        throw new Error("A placement needs a building or a model.\n\nFix: { building: 'hut', where: 'flat' } or { building: 'hut', at: [x, y] }");
      }
      const r = p.building ? buildingRadius(p.building) : (ctx.modelTypes.get(name)!.footprint?.[0] ?? tileSize) / 2;
      const count = p.at ? 1 : p.count ?? 1;
      for (let i = 0; i < count; i++) {
        const spot = p.at ?? area.findSpot(p, r, 'flat', !!p.building);
        if (!spot) {
          console.warn(`[Glyft] No room for ${name} in '${key}' (${i + 1} of ${count}). Try a larger radius, smaller spacing, or another area.`);
          break;
        }
        const wx = spot[0] / tileSize, wz = spot[1] / tileSize;
        const y = area.terrainHeight(wx, wz);
        const rotation = p.rotation ?? (p.at ? 0 : Math.floor(rand() * 4) * (Math.PI / 2));
        if (p.building) placedBuildings.push({ defId: p.building, x: wx, y, z: wz, rotation });
        else staticModels.push({ modelId: name, x: wx, y, z: wz, rotation, scale: ctx.modelTypes.get(name)!.scale ?? 1 });
        area.occupy(spot[0], spot[1], r, name);
      }
      area.meshes?.placeBuildings(placedBuildings);
    },

    placeExits(all) {
      for (const e of all) {
        if (e.from !== key) continue;
        const name = e.name ?? `${e.from}-${e.to}`;
        const trigger = e.trigger ?? 14;
        let spot: [number, number] | null = null;
        let out: [number, number] | null = null;
        if (e.building) {
          const b = placedBuildings.find((pb) => pb.defId === e.building);
          const bdef = ctx.buildings[e.building];
          if (!b || !bdef) {
            throw new Error(`Exit '${name}' uses building '${e.building}', which isn't placed in area '${key}'.\n\nFix: add { building: '${e.building}', ... } to that area's place list.`);
          }
          const door = !Array.isArray(bdef) && bdef.door ? bdef.door : [0, buildingRadius(e.building) / tileSize];
          const c = Math.cos(b.rotation), s = Math.sin(b.rotation);
          const dx = door[0] * c - door[1] * s, dz = door[0] * s + door[1] * c;
          const len = Math.hypot(dx, dz) || 1;
          out = [dx / len, dz / len];
          // The trigger sits just outside the doorway
          spot = [(b.x + dx + out[0] * 0.5) * tileSize, (b.z + dz + out[1] * 0.5) * tileSize];
        } else {
          spot = e.at ?? area.findSpot(e, trigger, 'land');
        }
        if (!spot) {
          console.warn(`[Glyft] No room for exit '${name}' in '${key}'.`);
          continue;
        }
        exits.push({ def: e, name, x: spot[0], y: spot[1], trigger, out });
        area.occupy(spot[0], spot[1], trigger + 8, name);
      }
    },

    scatter() {
      const entries = Object.entries(def.scatter ?? {}).flatMap(([k, r]) => (Array.isArray(r) ? r : [r!]).map((rule) => [k, rule] as const));
      for (const [kindName, rule] of entries) {
        const kind = kindName as PropKind;
        if (!PROP_INFO[kind]) {
          throw new Error(`Unknown prop '${kindName}'.\n\nFix: use one of ${Object.keys(PROP_INFO).join(', ')}.`);
        }
        const [s0, s1] = rule.scale ?? [0.8, 1.25];
        const count = rule.count ?? 1;
        for (let i = 0; i < count; i++) {
          const scale = s0 + rand() * (s1 - s0);
          const r = Math.max(PROP_INFO[kind].radius, 0.3) * scale * tileSize;
          const spot = area.findSpot({ spacing: tileSize * 0.5, ...rule }, r, 'land');
          if (!spot) break;
          const wx = spot[0] / tileSize, wz = spot[1] / tileSize;
          // Seat the prop at the lowest ground under its footprint so no edge hangs in the air on a slope
          const fr = Math.max(PROP_INFO[kind].radius, 0.4) * scale;
          let base = area.terrainHeight(wx, wz);
          for (let a = 0; a < 6; a++) {
            base = Math.min(base, area.terrainHeight(wx + Math.cos(a * 1.047) * fr, wz + Math.sin(a * 1.047) * fr));
          }
          propList.push({ kind, x: wx, y: base - 0.05, z: wz, rotation: rand() * Math.PI * 2, scale });
          const block = PROP_INFO[kind].radius * scale;
          if (block > 0) {
            const cell = `${Math.floor(wx / 2)},${Math.floor(wz / 2)}`;
            const list = propGrid.get(cell) ?? [];
            list.push({ x: wx, z: wz, r: block });
            propGrid.set(cell, list);
            occupied.push({ x: spot[0], y: spot[1], r: block * tileSize, name: kind });
          }
        }
      }
      area.props?.setInstances(propList);
    },

    rand,

    occupy(x, y, r, name) {
      occupied.push({ x, y, r, name });
    },

    destroy() {
      area.terrain?.destroy();
      area.sky?.destroy();
      area.meshes?.destroy();
      area.props?.destroy();
    },
  };

  function landWithin(wx: number, wz: number, dist: number): boolean {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      for (let d = 1; d <= dist; d++) if (!area.isWaterAt(wx + Math.cos(ang) * d, wz + Math.sin(ang) * d)) return true;
    }
    return false;
  }

  /** Buildings need their whole footprint on even, dry ground. */
  function footprintFits(px: number, py: number, r: number): boolean {
    const h0 = area.terrainHeight(px / tileSize, py / tileSize);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const x = px + dx * r * 0.8, y = py + dy * r * 0.8;
      if (!area.inArea(x, y, 'land')) return false;
      if (Math.abs(area.terrainHeight(x / tileSize, y / tileSize) - h0) > 1.2) return false;
    }
    return true;
  }

  function buildingRadius(name: string): number {
    let r = 0;
    for (const part of buildingParts(ctx.buildings[name] ?? [])) {
      r = Math.max(r, Math.abs(part.position[0]) + part.size[0] / 2, Math.abs(part.position[2]) + part.size[2] / 2);
    }
    return r * tileSize;
  }

  return area;
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
