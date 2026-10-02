/**
 * Glyft Island Example
 *
 * A 3D game written the 2D way: rules, not code. The config declares the
 * island, the village, who spawns where, what blocks what, how enemies
 * behave, what collisions do, and how you board the boat. The only code is
 * loading three images and drawing the HUD.
 */

import { Glyft, type GlyftConfig } from '../../src';
import { ai, death } from '../../addons';

const config: GlyftConfig = {
  settings: { tileSize: 16, viewport: [960, 540], mode: '3d', spriteMode: '4dir' },

  autoTags: { hero: ['player'], orc: ['enemy'], coin: ['pickup'], sloop: ['ship'] },
  stats: { coins: { default: 0 } },

  sounds: {
    '[player]:[pickup]': '$coin',
    '[player]:[enemy]': { sound: '$hurt', cooldown: 0.6 },
  },
  collisions: {
    '[player]:[pickup]': { collect: 'coins', destroy: true, floatText: true, particles: 'sparkle' },
    '[player]:[enemy]': { damage: 10, knockback: 60, flash: 0.2, cooldown: 0.8, floatText: true },
  },
  particles: {
    sparkle: { count: 14, speed: 60, lifetime: 0.5, color: 0xffe066, colorEnd: 0xff9900, size: 3, sizeEnd: 0 },
  },

  world: {
    terrain: {
      heightmap: { generate: 'island', size: 128, seed: 4 },
      maxHeight: 16,
      water: { height: 3.2, style: 'ocean' }, // generated land meets the sea at 0.2 x maxHeight
      fog: { near: 70, far: 220 },
    },
    sky: { time: 0.32, dayLength: 240 },
    camera: { mode: 'follow', target: 'hero', distance: 11, pitch: 0.45, yaw: Math.PI, zoom: [5, 45] },
    controller: {
      sprite: 'hero', speed: 90, jump: 2,
      board: { vehicles: ['cutter'], key: 'KeyF', range: 64 },
    },

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

    // A village: a tower on flat ground, huts around it
    place: [
      { building: 'tower', where: 'flat' },
      { building: 'hut', count: 4, where: 'flat', near: 'tower', radius: 260, spacing: 48 },
    ],

    // Who appears where (in order, so later rules can be near earlier ones)
    spawns: {
      hero: { near: 'tower', radius: 140 },
      cutter: { where: 'shore', near: 'hero', radius: 600, facing: 'out' },
      sloop: { where: 'sea' },
      orc: { count: 6, where: 'hills' },
      coin: { count: 20, spacing: 64 },
    },
  },
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Glyft(canvas, config);

// Enemies chase, ships cruise, and the hero wakes at the start when knocked out: all by tag
game.use(ai({
  behaviors: {
    hunter: { type: 'chase', speed: 45, range: 120 },
    cruise: { type: 'wander', speed: 140, chance: 0.004, damping: 0 }, // hold a heading, change it now and then
  },
  auto: { enemy: 'hunter', ship: 'cruise' },
}));
game.use(death({
  playerRespawn: { hp: 100, floatText: 'Ouch', returnToStart: true },
}));

await Promise.all([
  game.loadTexture('hero', './hero.png', { frameWidth: 32, frameHeight: 32 }),
  game.loadTexture('orc', './orc.png', { frameWidth: 32, frameHeight: 32 }),
  game.loadTexture('coin', './coin.png', { frameWidth: 16, frameHeight: 16 }),
]);

await game.start();

// The art has empty pixels under the feet; coins don't walk
for (const s of [...game.getTagged('player'), ...game.getTagged('enemy')]) s.visualOffsetY = 9;
for (const coin of game.getTagged('pickup')) {
  coin.walkFrames = 0;
  coin.bob = 4;
}
for (const orc of game.getTagged('enemy')) orc.hpBarVisible = true;

// ---- HUD ----

const hero = game.getTagged('player')[0];
const world = game.world!;

game.onUpdate(() => {
  const ctx = game.overlay;
  const hour = Math.floor(world.time * 24);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(8, 8, 230, 64);
  ctx.fillStyle = '#fff';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(`HP ${hero.hp ?? 100}   Coins ${game.stats.coins}/20`, 18, 30);
  ctx.fillText(`${String(hour).padStart(2, '0')}:00  ${world.riding ? 'Sailing (F near land to step off)' : 'On foot'}`, 18, 52);
});

// Handy for poking at the world from the browser console
(window as unknown as { game: Glyft }).game = game;
