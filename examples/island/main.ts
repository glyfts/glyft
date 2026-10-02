/**
 * Glyft Island Example
 *
 * A 3D game written the 2D way: rules, not code. The config declares the
 * island, the village, who spawns where, what blocks what, how enemies
 * behave, what a sword swing does, and how you board the boat. The only code
 * is loading three images and drawing the HUD.
 */

import { Glyft, type GlyftConfig } from '../../src';
import { ai, death } from '../../addons';

const config: GlyftConfig = {
  settings: { tileSize: 16, viewport: [960, 540], mode: '3d', spriteMode: '4dir' },

  autoTags: { hero: ['player'], orc: ['enemy'], coin: ['pickup'], sloop: ['ship'] },
  stats: { hp: { default: 100, max: 100 }, coins: { default: 0 } },

  sounds: {
    '[player]:[pickup]': '$coin',
    '[player]:[enemy]': { sound: '$hurt', cooldown: 0.6 },
    '[enemy]:slash': '$hit',
  },
  collisions: {
    '[player]:[pickup]': { collect: 'coins', destroy: true, floatText: true, particles: 'sparkle' },
    '[player]:[enemy]': { damage: 10, knockback: 60, flash: 0.2, cooldown: 0.8, floatText: true },
    // The hero's sword swing (controller.attack) is a sprite too, so hitting is just a rule
    '[enemy]:slash': { damage: 25, knockback: 90, flash: 0.15, cooldown: 0.3, floatText: true, particles: 'hit' },
  },
  particles: {
    sparkle: { count: 14, speed: 60, lifetime: 0.5, color: 0xffe066, colorEnd: 0xff9900, size: 3, sizeEnd: 0 },
    hit: { count: 10, speed: 80, lifetime: 0.3, color: 0xffffff, colorEnd: 0xff4444, size: 3, sizeEnd: 0 },
    poof: { count: 24, speed: 50, lifetime: 0.7, color: 0x88aa66, colorEnd: 0x334422, size: 4, sizeEnd: 0 },
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
      attack: { spawn: 'slash', frames: [4, 1], cooldown: 0.35 }, // click to swing; column 4 is the sword frame
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
    // The art has empty pixels under the feet (visualOffsetY) and a sword frame after the walk cycle
    spawns: {
      hero: { near: 'tower', radius: 140, with: { label: 'You', visualOffsetY: 9, walkFrames: 3 } },
      cutter: { where: 'shore', near: 'hero', radius: 400, facing: 'out', with: { label: 'Boat' } },
      sloop: { where: 'sea' },
      orc: { count: 6, where: 'hills', with: { visualOffsetY: 9, walkFrames: 3, hpBarVisible: true, data: { maxHp: 100 } } },
      coin: { count: 20, spacing: 64, with: { walkFrames: 0, bob: 4 } },
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
  rules: { orc: { particles: 'poof', floatText: 'Defeated' } },
  auto: { enemy: 'orc' },
  playerRespawn: { hp: 100, floatText: 'Ouch', returnToStart: true },
}));

await Promise.all([
  game.loadTexture('hero', './hero.png', { frameWidth: 32, frameHeight: 32 }),
  game.loadTexture('orc', './orc.png', { frameWidth: 32, frameHeight: 32 }),
  game.loadTexture('coin', './coin.png', { frameWidth: 16, frameHeight: 16 }),
]);

await game.start();

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
  if (world.boardable) {
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Press F to board', 480, 470);
    ctx.textAlign = 'left';
  }
});

// Handy for poking at the world from the browser console
(window as unknown as { game: Glyft }).game = game;
