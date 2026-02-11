/**
 * HUD Addon — canvas-based heads-up display.
 *
 * Defines the visual style for stat panels, announcements, and dialogue boxes.
 * Other addons trigger the HUD — the rooms addon calls announce(), the dialogue
 * addon calls showDialogue()/hideDialogue(). Stat panels auto-update each frame.
 *
 * @example
 * ```typescript
 * import { hud } from 'glyft/addons/hud';
 *
 * game.use(hud({
 *   panels: [
 *     {
 *       position: 'top-left',
 *       level: { stat: 'xp', thresholds: [0, 50, 120], barColor: 0x44aaff },
 *       stats: [{ stat: 'hp', label: '\u2665', color: 0xff4444, max: 100 }],
 *     },
 *     {
 *       position: 'top-right',
 *       stats: [
 *         { stat: 'coins', label: '\u25cf', color: 0xffdd44 },
 *         { stat: 'keys', label: '\u25c6', color: 0x44ddff },
 *       ],
 *     },
 *   ],
 *   announcement: { fadeIn: 0.5, hold: 2.0, fadeOut: 0.5 },
 *   dialogue: { speakerColor: 0x44aa99 },
 * }));
 * ```
 *
 * @packageDocumentation
 */

import type { GlyftAddon, Glyft } from '../src/types';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Anchor position for a HUD panel */
export type HudPosition = 'top-left' | 'top-right' | 'top-center'
                        | 'bottom-left' | 'bottom-right' | 'bottom-center';

/** A stat counter to display in a HUD panel */
export interface HudStat {
  /** Key in game.stats (e.g. 'hp', 'coins') */
  stat: string;
  /** Icon character displayed before the value */
  label: string;
  /** Icon + text color as 0xRRGGBB */
  color: number;
  /** If set, display "value / max" instead of just "value" */
  max?: number;
}

/** Level/XP progression bar config */
export interface HudLevel {
  /** Stat key that accumulates XP (e.g. 'xp') */
  stat: string;
  /**
   * Cumulative XP thresholds per level.
   * Level = highest index where xp >= thresholds[index].
   * e.g. [0, 50, 120, 200] → Lv 0 at 0 XP, Lv 1 at 50, Lv 2 at 120, Lv 3 at 200
   */
  thresholds: number[];
  /** XP bar fill color as 0xRRGGBB */
  barColor: number;
  /** XP bar width in pixels (default: 50) */
  barWidth?: number;
  /** XP bar height in pixels (default: 5) */
  barHeight?: number;
  /** Bar background color as 0xRRGGBB (default: 0x222222) */
  barBgColor?: number;
}

/** A positioned HUD panel containing stats and/or a level bar */
export interface HudPanel {
  /** Screen anchor position */
  position: HudPosition;
  /** Stats to display in this panel */
  stats?: HudStat[];
  /** Level/XP bar for this panel */
  level?: HudLevel;
}

/** Announcement style config */
export interface HudAnnouncement {
  /** Fade-in duration in seconds (default: 0.5) */
  fadeIn?: number;
  /** Hold duration in seconds (default: 2.0) */
  hold?: number;
  /** Fade-out duration in seconds (default: 0.5) */
  fadeOut?: number;
  /** Text color as 0xRRGGBB (default: 0xffffff) */
  color?: number;
  /** Font size in pixels (default: 10) */
  fontSize?: number;
  /** Background strip opacity 0-1 (default: 0.5) */
  bgOpacity?: number;
}

/** Dialogue box style config */
export interface HudDialogue {
  /** Speaker name color as 0xRRGGBB (default: 0x44aa99) */
  speakerColor?: number;
  /** Text color as 0xRRGGBB (default: 0xffffff) */
  textColor?: number;
  /** Prompt color as 0xRRGGBB (default: 0x888888) */
  promptColor?: number;
  /** Background color as 0xRRGGBB (default: 0x000000) */
  bgColor?: number;
  /** Background opacity 0-1 (default: 0.85) */
  bgOpacity?: number;
  /** Border color as 0xRRGGBB (default: 0x666666) */
  borderColor?: number;
}

/** Full HUD addon configuration */
export interface HudConfig {
  /** Positioned panels. Each panel has its own position, stats, and level bar. */
  panels?: HudPanel[];
  /** Announcement style. Triggered by other addons via announce(). */
  announcement?: HudAnnouncement;
  /** Dialogue box style. Triggered by the dialogue addon via showDialogue(). */
  dialogue?: HudDialogue;
  /** Font family (default: 'monospace') */
  font?: string;
  /** Font size in pixels for stat lines (default: 8) */
  fontSize?: number;
  /** Line height in pixels (default: 10) */
  lineHeight?: number;
  /** Pixel padding from viewport edge (default: 4) */
  padding?: number;
  /** Panel background color as 0xRRGGBB (default: 0x000000) */
  panelBg?: number;
  /** Panel background opacity 0-1 (default: 0.4) */
  panelBgOpacity?: number;
  /** Text outline width in pixels (default: 2) */
  outlineWidth?: number;
  /** Text outline color as 0xRRGGBB (default: 0x000000) */
  outlineColor?: number;
}

/** HUD addon public API */
export interface HudAddon extends GlyftAddon {
  /** Show a centered announcement (called by rooms addon on room load, etc.) */
  announce(text: string, color?: number): void;
  /** Show the dialogue box (called by the dialogue addon) */
  showDialogue(speaker: string | null, text: string, lineIndex: number, lineCount: number): void;
  /** Hide the dialogue box (called by the dialogue addon) */
  hideDialogue(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r},${g},${b})`;
}

function hexToRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

function getLevelFromXp(xp: number, thresholds: number[]): { level: number; xpInLevel: number; xpForLevel: number } {
  let level = 0;
  for (let i = 1; i < thresholds.length; i++) {
    if (xp >= thresholds[i]) {
      level = i;
    } else {
      break;
    }
  }
  const currentThreshold = thresholds[level] ?? 0;
  const nextThreshold = thresholds[level + 1] ?? currentThreshold + 100;
  return {
    level,
    xpInLevel: xp - currentThreshold,
    xpForLevel: nextThreshold - currentThreshold,
  };
}

/** Word-wrap text to fit within a given pixel width */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

/** Draw text with outline */
function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fillColor: string,
  outlineColor: string,
  outlineWidth: number,
): void {
  if (outlineWidth > 0) {
    ctx.lineWidth = outlineWidth;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outlineColor;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function hud(config: HudConfig = {}): HudAddon {
  let game: Glyft;
  const panels = config.panels ?? [];
  const font = config.font ?? 'monospace';
  const fontSize = config.fontSize ?? 8;
  const lineHeight = config.lineHeight ?? 10;
  const edgePadding = config.padding ?? 4;
  const panelBg = config.panelBg ?? 0x000000;
  const panelBgOpacity = config.panelBgOpacity ?? 0.4;
  const outlineWidth = config.outlineWidth ?? 2;
  const outlineColorStr = hexToRgb(config.outlineColor ?? 0x000000);
  const panelPad = 3;

  // Announcement style
  const annConf = config.announcement ?? {};
  const annFadeIn = annConf.fadeIn ?? 0.5;
  const annHold = annConf.hold ?? 2.0;
  const annFadeOut = annConf.fadeOut ?? 0.5;
  const annColor = annConf.color ?? 0xffffff;
  const annFontSize = annConf.fontSize ?? 10;
  const annBgOpacity = annConf.bgOpacity ?? 0.5;
  const annTotalDuration = annFadeIn + annHold + annFadeOut;

  // Announcement state (set by announce())
  let announceText: string | null = null;
  let announceStartTime = 0;
  let announceColor = annColor; // Per-announcement color override

  // Dialogue style
  const dlgConf = config.dialogue ?? {};
  const dlgSpeakerColor = hexToRgb(dlgConf.speakerColor ?? 0x44aa99);
  const dlgTextColor = hexToRgb(dlgConf.textColor ?? 0xffffff);
  const dlgPromptColor = hexToRgb(dlgConf.promptColor ?? 0x888888);
  const dlgBg = dlgConf.bgColor ?? 0x000000;
  const dlgBgOpacity = dlgConf.bgOpacity ?? 0.85;
  const dlgBorderColor = hexToRgb(dlgConf.borderColor ?? 0x666666);

  // Dialogue state (set by showDialogue/hideDialogue)
  let dlgActive = false;
  let dlgSpeaker: string | null = null;
  let dlgText = '';
  let dlgLineIndex = 0;
  let dlgLineCount = 0;

  function drawPanel(ctx: CanvasRenderingContext2D, vw: number, vh: number, panel: HudPanel): void {
    const pStats = panel.stats ?? [];
    const pLevel = panel.level ?? null;
    if (pStats.length === 0 && !pLevel) return;

    ctx.save();
    ctx.font = `${fontSize}px ${font}`;
    ctx.textBaseline = 'top';
    ctx.imageSmoothingEnabled = false;

    // Calculate panel dimensions
    let panelLines = 0;
    let panelWidth = 0;

    if (pLevel) {
      panelLines += 2;
      const barW = pLevel.barWidth ?? 50;
      const xp = game.stats[pLevel.stat] ?? 0;
      const { level: lvl } = getLevelFromXp(xp, pLevel.thresholds);
      panelWidth = Math.max(panelWidth, ctx.measureText(`Lv ${lvl}`).width, barW);
    }

    for (const s of pStats) {
      panelLines += 1;
      const val = game.stats[s.stat] ?? 0;
      const text = s.max != null ? `${s.label} ${Math.floor(val)}/${s.max}` : `${s.label} ${Math.floor(val)}`;
      panelWidth = Math.max(panelWidth, ctx.measureText(text).width);
    }

    const panelHeight = panelLines * lineHeight + panelPad * 2;
    panelWidth += panelPad * 2 + outlineWidth;

    // Compute anchor position
    const pos = panel.position;
    let px: number, py: number;
    if (pos.includes('left')) {
      px = edgePadding;
    } else if (pos.includes('right')) {
      px = vw - panelWidth - edgePadding;
    } else {
      px = (vw - panelWidth) / 2;
    }
    if (pos.includes('top')) {
      py = edgePadding;
    } else {
      py = vh - panelHeight - edgePadding;
    }

    // Draw background
    ctx.fillStyle = hexToRgba(panelBg, panelBgOpacity);
    ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(panelWidth), Math.ceil(panelHeight));

    // Draw content
    let cursorY = py + panelPad;
    const textX = px + panelPad;

    // Level display
    if (pLevel) {
      const xp = game.stats[pLevel.stat] ?? 0;
      const { level: lvl, xpInLevel, xpForLevel } = getLevelFromXp(xp, pLevel.thresholds);

      outlinedText(ctx, `Lv ${lvl}`, textX, cursorY, hexToRgb(pLevel.barColor), outlineColorStr, outlineWidth);
      cursorY += lineHeight;

      // XP bar
      const barW = pLevel.barWidth ?? 50;
      const barH = pLevel.barHeight ?? 5;
      const barX = textX;
      const barY = Math.floor(cursorY + (lineHeight - barH) / 2);
      const fill = xpForLevel > 0 ? Math.min(xpInLevel / xpForLevel, 1) : 1;

      ctx.fillStyle = hexToRgb(pLevel.barBgColor ?? 0x222222);
      ctx.fillRect(Math.floor(barX), barY, barW, barH);

      ctx.fillStyle = hexToRgb(pLevel.barColor);
      ctx.fillRect(Math.floor(barX), barY, Math.floor(barW * fill), barH);

      cursorY += lineHeight;
    }

    // Stats
    for (const s of pStats) {
      const val = game.stats[s.stat] ?? 0;
      const text = s.max != null ? `${s.label} ${Math.floor(val)}/${s.max}` : `${s.label} ${Math.floor(val)}`;
      outlinedText(ctx, text, textX, cursorY, hexToRgb(s.color), outlineColorStr, outlineWidth);
      cursorY += lineHeight;
    }

    ctx.restore();
  }

  function drawAnnouncement(ctx: CanvasRenderingContext2D, vw: number, vh: number, time: number): void {
    if (!announceText) return;

    const elapsed = time - announceStartTime;
    if (elapsed >= annTotalDuration) {
      announceText = null;
      return;
    }

    let alpha: number;
    if (elapsed < annFadeIn) {
      alpha = elapsed / annFadeIn;
    } else if (elapsed < annFadeIn + annHold) {
      alpha = 1;
    } else {
      alpha = 1 - (elapsed - annFadeIn - annHold) / annFadeOut;
    }
    alpha = Math.max(0, Math.min(1, alpha));

    ctx.save();

    const stripY = Math.floor(vh * 0.35);
    const stripH = annFontSize + 12;
    ctx.fillStyle = `rgba(0,0,0,${(annBgOpacity * alpha).toFixed(2)})`;
    ctx.fillRect(0, stripY, vw, stripH);

    ctx.font = `bold ${annFontSize}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tx = Math.floor(vw / 2);
    const ty = stripY + Math.floor(stripH / 2);
    outlinedText(ctx, announceText, tx, ty, hexToRgba(announceColor, alpha), `rgba(0,0,0,${alpha.toFixed(2)})`, outlineWidth);

    ctx.restore();
  }

  function drawDialogue(ctx: CanvasRenderingContext2D, vw: number, vh: number): void {
    if (!dlgActive) return;

    ctx.save();

    const boxPad = 6;
    const boxMargin = 8;
    const boxW = vw - boxMargin * 2;
    const textMaxWidth = boxW - boxPad * 2;

    // Set font before measuring text for wrapping
    ctx.font = `${fontSize}px ${font}`;

    // Word-wrap the dialogue text
    const wrappedLines = wrapText(ctx, dlgText, textMaxWidth);

    const speakerH = dlgSpeaker ? lineHeight : 0;
    const textH = lineHeight * wrappedLines.length;
    const promptH = lineHeight;
    const boxH = boxPad * 2 + speakerH + textH + promptH;
    const boxX = boxMargin;
    const boxY = vh - boxMargin - boxH;

    // Background
    ctx.fillStyle = hexToRgba(dlgBg, dlgBgOpacity);
    ctx.fillRect(boxX, boxY, boxW, boxH);

    // Border
    ctx.strokeStyle = dlgBorderColor;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'miter';
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    let cursorY = boxY + boxPad;

    // Speaker name
    if (dlgSpeaker) {
      ctx.font = `bold ${fontSize}px ${font}`;
      outlinedText(ctx, dlgSpeaker, boxX + boxPad, cursorY, dlgSpeakerColor, outlineColorStr, outlineWidth);
      cursorY += lineHeight;
      ctx.font = `${fontSize}px ${font}`;
    }

    // Dialogue text (wrapped)
    for (const line of wrappedLines) {
      outlinedText(ctx, line, boxX + boxPad, cursorY, dlgTextColor, outlineColorStr, outlineWidth);
      cursorY += lineHeight;
    }

    // Prompt
    const promptText = `[SPACE] ${dlgLineIndex + 1}/${dlgLineCount}`;
    ctx.textAlign = 'right';
    outlinedText(ctx, promptText, boxX + boxW - boxPad, cursorY, dlgPromptColor, outlineColorStr, outlineWidth);

    ctx.restore();
  }

  return {
    name: 'hud',

    init(g: Glyft) {
      game = g;
    },

    postPhysics(_dt: number) {
      const ctx = game.overlay;
      const vw = game.config.settings.viewport[0];
      const vh = game.config.settings.viewport[1];

      for (const panel of panels) {
        drawPanel(ctx, vw, vh, panel);
      }
      drawAnnouncement(ctx, vw, vh, game.time);
      drawDialogue(ctx, vw, vh);
    },

    announce(text: string, color?: number) {
      announceText = text;
      announceStartTime = game.time;
      announceColor = color ?? annColor;
    },

    showDialogue(speaker: string | null, text: string, lineIndex: number, lineCount: number) {
      dlgActive = true;
      dlgSpeaker = speaker;
      dlgText = text;
      dlgLineIndex = lineIndex;
      dlgLineCount = lineCount;
    },

    hideDialogue() {
      dlgActive = false;
    },

    destroy() {
      announceText = null;
      dlgActive = false;
    },
  };
}
