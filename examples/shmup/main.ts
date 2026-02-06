/**
 * Glyft Bullet Hell Example
 *
 * Demonstrates Glyft's performance with many sprites:
 * - Dense bullet patterns (radial, aimed, spiral)
 * - Hundreds of bullets on screen at 60fps
 * - Ring effects for danger zones
 * - Particle explosions
 * - Score and combo system
 * - Screen-clearing bomb mechanic
 */

import { Glyft, type GlyftConfig, type Sprite } from '../../src';

// =============================================================================
// Config
// =============================================================================

const config: GlyftConfig = {
  settings: {
    tileSize: 8,
    viewport: [320, 240],
    spriteMode: '1dir', // No directional animation needed
    backgroundColor: 0x0a0a18,
  },

  stats: {
    score: { default: 0 },
    bombs: { default: 3 },
    lives: { default: 3 },
  },

  sfx: {
    shoot:     { wave: 'square', freq: 600, duration: 0.05, sweep: 200 },
    enemy_hit: { wave: 'sawtooth', freq: 200, duration: 0.1, sweep: 50, noise: 0.2 },
    explode:   { wave: 'sawtooth', freq: 150, duration: 0.3, noise: 0.8 },
    bomb:      { wave: 'triangle', freq: 100, duration: 0.5, sweep: -50, noise: 0.9 },
    powerup:   { wave: 'sine', freq: [400, 1000], duration: 0.08 },
    hit:       { wave: 'triangle', freq: 200, duration: 0.15, noise: 0.7 },
  },

  particles: {
    bullet_hit:    { count: 4,  speed: 40, spread: 360, lifetime: 0.2, color: 0xff4444, colorEnd: 0x440000, size: 2, sizeEnd: 0 },
    enemy_explode: { count: 16, speed: 80, speedVariance: 30, spread: 360, lifetime: 0.4, gravity: 50, color: 0xff6644, colorEnd: 0xffcc00, size: 4, sizeEnd: 0 },
    boss_explode:  { count: 32, speed: 100, speedVariance: 40, spread: 360, lifetime: 0.6, gravity: 30, color: 0xff44ff, colorEnd: 0x4400ff, size: 5, sizeEnd: 1 },
    player_death:  { count: 24, speed: 60, spread: 360, lifetime: 0.5, color: 0x44ffff, colorEnd: 0x0044ff, size: 4, sizeEnd: 0 },
    bomb_wave:     { count: 48, speed: 150, spread: 360, lifetime: 0.3, color: 0xffffff, colorEnd: 0x4488ff, size: 3, sizeEnd: 1 },
    graze:         { count: 2,  speed: 20, spread: 180, lifetime: 0.2, color: 0xffffff, colorEnd: 0x8888ff, size: 2, sizeEnd: 0 },
  },

  music: {
    battle: {
      bpm: 160, wave: 'square', volume: 0.5,
      notes: [
        // Intense bullet hell music
        ['E4', 0.5], ['E4', 0.5], 'G4', ['E4', 0.5], ['D4', 0.5],
        ['C4', 0.5], ['C4', 0.5], 'E4', ['C4', 0.5], ['B3', 0.5],
        ['A3', 0.5], ['A3', 0.5], 'C4', 'E4',
        ['G4', 0.5], ['F4', 0.5], ['E4', 0.5], ['D4', 0.5], ['E4', 2],
      ],
      pad: { wave: 'sawtooth', freq: 110, volume: 0.15 },
    },
  },
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Glyft(canvas, config);
const atlas = game.createTestAtlas('test', 8, 8);

// =============================================================================
// Constants
// =============================================================================

const SCREEN_W = 320;
const SCREEN_H = 240;
const PLAYER_SPEED = 120;
const PLAYER_FOCUS_SPEED = 50;
const PLAYER_FIRE_RATE = 0.08;
const GRAZE_DISTANCE = 12;

// =============================================================================
// Game State
// =============================================================================

let playerFireTimer = 0;
let waveTimer = 0;
let currentWave = 0;
let combo = 0;
let comboTimer = 0;
let invincibleTimer = 0;
let gameOver = false;

// Bullet pools
const playerBullets: Sprite[] = [];
const enemyBullets: Sprite[] = [];
const enemies: Sprite[] = [];

// =============================================================================
// Procedural Background (GPU-rendered with sprites)
// =============================================================================

// Background star sprites (3 parallax layers)
const bgStars: Sprite[][] = [[], [], []];
const STAR_COUNTS = [40, 25, 15];
const STAR_SPEEDS = [12, 25, 45];
const STAR_COLORS = [0x334455, 0x445566, 0x556688]; // Subtle blue tones
const STAR_SIZES = [0.15, 0.2, 0.3];

// Initialize background stars
for (let layer = 0; layer < 3; layer++) {
  for (let i = 0; i < STAR_COUNTS[layer]; i++) {
    const star = game.createSprite(atlas, 'player');
    star.x = Math.random() * SCREEN_W;
    star.y = Math.random() * SCREEN_H;
    star.scale = STAR_SIZES[layer];
    star.tint = STAR_COLORS[layer];
    star.alpha = 0.2 + layer * 0.1 + Math.random() * 0.15;
    star.data.speed = STAR_SPEEDS[layer] + Math.random() * 8;
    star.data.baseAlpha = star.alpha;
    star.data.twinklePhase = Math.random() * Math.PI * 2;
    star.data.twinkleSpeed = 1.5 + Math.random() * 2;
    bgStars[layer].push(star);
  }
}

// Update background stars
function updateBackground(dt: number, time: number) {
  for (let layer = 0; layer < 3; layer++) {
    for (const star of bgStars[layer]) {
      // Scroll down
      star.y += (star.data.speed as number) * dt;

      // Wrap around
      if (star.y > SCREEN_H + 10) {
        star.y = -10;
        star.x = Math.random() * SCREEN_W;
      }

      // Twinkle effect
      star.data.twinklePhase = (star.data.twinklePhase as number) + (star.data.twinkleSpeed as number) * dt;
      const twinkle = 0.7 + 0.3 * Math.sin(star.data.twinklePhase as number);
      star.alpha = (star.data.baseAlpha as number) * twinkle;
    }
  }
}

// =============================================================================
// Player
// =============================================================================

const player = game.createSprite(atlas, 'player');
player.x = SCREEN_W / 2;
player.y = SCREEN_H - 40;
player.tint = 0x44ffff;
player.glow = 0.5;
player.glowColor = 0x44ffff;
player.tags = ['player'];

// =============================================================================
// Bullet Spawning
// =============================================================================

function spawnPlayerBullet(x: number, y: number, vx: number, vy: number) {
  const bullet = game.createSprite(atlas, 'player');
  bullet.x = x;
  bullet.y = y;
  bullet.vx = vx;
  bullet.vy = vy;
  bullet.tint = 0x44ffff;
  bullet.scale = 0.5;
  bullet.glow = 0.8;
  bullet.glowColor = 0x44ffff;
  bullet.tags = ['player_bullet'];
  playerBullets.push(bullet);
  return bullet;
}

function spawnEnemyBullet(x: number, y: number, vx: number, vy: number, color = 0xff4444) {
  const bullet = game.createSprite(atlas, 'player');
  bullet.x = x;
  bullet.y = y;
  bullet.vx = vx;
  bullet.vy = vy;
  bullet.tint = color;
  bullet.scale = 0.4;
  bullet.glow = 0.6;
  bullet.glowColor = color;
  bullet.tags = ['enemy_bullet'];
  enemyBullets.push(bullet);
  return bullet;
}

// =============================================================================
// Bullet Patterns
// =============================================================================

function fireRadial(x: number, y: number, count: number, speed: number, color = 0xff4444) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    spawnEnemyBullet(x, y, vx, vy, color);
  }
}

function fireAimed(x: number, y: number, targetX: number, targetY: number, speed: number, color = 0xff4444) {
  const dx = targetX - x;
  const dy = targetY - y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const vx = (dx / dist) * speed;
  const vy = (dy / dist) * speed;
  spawnEnemyBullet(x, y, vx, vy, color);
}

function fireSpiral(x: number, y: number, baseAngle: number, count: number, speed: number, color = 0xff44ff) {
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (i / count) * Math.PI * 2;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    spawnEnemyBullet(x, y, vx, vy, color);
  }
}

// =============================================================================
// Enemy Types
// =============================================================================

// Enemy data stored in sprite.data

function spawnEnemy(x: number, y: number, type: string) {
  const enemy = game.createSprite(atlas, 'player');
  enemy.x = x;
  enemy.y = y;

  const data: EnemyData = {
    type,
    hp: 3,
    fireTimer: 0,
    firePattern: 'radial',
  };

  switch (type) {
    case 'basic':
      enemy.tint = 0xff6644;
      data.hp = 3;
      data.firePattern = 'aimed';
      break;
    case 'spinner':
      enemy.tint = 0xff44ff;
      data.hp = 5;
      data.firePattern = 'spiral';
      data.spiralAngle = 0;
      break;
    case 'spreader':
      enemy.tint = 0xffff44;
      data.hp = 4;
      data.firePattern = 'radial';
      break;
    case 'boss':
      enemy.tint = 0xff00ff;
      enemy.scale = 2;
      data.hp = 50;
      data.firePattern = 'boss';
      data.moveTimer = 0;
      data.moveDir = 1;
      break;
  }

  enemy.data.type = data.type;
  enemy.data.hp = data.hp;
  enemy.data.fireTimer = data.fireTimer;
  enemy.data.firePattern = data.firePattern;
  if (data.spiralAngle !== undefined) enemy.data.spiralAngle = data.spiralAngle;
  if (data.moveTimer !== undefined) enemy.data.moveTimer = data.moveTimer;
  if (data.moveDir !== undefined) enemy.data.moveDir = data.moveDir;
  enemy.hpBarVisible = type === 'boss';
  enemy.hpBarValue = 1;
  enemy.hpBarWidth = type === 'boss' ? 60 : 20;
  enemies.push(enemy);

  // Spawn warning
  return enemy;
}

// =============================================================================
// Wave System
// =============================================================================

function spawnWave(wave: number) {
  switch (wave % 5) {
    case 0:
      // Basic enemies from top
      for (let i = 0; i < 5; i++) {
        setTimeout(() => spawnEnemy(60 + i * 50, -20, 'basic'), i * 200);
      }
      break;
    case 1:
      // Spinners from sides
      setTimeout(() => spawnEnemy(40, -20, 'spinner'), 0);
      setTimeout(() => spawnEnemy(280, -20, 'spinner'), 300);
      break;
    case 2:
      // Spreaders in formation
      for (let i = 0; i < 3; i++) {
        setTimeout(() => spawnEnemy(100 + i * 60, -20, 'spreader'), i * 150);
      }
      break;
    case 3:
      // Mixed wave
      setTimeout(() => spawnEnemy(80, -20, 'basic'), 0);
      setTimeout(() => spawnEnemy(160, -20, 'spinner'), 200);
      setTimeout(() => spawnEnemy(240, -20, 'basic'), 400);
      break;
    case 4:
      // Boss wave
      setTimeout(() => spawnEnemy(160, 40, 'boss'), 500);
      break;
  }
}

// =============================================================================
// Collision Detection
// =============================================================================

function checkCollision(a: Sprite, b: Sprite, radius: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy < radius * radius;
}

// =============================================================================
// Bomb
// =============================================================================

function useBomb() {
  if (game.stats.bombs <= 0) return;

  game.stats.bombs -= 1;
  game.sounds.play('bomb', { volume: 0.6 });
  game.particles.emit('bomb_wave', player.x, player.y);

  // Destroy all enemy bullets
  for (const bullet of enemyBullets) {
    if (bullet.exists) {
      game.particles.emit('bullet_hit', bullet.x, bullet.y);
      bullet.destroy();
    }
  }
  enemyBullets.length = 0;

  // Damage all enemies
  for (const enemy of enemies) {
    if (enemy.exists) {
      const data = enemy.data;
      data.hp -= 10;
    }
  }

  // Brief invincibility
  invincibleTimer = 1.5;
}

// =============================================================================
// Game Loop
// =============================================================================

game.onUpdate((dt) => {
  if (gameOver) return;

  // --- Timers ---
  if (playerFireTimer > 0) playerFireTimer -= dt;
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 0;
  }
  if (invincibleTimer > 0) {
    invincibleTimer -= dt;
    player.alpha = Math.sin(invincibleTimer * 20) > 0 ? 1 : 0.3;
  } else {
    player.alpha = 1;
  }

  // --- Wave spawning ---
  waveTimer -= dt;
  if (waveTimer <= 0 && enemies.filter(e => e.exists).length === 0) {
    spawnWave(currentWave);
    currentWave++;
    waveTimer = 4;
  }

  // --- Player Input ---
  let moveX = 0;
  let moveY = 0;
  if (game.input.isDown('ArrowLeft') || game.input.isDown('KeyA')) moveX = -1;
  if (game.input.isDown('ArrowRight') || game.input.isDown('KeyD')) moveX = 1;
  if (game.input.isDown('ArrowUp') || game.input.isDown('KeyW')) moveY = -1;
  if (game.input.isDown('ArrowDown') || game.input.isDown('KeyS')) moveY = 1;

  // Focus mode (slower movement for precise dodging)
  const focus = game.input.isDown('ShiftLeft') || game.input.isDown('ShiftRight');
  const speed = focus ? PLAYER_FOCUS_SPEED : PLAYER_SPEED;

  // Normalize diagonal
  if (moveX !== 0 && moveY !== 0) {
    moveX *= 0.707;
    moveY *= 0.707;
  }

  player.x += moveX * speed * dt;
  player.y += moveY * speed * dt;

  // Clamp to screen
  player.x = Math.max(8, Math.min(SCREEN_W - 8, player.x));
  player.y = Math.max(8, Math.min(SCREEN_H - 8, player.y));

  // --- Player Shooting ---
  const shooting = game.input.isDown('KeyZ') || game.input.isDown('Space');
  if (shooting && playerFireTimer <= 0) {
    playerFireTimer = PLAYER_FIRE_RATE;
    spawnPlayerBullet(player.x - 6, player.y - 4, 0, -400);
    spawnPlayerBullet(player.x + 6, player.y - 4, 0, -400);
    game.sounds.play('shoot', { volume: 0.15 });
  }

  // --- Bomb ---
  if (game.input.justPressed('KeyX')) {
    useBomb();
  }

  // --- Update Player Bullets ---
  for (let i = playerBullets.length - 1; i >= 0; i--) {
    const bullet = playerBullets[i];
    if (!bullet.exists) {
      playerBullets.splice(i, 1);
      continue;
    }

    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;

    // Off screen
    if (bullet.y < -10) {
      bullet.destroy();
      playerBullets.splice(i, 1);
    }
  }

  // --- Update Enemy Bullets ---
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const bullet = enemyBullets[i];
    if (!bullet.exists) {
      enemyBullets.splice(i, 1);
      continue;
    }

    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;

    // Off screen
    if (bullet.x < -10 || bullet.x > SCREEN_W + 10 || bullet.y < -10 || bullet.y > SCREEN_H + 10) {
      bullet.destroy();
      enemyBullets.splice(i, 1);
      continue;
    }

    // Graze detection (near miss = points)
    if (invincibleTimer <= 0) {
      const grazeDist = Math.sqrt((bullet.x - player.x) ** 2 + (bullet.y - player.y) ** 2);
      if (grazeDist < GRAZE_DISTANCE && grazeDist > 4) {
        game.stats.score += 10;
        game.particles.emit('graze', player.x, player.y);
      }

      // Player hit
      if (checkCollision(bullet, player, 4)) {
        playerHit();
        bullet.destroy();
        enemyBullets.splice(i, 1);
      }
    }
  }

  // --- Update Enemies ---
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    if (!enemy.exists) {
      enemies.splice(i, 1);
      continue;
    }

    const data = enemy.data;

    // Movement
    if (data.type === 'boss') {
      // Boss moves side to side
      data.moveTimer = (data.moveTimer || 0) + dt;
      enemy.x += (data.moveDir || 1) * 40 * dt;
      if (enemy.x < 60 || enemy.x > SCREEN_W - 60) {
        data.moveDir = -(data.moveDir || 1);
      }
    } else {
      // Regular enemies drift down
      enemy.y += 20 * dt;

      // Off screen
      if (enemy.y > SCREEN_H + 20) {
        enemy.destroy();
        enemies.splice(i, 1);
        continue;
      }
    }

    // Firing
    data.fireTimer -= dt;
    if (data.fireTimer <= 0 && enemy.y > 10) {
      switch (data.firePattern) {
        case 'aimed':
          fireAimed(enemy.x, enemy.y, player.x, player.y, 80);
          data.fireTimer = 1.2;
          break;
        case 'spiral':
          data.spiralAngle = (data.spiralAngle || 0) + 0.3;
          fireSpiral(enemy.x, enemy.y, data.spiralAngle, 5, 60, 0xff44ff);
          data.fireTimer = 0.3;
          break;
        case 'radial':
          fireRadial(enemy.x, enemy.y, 8, 50, 0xffff44);
          data.fireTimer = 1.5;
          break;
        case 'boss':
          // Boss has multiple attack patterns
          const pattern = Math.floor(Math.random() * 3);
          if (pattern === 0) {
            fireRadial(enemy.x, enemy.y, 16, 60, 0xff44ff);
          } else if (pattern === 1) {
            for (let j = 0; j < 5; j++) {
              setTimeout(() => {
                if (enemy.exists) fireAimed(enemy.x, enemy.y, player.x, player.y, 100, 0xff4444);
              }, j * 100);
            }
          } else {
            data.spiralAngle = (data.spiralAngle || 0) + 0.2;
            fireSpiral(enemy.x, enemy.y, data.spiralAngle, 12, 70, 0x44ff44);
          }
          data.fireTimer = 0.8;
          break;
      }
    }

    // Check player bullet collisions
    for (const bullet of playerBullets) {
      if (bullet.exists && checkCollision(bullet, enemy, 12)) {
        data.hp--;
        bullet.destroy();
        game.sounds.play('enemy_hit', { volume: 0.3 });

        if (data.hp <= 0) {
          // Enemy destroyed
          const isBoss = data.type === 'boss';
          const points = isBoss ? 5000 : 100;
          const particleType = isBoss ? 'boss_explode' : 'enemy_explode';

          game.particles.emit(particleType, enemy.x, enemy.y);
          game.sounds.play('explode', { volume: isBoss ? 0.7 : 0.4 });

          combo++;
          comboTimer = 2;
          const comboBonus = Math.floor(points * (1 + combo * 0.1));
          game.stats.score += comboBonus;
          game.floatText(enemy.x, enemy.y, `+${comboBonus}`, {
            color: 0xffff44,
            style: 'pop',
            scale: isBoss ? 0.8 : 0.5,
          });

          enemy.destroy();
        } else {
          // Hit flash
          enemy.hpBarValue = data.hp / (data.type === 'boss' ? 50 : 5);
        }
        break;
      }
    }

    // Player collision with enemy
    if (invincibleTimer <= 0 && checkCollision(player, enemy, 8)) {
      playerHit();
    }
  }
});

// =============================================================================
// Player Hit
// =============================================================================

function playerHit() {
  if (game.stats.lives <= 1) {
    gameOver = true;
    game.particles.emit('player_death', player.x, player.y);
    game.sounds.play('explode', { volume: 0.6 });
    player.alpha = 0;
    return;
  }

  game.stats.lives -= 1;
  game.sounds.play('hit', { volume: 0.5 });
  game.particles.emit('player_death', player.x, player.y);

  // Reset position
  player.x = SCREEN_W / 2;
  player.y = SCREEN_H - 40;
  invincibleTimer = 2;
  combo = 0;

  // Clear some bullets
  for (const bullet of enemyBullets) {
    if (Math.random() < 0.5) {
      bullet.destroy();
    }
  }
}

// =============================================================================
// Background Update
// =============================================================================

game.onUpdate((dt) => {
  updateBackground(dt, game.time);
});

// =============================================================================
// HUD
// =============================================================================

game.onUpdate(() => {
  const ctx = game.overlay;
  ctx.fillStyle = '#fff';
  ctx.font = '10px monospace';

  // Score
  ctx.fillText(`SCORE: ${game.stats.score.toLocaleString()}`, 8, 14);

  // Combo
  if (combo > 1) {
    ctx.fillStyle = '#ff0';
    ctx.fillText(`x${combo} COMBO`, 8, 26);
  }

  // Lives
  ctx.fillStyle = '#4ff';
  ctx.fillText(`LIVES: ${'♦'.repeat(game.stats.lives)}`, SCREEN_W - 70, 14);

  // Bombs
  ctx.fillStyle = '#f4f';
  ctx.fillText(`BOMB: ${'★'.repeat(game.stats.bombs)}`, SCREEN_W - 70, 26);

  // Wave
  ctx.fillStyle = '#888';
  ctx.fillText(`WAVE ${currentWave}`, SCREEN_W / 2 - 20, 14);

  // Game Over
  if (gameOver) {
    ctx.fillStyle = '#f44';
    ctx.font = '20px monospace';
    ctx.fillText('GAME OVER', SCREEN_W / 2 - 50, SCREEN_H / 2);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText('Refresh to retry', SCREEN_W / 2 - 40, SCREEN_H / 2 + 20);
  }
});

// =============================================================================
// Start
// =============================================================================

game.music.play('battle', { fade: 0.5 });
game.start();

// Spawn first wave after short delay
waveTimer = 2;

console.log('Bullet Hell running!');
console.log('Arrows/WASD: Move | Shift: Focus (slow) | Z/Space: Shoot | X: Bomb');
