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
      { type: 'npc', x: 5, y: 5, dialogue: 'elder' },
      { type: 'npc', x: 12, y: 8, dialogue: 'merchant' },
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
    '[player]:[enemy]': { damage: 10, knockback: 80, flash: 0.2, cooldown: 0.5, floatText: { scale: 0.5 } },
    '[player]:[boss]': { damage: 25, knockback: 120, flash: 0.3, cooldown: 0.8, floatText: { scale: 0.5 } },

    // Collection - items magnetize toward player then collect on touch
    '[player]:[collectible]': { magnetize: { range: 48, speed: 80 }, collect: 'coins', destroy: true },
    '[player]:[key]': { magnetize: { range: 48, speed: 80 }, collect: 'keys', destroy: true },
    '[player]:[heal]': { magnetize: { range: 48, speed: 80 }, heal: 25, destroy: true },

    // NPC interaction handled via custom handler
    '[player]:[npc]': 'interactNPC',
  },

  // Custom handlers
  handlers: {
    interactNPC: (_player: Sprite, npc: Sprite) => {
      // This just marks which NPC we're near
      // Actual dialogue is triggered by Space key
      (window as unknown as { nearbyNPC: Sprite | null }).nearbyNPC = npc;
    },
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
  state.enemies = [];
  state.npcs = [];
  state.items = [];

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
    } else {
      enemy.tint = 0xff6666; // Red for regular enemies
      enemy.hp = 30;
      enemy.tags = ['enemy', 'hostile'];
      enemy.label = 'Slime';
      enemy.labelColor = 0xff6666;
    }

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
        currentMap.set(x, y, 4); // Tree tile
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
  } else {
    showDialogueLine();
  }
}

// =============================================================================
// Game Loop
// =============================================================================

const PLAYER_SPEED = 100;
const ENEMY_SPEED = 30;

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

    if (dist > 20 && dist < 150) {
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

    // Check if enemy died
    if (enemy.hp !== undefined && enemy.hp <= 0) {
      const isBoss = enemy.tags.includes('boss');
      const xp = isBoss ? 50 : 10;
      const cx = enemy.x + enemy.width / 2;
      game.floatText(cx, enemy.y, `+${xp} XP`, { color: 0xaa88ff, style: 'rise', duration: 1.2, scale: 0.5 });
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

  // Remove destroyed enemies from array
  state.enemies = state.enemies.filter(e => e.exists);
  state.items = state.items.filter(i => i.exists);

  // Update stats display
  const hp = state.player.hp ?? 100;
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
