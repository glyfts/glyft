/**
 * Glyft Island Example
 *
 * A 3D game written the 2D way: rules, not code. The config declares two
 * areas (an island and the cavern beneath it) joined by exits, the village,
 * trees and rocks, who spawns where, how enemies behave, what a sword swing
 * does, and how you board the boat. The only code loads the images and the HUD.
 */

import { Glyft, type GlyftConfig, type BuildingDef } from '../../src';
import { ai, death } from '../../addons';
import { createHud } from './hud';

// ---- Buildings (parts in world units; door marks where exits start) ----

const caveMouth: BuildingDef = {
  parts: [
    { type: 'box', position: [0, 0, -0.6], size: [5.2, 3.4, 2.6], faces: { all: 'rock' } },
    { type: 'box', position: [-1.85, 0, 0.9], size: [1.5, 2.8, 1.6], faces: { all: 'rock' } },
    { type: 'box', position: [1.85, 0, 0.9], size: [1.5, 2.8, 1.6], faces: { all: 'rock' } },
    { type: 'box', position: [0, 2.2, 0.9], size: [5.2, 1.1, 1.6], faces: { all: 'rock' } },
    { type: 'box', position: [0, 0, 0.6], size: [2.3, 2.25, 0.9], faces: { all: 'shadow' } },
  ],
  door: [0, 1.7],
};

const tower: BuildingDef = {
  parts: [
    { type: 'box', position: [0, 0, 0], size: [3, 7, 3], faces: { all: 'stone' } },
    { type: 'box', position: [0, 0, 1.5], size: [1, 1.9, 0.1], faces: { all: 'door' } },
    { type: 'box', position: [0, 7, 0], size: [3.5, 0.6, 3.5], faces: { all: 'brick' } },
    { type: 'roof', position: [0, 7.6, 0], size: [3.5, 2.2, 3.5], faces: { all: 'slate', gable1: 'stone', gable2: 'stone' } },
  ],
  door: [0, 1.6],
};

// Stairs in the cavern that climb up into the tower
const stairs: BuildingDef = {
  parts: [
    { type: 'box', position: [0, 0, -0.6], size: [3.4, 4, 2.4], faces: { all: 'stone' } },
    { type: 'box', position: [0, 0, 0.62], size: [1.5, 2.3, 0.1], faces: { all: 'shadow' } },
    { type: 'wedge', position: [0, 0, 1.3], size: [1.5, 0.5, 1.2], direction: 'south', faces: { all: 'stone' } },
  ],
  door: [0, 1.9],
};

const config: GlyftConfig = {
  settings: { tileSize: 16, viewport: [960, 540], mode: '3d', spriteMode: '4dir' },

  autoTags: { hero: ['player'], orc: ['enemy'], slime: ['enemy'], coin: ['pickup'], sloop: ['ship'], horse: ['mount'] },
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
    camera: { mode: 'follow', target: 'hero', distance: 11, pitch: 0.45, yaw: Math.PI, zoom: [5, 45] },
    controller: {
      sprite: 'hero', speed: 90, jump: 2,
      board: { vehicles: ['cutter', 'horse'], key: 'KeyF', range: 64 }, // a ship you sail, a horse you ride
      attack: { spawn: 'slash', frames: [4, 1], cooldown: 0.35 }, // click to swing; column 4 is the sword frame
    },

    buildings: {
      hut: [
        { type: 'box', position: [0, 0, 0], size: [4, 2.6, 4], faces: { all: 'plaster', top: 'planks' } },
        { type: 'box', position: [0.8, 0, 2], size: [1, 1.8, 0.1], faces: { all: 'door' } },
        { type: 'box', position: [-0.9, 1, 2], size: [0.8, 0.8, 0.08], faces: { all: 'window' } },
        { type: 'roof', position: [0, 2.6, 0], size: [4.6, 1.8, 4.6], faces: { all: 'thatch', gable1: 'plaster', gable2: 'plaster' } },
      ],
      tower, caveMouth, stairs,
    },
    ships: {
      sloop: { preset: 'sloop' },
      cutter: { preset: 'cutter', turnRate: 1.2 },
    },

    start: 'island',
    areas: {
      island: {
        label: 'The Island',
        terrain: {
          heightmap: { generate: 'island', size: 128, seed: 4 },
          maxHeight: 16,
          water: { height: 3.2, style: 'ocean' }, // generated land meets the sea at 0.2 x maxHeight
          fog: { near: 70, far: 220 },
        },
        sky: { time: 0.32, dayLength: 240 },
        // A village around a tower, and a cave in the hills away from it
        place: [
          { building: 'tower', where: 'flat' },
          { building: 'hut', count: 4, where: 'flat', near: 'tower', radius: 260, spacing: 48 },
          { building: 'caveMouth', where: 'flat', near: 'center', radius: 520, spacing: 200 },
        ],
        scatter: {
          pine: { count: 40 }, oak: { count: 22 }, bush: { count: 35 }, grass: { count: 160 },
          rock: [{ count: 18 }, { count: 4, near: 'caveMouth', radius: 90, spacing: 0 }],
          boulder: [{ count: 6, where: 'hills' }, { count: 3, near: 'caveMouth', radius: 80, spacing: 0 }],
        },
        // Who appears where (in order, so later rules can be near earlier ones)
        spawns: {
          hero: { near: 'tower', radius: 140, with: { label: 'You', visualOffsetY: 1, walkFrames: 3 } },
          horse: { near: 'hero', radius: 120, spacing: 32, with: { label: 'Horse', scale: 1.35, visualOffsetY: 1, walkFrames: 3 } },
          cutter: { where: 'shore', near: 'hero', radius: 700, facing: 'out', with: { label: 'Boat' } },
          sloop: { where: 'sea' },
          orc: { count: 6, where: 'hills', awayFrom: 'hero', with: { visualOffsetY: 1, walkFrames: 3, hpBarVisible: true, data: { maxHp: 100 } } },
          coin: { count: 20, spacing: 64, with: { walkFrames: 0, bob: 4 } },
        },
      },

      cavern: {
        label: 'Glimmer Cavern',
        terrain: { heightmap: { generate: 'cave', size: 72, seed: 9 }, maxHeight: 9, fog: { near: 14, far: 52 } },
        sky: false,
        light: { ambient: 0x3d3852, sun: 0x9a7c60, fog: 0x0a0910 },
        place: [
          { building: 'caveMouth', where: 'flat', near: 'center', radius: 260 },
          { building: 'stairs', where: 'flat', near: 'center', radius: 260, spacing: 160 },
        ],
        scatter: {
          stalagmite: { count: 26 }, crystal: { count: 20, scale: [0.8, 1.6] }, mushroom: { count: 35 }, rock: { count: 14 },
        },
        spawns: {
          slime: { count: 7, spacing: 48, with: { scale: 1.6, hpBarVisible: true, data: { maxHp: 100 } } },
          coin: { count: 12, spacing: 48, with: { walkFrames: 0, bob: 4 } },
        },
      },
    },

    // Walk into a doorway to go through. Each pair names where you come out.
    exits: [
      { from: 'island', to: 'cavern', building: 'caveMouth', name: 'cave-mouth', arrive: 'cavern-tunnel' },
      { from: 'cavern', to: 'island', building: 'caveMouth', name: 'cavern-tunnel', arrive: 'cave-mouth' },
      { from: 'cavern', to: 'island', building: 'stairs', name: 'cavern-stairs', arrive: 'tower-door' },
      { from: 'island', to: 'cavern', building: 'tower', name: 'tower-door', arrive: 'cavern-stairs' },
    ],
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
  rules: { foe: { particles: 'poof', floatText: 'Defeated' } },
  auto: { enemy: 'foe' },
  // Knocked out: wake at the start; from the cavern, that means back up the tower stairs first
  playerRespawn: {
    hp: 100, floatText: 'Ouch', returnToStart: true,
    onDeath: () => { if (game.world!.area !== 'island') game.world!.go('island', 'tower-door'); },
  },
}));

await Promise.all([
  game.loadTexture('hero', './hero.png', { frameWidth: 32, frameHeight: 32 }),
  game.loadTexture('orc', './orc.png', { frameWidth: 32, frameHeight: 32 }),
  game.loadTexture('coin', './coin.png', { frameWidth: 16, frameHeight: 16 }),
  game.loadTexture('horse', './horse.png', { frameWidth: 32, frameHeight: 32 }),
]);
game.createTestAtlas('starter', 16, 16); // built-in art: the cave slimes

await game.start();
createHud(game, { coinsTotal: 32 });

// Handy for poking at the world from the browser console
(window as unknown as { game: Glyft }).game = game;
