/**
 * Glyft RPG Example
 *
 * Demonstrates a complete config-driven mini-RPG with:
 * - Multiple rooms with transitions
 * - NPCs with dialogue
 * - Combat with enemies
 * - Stats (HP, coins, keys)
 * - Reactive sounds and music
 * - All features from config, minimal code
 */

import { Glyft, type GlyftConfig, type Sprite } from '../../src';
import { lerp, clamp, distance } from '../../src/helpers';

// =============================================================================
// Game Data (Config-Driven)
// =============================================================================

/**
 * Room definitions - each room is a separate tilemap configuration.
 * In a real game, these would be loaded from JSON files.
 */
const ROOMS = {
  village: {
    name: 'Village',
    width: 24,
    height: 18,
    music: 'peaceful',
    npcs: [
      { type: 'npc', x: 5, y: 5, dialogue: 'elder', quest: true },
      { type: 'npc', x: 12, y: 8, dialogue: 'merchant', quest: false },
    ],
    enemies: [],
    items: [
      { type: 'coin', x: 8, y: 10 },
      { type: 'coin', x: 9, y: 10 },
    ],
    exits: [
      { x: 23, y: 9, to: 'forest', spawnX: 1, spawnY: 9 },
    ],
  },
  forest: {
    name: 'Dark Forest',
    width: 32,
    height: 24,
    music: 'dungeon',
    npcs: [],
    enemies: [
      { type: 'slime', x: 10, y: 10 },
      { type: 'slime', x: 15, y: 8 },
      { type: 'slime', x: 20, y: 15 },
    ],
    items: [
      { type: 'coin', x: 25, y: 12 },
      { type: 'key', x: 28, y: 5 },
    ],
    exits: [
      { x: 0, y: 9, to: 'village', spawnX: 22, spawnY: 9 },
      { x: 31, y: 12, to: 'dungeon', spawnX: 1, spawnY: 6 },
    ],
  },
  dungeon: {
    name: 'Ancient Dungeon',
    width: 20,
    height: 16,
    music: 'battle',
    npcs: [],
    enemies: [
      { type: 'slime', x: 8, y: 6 },
      { type: 'slime', x: 12, y: 10 },
      { type: 'boss', x: 16, y: 8 },
    ],
    items: [
      { type: 'heart', x: 5, y: 12 },
      { type: 'coin', x: 18, y: 14 },
      { type: 'coin', x: 17, y: 14 },
      { type: 'coin', x: 16, y: 14 },
    ],
    exits: [
      { x: 0, y: 6, to: 'forest', spawnX: 30, spawnY: 12 },
    ],
  },
};

/**
 * NPC dialogue lines - keyed by dialogue ID.
 */
const DIALOGUE: Record<string, string[]> = {
  elder: [
    'Welcome, traveler.',
    'The forest to the east has become dangerous.',
    'Beware the slimes that lurk there.',
    'If you can defeat the dungeon boss, peace will return.',
  ],
  merchant: [
    'Looking for supplies?',
    'I\'m all sold out, sorry!',
    'Try the chests in the dungeon.',
  ],
};

// =============================================================================
// Glyft Configuration
// =============================================================================

const config: GlyftConfig = {
  settings: {
    tileSize: 16,
    viewport: [320, 240],
    spriteMode: '4dir',
    backgroundColor: 0x1a1a2e,
  },

  // Auto-tag sprites based on type prefix
  autoTags: {
    'slime': ['enemy', 'hostile'],
    'boss': ['enemy', 'hostile', 'boss'],
    'npc': ['npc', 'friendly'],
    'coin': ['item', 'collectible'],
    'key': ['item', 'collectible', 'key'],
    'heart': ['item', 'collectible', 'heal'],
    'projectile': ['projectile'],
  },

  // Player stats
  stats: {
    hp: { default: 100, max: 100 },
    coins: { default: 0 },
    keys: { default: 0 },
    xp: { default: 0 },
  },

  // Reactive sounds
  sounds: {
    // Movement
    '[player]:moving': { sound: '$step', interval: 0.2, volume: 0.3 },
    '[enemy]:moving': { sound: '$step', interval: 0.35, volume: 0.15, pitch: [0.7, 0.9] },

    // Combat
    '[player]:[enemy]': { sound: '$hurt', cooldown: 0.5, volume: 0.5 },
    '[player]:[boss]': { sound: '$hit', cooldown: 0.3, volume: 0.7 },

    // Collection
    '[player]:[collectible]': { sound: '$coin', volume: 0.6 },

    // NPC interaction
    '[player]:[npc]': { sound: '$blip', cooldown: 0.5, volume: 0.4 },
  },

  // Collision rules
  collisions: {
    // Combat - player takes damage from enemies
    '[player]:[enemy]': { damage: 10, knockback: 80, flash: 0.2, cooldown: 0.5, floatText: { scale: 0.5 }, particles: 'hit_sparks' },
    '[player]:[boss]': { damage: 25, knockback: 120, flash: 0.3, cooldown: 0.8, floatText: { scale: 0.5 }, particles: 'boss_hit' },

    // Collection - items magnetize toward player then collect on touch
    '[player]:[collectible]': { magnetize: { range: 48, speed: 80 }, collect: 'coins', destroy: true, particles: 'coin_sparkle' },
    '[player]:[key]': { magnetize: { range: 48, speed: 80 }, collect: 'keys', destroy: true, particles: 'coin_sparkle' },
    '[player]:[heal]': { magnetize: { range: 48, speed: 80 }, heal: 25, destroy: true, particles: 'heal_glow' },

    // Projectile hits enemy
    '[projectile]:[enemy]': 'projectileHit',

    // NPC interaction handled via custom handler
    '[player]:[npc]': 'interactNPC',
  },

  // Custom handlers
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
      projectile.destroy();
    },

    interactNPC: (_player: Sprite, npc: Sprite) => {
      // This just marks which NPC we're near
      // Actual dialogue is triggered by Space key
      (window as unknown as { nearbyNPC: Sprite | null }).nearbyNPC = npc;
    },
  },

  // Particle effects
  particles: {
    hit_sparks:   { count: 8,  speed: 60, speedVariance: 20, angle: -90, spread: 120, lifetime: 0.3, lifetimeVariance: 0.1, gravity: 100, color: 0xffcc44, colorEnd: 0xff4400, size: 3, sizeEnd: 1 },
    boss_hit:     { count: 16, speed: 80, speedVariance: 30, angle: -90, spread: 180, lifetime: 0.5, lifetimeVariance: 0.15, gravity: 60, color: 0xff44ff, colorEnd: 0x4400ff, size: 4, sizeEnd: 1 },
    death_burst:  { count: 20, speed: 40, speedVariance: 20, spread: 360, lifetime: 0.6, lifetimeVariance: 0.2, gravity: 20, color: 0xff6666, colorEnd: 0x440000, size: 4, sizeEnd: 0 },
    heal_glow:    { count: 12, speed: 20, speedVariance: 10, angle: -90, spread: 60, lifetime: 0.8, lifetimeVariance: 0.2, gravity: -30, color: 0x44ff66, colorEnd: 0x00ff88, size: 3, sizeEnd: 2 },
    coin_sparkle: { count: 6,  speed: 30, speedVariance: 15, spread: 360, lifetime: 0.4, lifetimeVariance: 0.1, color: 0xffdd44, colorEnd: 0xffff88, size: 2, sizeEnd: 0 },
  },

  // Music tracks (procedural for this example)
  music: {
    peaceful: { track: '$peaceful', loop: true, volume: 0.8 },
    dungeon: { track: '$dungeon', loop: true, volume: 0.8 },
    battle: { track: '$battle', loop: true, volume: 0.9 },
  },
};

// =============================================================================
// Game State
// =============================================================================

interface GameState {
  currentRoom: keyof typeof ROOMS;
  player: Sprite | null;
  enemies: Sprite[];
  npcs: Sprite[];
  items: Sprite[];
  nearbyNPC: Sprite | null;
  dialogueActive: boolean;
  dialogueLines: string[];
  dialogueIndex: number;
  dialogueSpeaker: string;
  exitCooldown: number; // Prevents immediate re-exit after room transition
  projectiles: { sprite: Sprite; birth: number }[];
  lastShotTime: number;
}

const state: GameState = {
  currentRoom: 'village',
  player: null,
  enemies: [],
  npcs: [],
  items: [],
  nearbyNPC: null,
  dialogueActive: false,
  dialogueLines: [],
  dialogueIndex: 0,
  dialogueSpeaker: '',
  exitCooldown: 0,
  projectiles: [],
  lastShotTime: 0,
};

// Make state accessible for collision handler
(window as unknown as { nearbyNPC: Sprite | null }).nearbyNPC = null;

// =============================================================================
// Initialize Game
// =============================================================================

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Glyft(canvas, config);

// Create test atlas
const atlas = game.createTestAtlas('test', 16, 16);

// UI elements
const statsEl = document.getElementById('stats')!;
const dialogueEl = document.getElementById('dialogue')!;
const speakerEl = document.getElementById('speaker')!;
const textEl = document.getElementById('dialogueText')!;

// =============================================================================
// Room Management
// =============================================================================

let currentMap: ReturnType<typeof game.createMap>;

function loadRoom(roomId: keyof typeof ROOMS, spawnX?: number, spawnY?: number) {
  const room = ROOMS[roomId];
  state.currentRoom = roomId;

  // Clear existing sprites
  for (const enemy of state.enemies) enemy.destroy();
  for (const npc of state.npcs) npc.destroy();
  for (const item of state.items) item.destroy();
  for (const p of state.projectiles) p.sprite.destroy();
  state.enemies = [];
  state.npcs = [];
  state.items = [];
  state.projectiles = [];

  // Destroy old map if exists
  if (currentMap) {
    currentMap.destroy();
  }

  // Create new map
  currentMap = game.createMap(atlas, room.width, room.height);

  // Generate procedural terrain
  generateTerrain(room.width, room.height, roomId);

  // Spawn NPCs
  for (const npcData of room.npcs) {
    const npc = game.createSprite(atlas, 'player');
    npc.x = npcData.x * 16;
    npc.y = npcData.y * 16;
    npc.tint = 0x66ff66; // Green for NPCs
    npc.tags = ['npc', 'friendly'];
    npc.data.dialogue = npcData.dialogue;
    const npcName = (npcData.dialogue as string).charAt(0).toUpperCase() + (npcData.dialogue as string).slice(1);
    npc.label = npcName;
    npc.labelColor = 0x66ff66;

    // Quest indicator icon above label
    if (npcData.quest) {
      npc.labelIcon = '!';
      npc.labelIconColor = 0xffff00;
    }

    state.npcs.push(npc);
  }

  // Spawn enemies
  for (const enemyData of room.enemies) {
    const enemy = game.createSprite(atlas, 'player');
    enemy.x = enemyData.x * 16;
    enemy.y = enemyData.y * 16;

    if (enemyData.type === 'boss') {
      enemy.tint = 0xff00ff; // Magenta for boss
      enemy.scale = 1.5;
      enemy.hp = 100;
      enemy.tags = ['enemy', 'hostile', 'boss'];
      enemy.label = 'Boss';
      enemy.labelColor = 0xff00ff;
      enemy.hpBarWidth = 50;
    } else {
      enemy.tint = 0xff6666; // Red for regular enemies
      enemy.hp = 30;
      enemy.tags = ['enemy', 'hostile'];
      enemy.label = 'Slime';
      enemy.labelColor = 0xff6666;
      enemy.hpBarWidth = 30;
    }

    enemy.data.maxHp = enemy.hp;
    enemy.hpBarVisible = true;

    state.enemies.push(enemy);
  }

  // Spawn items
  for (const itemData of room.items) {
    const item = game.createSprite(atlas, 'player');
    item.x = itemData.x * 16;
    item.y = itemData.y * 16;
    item.scale = 0.5;

    item.bob = 3;
    item.bobSpeed = 0.8;
    item.shadow = true;

    switch (itemData.type) {
      case 'coin':
        item.tint = 0xffcc00;
        item.tags = ['item', 'collectible'];
        item.label = 'Coin';
        item.labelColor = 0xffcc00;
        break;
      case 'key':
        item.tint = 0x00ccff;
        item.tags = ['item', 'collectible', 'key'];
        item.label = 'Key';
        item.labelColor = 0x00ccff;
        break;
      case 'heart':
        item.tint = 0xff6699;
        item.tags = ['item', 'collectible', 'heal'];
        item.label = 'Heart';
        item.labelColor = 0xff6699;
        break;
    }

    item.labelVisible = 'proximity';
    item.labelRange = 60;

    state.items.push(item);
  }

  // Position player
  if (!state.player) {
    state.player = game.createSprite(atlas, 'player');
    state.player.tags = ['player'];
    state.player.label = 'Hero';
    state.player.labelColor = 0xffffff;
    state.player.hpBarVisible = true;
    state.player.hpBarWidth = 40;
  }

  state.player.x = (spawnX ?? Math.floor(room.width / 2)) * 16;
  state.player.y = (spawnY ?? Math.floor(room.height / 2)) * 16;

  // Setup camera
  game.camera.follow(state.player, { smoothing: 0.1 });
  game.camera.setBounds(0, 0, currentMap.widthPx, currentMap.heightPx);

  // Change music
  game.music.play(room.music, { fade: 1 });

  console.log(`Entered: ${room.name}`);
}

function generateTerrain(width: number, height: number, roomId: string) {
  // Floor
  const floorTile = roomId === 'dungeon' ? 5 : roomId === 'forest' ? 3 : 1;
  currentMap.fill(0, 0, width, height, floorTile);

  // Walls around edges
  const wallTile = roomId === 'dungeon' ? 6 : 2;
  for (let x = 0; x < width; x++) {
    currentMap.set(x, 0, wallTile);
    currentMap.set(x, height - 1, wallTile);
    currentMap.setCollision(x, 0, true);
    currentMap.setCollision(x, height - 1, true);
  }
  for (let y = 0; y < height; y++) {
    currentMap.set(0, y, wallTile);
    currentMap.set(width - 1, y, wallTile);
    currentMap.setCollision(0, y, true);
    currentMap.setCollision(width - 1, y, true);
  }

  // Room-specific features
  const room = ROOMS[roomId as keyof typeof ROOMS];

  // Open exits
  for (const exit of room.exits) {
    currentMap.set(exit.x, exit.y, floorTile);
    currentMap.setCollision(exit.x, exit.y, false);
    // Mark adjacent tiles as exit area
    currentMap.set(clamp(exit.x - 1, 0, width - 1), exit.y, floorTile);
    currentMap.set(clamp(exit.x + 1, 0, width - 1), exit.y, floorTile);
  }

  // Add some random obstacles based on room type
  if (roomId === 'forest') {
    // Trees
    for (let i = 0; i < 15; i++) {
      const x = 2 + Math.floor(Math.random() * (width - 4));
      const y = 2 + Math.floor(Math.random() * (height - 4));
      if (!isNearSpecialLocation(x, y, roomId)) {
        currentMap.set(x, y, 13); // Tree tile (brown)
        currentMap.setCollision(x, y, true);
      }
    }
  } else if (roomId === 'dungeon') {
    // Pillars
    for (let x = 4; x < width - 4; x += 4) {
      for (let y = 4; y < height - 4; y += 4) {
        if (!isNearSpecialLocation(x, y, roomId)) {
          currentMap.set(x, y, 7); // Pillar tile
          currentMap.setCollision(x, y, true);
        }
      }
    }
  }
}

function isNearSpecialLocation(x: number, y: number, roomId: string): boolean {
  const room = ROOMS[roomId as keyof typeof ROOMS];

  // Check distance from exits
  for (const exit of room.exits) {
    if (distance(x, y, exit.x, exit.y) < 3) return true;
  }

  // Check distance from NPCs
  for (const npc of room.npcs) {
    if (distance(x, y, npc.x, npc.y) < 3) return true;
  }

  // Check distance from enemies
  for (const enemy of room.enemies) {
    if (distance(x, y, enemy.x, enemy.y) < 3) return true;
  }

  // Check distance from items
  for (const item of room.items) {
    if (distance(x, y, item.x, item.y) < 2) return true;
  }

  return false;
}

function checkExits(dt: number) {
  if (!state.player) return;

  // Cooldown after room transition to prevent immediate re-exit
  if (state.exitCooldown > 0) {
    state.exitCooldown -= dt;
    return;
  }

  const room = ROOMS[state.currentRoom];
  const playerTileX = Math.floor(state.player.x / 16);
  const playerTileY = Math.floor(state.player.y / 16);

  for (const exit of room.exits) {
    if (Math.abs(playerTileX - exit.x) < 2 && Math.abs(playerTileY - exit.y) < 2) {
      state.exitCooldown = 0.5; // Half second cooldown
      loadRoom(exit.to as keyof typeof ROOMS, exit.spawnX, exit.spawnY);
      return;
    }
  }
}

// =============================================================================
// Dialogue System
// =============================================================================

function startDialogue(npc: Sprite) {
  const dialogueId = npc.data.dialogue as string;
  const lines = DIALOGUE[dialogueId];

  if (!lines) return;

  state.dialogueActive = true;
  state.dialogueLines = lines;
  state.dialogueIndex = 0;
  state.dialogueSpeaker = dialogueId.charAt(0).toUpperCase() + dialogueId.slice(1);

  showDialogueLine();
}

function showDialogueLine() {
  speakerEl.textContent = state.dialogueSpeaker;
  textEl.textContent = state.dialogueLines[state.dialogueIndex];
  dialogueEl.classList.add('visible');
}

function advanceDialogue() {
  state.dialogueIndex++;

  if (state.dialogueIndex >= state.dialogueLines.length) {
    // End dialogue
    state.dialogueActive = false;
    dialogueEl.classList.remove('visible');

    // Change quest indicator from ! to ? after talking
    if (state.nearbyNPC?.labelIcon === '!') {
      state.nearbyNPC.labelIcon = '?';
      state.nearbyNPC.labelIconColor = 0x888888;
    }
  } else {
    showDialogueLine();
  }
}

// =============================================================================
// Projectile System
// =============================================================================

function fireProjectile() {
  if (!state.player) return;

  const now = performance.now() / 1000;
  if (now - state.lastShotTime < PROJECTILE_COOLDOWN) return;
  state.lastShotTime = now;

  const facing = state.player.facing;
  const dirMap: Record<string, [number, number]> = {
    down: [0, 1], right: [1, 0], up: [0, -1], left: [-1, 0],
  };
  const [dx, dy] = dirMap[facing];

  const proj = game.createSprite(atlas, 'projectile');
  proj.x = state.player.x;
  proj.y = state.player.y;
  proj.vx = dx * PROJECTILE_SPEED;
  proj.vy = dy * PROJECTILE_SPEED;
  proj.tags = ['projectile'];
  proj.tint = 0x44ccff;
  proj.scale = 0.4;

  state.projectiles.push({ sprite: proj, birth: now });
}

// =============================================================================
// Game Loop
// =============================================================================

const PLAYER_SPEED = 100;
const ENEMY_SPEED = 30;
const PROJECTILE_SPEED = 200;
const PROJECTILE_COOLDOWN = 0.3;
const PROJECTILE_LIFETIME = 1.0;

game.onUpdate((dt) => {
  if (!state.player) return;

  // Don't process movement during dialogue
  if (state.dialogueActive) {
    state.player.vx = 0;
    state.player.vy = 0;
    return;
  }

  // Player input
  let vx = 0;
  let vy = 0;

  if (game.input.isDown('ArrowLeft') || game.input.isDown('KeyA')) vx -= 1;
  if (game.input.isDown('ArrowRight') || game.input.isDown('KeyD')) vx += 1;
  if (game.input.isDown('ArrowUp') || game.input.isDown('KeyW')) vy -= 1;
  if (game.input.isDown('ArrowDown') || game.input.isDown('KeyS')) vy += 1;

  // Normalize diagonal movement
  if (vx !== 0 && vy !== 0) {
    vx *= 0.707;
    vy *= 0.707;
  }

  state.player.vx = vx * PLAYER_SPEED;
  state.player.vy = vy * PLAYER_SPEED;

  // Move with collision (uses sprite's frame size automatically)
  const nx = state.player.x + state.player.vx * dt;
  const ny = state.player.y + state.player.vy * dt;

  if (!game.spriteCollidesWithMap(state.player, nx, state.player.y)) {
    state.player.x = nx;
  }
  if (!game.spriteCollidesWithMap(state.player, state.player.x, ny)) {
    state.player.y = ny;
  }

  // Check for room transitions
  checkExits(dt);

  // Check for nearby NPC
  state.nearbyNPC = null;
  for (const npc of state.npcs) {
    if (distance(state.player.x, state.player.y, npc.x, npc.y) < 24) {
      state.nearbyNPC = npc;
      break;
    }
  }

  // Update enemies (simple chase AI)
  for (const enemy of state.enemies) {
    if (!enemy.exists) continue;

    const dx = state.player.x - enemy.x;
    const dy = state.player.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 150) {
      const speed = enemy.tags.includes('boss') ? ENEMY_SPEED * 0.7 : ENEMY_SPEED;
      enemy.vx = (dx / dist) * speed;
      enemy.vy = (dy / dist) * speed;

      const ex = enemy.x + enemy.vx * dt;
      const ey = enemy.y + enemy.vy * dt;

      if (!game.spriteCollidesWithMap(enemy, ex, enemy.y)) {
        enemy.x = ex;
      }
      if (!game.spriteCollidesWithMap(enemy, enemy.x, ey)) {
        enemy.y = ey;
      }
    } else {
      // Wander randomly when not chasing
      if (Math.random() < 0.02) {
        enemy.vx = (Math.random() - 0.5) * ENEMY_SPEED;
        enemy.vy = (Math.random() - 0.5) * ENEMY_SPEED;
      }

      // Apply damping
      enemy.vx = lerp(enemy.vx, 0, 0.1);
      enemy.vy = lerp(enemy.vy, 0, 0.1);
    }

    // Update enemy HP bar
    if (enemy.hp !== undefined && enemy.data.maxHp) {
      enemy.hpBarValue = Math.max(0, enemy.hp / (enemy.data.maxHp as number));
    }

    // Check if enemy died
    if (enemy.hp !== undefined && enemy.hp <= 0) {
      const isBoss = enemy.tags.includes('boss');
      const xp = isBoss ? 50 : 10;
      const cx = enemy.x + enemy.width / 2;
      game.floatText(cx, enemy.y, `+${xp} XP`, { color: 0xaa88ff, style: 'rise', duration: 1.2, scale: 0.5 });
      game.particles.emit('death_burst', cx, enemy.y);
      enemy.destroy();
      game.stats.coins += isBoss ? 10 : 2;
      game.stats.xp += xp;
    }
  }

  // Float text for collected items
  for (const item of state.items) {
    if (!item.exists) {
      const cx = item.x + item.width / 2;
      if (item.tags.includes('key')) {
        game.floatText(cx, item.y, '+1 Key', { color: 0x00ccff, style: 'rise', scale: 0.5 });
      } else if (item.tags.includes('heal')) {
        game.floatText(cx, item.y, '+25 HP', { color: 0xff6699, style: 'pop', scale: 0.5 });
      } else {
        game.floatText(cx, item.y, '+1G', { color: 0xffcc00, style: 'rise', scale: 0.5 });
      }
    }
  }

  // Update projectiles — wall collision + lifetime
  const now = performance.now() / 1000;
  for (const p of state.projectiles) {
    if (!p.sprite.exists) continue;

    if (now - p.birth > PROJECTILE_LIFETIME) {
      p.sprite.destroy();
      continue;
    }

    const nx = p.sprite.x + p.sprite.vx * dt;
    const ny = p.sprite.y + p.sprite.vy * dt;
    if (game.spriteCollidesWithMap(p.sprite, nx, ny)) {
      p.sprite.destroy();
    } else {
      p.sprite.x = nx;
      p.sprite.y = ny;
    }
  }

  // Remove destroyed sprites from arrays
  state.enemies = state.enemies.filter(e => e.exists);
  state.items = state.items.filter(i => i.exists);
  state.projectiles = state.projectiles.filter(p => p.sprite.exists);

  // Check player death
  const hp = state.player.hp ?? 100;
  if (hp <= 0) {
    game.particles.emit('death_burst', state.player.x + state.player.width / 2, state.player.y);
    game.floatText(state.player.x + state.player.width / 2, state.player.y, 'YOU DIED', { color: 0xff0000, style: 'pop', duration: 1.5, scale: 0.6 });
    state.player.hp = 100;
    game.stats.coins = 0;
    game.stats.keys = 0;
    loadRoom('village');
    return;
  }

  // Update player HP bar
  state.player.hpBarValue = hp / 100;

  // Update stats display
  const room = ROOMS[state.currentRoom];
  statsEl.innerHTML = `
    HP: ${hp}<br>
    Coins: ${game.stats.coins}<br>
    Keys: ${game.stats.keys}<br>
    XP: ${game.stats.xp}<br>
    <br>
    Room: ${room.name}<br>
    ${state.nearbyNPC ? '<span style="color:#4a9">[SPACE] Talk</span>' : ''}
  `;
});

// =============================================================================
// Input Handling
// =============================================================================

window.addEventListener('keydown', (e) => {
  // Dialogue interaction
  if (e.code === 'Space') {
    e.preventDefault();

    if (state.dialogueActive) {
      advanceDialogue();
    } else if (state.nearbyNPC) {
      startDialogue(state.nearbyNPC);
    } else {
      fireProjectile();
    }
  }

  // Music toggle
  if (e.code === 'KeyM') {
    const current = game.music.getCurrent();
    if (current) {
      game.music.stop({ fade: 0.3 });
    } else {
      const room = ROOMS[state.currentRoom];
      game.music.play(room.music, { fade: 0.3 });
    }
  }

  // Debug: Quick room change
  if (e.code === 'Digit1') loadRoom('village');
  if (e.code === 'Digit2') loadRoom('forest');
  if (e.code === 'Digit3') loadRoom('dungeon');
});

// =============================================================================
// Start Game
// =============================================================================

loadRoom('village');
game.start();

console.log('RPG Example running!');
console.log('WASD/Arrows: Move | Space: Interact | M: Toggle Music | 1-3: Change Room');
