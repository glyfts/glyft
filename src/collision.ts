/**
 * Collision Detection and Response System
 *
 * Pattern-based collision rules with built-in actions.
 */

import type { CollisionAction, Sprite } from './types';

export interface CollisionPair {
  a: string; // sprite id
  b: string; // sprite id
  pattern: string;
}

export interface CollisionSystem {
  /** Check all sprite collisions this frame */
  update(
    sprites: Map<string, SpriteData>,
    time: number,
    onCollision: (a: string, b: string, pattern: string, action: CollisionAction | string) => void
  ): void;
}

export interface SpriteData {
  id: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tags: string[];
  exists: boolean;
  width: number;
  height: number;
}

interface ParsedRule {
  pattern: string;
  patternA: string;
  patternB: string;
  action: CollisionAction | string;
  specificity: number;
}

/**
 * Create collision system.
 */
export function createCollisionSystem(
  rules: Map<string, CollisionAction | string>
): CollisionSystem {
  // Parse rules for faster matching
  const parsedRules: ParsedRule[] = [];

  for (const [pattern, action] of rules.entries()) {
    const parts = pattern.split(':');
    if (parts.length !== 2) continue; // Invalid pattern

    parsedRules.push({
      pattern,
      patternA: parts[0],
      patternB: parts[1],
      action,
      specificity: patternSpecificity(pattern),
    });
  }

  // Sort by specificity (most specific first)
  parsedRules.sort((a, b) => b.specificity - a.specificity);

  // Track cooldowns per sprite pair
  const cooldowns = new Map<string, number>();

  return {
    update(sprites, time, onCollision) {
      const spriteList = Array.from(sprites.values()).filter(s => s.exists);

      // O(n²) collision check - can optimize with spatial partitioning later
      for (let i = 0; i < spriteList.length; i++) {
        for (let j = i + 1; j < spriteList.length; j++) {
          const a = spriteList[i];
          const b = spriteList[j];

          // AABB collision check
          if (!aabbOverlap(a, b)) continue;

          // Find matching rule
          const match = findMatchingRule(parsedRules, a, b);
          if (!match) continue;

          const { rule, swapped } = match;

          // Check cooldown
          const cooldownKey = `${a.id}:${b.id}:${rule.pattern}`;
          const lastCollision = cooldowns.get(cooldownKey) ?? 0;
          const cooldown = typeof rule.action === 'object' ? (rule.action.cooldown ?? 0) : 0;

          if (time - lastCollision < cooldown) continue;

          // Trigger collision - ensure sprites are in pattern order (A matches patternA)
          cooldowns.set(cooldownKey, time);
          if (swapped) {
            onCollision(b.id, a.id, rule.pattern, rule.action);
          } else {
            onCollision(a.id, b.id, rule.pattern, rule.action);
          }
        }
      }
    },
  };
}

function aabbOverlap(a: SpriteData, b: SpriteData): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

interface MatchResult {
  rule: ParsedRule;
  swapped: boolean; // true if B:A matched instead of A:B
}

function findMatchingRule(
  rules: ParsedRule[],
  a: SpriteData,
  b: SpriteData
): MatchResult | null {
  for (const rule of rules) {
    // Check A:B
    if (matchesSprite(rule.patternA, a) && matchesSprite(rule.patternB, b)) {
      return { rule, swapped: false };
    }
    // Check B:A (symmetric)
    if (matchesSprite(rule.patternA, b) && matchesSprite(rule.patternB, a)) {
      return { rule, swapped: true };
    }
  }
  return null;
}

function matchesSprite(pattern: string, sprite: SpriteData): boolean {
  // Tag pattern: [tag] or [tag1,tag2]
  if (pattern.startsWith('[') && pattern.endsWith(']')) {
    const tagList = pattern.slice(1, -1).split(',');
    return tagList.every((tag) => sprite.tags.includes(tag.trim()));
  }

  // Wildcard: name*
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return sprite.type.startsWith(prefix);
  }

  // Exact match
  return sprite.type === pattern;
}

function patternSpecificity(pattern: string): number {
  let score = 0;

  // Exact names are most specific
  if (!pattern.includes('[') && !pattern.includes('*')) {
    score += 100;
  }

  // Multiple tags are more specific than single
  const tagMatches = pattern.match(/\[([^\]]+)\]/g);
  if (tagMatches) {
    for (const match of tagMatches) {
      const tags = match.slice(1, -1).split(',');
      score += tags.length * 10;
    }
  }

  // Wildcards are less specific
  if (pattern.includes('*')) {
    score -= 50;
  }

  return score;
}

/**
 * Apply collision action to sprites.
 */
export function applyCollisionAction(
  action: CollisionAction,
  target: Sprite,
  source: Sprite,
  game: {
    stats: Record<string, number>;
    sounds: { play: (sound: string, options?: { x?: number }) => void };
  }
): void {
  // Damage
  if (action.damage !== undefined && target.hp !== undefined) {
    target.hp = Math.max(0, target.hp - action.damage);
  }

  // Heal
  if (action.heal !== undefined && target.hp !== undefined) {
    target.hp += action.heal;
    // Clamp to max if we had access to it
  }

  // Knockback
  if (action.knockback !== undefined) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = action.knockback;

    // Apply velocity impulse
    target.vx += (dx / dist) * force;
    target.vy += (dy / dist) * force;
  }

  // Flash (handled by renderer - set a flash timer on sprite)
  if (action.flash !== undefined) {
    target.data._flashUntil = Date.now() + action.flash * 1000;
    target.data._flashColor = 0xff0000;
  }

  // Collect
  if (action.collect !== undefined) {
    const stat = action.collect;
    if (game.stats[stat] !== undefined) {
      game.stats[stat] += 1;
    }
  }

  // Destroy
  if (action.destroy) {
    if (action.animation) {
      target.playOverride(action.animation, {
        loop: false,
        onComplete: () => target.destroy(),
      });
    } else {
      target.destroy();
    }
  }
}
