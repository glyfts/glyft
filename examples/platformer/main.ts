/**
 * Glyft Platformer Example
 *
 * Demonstrates platformer physics with Glyft:
 * - Gravity, jumping, ground detection
 * - 2dir-side sprite mode (left/right facing)
 * - Enemy stomping
 * - Collectibles with magnetization
 * - Particle effects for dust and impacts
 */

import { Glyft, type GlyftConfig, type Sprite, type TileMap } from '../../src';

// =============================================================================
// Physics Constants
// =============================================================================

const GRAVITY = 800;
const JUMP_VELOCITY = -340;  // Higher jump to reach platforms
const MOVE_SPEED = 100;
const MAX_FALL_SPEED = 400;
const COYOTE_TIME = 0.08; // Grace period after leaving ground
const JUMP_BUFFER = 0.1;  // Input buffer for jump

// =============================================================================
// Config
// =============================================================================

const config: GlyftConfig = {
  settings: {
    tileSize: 16,
    viewport: [320, 240],
    spriteMode: '2dir-side', // Left/right flipping for platformers
    backgroundColor: 0x1a1a2e,
  },

  autoTags: {
    'enemy_': ['enemy'],
    'coin_': ['coin', 'collectible'],
  },

  stats: {
    score: { default: 0 },
    coins: { default: 0 },
  },

  sfx: {
    jump:   { wave: 'square', freq: 200, duration: 0.1, sweep: 400, sweepTime: 0.08 },
    land:   { wave: 'triangle', freq: 100, duration: 0.08, noise: 0.6 },
    stomp:  { wave: 'square', freq: 300, duration: 0.15, sweep: 600, noise: 0.2 },
    coin:   { wave: 'sine', freq: [800, 1200], duration: 0.08 },
    hurt:   { wave: 'sawtooth', freq: 200, duration: 0.2, sweep: 50, noise: 0.3 },
  },

  sounds: {
    '[player]:[coin]': { sound: 'coin', volume: 0.5 },
  },

  collisions: {
    '[player]:[coin]': {
      magnetize: { range: 32, speed: 120 },
      collect: 'coins',
      destroy: true,
      particles: 'coin_sparkle',
      floatText: { color: 0xffdd44, style: 'rise', scale: 0.4 },
    },
  },

  particles: {
    dust:          { count: 4,  speed: 20, speedVariance: 10, angle: -90, spread: 60, lifetime: 0.3, gravity: 50, color: 0x888888, colorEnd: 0x444444, size: 2, sizeEnd: 0 },
    land_dust:     { count: 8,  speed: 40, speedVariance: 15, angle: -90, spread: 140, lifetime: 0.4, gravity: 80, color: 0xaaaaaa, colorEnd: 0x555555, size: 3, sizeEnd: 1 },
    stomp_burst:   { count: 12, speed: 60, speedVariance: 20, spread: 360, lifetime: 0.4, gravity: 100, color: 0xff6644, colorEnd: 0xffcc00, size: 4, sizeEnd: 0 },
    coin_sparkle:  { count: 6,  speed: 30, speedVariance: 15, spread: 360, lifetime: 0.4, color: 0xffdd44, colorEnd: 0xffff88, size: 2, sizeEnd: 0 },
    death_poof:    { count: 16, speed: 50, speedVariance: 25, spread: 360, lifetime: 0.5, gravity: 40, color: 0xff4444, colorEnd: 0x440000, size: 4, sizeEnd: 0 },
  },

  music: {
    level: {
      bpm: 140, wave: 'square', volume: 0.5,
      notes: [
        // Upbeat platformer melody
        'C5', 'E5', 'G5', 'E5',
        'A4', 'C5', 'E5', 'C5',
        'F4', 'A4', 'C5', 'A4',
        'G4', 'B4', 'D5', ['G5', 2],
      ],
      pad: { wave: 'triangle', freq: 131, volume: 0.2 },
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
// Level Generation
// =============================================================================

const LEVEL_WIDTH = 40;
const LEVEL_HEIGHT = 15;

const map = game.createMap(atlas, LEVEL_WIDTH, LEVEL_HEIGHT);

// Fill sky
map.fill(0, 0, LEVEL_WIDTH, LEVEL_HEIGHT, 0);

// Ground floor
for (let x = 0; x < LEVEL_WIDTH; x++) {
  map.set(x, LEVEL_HEIGHT - 1, 2);
  map.setCollision(x, LEVEL_HEIGHT - 1, true);
  map.set(x, LEVEL_HEIGHT - 2, 1);
  map.setCollision(x, LEVEL_HEIGHT - 2, true);
}

// Platforms
const platforms = [
  // x, y, width
  [3, 10, 4],
  [10, 8, 5],
  [18, 11, 3],
  [22, 8, 4],
  [28, 6, 5],
  [35, 9, 4],
];

for (const [px, py, pw] of platforms) {
  for (let x = px; x < px + pw; x++) {
    map.set(x, py, 3);
    map.setCollision(x, py, true);
  }
}

// Gaps in ground
const gaps = [[12, 14], [13, 14], [25, 14], [26, 14]];
for (const [gx, gy] of gaps) {
  map.set(gx, gy - 1, 0);
  map.setCollision(gx, gy - 1, false);
  map.set(gx, gy, 0);
  map.setCollision(gx, gy, false);
}

// =============================================================================
// Sprites
// =============================================================================

// Player
const player = game.createSprite(atlas, 'player');
player.x = 32;
player.y = 160;
player.tags = ['player'];
player.shadow = true;

// Player physics state
let velocityY = 0;
let grounded = false;
let coyoteTimer = 0;
let jumpBufferTimer = 0;
let wasGrounded = false;

// Coins
const coinPositions = [
  [5, 9], [6, 9],           // On first platform
  [12, 7], [13, 7], [14, 7], // On second platform
  [23, 7], [24, 7],         // On fourth platform
  [30, 5], [31, 5],         // On fifth platform
  [15, 12], [16, 12],       // Floating coins
];

for (const [cx, cy] of coinPositions) {
  const coin = game.createSprite(atlas, 'player');
  coin.x = cx * 16 + 8;
  coin.y = cy * 16 + 8;
  coin.tint = 0xffdd44;
  coin.scale = 0.5;
  coin.bob = 3;
  coin.bobSpeed = 1.2;
  coin.tags = ['coin', 'collectible'];
}

// Enemies (patrolling slimes)
// Enemy data stored in sprite.data

const enemies: Sprite[] = [];
const enemySpawns = [
  { x: 5, y: 12, patrol: [3, 9] },
  { x: 20, y: 12, patrol: [18, 24] },
  { x: 32, y: 12, patrol: [30, 38] },
];

for (const spawn of enemySpawns) {
  const enemy = game.createSprite(atlas, 'player');
  enemy.x = spawn.x * 16;
  enemy.y = spawn.y * 16;
  enemy.tint = 0xff6666;
  enemy.tags = ['enemy'];
  enemy.hp = 1;
  enemy.data.startX = spawn.patrol[0] * 16;
  enemy.data.endX = spawn.patrol[1] * 16;
  enemy.data.direction = 1;
  enemies.push(enemy);
}

// =============================================================================
// Camera
// =============================================================================

game.camera.follow(player, { smoothing: 0.1 });
game.camera.setBounds(0, 0, map.widthPx, map.heightPx);

// =============================================================================
// Helper: Ground Check
// =============================================================================

function isOnGround(sprite: Sprite, yOffset = 1): boolean {
  // Check a pixel below the sprite
  return game.spriteCollidesWithMap(sprite, sprite.x, sprite.y + yOffset);
}

function canStompEnemy(playerSprite: Sprite, enemySprite: Sprite): boolean {
  // Player must be falling and above the enemy
  const playerBottom = playerSprite.y + playerSprite.height;
  const enemyTop = enemySprite.y;
  const falling = velocityY > 0;
  return falling && playerBottom < enemyTop + 8;
}

// =============================================================================
// Game Loop
// =============================================================================

game.onUpdate((dt) => {
  // --- Timers ---
  if (coyoteTimer > 0) coyoteTimer -= dt;
  if (jumpBufferTimer > 0) jumpBufferTimer -= dt;

  // --- Input ---
  let moveX = 0;
  if (game.input.isDown('ArrowLeft') || game.input.isDown('KeyA')) moveX = -1;
  if (game.input.isDown('ArrowRight') || game.input.isDown('KeyD')) moveX = 1;

  const jumpPressed = game.input.justPressed('Space') || game.input.justPressed('ArrowUp') || game.input.justPressed('KeyW');
  if (jumpPressed) jumpBufferTimer = JUMP_BUFFER;

  // --- Horizontal Movement ---
  player.vx = moveX * MOVE_SPEED;
  const nx = player.x + player.vx * dt;
  if (!game.spriteCollidesWithMap(player, nx, player.y)) {
    player.x = nx;
  } else {
    player.vx = 0;
  }

  // Running dust
  if (grounded && Math.abs(moveX) > 0 && Math.random() < 0.1) {
    game.particles.emit('dust', player.x + player.width / 2, player.y + player.height);
  }

  // --- Ground Check ---
  grounded = isOnGround(player);

  // Coyote time: grace period after leaving ground
  if (grounded) {
    coyoteTimer = COYOTE_TIME;
  }

  // Landing detection
  if (grounded && !wasGrounded && velocityY > 100) {
    game.sounds.play('land', { volume: 0.3 });
    game.particles.emit('land_dust', player.x + player.width / 2, player.y + player.height);
  }
  wasGrounded = grounded;

  // --- Jump ---
  const canJump = coyoteTimer > 0 || grounded;
  if (jumpBufferTimer > 0 && canJump) {
    velocityY = JUMP_VELOCITY;
    jumpBufferTimer = 0;
    coyoteTimer = 0;
    grounded = false;
    game.sounds.play('jump', { volume: 0.4 });
    game.particles.emit('dust', player.x + player.width / 2, player.y + player.height);
  }

  // Variable jump height (release early = lower jump)
  const jumpHeld = game.input.isDown('Space') || game.input.isDown('ArrowUp') || game.input.isDown('KeyW');
  if (!jumpHeld && velocityY < 0) {
    velocityY *= 0.9; // Cut jump short
  }

  // --- Gravity ---
  if (!grounded) {
    velocityY += GRAVITY * dt;
    velocityY = Math.min(velocityY, MAX_FALL_SPEED);
  }

  // --- Vertical Movement ---
  player.vy = velocityY;
  const ny = player.y + velocityY * dt;

  if (!game.spriteCollidesWithMap(player, player.x, ny)) {
    player.y = ny;
  } else {
    // Hit something
    if (velocityY > 0) {
      // Landing - snap to ground
      while (!game.spriteCollidesWithMap(player, player.x, player.y + 1)) {
        player.y += 1;
      }
      grounded = true;
    }
    velocityY = 0;
  }

  // --- Fall death ---
  if (player.y > map.heightPx + 32) {
    // Respawn
    player.x = 32;
    player.y = 160;
    velocityY = 0;
    game.sounds.play('hurt', { volume: 0.5 });
    game.particles.emit('death_poof', 160, map.heightPx);
  }

  // --- Enemy AI & Collision ---
  for (const enemy of enemies) {
    if (!enemy.exists) continue;

    const data = enemy.data;

    // Patrol movement
    enemy.x += data.direction * 30 * dt;
    enemy.vx = data.direction * 30; // For animation

    // Turn around at patrol bounds
    if (enemy.x <= data.startX) {
      enemy.x = data.startX;
      data.direction = 1;
    } else if (enemy.x >= data.endX) {
      enemy.x = data.endX;
      data.direction = -1;
    }

    // Check collision with player
    const dx = Math.abs((player.x + player.width / 2) - (enemy.x + enemy.width / 2));
    const dy = Math.abs((player.y + player.height / 2) - (enemy.y + enemy.height / 2));
    const colliding = dx < 12 && dy < 12;

    if (colliding) {
      if (canStompEnemy(player, enemy)) {
        // Stomp!
        game.sounds.play('stomp', { volume: 0.5 });
        game.particles.emit('stomp_burst', enemy.x + enemy.width / 2, enemy.y + enemy.height / 2);
        game.floatText(enemy.x + enemy.width / 2, enemy.y, '+100', { color: 0xffff44, style: 'pop', scale: 0.5 });
        game.stats.score += 100;
        enemy.destroy();

        // Bounce
        velocityY = JUMP_VELOCITY * 0.6;
        grounded = false;
      } else {
        // Player hit - knockback
        const knockDir = player.x < enemy.x ? -1 : 1;
        player.x += knockDir * 30;
        velocityY = -150;
        game.sounds.play('hurt', { volume: 0.5 });
        game.particles.emit('death_poof', player.x + player.width / 2, player.y + player.height / 2);
      }
    }
  }
});

// =============================================================================
// HUD - Draw score/coins
// =============================================================================

game.onUpdate(() => {
  const ctx = game.overlay;
  ctx.fillStyle = '#fff';
  ctx.font = '10px monospace';
  ctx.fillText(`COINS: ${game.stats.coins}`, 8, 16);
  ctx.fillText(`SCORE: ${game.stats.score}`, 8, 28);
});

// =============================================================================
// Start
// =============================================================================

game.music.play('level', { fade: 0.5 });
game.start();

console.log('Platformer running! Arrow keys to move, Space to jump.');
