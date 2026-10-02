/**
 * HUD for the island example, drawn on game.overlay (viewport units, sharp at any size).
 *
 * Player panel (HP, coins), area banner, rotating minimap with exits and enemies,
 * day/night clock, context prompts, a hurt vignette and a fading controls hint.
 */

import type { Glyft, Sprite } from '../../src';

const W = 960, H = 540;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MAP_R = 62;
const MAP_CX = W - 20 - MAP_R, MAP_CY = 20 + MAP_R;

interface HudOptions { coinsTotal: number }

export function createHud(game: Glyft, options: HudOptions): void {
  const world = game.world!;
  const hero = game.getTagged('player')[0] as Sprite;
  const labels = new Map(Object.entries(game.config.world?.areas ?? {}).map(([k, a]) => [k, a.label ?? k]));
  const maxHp = game.config.stats?.hp?.max ?? 100;

  let banner = { text: world.areaLabel, t: 0 };
  let lastHp = hero.hp ?? maxHp;
  let hurt = 0;
  let lastCoins = game.stats.coins ?? 0;
  let coinPop = 0;
  let elapsed = 0;
  let mapImage = drawAreaMap(game);

  world.onAreaChange((_area, label) => {
    banner = { text: label, t: 0 };
    mapImage = drawAreaMap(game);
  });

  game.onUpdate((dt) => {
    elapsed += dt;
    banner.t += dt;
    const hp = hero.hp ?? maxHp;
    if (hp < lastHp) hurt = 1;
    lastHp = hp;
    hurt = Math.max(0, hurt - dt * 1.8);
    const coins = game.stats.coins ?? 0;
    if (coins > lastCoins) coinPop = 1;
    lastCoins = coins;
    coinPop = Math.max(0, coinPop - dt * 4);

    const ctx = game.overlay;
    drawVignette(ctx, hurt);
    drawPlayerPanel(ctx, hp, maxHp, coins, options.coinsTotal, coinPop);
    drawMinimap(ctx, game, hero, mapImage);
    drawClock(ctx, world.area === 'island' ? world.time : null);
    drawBanner(ctx, banner.text, banner.t);
    drawPrompt(ctx, promptText(game, hero, labels));
    drawControls(ctx, elapsed);
  });
}

// ---- Pieces ----

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 12): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = 'rgba(14, 18, 28, 0.66)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y - s * 0.1, x - s * 0.55, y - s * 0.1, x - s * 0.55, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.55, y + s * 0.6, x, y + s * 0.75, x, y + s * 0.95);
  ctx.bezierCurveTo(x, y + s * 0.75, x + s * 0.55, y + s * 0.6, x + s * 0.55, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.55, y - s * 0.1, x, y - s * 0.1, x, y + s * 0.3);
  ctx.fillStyle = '#ff5a6a';
  ctx.fill();
}

function coinIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#d99a1f'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, Math.PI * 2); ctx.fillStyle = '#ffd23f'; ctx.fill();
  ctx.fillStyle = '#fff6c8'; ctx.fillRect(x - r * 0.3, y - r * 0.45, r * 0.22, r * 0.6);
}

function drawPlayerPanel(ctx: CanvasRenderingContext2D, hp: number, maxHp: number, coins: number, total: number, pop: number): void {
  panel(ctx, 16, 16, 236, 70);
  heart(ctx, 38, 26, 18);
  // HP bar
  const bx = 56, by = 31, bw = 180, bh = 12, frac = Math.max(0, Math.min(1, hp / maxHp));
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
  if (frac > 0) {
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, '#e8334a'); g.addColorStop(1, frac > 0.5 ? '#ff8a5c' : '#ff5a3c');
    ctx.beginPath(); ctx.roundRect(bx, by, Math.max(bh, bw * frac), bh, 6); ctx.fillStyle = g; ctx.fill();
  }
  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.ceil(hp)} / ${maxHp}`, bx + bw, by - 4);
  // Coins
  const s = 1 + pop * 0.35;
  ctx.save();
  ctx.translate(38, 66); ctx.scale(s, s);
  coinIcon(ctx, 0, 0, 9);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.font = `700 15px ${FONT}`;
  ctx.fillStyle = pop > 0 ? '#ffe680' : '#ffffff';
  ctx.fillText(`${coins}`, 56, 71);
  ctx.font = `500 13px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(`/ ${total}`, 56 + ctx.measureText(`${coins}`).width + 22, 71);
}

/** Bake the current area's terrain into a small coloured map. */
function drawAreaMap(game: Glyft): HTMLCanvasElement {
  const world = game.world!;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  // Sample the whole area: probe outward from the middle to find its extent
  const span = areaSpan(game);
  const underground = world.area !== 'island';
  const heights: number[] = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) heights.push(world.heightAt((i + 0.5) / size * span, (j + 0.5) / size * span));
  const max = Math.max(...heights), min = Math.min(...heights);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / size * span, y = (j + 0.5) / size * span;
      const h = heights[j * size + i];
      const t = (h - min) / (max - min || 1);
      let c: [number, number, number];
      if (underground) {
        c = t < 0.25 ? [120 - t * 120, 98 - t * 100, 80 - t * 80] : [26, 22, 30];
      } else if (world.isWater(x, y)) {
        c = [40 + t * 60, 92 + t * 70, 150 + t * 50];
      } else if (t < 0.24) c = [214, 196, 148];
      else if (t < 0.55) c = [92 + t * 30, 150 - t * 30, 70];
      else if (t < 0.8) c = [120, 116, 108];
      else c = [230, 234, 240];
      const k = (j * size + i) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  (canvas as HTMLCanvasElement & { span: number }).span = span;
  return canvas;
}

/** Area width in pixels (the world is square here): first point outside the terrain. */
function areaSpan(game: Glyft): number {
  const ts = game.config.settings.tileSize;
  const area = game.config.world?.areas?.[game.world!.area];
  const hm = area?.terrain?.heightmap;
  const cells = hm && typeof hm === 'object' && !Array.isArray(hm) ? hm.size ?? 128 : 128;
  return cells * (area?.terrain?.cellSize ?? 1) * ts;
}

function drawMinimap(ctx: CanvasRenderingContext2D, game: Glyft, hero: Sprite, map: HTMLCanvasElement): void {
  const world = game.world!;
  const span = (map as HTMLCanvasElement & { span: number }).span;
  const yaw = world.cameraYaw;
  const fx = -Math.sin(yaw), fy = -Math.cos(yaw);
  const rot = -Math.PI / 2 - Math.atan2(fy, fx); // camera forward points up
  const view = span * 0.42;                        // pixels of world across the map
  const k = (MAP_R * 2) / view;
  const px = hero.x + hero.width / 2, py = hero.y + hero.height / 2;
  const toMap = (x: number, y: number): [number, number] => {
    const dx = (x - px) * k, dy = (y - py) * k;
    return [MAP_CX + dx * Math.cos(rot) - dy * Math.sin(rot), MAP_CY + dx * Math.sin(rot) + dy * Math.cos(rot)];
  };

  ctx.save();
  ctx.beginPath(); ctx.arc(MAP_CX, MAP_CY, MAP_R, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = world.area === 'island' ? '#2a5c8a' : '#141018';
  ctx.fillRect(MAP_CX - MAP_R, MAP_CY - MAP_R, MAP_R * 2, MAP_R * 2);
  ctx.translate(MAP_CX, MAP_CY);
  ctx.rotate(rot);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(map, -px * k, -py * k, span * k, span * k);
  ctx.restore();

  ctx.save();
  ctx.beginPath(); ctx.arc(MAP_CX, MAP_CY, MAP_R, 0, Math.PI * 2); ctx.clip();
  const dot = (x: number, y: number, r: number, color: string) => {
    const [mx, my] = toMap(x, y);
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  };
  for (const c of game.getTagged('pickup')) dot(c.x + c.width / 2, c.y + c.height / 2, 1.8, '#ffd23f');
  for (const e of game.getTagged('enemy')) dot(e.x + e.width / 2, e.y + e.height / 2, 2.6, '#ff4d5e');
  for (const s of game.getTagged('ship')) dot(s.x + s.width / 2, s.y + s.height / 2, 3, '#ffffff');
  for (const e of world.exits) {
    const [mx, my] = toMap(e.x, e.y);
    ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#9fe8ff'; ctx.strokeStyle = '#0b2030'; ctx.lineWidth = 1.5;
    ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8);
    ctx.restore();
  }
  ctx.restore();

  // Player arrow (always pointing up: the map turns with the camera)
  ctx.beginPath();
  ctx.moveTo(MAP_CX, MAP_CY - 7); ctx.lineTo(MAP_CX + 5, MAP_CY + 5); ctx.lineTo(MAP_CX, MAP_CY + 2); ctx.lineTo(MAP_CX - 5, MAP_CY + 5);
  ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#14181f'; ctx.lineWidth = 1.5; ctx.stroke();

  // Ring and north marker
  ctx.beginPath(); ctx.arc(MAP_CX, MAP_CY, MAP_R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(MAP_CX, MAP_CY, MAP_R + 2.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(14,18,28,0.7)'; ctx.lineWidth = 2; ctx.stroke();
  const nx = MAP_CX + Math.cos(rot - Math.PI / 2) * MAP_R, ny = MAP_CY + Math.sin(rot - Math.PI / 2) * MAP_R;
  ctx.beginPath(); ctx.arc(nx, ny, 9, 0, Math.PI * 2); ctx.fillStyle = '#14181f'; ctx.fill();
  ctx.font = `800 10px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', nx, ny + 0.5);
  ctx.textBaseline = 'alphabetic';
}

function drawClock(ctx: CanvasRenderingContext2D, time: number | null): void {
  const x = MAP_CX, y = MAP_CY + MAP_R + 20;
  const text = time === null ? 'Underground' : `${String(Math.floor(time * 24)).padStart(2, '0')}:${String(Math.floor((time * 24 * 60) % 60)).padStart(2, '0')}`;
  ctx.font = `600 12px ${FONT}`;
  const w = ctx.measureText(text).width + 34;
  panel(ctx, x - w / 2, y - 12, w, 24, 12);
  const ix = x - w / 2 + 14;
  if (time === null) {
    ctx.fillStyle = '#9fe8ff'; ctx.beginPath(); ctx.moveTo(ix, y - 6); ctx.lineTo(ix + 4, y); ctx.lineTo(ix, y + 6); ctx.lineTo(ix - 4, y); ctx.fill();
  } else if (time > 0.25 && time < 0.75) {
    ctx.beginPath(); ctx.arc(ix, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffd23f'; ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(ix, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#d8def0'; ctx.fill();
    ctx.beginPath(); ctx.arc(ix + 2.5, y - 1.5, 4.2, 0, Math.PI * 2); ctx.fillStyle = 'rgb(14,18,28)'; ctx.fill();
  }
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
  ctx.fillText(text, ix + 11, y + 4);
}

function drawBanner(ctx: CanvasRenderingContext2D, text: string, t: number): void {
  if (t > 3.2) return;
  const a = t < 0.4 ? t / 0.4 : t > 2.4 ? Math.max(0, 1 - (t - 2.4) / 0.8) : 1;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `700 30px ${FONT}`;
  ctx.textAlign = 'center';
  const y = 92 - (1 - a) * 8;
  const w = ctx.measureText(text).width;
  const g = ctx.createLinearGradient(W / 2 - w, 0, W / 2 + w, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(W / 2 - w, y + 12, w * 2, 1.5);
  ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, W / 2, y);
  ctx.restore();
}

function promptText(game: Glyft, hero: Sprite, labels: Map<string, string>): [string, string] | null {
  const world = game.world!;
  if (world.riding) return ['F', 'Step off near land  ·  W/S sail  ·  A/D steer'];
  if (world.boardable) return ['F', 'Board the boat'];
  const px = hero.x + hero.width / 2, py = hero.y + hero.height / 2;
  for (const e of world.exits) {
    if (Math.hypot(e.x - px, e.y - py) < 70) return ['', `To ${labels.get(e.to) ?? e.to}`];
  }
  return null;
}

function drawPrompt(ctx: CanvasRenderingContext2D, prompt: [string, string] | null): void {
  if (!prompt) return;
  const [key, text] = prompt;
  ctx.font = `600 14px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const kw = key ? 26 : 0;
  const w = tw + kw + 28, x = W / 2 - w / 2, y = H - 64;
  panel(ctx, x, y, w, 34, 17);
  if (key) {
    ctx.beginPath(); ctx.roundRect(x + 10, y + 6, 22, 22, 6);
    ctx.fillStyle = '#f2f4f8'; ctx.fill();
    ctx.fillStyle = '#14181f'; ctx.font = `800 13px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(key, x + 21, y + 22);
  }
  ctx.font = `600 14px ${FONT}`;
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
  ctx.fillText(text, x + 14 + kw, y + 22);
}

function drawControls(ctx: CanvasRenderingContext2D, elapsed: number): void {
  if (elapsed > 12) return;
  const a = elapsed < 9 ? 1 : 1 - (elapsed - 9) / 3;
  const items: [string, string][] = [['WASD', 'move'], ['Click', 'attack'], ['Space', 'jump'], ['F', 'board'], ['Drag', 'camera']];
  ctx.save();
  ctx.globalAlpha = a * 0.9;
  ctx.font = `600 11px ${FONT}`;
  let x = 16;
  const y = H - 30;
  for (const [key, what] of items) {
    const kw = ctx.measureText(key).width + 12;
    ctx.beginPath(); ctx.roundRect(x, y - 13, kw, 19, 5);
    ctx.fillStyle = 'rgba(242,244,248,0.92)'; ctx.fill();
    ctx.fillStyle = '#14181f'; ctx.textAlign = 'left'; ctx.fillText(key, x + 6, y + 1);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4;
    ctx.fillText(what, x + kw + 5, y + 1);
    ctx.shadowBlur = 0;
    x += kw + ctx.measureText(what).width + 16;
  }
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D, hurt: number): void {
  if (hurt <= 0) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  g.addColorStop(0, 'rgba(200, 20, 30, 0)');
  g.addColorStop(1, `rgba(200, 20, 30, ${0.45 * hurt})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
