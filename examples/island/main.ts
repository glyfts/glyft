/**
 * Glyft Island Example
 *
 * A 3D world built entirely from config: generated island, ocean waves,
 * day/night sky, a village, a follow camera, and a walking controller.
 * The game logic below is plain 2D Glyft: sprites, vx/vy, collisions, stats.
 */

import { Glyft, type GlyftConfig, type Sprite } from '../../src';

const TILE = 16;
const MAX_HEIGHT = 16;
const WATER = MAX_HEIGHT * 0.2; // generated land meets the sea at 0.2 x maxHeight

const config: GlyftConfig = {
  settings: { tileSize: TILE, viewport: [960, 540], mode: '3d', spriteMode: '4dir' },

  autoTags: { hero: ['player'], orc: ['enemy'], coin: ['pickup'] },
  stats: { hp: { default: 100, max: 100 }, coins: { default: 0 } },

  sounds: {
    '[player]:[pickup]': '$coin',
    '[player]:[enemy]': { sound: '$hurt', cooldown: 0.6 },
  },
  collisions: {
    '[player]:[pickup]': { collect: 'coins', destroy: true, floatText: true, particles: 'sparkle' },
    '[player]:[enemy]': { damage: 10, knockback: 60, flash: 0.2, cooldown: 0.6, floatText: true },
  },
  particles: {
    sparkle: { count: 14, speed: 60, lifetime: 0.5, color: 0xffe066, colorEnd: 0xff9900, size: 3, sizeEnd: 0 },
  },

  world: {
    terrain: {
      heightmap: { generate: 'island', size: 128, seed: 4 },
      maxHeight: MAX_HEIGHT,
      water: { height: WATER, style: 'ocean', waves: 1 },
      fog: { near: 70, far: 220 },
    },
    sky: { time: 0.32, dayLength: 240 },
    camera: { mode: 'follow', target: 'hero', distance: 11, pitch: 0.45, yaw: Math.PI, zoom: [5, 45] },
    controller: { sprite: 'hero', speed: 90, jump: 2, blockedBy: ['water', 'steep', 'buildings'] },

    buildings: {
      hut: [
        { type: 'box', position: [0, 0, 0], size: [4, 2.6, 4], faces: { all: 'plaster', top: 'planks' } },
        { type: 'box', position: [0.8, 0, 2], size: [1, 1.8, 0.1], faces: { all: 'door' } },
        { type: 'box', position: [-0.9, 1, 2], size: [0.8, 0.8, 0.08], faces: { all: 'window' } },
        { type: 'roof', position: [0, 2.6, 0], size: [4.6, 1.8, 4.6], faces: { all: 'thatch', gable1: 'plaster', gable2: 'plaster' } },
      ],
      tower: [
        { type: 'box', position: [0, 0, 0], size: [3, 7, 3], faces: { all: 'stone' } },
        { type: 'box', position: [0, 0, 1.5], size: [1, 1.9, 0.1], faces: { all: 'door' } },
        { type: 'box', position: [0, 7, 0], size: [3.5, 0.6, 3.5], faces: { all: 'brick' } },
        { type: 'roof', position: [0, 7.6, 0], size: [3.5, 2.2, 3.5], faces: { all: 'slate', gable1: 'stone', gable2: 'stone' } },
      ],
    },
    ships: {
      sloop: { preset: 'sloop' },
      cutter: { preset: 'cutter', turnRate: 1.2 },
    },
  },
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Glyft(canvas, config);

await Promise.all([
  game.loadTexture('hero', './hero.png', { frameWidth: 32, frameHeight: 32 }),
  game.loadTexture('orc', './orc.png', { frameWidth: 32, frameHeight: 32 }),
]);
await game.ready;

const world = game.world!;
const WORLD_PX = 128 * TILE;

/** Find dry, flat ground near a point, spiralling outward. */
function findLand(cx: number, cy: number, minH = WATER + 0.6, maxH = WATER + 4): [number, number] {
  for (let r = 0; r < WORLD_PX / 2; r += TILE) {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const h = world.heightAt(x, y);
      if (h > minH && h < maxH) return [x, y];
    }
  }
  return [cx, cy];
}

/** Find open water at least `depth` below the surface. */
function findSea(cx: number, cy: number, depth = 1.2): [number, number] {
  for (let r = 0; r < WORLD_PX / 2; r += TILE) {
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (world.heightAt(x, y) < WATER - depth) return [x, y];
    }
  }
  return [cx, cy];
}

// ---- Village ----

const [vx, vy] = findLand(WORLD_PX / 2, WORLD_PX * 0.62);
const village: [string, number, number][] = [['hut', -200, 60], ['hut', 70, -170], ['hut', 210, 40], ['tower', -110, -190]];
for (const [building, dx, dy] of village) {
  const [bx, by] = findLand(vx + dx, vy + dy);
  // Keep the square clear: findLand can spiral back toward the centre
  if (Math.hypot(bx - vx, by - vy) < 100) continue;
  world.place({ building, at: [bx, by] });
}

// ---- Hero ----

const hero = game.spawn('hero', 0, 0);
hero.x = vx;
hero.y = vy;
hero.label = 'You';
hero.visualOffsetY = 9; // the art has empty pixels under the feet

// ---- Orcs wander the hills ----

const orcs: Sprite[] = [];
for (let i = 0; i < 6; i++) {
  const [ox, oy] = findLand(WORLD_PX / 2 + Math.cos(i) * 300, WORLD_PX / 2 + Math.sin(i) * 300, WATER + 1, WATER + 8);
  const orc = game.spawn('orc', 0, 0);
  orc.x = ox;
  orc.y = oy;
  orc.physics = true;
  orc.data.home = [ox, oy];
  orc.hpBarVisible = true;
  orc.visualOffsetY = 9;
  orcs.push(orc);
}

// ---- Coins scattered over the island ----

// A coin drawn on a canvas: four identical rows so it looks the same from every side
const coinCanvas = document.createElement('canvas');
coinCanvas.width = 16;
coinCanvas.height = 64;
const cctx = coinCanvas.getContext('2d')!;
for (let row = 0; row < 4; row++) {
  cctx.fillStyle = '#b8860b';
  cctx.beginPath(); cctx.arc(8, row * 16 + 8, 6, 0, Math.PI * 2); cctx.fill();
  cctx.fillStyle = '#ffd23f';
  cctx.beginPath(); cctx.arc(8, row * 16 + 8, 4.5, 0, Math.PI * 2); cctx.fill();
}
await game.loadTexture('coin', coinCanvas.toDataURL(), { frameWidth: 16, frameHeight: 16 });

for (let i = 0; i < 20; i++) {
  const a = (i / 20) * Math.PI * 2;
  const [cx, cy] = findLand(WORLD_PX / 2 + Math.cos(a) * 420, WORLD_PX / 2 + Math.sin(a) * 420);
  const coin = game.spawn('coin', 0, 0);
  coin.x = cx;
  coin.y = cy;
  coin.walkFrames = 0;
  coin.bob = 4;
}

// ---- Ships: one sails laps around the island, one waits at the shore ----

const CENTRE = WORLD_PX / 2;
const SAIL_RADIUS = WORLD_PX * 0.43;
const SAIL_SPEED = 70;
let sailAngle = 0;
const sloop = game.spawn('sloop', 0, 0);
sloop.x = CENTRE + Math.cos(sailAngle) * SAIL_RADIUS;
sloop.y = CENTRE + Math.sin(sailAngle) * SAIL_RADIUS;
sloop.physics = true;

// The cutter waits just off the beach south of the village, bow out to sea
const [bx, by] = findSea(vx, vy + 200, 0.8);
const cutter = game.spawn('cutter', 0, 0);
cutter.x = bx;
cutter.y = by;
cutter.rotation = Math.atan2(bx - CENTRE, by - CENTRE);

// ---- Boarding: hand the controller and camera to the boat ----

let aboard = false;
const controller = game.config.world!.controller!;
const camera = game.config.world!.camera!;

function board(): void {
  aboard = true;
  hero.tags = hero.tags.filter((t) => t !== 'player'); // out of reach while at sea
  controller.sprite = 'cutter';
  camera.target = 'cutter';
  hero.alpha = 0;
  hero.label = null;
  hero.physics = false;
}

function goAshore(): boolean {
  const [lx, ly] = findLand(cutter.x, cutter.y);
  if (Math.hypot(lx - cutter.x, ly - cutter.y) > 6 * TILE) return false;
  aboard = false;
  hero.tags.push('player');
  controller.sprite = 'hero';
  camera.target = 'hero';
  hero.x = lx;
  hero.y = ly;
  hero.alpha = 1;
  hero.label = 'You';
  cutter.vx = 0;
  cutter.vy = 0;
  return true;
}

// ---- Combat: an orc that lands a hit backs off for a moment ----

game.collisions.on('[player]:[enemy]', (_player, orc) => {
  orc.data.backOff = 1.5;
});

// ---- Game loop ----

let wanderTimer = 0;

game.onUpdate((dt) => {
  // Orcs: chase the hero when close, otherwise amble near home
  wanderTimer -= dt;
  for (const orc of orcs) {
    if (!orc.exists) continue;
    const dx = hero.x - orc.x, dy = hero.y - orc.y;
    const dist = Math.hypot(dx, dy);
    const [hx, hy] = orc.data.home as [number, number];
    const backOff = (orc.data.backOff as number | undefined) ?? 0;
    if (backOff > 0) {
      orc.data.backOff = backOff - dt;
      orc.vx = (-dx / dist) * 40;
      orc.vy = (-dy / dist) * 40;
    } else if (!aboard && dist < 120) {
      orc.vx = (dx / dist) * 50;
      orc.vy = (dy / dist) * 50;
    } else if (wanderTimer <= 0) {
      const tx = hx + (Math.random() - 0.5) * 160 - orc.x;
      const ty = hy + (Math.random() - 0.5) * 160 - orc.y;
      const d = Math.hypot(tx, ty) || 1;
      orc.vx = (tx / d) * 25;
      orc.vy = (ty / d) * 25;
    }
    if (world.isWater(orc.x + orc.vx * dt * 8, orc.y + orc.vy * dt * 8)) {
      orc.vx = -orc.vx;
      orc.vy = -orc.vy;
    }
  }
  if (wanderTimer <= 0) wanderTimer = 2;

  // The sloop sails laps offshore: velocity along the circle's tangent
  sailAngle += (dt * SAIL_SPEED) / SAIL_RADIUS;
  sloop.vx = -Math.sin(sailAngle) * SAIL_SPEED;
  sloop.vy = Math.cos(sailAngle) * SAIL_SPEED;

  // Fall, wake up in the village
  if ((hero.hp ?? 100) <= 0) {
    hero.hp = 100;
    hero.x = vx;
    hero.y = vy;
    game.floatText(vx, vy, 'Ouch', { color: 0xffffff });
  }

  // Board or leave the cutter
  if (game.input.justPressed('KeyF')) {
    if (aboard) goAshore();
    else if (Math.hypot(cutter.x - hero.x, cutter.y - hero.y) < 5 * TILE) board();
  }

  // HUD
  const ctx = game.overlay;
  const hour = Math.floor(world.time * 24);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(8, 8, 220, 64);
  ctx.fillStyle = '#fff';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(`HP ${hero.hp}   Coins ${game.stats.coins}/20`, 18, 30);
  ctx.fillText(`${String(hour).padStart(2, '0')}:00  ${aboard ? 'Sailing (F to land)' : 'On foot'}`, 18, 52);
  if (!aboard && Math.hypot(cutter.x - hero.x, cutter.y - hero.y) < 5 * TILE) {
    ctx.fillText('Press F to board', 18, 92);
  }
});

game.on('pointerdown', (e) => {
  if (e.sprite?.tags.includes('enemy')) game.floatText(e.worldX, e.worldY, 'Grr!', { color: 0xff6666 });
});

// Handy for poking at the world from the browser console
(window as unknown as { game: Glyft }).game = game;

game.start();
