/**
 * Glyft RPG Example — Addon-Based
 *
 * Demonstrates a complete config-driven mini-RPG using Glyft addons:
 * - Rooms: room transitions, spawn management, exit detection
 * - AI: enemy chase/wander behavior
 * - Projectiles: Space to shoot
 * - Death: enemy death rewards, player respawn
 * - Dialogue: NPC interaction with event callbacks
 *
 * All game logic is declarative config. The game loop is just player input.
 */

import { Glyft, type GlyftConfig, type Sprite, type TileMap } from '../../src';
import { clamp, distance } from '../../src/helpers';
import { projectiles, ai, death, rooms, dialogue, hud } from '../../addons';
import type { ProjectileAddon } from '../../addons/projectiles';
import type { DialogueAddon } from '../../addons/dialogue';
import type { RoomAddon } from '../../addons/rooms';

// =============================================================================
// Glyft Engine Config
// =============================================================================

const config: GlyftConfig = {
  settings: {
    tileSize: 16,
    viewport: [320, 240],
    spriteMode: '4dir',
    backgroundColor: 0x1a1a2e,
  },

  autoTags: {
    'slime': ['enemy', 'hostile'],
    'boss': ['enemy', 'hostile', 'boss'],
    'npc': ['npc', 'friendly'],
    'coin': ['item', 'collectible'],
    'key': ['item', 'collectible', 'key'],
    'heart': ['item', 'collectible', 'heal'],
    'projectile': ['projectile'],
  },

  stats: {
    hp: { default: 100, max: 100 },
    coins: { default: 0 },
    keys: { default: 0 },
    xp: { default: 0 },
  },

  sfx: {
    shoot:     { wave: 'sine',     freq: 900,        duration: 0.08, sweep: 450,  sweepTime: 0.06 },
    wall_hit:  { wave: 'sawtooth', freq: 120,        duration: 0.12, noise: 0.4,  filter: 'lowpass', filterFreq: 800 },
    enemy_hit: { wave: 'sawtooth', freq: 250,        duration: 0.15, sweep: 100,  noise: 0.2 },
    npc_talk:  { wave: 'sine',     freq: [600, 900], duration: 0.06 },
  },

  sounds: {
    '[player]:moving': { sound: '$step', interval: 0.2, volume: 0.3 },
    '[enemy]:moving': { sound: '$step', interval: 0.35, volume: 0.15, pitch: [0.7, 0.9] },
    '[player]:[enemy]': { sound: '$hurt', cooldown: 0.5, volume: 0.5 },
    '[player]:[boss]': { sound: '$hit', cooldown: 0.3, volume: 0.7 },
    '[player]:[collectible]': { sound: '$coin', volume: 0.6 },
    '[player]:[npc]': { sound: '$blip', cooldown: 0.5, volume: 0.4 },
  },

  collisions: {
    '[player]:[enemy]': { damage: 10, knockback: 80, flash: 0.2, cooldown: 0.5, floatText: { scale: 0.5 }, particles: 'hit_sparks' },
    '[player]:[boss]': { damage: 25, knockback: 120, flash: 0.3, cooldown: 0.8, floatText: { scale: 0.5 }, particles: 'boss_hit' },
    '[player]:[collectible]': { magnetize: { range: 48, speed: 80 }, collect: 'coins', destroy: true, particles: 'coin_sparkle' },
    '[player]:[key]': { magnetize: { range: 48, speed: 80 }, collect: 'keys', destroy: true, particles: 'coin_sparkle' },
    '[player]:[heal]': { magnetize: { range: 48, speed: 80 }, heal: 25, destroy: true, particles: 'heal_glow' },
    '[projectile]:[enemy]': 'projectileHit',
  },

  handlers: {
    projectileHit: (projectile: Sprite, enemy: Sprite, game) => {
      if (enemy.hp !== undefined) {
        enemy.hp -= 15;
        enemy.data._flashUntil = Date.now() + 100;
        enemy.data._flashColor = 0xff0000;
      }
      const cx = (projectile.x + enemy.x) / 2 + enemy.width / 2;
      const cy = (projectile.y + enemy.y) / 2 + enemy.height / 2;
      game.particles.emit('hit_sparks', cx, cy);
      game.floatText(cx, cy, '-15', { color: 0xff4444, style: 'rise', scale: 0.5 });
      game.sounds.play('enemy_hit', { volume: 0.4 });
      projectile.destroy();
    },
  },

  particles: {
    hit_sparks:   { count: 8,  speed: 60, speedVariance: 20, angle: -90, spread: 120, lifetime: 0.3, lifetimeVariance: 0.1, gravity: 100, color: 0xffcc44, colorEnd: 0xff4400, size: 3, sizeEnd: 1 },
    boss_hit:     { count: 16, speed: 80, speedVariance: 30, angle: -90, spread: 180, lifetime: 0.5, lifetimeVariance: 0.15, gravity: 60, color: 0xff44ff, colorEnd: 0x4400ff, size: 4, sizeEnd: 1 },
    death_burst:  { count: 20, speed: 40, speedVariance: 20, spread: 360, lifetime: 0.6, lifetimeVariance: 0.2, gravity: 20, color: 0xff6666, colorEnd: 0x440000, size: 4, sizeEnd: 0 },
    heal_glow:    { count: 12, speed: 20, speedVariance: 10, angle: -90, spread: 60, lifetime: 0.8, lifetimeVariance: 0.2, gravity: -30, color: 0x44ff66, colorEnd: 0x00ff88, size: 3, sizeEnd: 2 },
    coin_sparkle: { count: 6,  speed: 30, speedVariance: 15, spread: 360, lifetime: 0.4, lifetimeVariance: 0.1, color: 0xffdd44, colorEnd: 0xffff88, size: 2, sizeEnd: 0 },
  },

  music: {
    // Village — gentle C major, lilting rhythm (16 beats @ 58 bpm ≈ 16.5s loop)
    peaceful: {
      bpm: 58, wave: 'sine', volume: 0.8,
      notes: [
        // Phrase 1: rising arpeggio, hopeful
        ['C4', 1.5], ['E4', 0.5], ['G4', 1], ['A4', 1],
        ['G4', 1.5], ['E4', 0.5], ['D4', 1], ['E4', 1],
        // Phrase 2: stepwise descent, resolves home
        'F4', ['E4', 0.5], ['D4', 0.5], 'C4', 'E4',
        'D4', ['C4', 0.5], ['B3', 0.5], ['C4', 2],
      ],
      pad: { wave: 'sine', freq: 131, volume: 0.3 },
    },
    // Dark Forest — D minor, slow and ominous (16 beats @ 50 bpm ≈ 19s loop)
    dungeon: {
      bpm: 50, wave: 'triangle', volume: 0.8,
      notes: [
        // Phrase 1: long root drone, then chromatic neighbor
        ['D3', 3], 'F3',
        'A3', ['Bb3', 0.5], ['A3', 0.5], 'G3', 'F3',
        // Phrase 2: half-step tension, bass walk to root
        ['E3', 1.5], ['F3', 0.5], ['D3', 2],
        'A2', ['Bb2', 0.5], ['C3', 0.5], ['D3', 2],
      ],
      pad: { wave: 'triangle', freq: 73, volume: 0.4 },
    },
    // Ancient Dungeon — D minor, driving battle rhythm (16 beats @ 120 bpm ≈ 8s loop)
    battle: {
      bpm: 120, wave: 'square', volume: 0.7,
      notes: [
        // Phrase 1: staccato attack, rapid descent
        ['D4', 0.5], ['D4', 0.5], 'F4', ['A4', 0.5], ['A4', 0.5],
        ['G4', 0.5], ['F4', 0.5], ['E4', 0.5], ['D4', 0.5], 'A3',
        'D4', ['F4', 0.5], ['E4', 0.5],
        // Phrase 2: call and response, held resolution
        ['D4', 0.5], ['D4', 0.5], 'F4', 'A4', 'G4',
        ['F4', 0.5], ['E4', 0.5], ['D4', 0.5], ['C4', 0.5], ['D4', 2],
      ],
      pad: { wave: 'sawtooth', freq: 73, volume: 0.2 },
    },
  },
};

// =============================================================================
// Initialize
// =============================================================================

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Glyft(canvas, config);
const atlas = game.createTestAtlas('test', 16, 16);

// =============================================================================
// Room Connections — bidirectional exits defined once
// =============================================================================

const CONNECTIONS = [
  { rooms: ['village', 'forest'] as [string, string], exits: [[23, 9], [0, 9]] as [[number, number], [number, number]] },
  { rooms: ['forest', 'dungeon'] as [string, string], exits: [[31, 12], [0, 6]] as [[number, number], [number, number]] },
];

// Build exit lookup from connections for terrain generation
function getExitsForRoom(roomId: string): Array<{ x: number; y: number }> {
  const exits: Array<{ x: number; y: number }> = [];
  for (const conn of CONNECTIONS) {
    const idx = conn.rooms.indexOf(roomId);
    if (idx !== -1) {
      const [x, y] = conn.exits[idx];
      exits.push({ x, y });
    }
  }
  return exits;
}

// =============================================================================
// Terrain Generation (room build callbacks)
// =============================================================================

function isNearSpecialLocation(x: number, y: number, roomId: string, spawns: typeof ROOM_DATA[string]['spawns']): boolean {
  for (const exit of getExitsForRoom(roomId)) {
    if (distance(x, y, exit.x, exit.y) < 3) return true;
  }
  for (const s of spawns) {
    if (distance(x, y, s.x, s.y) < 3) return true;
  }
  return false;
}

function buildRoom(map: TileMap, roomId: string, roomData: typeof ROOM_DATA[string]) {
  const { width, height, spawns } = roomData;
  const exits = getExitsForRoom(roomId);

  // Floor
  const floorTile = roomId === 'dungeon' ? 5 : roomId === 'forest' ? 3 : 1;
  map.fill(0, 0, width, height, floorTile);

  // Walls around edges
  const wallTile = roomId === 'dungeon' ? 6 : 2;
  for (let x = 0; x < width; x++) {
    map.set(x, 0, wallTile); map.set(x, height - 1, wallTile);
    map.setCollision(x, 0, true); map.setCollision(x, height - 1, true);
  }
  for (let y = 0; y < height; y++) {
    map.set(0, y, wallTile); map.set(width - 1, y, wallTile);
    map.setCollision(0, y, true); map.setCollision(width - 1, y, true);
  }

  // Open exits
  for (const exit of exits) {
    map.set(exit.x, exit.y, floorTile);
    map.setCollision(exit.x, exit.y, false);
    map.set(clamp(exit.x - 1, 0, width - 1), exit.y, floorTile);
    map.set(clamp(exit.x + 1, 0, width - 1), exit.y, floorTile);
  }

  // Room-specific obstacles
  if (roomId === 'forest') {
    for (let i = 0; i < 15; i++) {
      const x = 2 + Math.floor(Math.random() * (width - 4));
      const y = 2 + Math.floor(Math.random() * (height - 4));
      if (!isNearSpecialLocation(x, y, roomId, spawns)) {
        map.set(x, y, 13);
        map.setCollision(x, y, true);
      }
    }
  } else if (roomId === 'dungeon') {
    for (let x = 4; x < width - 4; x += 4) {
      for (let y = 4; y < height - 4; y += 4) {
        if (!isNearSpecialLocation(x, y, roomId, spawns)) {
          map.set(x, y, 7);
          map.setCollision(x, y, true);
        }
      }
    }
  }
}

// =============================================================================
// Room Data — spawns, exits, terrain build
// =============================================================================

const ROOM_DATA = {
  village: {
    width: 24, height: 18,
    spawns: [
      // NPCs
      { type: 'player', x: 5, y: 5, tags: ['npc', 'friendly'], dialogue: 'elder',
        configure: (s: Sprite) => {
          s.tint = 0x66ff66; s.label = 'Elder'; s.labelColor = 0x66ff66;
          s.labelIcon = '!'; s.labelIconColor = 0xffff00;
        } },
      { type: 'player', x: 12, y: 8, tags: ['npc', 'friendly'], dialogue: 'merchant',
        configure: (s: Sprite) => {
          s.tint = 0x66ff66; s.label = 'Merchant'; s.labelColor = 0x66ff66;
        } },
      // Items
      { type: 'player', x: 8, y: 10, tags: ['item', 'collectible'],
        configure: (s: Sprite) => {
          s.tint = 0xffcc00; s.scale = 0.5; s.bob = 3; s.bobSpeed = 0.8; s.shadow = true;
          s.label = 'Coin'; s.labelColor = 0xffcc00; s.labelVisible = 'proximity'; s.labelRange = 60;
        } },
      { type: 'player', x: 9, y: 10, tags: ['item', 'collectible'],
        configure: (s: Sprite) => {
          s.tint = 0xffcc00; s.scale = 0.5; s.bob = 3; s.bobSpeed = 0.8; s.shadow = true;
          s.label = 'Coin'; s.labelColor = 0xffcc00; s.labelVisible = 'proximity'; s.labelRange = 60;
        } },
    ],
  },
  forest: {
    width: 32, height: 24,
    spawns: [
      // Enemies
      { type: 'player', x: 10, y: 10, tags: ['enemy', 'hostile'], ai: 'chaser',
        configure: (s: Sprite) => {
          s.tint = 0xff6666; s.hp = 30; s.label = 'Slime'; s.labelColor = 0xff6666;
          s.hpBarWidth = 30; s.hpBarVisible = true;
        } },
      { type: 'player', x: 15, y: 8, tags: ['enemy', 'hostile'], ai: 'chaser',
        configure: (s: Sprite) => {
          s.tint = 0xff6666; s.hp = 30; s.label = 'Slime'; s.labelColor = 0xff6666;
          s.hpBarWidth = 30; s.hpBarVisible = true;
        } },
      { type: 'player', x: 20, y: 15, tags: ['enemy', 'hostile'], ai: 'chaser',
        configure: (s: Sprite) => {
          s.tint = 0xff6666; s.hp = 30; s.label = 'Slime'; s.labelColor = 0xff6666;
          s.hpBarWidth = 30; s.hpBarVisible = true;
        } },
      // Items
      { type: 'player', x: 25, y: 12, tags: ['item', 'collectible'],
        configure: (s: Sprite) => {
          s.tint = 0xffcc00; s.scale = 0.5; s.bob = 3; s.bobSpeed = 0.8; s.shadow = true;
          s.label = 'Coin'; s.labelColor = 0xffcc00; s.labelVisible = 'proximity'; s.labelRange = 60;
        } },
      { type: 'player', x: 28, y: 5, tags: ['item', 'collectible', 'key'],
        configure: (s: Sprite) => {
          s.tint = 0x00ccff; s.scale = 0.5; s.bob = 3; s.bobSpeed = 0.8; s.shadow = true;
          s.label = 'Key'; s.labelColor = 0x00ccff; s.labelVisible = 'proximity'; s.labelRange = 60;
        } },
    ],
  },
  dungeon: {
    width: 20, height: 16,
    spawns: [
      // Enemies
      { type: 'player', x: 8, y: 6, tags: ['enemy', 'hostile'], ai: 'chaser',
        configure: (s: Sprite) => {
          s.tint = 0xff6666; s.hp = 30; s.label = 'Slime'; s.labelColor = 0xff6666;
          s.hpBarWidth = 30; s.hpBarVisible = true;
        } },
      { type: 'player', x: 12, y: 10, tags: ['enemy', 'hostile'], ai: 'chaser',
        configure: (s: Sprite) => {
          s.tint = 0xff6666; s.hp = 30; s.label = 'Slime'; s.labelColor = 0xff6666;
          s.hpBarWidth = 30; s.hpBarVisible = true;
        } },
      { type: 'player', x: 16, y: 8, tags: ['enemy', 'hostile', 'boss'], ai: 'boss_chase',
        configure: (s: Sprite) => {
          s.tint = 0xff00ff; s.scale = 1.5; s.hp = 100; s.label = 'Boss'; s.labelColor = 0xff00ff;
          s.hpBarWidth = 50; s.hpBarVisible = true;
        } },
      // Items
      { type: 'player', x: 5, y: 12, tags: ['item', 'collectible', 'heal'],
        configure: (s: Sprite) => {
          s.tint = 0xff6699; s.scale = 0.5; s.bob = 3; s.bobSpeed = 0.8; s.shadow = true;
          s.label = 'Heart'; s.labelColor = 0xff6699; s.labelVisible = 'proximity'; s.labelRange = 60;
        } },
      { type: 'player', x: 18, y: 14, tags: ['item', 'collectible'],
        configure: (s: Sprite) => {
          s.tint = 0xffcc00; s.scale = 0.5; s.bob = 3; s.bobSpeed = 0.8; s.shadow = true;
          s.label = 'Coin'; s.labelColor = 0xffcc00; s.labelVisible = 'proximity'; s.labelRange = 60;
        } },
      { type: 'player', x: 17, y: 14, tags: ['item', 'collectible'],
        configure: (s: Sprite) => {
          s.tint = 0xffcc00; s.scale = 0.5; s.bob = 3; s.bobSpeed = 0.8; s.shadow = true;
          s.label = 'Coin'; s.labelColor = 0xffcc00; s.labelVisible = 'proximity'; s.labelRange = 60;
        } },
      { type: 'player', x: 16, y: 14, tags: ['item', 'collectible'],
        configure: (s: Sprite) => {
          s.tint = 0xffcc00; s.scale = 0.5; s.bob = 3; s.bobSpeed = 0.8; s.shadow = true;
          s.label = 'Coin'; s.labelColor = 0xffcc00; s.labelVisible = 'proximity'; s.labelRange = 60;
        } },
    ],
  },
};

// =============================================================================
// Register Addons
// =============================================================================

// Projectiles — Space to shoot cyan bolts
game.use(projectiles({
  types: {
    player_bolt: { speed: 200, cooldown: 0.3, lifetime: 1.0, tint: 0x44ccff, scale: 0.4, fireSound: 'shoot', wallSound: 'wall_hit' },
  },
}));

// AI — enemies chase player, boss moves slower
game.use(ai({
  behaviors: {
    chaser: { type: 'chase', speed: 30, range: 150, target: 'player', damping: 0.1, mapCollision: true },
    boss_chase: { type: 'chase', speed: 21, range: 150, target: 'player', damping: 0.1, mapCollision: true },
  },
}));

// Death — enemy rewards + player respawn
game.use(death({
  rules: {
    enemy: {
      particles: 'death_burst',
      floatText: '+10 XP',
      floatTextColor: 0xaa88ff,
      xpReward: 10,
      coinReward: 2,
    },
    boss: {
      particles: 'death_burst',
      floatText: '+50 XP',
      floatTextColor: 0xaa88ff,
      xpReward: 50,
      coinReward: 10,
    },
  },
  playerRespawn: {
    hp: 100,
    resetStats: ['coins', 'keys'],
    particles: 'death_burst',
    floatText: 'YOU DIED',
    floatTextColor: 0xff0000,
    floatTextStyle: 'pop',
    onDeath: () => {
      game.addon<RoomAddon>('rooms')?.load('village');
    },
  },
}));

// Rooms — three connected areas with terrain generation
game.use(rooms({
  atlas,
  startRoom: 'village',
  rooms: {
    village: {
      name: 'Village',
      width: 24,
      height: 18,
      music: 'peaceful',
      spawn: [12, 9],
      build: (map) => buildRoom(map, 'village', ROOM_DATA.village),
      spawns: ROOM_DATA.village.spawns,
      onEnter: () => console.log('Entered: Village'),
    },
    forest: {
      name: 'Dark Forest',
      width: 32,
      height: 24,
      music: 'dungeon',
      build: (map) => buildRoom(map, 'forest', ROOM_DATA.forest),
      spawns: ROOM_DATA.forest.spawns,
      onEnter: () => console.log('Entered: Dark Forest'),
    },
    dungeon: {
      name: 'Ancient Dungeon',
      width: 20,
      height: 16,
      music: 'battle',
      build: (map) => buildRoom(map, 'dungeon', ROOM_DATA.dungeon),
      spawns: ROOM_DATA.dungeon.spawns,
      onEnter: () => console.log('Entered: Ancient Dungeon'),
    },
  },
  connections: CONNECTIONS,
}));

// Dialogue — NPC conversations with DOM callbacks
game.use(dialogue({
  dialogues: {
    elder: {
      lines: [
        'Welcome, traveler.',
        'The forest to the east has become dangerous.',
        'Beware the slimes that lurk there.',
        'If you can defeat the dungeon boss, peace will return.',
      ],
      speaker: 'Elder',
    },
    merchant: {
      lines: [
        'Looking for supplies?',
        'I\'m all sold out, sorry!',
        'Try the chests in the dungeon.',
      ],
      speaker: 'Merchant',
    },
  },
  advanceKey: 'Space',
  proximityRange: 24,
  onLine: () => {
    game.sounds.play('npc_talk', { volume: 0.3 });
  },
}));

game.use(hud({
  panels: [
    {
      position: 'top-left',
      level: {
        stat: 'xp',
        thresholds: [0, 50, 120, 200, 300, 500, 800],
        barColor: 0x44aaff,
        barWidth: 50,
      },
      stats: [
        { stat: 'hp', label: '\u2665', color: 0xff4444, max: 100 },
      ],
    },
    {
      position: 'top-right',
      stats: [
        { stat: 'coins', label: '\u25cf', color: 0xffdd44 },
        { stat: 'keys', label: '\u25c6', color: 0x44ddff },
      ],
    },
  ],
  announcement: { hold: 2.0 },
  dialogue: {},
}));

// =============================================================================
// Create Player
// =============================================================================

const player = game.createSprite(atlas, 'player');
player.tags = ['player'];
player.label = 'Hero';
player.labelColor = 0xffffff;
player.hpBarVisible = true;
player.hpBarWidth = 40;

// Register player with addons
game.addon<RoomAddon>('rooms')!.setPlayer(player);
game.addon<DialogueAddon>('dialogue')!.setPlayer(player);

const deathAddon = game.addon('death');
if (deathAddon && 'trackPlayer' in deathAddon) {
  (deathAddon as { trackPlayer: (s: Sprite) => void }).trackPlayer(player);
}

// =============================================================================
// Game Loop — just player input + UI
// =============================================================================

const PLAYER_SPEED = 100;

game.onUpdate((dt) => {
  const dlg = game.addon<DialogueAddon>('dialogue')!;
  const proj = game.addon<ProjectileAddon>('projectiles')!;

  // Freeze during dialogue
  if (dlg.active) {
    player.vx = 0;
    player.vy = 0;
    return;
  }

  // Player input
  let vx = 0;
  let vy = 0;
  if (game.input.isDown('ArrowLeft') || game.input.isDown('KeyA')) vx -= 1;
  if (game.input.isDown('ArrowRight') || game.input.isDown('KeyD')) vx += 1;
  if (game.input.isDown('ArrowUp') || game.input.isDown('KeyW')) vy -= 1;
  if (game.input.isDown('ArrowDown') || game.input.isDown('KeyS')) vy += 1;

  if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

  player.vx = vx * PLAYER_SPEED;
  player.vy = vy * PLAYER_SPEED;

  // Move with tilemap collision
  const nx = player.x + player.vx * dt;
  const ny = player.y + player.vy * dt;
  if (!game.spriteCollidesWithMap(player, nx, player.y)) player.x = nx;
  if (!game.spriteCollidesWithMap(player, player.x, ny)) player.y = ny;

  // Fire projectile on Space (dialogue addon handles Space for dialogue)
  if (game.input.justPressed('Space') && !dlg.active) {
    proj.fire('player_bolt', player, atlas);
  }

  // Update player HP bar
  const hp = player.hp ?? 100;
  player.hpBarValue = hp / 100;
});

// =============================================================================
// Input — Music toggle + debug room change
// =============================================================================

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    const current = game.music.getCurrent();
    if (current) {
      game.music.stop({ fade: 0.3 });
    } else {
      const roomSys = game.addon<RoomAddon>('rooms')!;
      const def = roomSys.currentDef;
      if (def?.music) game.music.play(def.music, { fade: 0.3 });
    }
  }

  // Debug: Quick room change
  const roomSys = game.addon<RoomAddon>('rooms')!;
  if (e.code === 'Digit1') roomSys.load('village');
  if (e.code === 'Digit2') roomSys.load('forest');
  if (e.code === 'Digit3') roomSys.load('dungeon');
});

// =============================================================================
// Start
// =============================================================================

game.start();
console.log('RPG Example running!');
console.log('WASD/Arrows: Move | Space: Interact/Shoot | M: Toggle Music | 1-3: Change Room');
