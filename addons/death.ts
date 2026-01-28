/**
 * Death & Respawn Addon
 *
 * Monitors tracked sprites for HP <= 0, applies death effects (particles, float text,
 * rewards), and handles player respawn with stat resets.
 *
 * @example
 * ```typescript
 * import { death } from 'glyft/addons/death';
 *
 * game.use(death({
 *   rules: {
 *     enemy: { particles: 'death_burst', xpReward: 10, coinReward: 2 },
 *   },
 *   playerRespawn: {
 *     hp: 100,
 *     resetStats: ['coins', 'keys'],
 *     particles: 'death_burst',
 *     floatText: 'YOU DIED',
 *   },
 * }));
 *
 * const deathSys = game.addon<DeathAddon>('death')!;
 * deathSys.trackPlayer(player);
 * deathSys.track(enemy, 'enemy');
 * ```
 *
 * @packageDocumentation
 */

import type { GlyftAddon, Glyft, Sprite } from '../src/types';

/** Death rule for a category of sprites */
export interface DeathRule {
  /** Particle emitter to fire at death location */
  particles?: string;
  /** Float text to show */
  floatText?: string;
  /** Float text color (default: 0xaa88ff) */
  floatTextColor?: number;
  /** XP reward added to game.stats.xp */
  xpReward?: number;
  /** Coin reward added to game.stats.coins */
  coinReward?: number;
  /** Custom callback on death */
  onDeath?: (sprite: Sprite) => void;
}

/** Player respawn configuration */
export interface PlayerRespawn {
  /** HP to restore on respawn (default: stat max or 100) */
  hp?: number;
  /** Stat names to reset to 0 */
  resetStats?: string[];
  /** Particle emitter on death */
  particles?: string;
  /** Float text on death */
  floatText?: string;
  /** Float text color (default: 0xff0000) */
  floatTextColor?: number;
  /** Float text style (default: 'pop') */
  floatTextStyle?: 'rise' | 'pop';
  /** Custom callback on death (e.g., room change) */
  onDeath?: () => void;
}

/** Death addon configuration */
export interface DeathAddonConfig {
  /** Named death rules for sprite categories */
  rules?: Record<string, DeathRule>;
  /** Player respawn config */
  playerRespawn?: PlayerRespawn;
}

interface TrackedEntity {
  sprite: Sprite;
  rule: string;
}

/** Death addon public API */
export interface DeathAddon extends GlyftAddon {
  /** Register a sprite for death monitoring */
  track(sprite: Sprite, rule: string): void;
  /** Register the player sprite for respawn */
  trackPlayer(sprite: Sprite): void;
  /** Stop monitoring a sprite */
  untrack(sprite: Sprite): void;
}

/**
 * Create the death addon.
 */
export function death(config: DeathAddonConfig): DeathAddon {
  let game: Glyft;
  const rules = new Map<string, DeathRule>();
  const tracked: TrackedEntity[] = [];
  let playerSprite: Sprite | null = null;

  return {
    name: 'death',

    init(g: Glyft) {
      game = g;
      if (config.rules) {
        for (const [name, rule] of Object.entries(config.rules)) {
          rules.set(name, rule);
        }
      }
    },

    postPhysics(_dt: number) {
      // Check tracked entities (enemies, etc.)
      for (let i = tracked.length - 1; i >= 0; i--) {
        const t = tracked[i];
        if (!t.sprite.exists) {
          tracked.splice(i, 1);
          continue;
        }

        if (t.sprite.hp !== undefined && t.sprite.hp <= 0) {
          const rule = rules.get(t.rule);
          if (rule) {
            const cx = t.sprite.x + t.sprite.width / 2;
            const cy = t.sprite.y;

            if (rule.particles) {
              game.particles.emit(rule.particles, cx, cy);
            }
            if (rule.floatText) {
              game.floatText(cx, cy, rule.floatText, {
                color: rule.floatTextColor ?? 0xaa88ff,
                style: 'rise',
                duration: 1.2,
                scale: 0.5,
              });
            }
            if (rule.xpReward) {
              game.stats.xp = (game.stats.xp ?? 0) + rule.xpReward;
            }
            if (rule.coinReward) {
              game.stats.coins = (game.stats.coins ?? 0) + rule.coinReward;
            }
            if (rule.onDeath) {
              rule.onDeath(t.sprite);
            }
          }
          t.sprite.destroy();
          tracked.splice(i, 1);
        }
      }

      // Check player death
      if (playerSprite && playerSprite.exists && config.playerRespawn) {
        const hp = playerSprite.hp ?? 100;
        if (hp <= 0) {
          const respawn = config.playerRespawn;
          const cx = playerSprite.x + playerSprite.width / 2;
          const cy = playerSprite.y;

          if (respawn.particles) {
            game.particles.emit(respawn.particles, cx, cy);
          }
          if (respawn.floatText) {
            game.floatText(cx, cy, respawn.floatText, {
              color: respawn.floatTextColor ?? 0xff0000,
              style: respawn.floatTextStyle ?? 'pop',
              duration: 1.5,
              scale: 0.6,
            });
          }

          // Reset HP
          playerSprite.hp = respawn.hp ?? 100;

          // Reset stats
          if (respawn.resetStats) {
            for (const stat of respawn.resetStats) {
              game.stats[stat] = 0;
            }
          }

          // Custom handler (e.g., room change)
          if (respawn.onDeath) {
            respawn.onDeath();
          }
        }
      }
    },

    track(sprite: Sprite, rule: string) {
      tracked.push({ sprite, rule });
    },

    trackPlayer(sprite: Sprite) {
      playerSprite = sprite;
    },

    untrack(sprite: Sprite) {
      const idx = tracked.findIndex(t => t.sprite.id === sprite.id);
      if (idx !== -1) tracked.splice(idx, 1);
      if (playerSprite && playerSprite.id === sprite.id) {
        playerSprite = null;
      }
    },

    destroy() {
      tracked.length = 0;
      playerSprite = null;
    },
  };
}
