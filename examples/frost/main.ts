/**
 * Glyft Frostholm Example
 *
 * A shared winter archipelago at dusk. Same engine and rules as the island,
 * a different world: snow terrain, frosted pines, glowing ice, longhouses
 * with snow on the roofs, and a network rule so everyone here sees each other.
 */

import { Glyft, type GlyftConfig, type BuildingDef } from '../../src';
import { createHud } from '../island/hud';

// Your name and cloak colour, kept between visits
const NAMES = ['Asa', 'Bjorn', 'Eir', 'Grima', 'Halla', 'Ingvar', 'Kari', 'Liv', 'Orm', 'Runa', 'Sigrid', 'Tove'];
const CLOAKS = [0xffc8c0, 0xc8d8ff, 0xd4ffc8, 0xffe4a8, 0xe8ccff, 0xffffff];
const stored = (key: string, make: () => string) => {
  let v = localStorage.getItem(key);
  if (!v) { v = make(); localStorage.setItem(key, v); }
  return v;
};
const playerName = stored('glyft-frost-name', () => `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${Math.floor(Math.random() * 90 + 10)}`);
const cloak = Number(stored('glyft-frost-cloak', () => String(CLOAKS[Math.floor(Math.random() * CLOAKS.length)])));

// Locally, run a Wyrt server with wyrt_sync; ?server= points anywhere else
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const server = new URLSearchParams(location.search).get('server') ?? (local ? 'ws://localhost:8080' : 'wss://glyft.dev/sync');

const longhouse: BuildingDef = {
  parts: [
    { type: 'box', position: [0, 0, 0], size: [7, 2.4, 3.6], faces: { all: 'wood' } },
    { type: 'box', position: [0, 0, 1.8], size: [1.1, 1.9, 0.1], faces: { all: 'door' } },
    { type: 'roof', position: [0, 2.4, 0], size: [7.6, 2.6, 4.4], faces: { all: 'snow', gable1: 'wood', gable2: 'wood' } },
  ],
};

const hall: BuildingDef = {
  parts: [
    { type: 'box', position: [0, 0, 0], size: [5, 3.2, 5], faces: { all: 'stone' } },
    { type: 'box', position: [0, 0, 2.5], size: [1.4, 2.2, 0.1], faces: { all: 'door' } },
    { type: 'box', position: [0, 3.2, 0], size: [5.4, 0.4, 5.4], faces: { all: 'wood' } },
    { type: 'roof', position: [0, 3.6, 0], size: [5.4, 3, 5.4], faces: { all: 'snow', gable1: 'stone', gable2: 'stone' } },
  ],
};

const config: GlyftConfig = {
  settings: { tileSize: 16, viewport: [960, 540], mode: '3d', spriteMode: '4dir' },
  network: { server, room: 'frostholm', name: playerName },

  autoTags: { hero: ['player'], coin: ['pickup'], horse: ['mount'] },
  stats: { hp: { default: 100, max: 100 }, coins: { default: 0 } },
  sounds: { '[player]:[pickup]': '$coin' },
  collisions: { '[player]:[pickup]': { collect: 'coins', destroy: true, floatText: true, particles: 'frost' } },
  particles: {
    frost: { count: 16, speed: 50, lifetime: 0.6, color: 0xe8f6ff, colorEnd: 0x7fc8ff, size: 3, sizeEnd: 0 },
  },

  world: {
    camera: { mode: 'follow', target: 'hero', distance: 12, pitch: 0.42, yaw: Math.PI, zoom: [5, 45] },
    controller: {
      sprite: 'hero', speed: 90, jump: 2,
      board: { vehicles: ['cutter', 'horse'], key: 'KeyF', range: 64 },
    },
    buildings: { longhouse, hall },
    ships: { cutter: { preset: 'cutter', turnRate: 1.2 }, sloop: { preset: 'sloop' } },

    areas: {
      frostholm: {
        label: 'Frostholm',
        terrain: {
          heightmap: { generate: 'archipelago', size: 128, seed: 11 },
          maxHeight: 14,
          textures: { low: 'rock', mid: 'snow', steep: 'rock', high: 'snow' },
          water: { height: 2.8, style: 'ocean', waves: 0.6 },
          fog: { near: 50, far: 170 },
        },
        sky: { time: 0.36, dayLength: 600 },
        light: { ambient: 0xaabef0, sun: 0xa8b8e8, fog: 0xc0d0ec }, // a cold winter light over the sky's day
        place: [
          { building: 'hall', where: 'flat' },
          { building: 'longhouse', count: 4, where: 'flat', near: 'hall', radius: 240, spacing: 70 },
        ],
        scatter: {
          pine: { count: 70, snow: 0.85, tint: 0x8fb0a0, scale: [0.9, 1.5] },
          boulder: { count: 14, snow: 0.8 },
          rock: { count: 30, snow: 0.6, tint: 0xb8c4d0 },
          crystal: [{ count: 22, tint: 0xbfeaff, scale: [0.9, 1.8] }, { count: 10, near: 'hall', radius: 160, tint: 0xbfeaff }],
          bush: { count: 25, snow: 1 },
        },
        spawns: {
          hero: { near: 'hall', radius: 120, with: { label: 'You', visualOffsetY: 1, walkFrames: 3, tint: cloak } },
          horse: { near: 'hero', radius: 120, spacing: 32, with: { label: 'Horse', scale: 1.35, visualOffsetY: 1, walkFrames: 3 } },
          cutter: { where: 'shore', near: 'hero', radius: 700, facing: 'out', with: { label: 'Boat' } },
          sloop: { where: 'sea' },
          coin: { count: 24, spacing: 64, with: { walkFrames: 0, bob: 4 } },
        },
      },
    },
  },
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Glyft(canvas, config);

await Promise.all([
  game.loadTexture('hero', './hero.png', { frameWidth: 32, frameHeight: 32 }),
  game.loadTexture('coin', './coin.png', { frameWidth: 16, frameHeight: 16 }),
  game.loadTexture('horse', './horse.png', { frameWidth: 32, frameHeight: 32 }),
]);

await game.start();
createHud(game, { coinsTotal: 24 });

(window as unknown as { game: Glyft }).game = game;
