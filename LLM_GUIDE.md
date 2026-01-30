# Glyft LLM Guide

A guide for LLMs generating Glyft game code. Glyft is a config-driven, GPU-first WebGL2 framework for tile-based 2D games.

## Philosophy

**Config, not code.** Define game rules as data. Code is only for input handling, AI logic, and custom handlers.

```typescript
// Good: Declarative config
collisions: {
  '[player]:[enemy]': { damage: 10, knockback: 50 },
  '[player]:[coin]': { collect: 'coins', destroy: true },
}

// Bad: Imperative collision handling scattered everywhere
if (player.collidesWith(enemy)) { player.hp -= 10; ... }
```

## Minimal Working Example

```typescript
import { Glyft, type GlyftConfig } from 'glyft';

const config: GlyftConfig = {
  settings: {
    tileSize: 16,
    viewport: [320, 240],
    spriteMode: '4dir',
  },
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Glyft(canvas, config);

// Create a test atlas (colored squares for prototyping)
const atlas = game.createTestAtlas('world', 8, 8);

// Create a tilemap
const map = game.createMap(atlas, 20, 15);
map.fill(0, 0, 20, 15, 1); // Fill with tile index 1

// Create a sprite
const player = game.createSprite(atlas, 'player');
player.x = 160;
player.y = 120;
player.tags = ['player'];

// Game loop
game.onUpdate((dt) => {
  let vx = 0, vy = 0;
  if (game.input.isDown('ArrowLeft')) vx = -1;
  if (game.input.isDown('ArrowRight')) vx = 1;
  if (game.input.isDown('ArrowUp')) vy = -1;
  if (game.input.isDown('ArrowDown')) vy = 1;

  player.vx = vx * 100;
  player.vy = vy * 100;
});

game.start();
```

## Config Structure

```typescript
const config: GlyftConfig = {
  settings: {
    tileSize: 16,              // Pixels per tile
    viewport: [320, 240],      // Game resolution
    spriteMode: '4dir',        // Animation mode
    backgroundColor: 0x1a1a2e, // Hex color
  },

  // Auto-apply tags based on sprite name prefix
  autoTags: {
    'enemy_': ['enemy', 'hostile'],
    'npc_': ['npc', 'friendly'],
  },

  // Player stats (accessed via game.stats)
  stats: {
    hp: { default: 100, max: 100 },
    coins: { default: 0 },
    xp: { default: 0 },
  },

  // Procedural sound effects
  sfx: {
    hit: { wave: 'square', freq: [200, 100], duration: 0.1 },
    coin: { wave: 'sine', freq: [800, 1200], duration: 0.15 },
    step: { wave: 'sine', freq: 80, duration: 0.03, volume: 0.2 },
  },

  // Reactive sounds (triggered automatically)
  sounds: {
    '[player]:[enemy]': { sound: '$hit', cooldown: 0.3 },
    '[player]:[coin]': '$coin',
    '[player]:moving': { sound: '$step', interval: 0.25 },
  },

  // Reactive collisions
  collisions: {
    '[player]:[enemy]': { damage: 10, knockback: 50, cooldown: 0.5 },
    '[player]:[coin]': { collect: 'coins', destroy: true },
    '[sword]:[enemy]': { damage: 25, flash: 0.1 },
  },

  // Particle effects
  particles: {
    blood: {
      count: 8,
      speed: 50,
      spread: 360,
      lifetime: 0.5,
      gravity: 200,
      color: 0xff0000,
      size: 2,
    },
  },

  // Declarative music (procedural, no audio files needed)
  music: {
    peaceful: {
      bpm: 60,
      wave: 'sine',
      volume: 0.5,
      notes: [
        ['C4', 2], ['E4', 1], ['G4', 1],
        ['A4', 2], ['G4', 2],
        ['F4', 2], ['E4', 1], ['D4', 1],
        ['C4', 3], [null, 1], // null = rest
      ],
      pad: { wave: 'sine', freq: 131, volume: 0.2 },
    },
  },
};
```

## Sprite Modes

| Mode | Directions | Use Case |
|------|------------|----------|
| `4dir` | Down, Right, Up, Left | Top-down RPGs |
| `8dir` | 8 compass directions | Detailed top-down |
| `2dir-side` | Left, Right (GPU flips) | Platformers |
| `1dir` | Single direction | Projectiles, effects |

Sprites auto-animate based on velocity. Set `vx`/`vy` and the GPU picks the correct direction and frame.

## Sprite Properties

```typescript
const sprite = game.createSprite(atlas, 'player');

// Position & movement
sprite.x = 100;
sprite.y = 100;
sprite.vx = 50;   // Velocity - also controls animation direction
sprite.vy = 0;

// Visual
sprite.tint = 0xff6666;      // Color tint
sprite.alpha = 0.8;          // Transparency
sprite.scale = 1.5;          // Size multiplier
sprite.rotation = 0;         // Radians (for 1dir mode)
sprite.visible = true;

// Animation
sprite.bob = 2;              // Bounce amplitude
sprite.bobSpeed = 1;         // Bounce speed

// Labels (floating text above sprite)
sprite.label = 'Guard';
sprite.labelColor = 0xffff00;
sprite.labelVisible = 'always' | 'proximity' | 'hover' | 'never';
sprite.labelRange = 48;      // For proximity mode
sprite.labelIcon = '!';      // Quest indicator
sprite.labelIconColor = 0xffff00;

// Combat
sprite.hp = 100;
sprite.hpBarVisible = true;
sprite.hpBarWidth = 30;

// Tags for pattern matching
sprite.tags = ['player', 'friendly'];

// Custom data storage
sprite.data.customField = 'anything';

// Lifecycle
sprite.destroy();
sprite.exists; // false after destroy
```

## Input

```typescript
// In game.onUpdate callback:
game.input.isDown('ArrowLeft')     // Key held
game.input.isDown('KeyW')          // WASD
game.input.justPressed('Space')    // Just pressed this frame
game.input.justReleased('KeyE')    // Just released

// Mouse/touch
game.input.pointerX
game.input.pointerY
game.input.isPointerDown()
```

## Tilemaps

```typescript
const map = game.createMap(atlas, width, height);

map.fill(x, y, w, h, tileIndex);           // Fill rectangle
map.set(x, y, tileIndex);                   // Set single tile
map.get(x, y);                              // Get tile index
map.setCollision(x, y, solid);              // Set collision
map.isColliding(x, y);                      // Check collision

// World dimensions
map.widthPx   // Width in pixels
map.heightPx  // Height in pixels
```

## Collision Detection

```typescript
// Check if sprite would collide at position
game.spriteCollidesWithMap(sprite, newX, newY);

// Movement with collision
const nx = player.x + player.vx * dt;
const ny = player.y + player.vy * dt;
if (!game.spriteCollidesWithMap(player, nx, player.y)) player.x = nx;
if (!game.spriteCollidesWithMap(player, player.x, ny)) player.y = ny;
```

## Camera

```typescript
game.camera.follow(player, { smoothing: 0.1 });
game.camera.setBounds(0, 0, map.widthPx, map.heightPx);
game.camera.x;  // Current position
game.camera.y;
```

## Particles

```typescript
// Emit at position
game.particles.emit('blood', x, y);

// Emit with options
game.particles.emit('sparkle', x, y, { count: 20 });
```

## Floating Text

```typescript
game.floatText(x, y, 'Critical!', {
  color: 0xffff00,
  size: 12,
  duration: 1.5,
  rise: 30,
});
```

## Music

```typescript
game.music.play('peaceful', { fade: 1 });  // 1s fade in
game.music.stop({ fade: 0.5 });
game.music.pause();
game.music.resume();
game.music.setVolume(0.5);
```

## Sound Effects

```typescript
// Manual play
game.sounds.play('$coin');
game.sounds.play('$hit', { volume: 0.5, pitch: [0.9, 1.1] });

// Procedural sounds (prefix with $)
// Available: $beep, $blip, $hit, $step, $coin, $hurt
```

## Addons

Addons extend Glyft with reusable systems. Import from `glyft/addons`.

### Rooms Addon

Manages multiple rooms/areas with transitions. Two connection styles available:

#### Edge-Based Connections (Recommended)

Walk off one edge → appear on the connected edge of the next room. Walls and doorways are auto-generated.

```typescript
import { rooms } from 'glyft/addons';

game.use(rooms({
  atlas,
  startRoom: 'village',
  rooms: {
    village: {
      name: 'Village',
      width: 24, height: 18,
      music: 'peaceful',
      spawn: [12, 9],
      wallTile: 2,  // Tile index for auto-generated walls
      build: (map) => {
        map.fill(0, 0, 24, 18, 1);  // Just floor, walls auto-added
      },
      spawns: [
        { type: 'player', x: 5, y: 5, tags: ['npc'], dialogue: 'elder',
          configure: (s) => { s.label = 'Elder'; s.tint = 0x66ff66; } },
      ],
    },
    forest: {
      name: 'Forest',
      width: 32, height: 24,
      wallTile: 3,
      build: (map) => { map.fill(0, 0, 32, 24, 4); },
      spawns: [],
    },
  },
  // Connect room edges - bidirectional, doorways auto-created
  edges: [
    { rooms: ['village', 'forest'], edges: ['east', 'west'] },
  ],
  doorwaySize: 4,  // Width of doorway in tiles (default: 4)
}));
```

#### Tile-Based Connections

For precise control over exit positions:

```typescript
game.use(rooms({
  atlas,
  startRoom: 'village',
  rooms: {
    village: { width: 24, height: 18, build: buildVillage, spawns: [] },
    forest: { width: 32, height: 24, build: buildForest, spawns: [] },
  },
  // Bidirectional - specify exit tile positions in each room
  connections: [
    { rooms: ['village', 'forest'], exits: [[23, 9], [0, 12]] },
  ],
}));
```

#### Room API

```typescript
const roomSys = game.addon('rooms');
roomSys.setPlayer(player);          // Required - enables exit detection
roomSys.load('forest', 5, 10);      // Manual room change with spawn position
roomSys.currentRoom;                // Current room ID
roomSys.currentDef;                 // Current room definition
```

### Dialogue Addon

NPC dialogue with proximity detection.

```typescript
import { dialogue } from 'glyft/addons';

game.use(dialogue({
  dialogues: {
    elder: {
      speaker: 'Elder',
      lines: [
        'Welcome, traveler.',
        'The forest is dangerous.',
        'Take this sword.',
      ],
    },
    // Simple format (no speaker name):
    sign: ['Town Square', 'Population: 42'],
  },
  advanceKey: 'Space',
  proximityRange: 24,
  onLine: (id, index, text, speaker) => { /* play sound */ },
  onEnd: (id) => { /* dialogue finished */ },
}));

const dlg = game.addon('dialogue');
dlg.setPlayer(player);
dlg.assign(npcSprite, 'elder');  // Or use rooms spawns with dialogue property
dlg.active;  // Check if dialogue is open
```

### HUD Addon

Canvas-based heads-up display.

```typescript
import { hud } from 'glyft/addons';

game.use(hud({
  panels: [
    {
      position: 'top-left',
      level: { stat: 'xp', thresholds: [0, 50, 120, 200], barColor: 0x44aaff },
      stats: [
        { stat: 'hp', label: '♥', color: 0xff4444, max: 100 },
        { stat: 'coins', label: '●', color: 0xffdd44 },
      ],
    },
  ],
  announcement: { fadeIn: 0.5, hold: 2.0, fadeOut: 0.5 },
  dialogue: { speakerColor: 0x44aa99 },
}));

// Rooms addon auto-announces room names
// Dialogue addon auto-shows dialogue box
```

### AI Addon

Simple AI behaviors.

```typescript
import { ai } from 'glyft/addons';

game.use(ai({
  behaviors: {
    chaser: {
      type: 'chase',
      target: '[player]',
      speed: 40,
      range: 100,
    },
    wanderer: {
      type: 'wander',
      speed: 20,
      pauseTime: [1, 3],
      moveTime: [0.5, 2],
    },
  },
}));

const aiSys = game.addon('ai');
aiSys.assign(enemySprite, 'chaser');
```

### Projectiles Addon

Bullet/projectile management.

```typescript
import { projectiles } from 'glyft/addons';

game.use(projectiles({ atlas }));

const proj = game.addon('projectiles');
proj.spawn({
  type: 'fireball',
  x: player.x,
  y: player.y,
  angle: Math.atan2(targetY - player.y, targetX - player.x),
  speed: 200,
  damage: 25,
  tags: ['projectile', 'player_projectile'],
  lifetime: 2,
});
```

## Pattern Syntax

Used in `sounds` and `collisions` config:

| Pattern | Meaning |
|---------|---------|
| `[player]` | Sprite with tag 'player' |
| `[tag1,tag2]` | Sprite with both tags |
| `name` | Sprite with exact name |
| `name*` | Wildcard match |
| `a:b` | Sprite a collides with sprite b |
| `[tag]:moving` | Tagged sprite has velocity |
| `[tag]:destroyed` | Tagged sprite was destroyed |

## Complete Game Template

```typescript
import { Glyft, type GlyftConfig, type Sprite } from 'glyft';
import { rooms, dialogue, hud, ai } from 'glyft/addons';

const config: GlyftConfig = {
  settings: {
    tileSize: 16,
    viewport: [320, 240],
    spriteMode: '4dir',
    backgroundColor: 0x1a1a2e,
  },
  stats: {
    hp: { default: 100, max: 100 },
    coins: { default: 0 },
  },
  sfx: {
    hit: { wave: 'square', freq: [200, 100], duration: 0.1 },
  },
  sounds: {
    '[player]:[enemy]': { sound: '$hit', cooldown: 0.3 },
  },
  collisions: {
    '[player]:[enemy]': { damage: 10, knockback: 50, cooldown: 0.5 },
  },
  music: {
    main: {
      bpm: 60,
      wave: 'sine',
      notes: [['C4', 2], ['E4', 2], ['G4', 2], ['C5', 2]],
    },
  },
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Glyft(canvas, config);
const atlas = game.createTestAtlas('world', 8, 8);

// Register addons
game.use(rooms({
  atlas,
  startRoom: 'main',
  rooms: {
    main: {
      name: 'Main Area',
      width: 20, height: 15,
      music: 'main',
      spawn: [10, 7],
      wallTile: 2,  // Walls auto-generated at edges
      build: (map) => {
        map.fill(0, 0, 20, 15, 1);  // Just floor - walls added automatically
      },
      spawns: [
        { type: 'player', x: 5, y: 5, tags: ['enemy'], ai: 'wander',
          configure: (s: Sprite) => { s.tint = 0xff6666; s.hp = 30; } },
      ],
    },
  },
  edges: [],  // No connections = solid walls on all sides
}));

game.use(ai({
  behaviors: {
    wander: { type: 'wander', speed: 30 },
  },
}));

game.use(hud({
  panels: [{
    position: 'top-left',
    stats: [{ stat: 'hp', label: '♥', color: 0xff4444, max: 100 }],
  }],
}));

// Create player
const player = game.createSprite(atlas, 'player');
player.tags = ['player'];
player.tint = 0x4488ff;

game.addon('rooms')!.setPlayer(player);

// Game loop
const SPEED = 100;
game.onUpdate((dt) => {
  let vx = 0, vy = 0;
  if (game.input.isDown('ArrowLeft') || game.input.isDown('KeyA')) vx = -1;
  if (game.input.isDown('ArrowRight') || game.input.isDown('KeyD')) vx = 1;
  if (game.input.isDown('ArrowUp') || game.input.isDown('KeyW')) vy = -1;
  if (game.input.isDown('ArrowDown') || game.input.isDown('KeyS')) vy = 1;

  if (vx && vy) { vx *= 0.707; vy *= 0.707; }
  player.vx = vx * SPEED;
  player.vy = vy * SPEED;

  const nx = player.x + player.vx * dt;
  const ny = player.y + player.vy * dt;
  if (!game.spriteCollidesWithMap(player, nx, player.y)) player.x = nx;
  if (!game.spriteCollidesWithMap(player, player.x, ny)) player.y = ny;
});

game.start();
```

## Common Patterns

### Freeze Player During Dialogue
```typescript
game.onUpdate((dt) => {
  const dlg = game.addon('dialogue');
  if (dlg?.active) {
    player.vx = 0;
    player.vy = 0;
    return;
  }
  // Normal movement...
});
```

### Spawn Particles on Hit
```typescript
collisions: {
  '[sword]:[enemy]': {
    damage: 25,
    handler: 'onEnemyHit',
  },
},
handlers: {
  onEnemyHit: (sword, enemy, game) => {
    game.particles.emit('blood', enemy.x, enemy.y);
  },
},
```

### Room-Specific Logic
```typescript
rooms: {
  boss_room: {
    // ...
    onEnter: () => {
      game.music.play('boss', { fade: 1 });
      // Spawn boss, lock doors, etc.
    },
    onExit: () => {
      game.music.play('peaceful', { fade: 1 });
    },
  },
},
```

## Tips for LLMs

1. **Use config over code** — Define behaviors in `collisions`, `sounds`, `stats` config
2. **Use addons** — Don't reinvent rooms, dialogue, HUD, AI
3. **Tags are powerful** — Use `[tag]` patterns for flexible collision/sound rules
4. **Velocity controls animation** — Just set `vx`/`vy`, GPU handles direction
5. **Test atlas for prototypes** — `createTestAtlas()` needs no image files
6. **Procedural audio** — Prefix with `$` for built-in sounds, or define in `sfx`
7. **Declarative music** — Use note arrays like `['C4', 2]` for [note, beats]
8. **null for rests** — In music, `[null, 1]` creates a 1-beat rest
9. **Use edges for rooms** — `edges` auto-generates walls/doorways; simpler than manual `exits`
10. **Sound ranges** — Use `[min, max]` for random variation: `pitch: [0.9, 1.1]`
