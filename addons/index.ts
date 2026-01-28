/**
 * Glyft Addons
 *
 * Opt-in modules that extend the engine with common game systems.
 * Each addon is self-contained and tree-shakeable.
 *
 * @example
 * ```typescript
 * import { projectiles, ai, death, rooms, dialogue } from 'glyft/addons';
 *
 * game.use(projectiles({ types: { bolt: { speed: 200 } } }));
 * game.use(ai({ behaviors: { chaser: { type: 'chase', speed: 30 } } }));
 * ```
 *
 * @packageDocumentation
 */

export { projectiles } from './projectiles';
export type { ProjectileAddon, ProjectileConfig, ProjectileTypeDef } from './projectiles';

export { ai } from './ai';
export type { AIAddon, AIConfig, AIBehavior } from './ai';

export { death } from './death';
export type { DeathAddon, DeathAddonConfig, DeathRule, PlayerRespawn } from './death';

export { rooms } from './rooms';
export type { RoomAddon, RoomConfig, RoomDef, SpawnDef, ExitDef } from './rooms';

export { dialogue } from './dialogue';
export type { DialogueAddon, DialogueAddonConfig, DialogueDef } from './dialogue';

export { hud } from './hud';
export type { HudAddon, HudConfig, HudStat, HudLevel, HudPanel, HudPosition, HudAnnouncement, HudDialogue } from './hud';
