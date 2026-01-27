/**
 * GPU-driven floating text system.
 *
 * Renders damage numbers, info text (+XP, +coins) using per-character
 * instanced quads. One draw call for all active text. Zero draw calls when idle.
 *
 * Font atlas generated at init (canvas → WebGL texture, white fill + black outline).
 * Particle pool with ring-buffer recycling. No per-frame allocations.
 */

import { compileShader } from './renderer';
import { textVertexShader, textFragmentShader } from './shaders/text';
import type { FloatTextOptions } from './types';

// Pool limits
const MAX_TEXTS = 64;
const MAX_CHARS_PER_TEXT = 16;
const MAX_CHARS = MAX_TEXTS * MAX_CHARS_PER_TEXT;
const FLOATS_PER_CHAR = 12;
const BYTES_PER_CHAR = FLOATS_PER_CHAR * 4;

// Font atlas
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-.,!?%: /';
const FONT_SIZE = 16;
const CHAR_PADDING = 2;

// Bit-cast buffer (uint32 ↔ float32)
const _packBuf = new ArrayBuffer(4);
const _packU32 = new Uint32Array(_packBuf);
const _packF32 = new Float32Array(_packBuf);

export function packColorF32(rgb: number): number {
  _packU32[0] = rgb & 0xFFFFFF;
  return _packF32[0];
}

function packFlagsF32(riseSpeed: number, isPop: boolean): number {
  const speedU16 = Math.min(0xFFFF, Math.round(riseSpeed / 0.1));
  _packU32[0] = (speedU16 & 0xFFFF) | (isPop ? 0x10000 : 0);
  return _packF32[0];
}

function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
}

export interface CharMetric {
  x: number;
  w: number;
  advance: number;
}

export interface FontAtlas {
  texture: WebGLTexture;
  width: number;
  height: number;
  metrics: Map<string, CharMetric>;
  charHeight: number;
}

interface TextParticle {
  active: boolean;
  birthTime: number;
  duration: number;
  charCount: number;
  slot: number;
}

export interface FloatTextManager {
  spawn(x: number, y: number, text: string, time: number, options?: FloatTextOptions): void;
  update(time: number): void;
  render(projection: Float32Array, time: number, cameraX: number, cameraY: number): void;
}

export function generateFontAtlas(gl: WebGL2RenderingContext): FontAtlas {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  const font = `bold ${FONT_SIZE}px monospace`;
  ctx.font = font;

  // Measure all characters
  const metrics = new Map<string, CharMetric>();
  let totalWidth = CHAR_PADDING;

  for (const ch of CHARSET) {
    const m = ctx.measureText(ch);
    const w = Math.ceil(m.width);
    metrics.set(ch, { x: totalWidth, w, advance: w + 1 });
    totalWidth += w + CHAR_PADDING;
  }

  const charHeight = FONT_SIZE + 4;
  const atlasW = nextPow2(totalWidth);
  const atlasH = nextPow2(charHeight + 4);

  canvas.width = atlasW;
  canvas.height = atlasH;

  // Re-set font (canvas resize resets context)
  ctx.font = font;
  ctx.textBaseline = 'top';

  // Black outline first
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  for (const ch of CHARSET) {
    const m = metrics.get(ch)!;
    ctx.strokeText(ch, m.x, 2);
  }

  // White fill on top
  ctx.fillStyle = '#fff';
  for (const ch of CHARSET) {
    const m = metrics.get(ch)!;
    ctx.fillText(ch, m.x, 2);
  }

  // Upload to WebGL
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return { texture, width: atlasW, height: atlasH, metrics, charHeight };
}

export function createFloatTextManager(gl: WebGL2RenderingContext, sharedAtlas?: FontAtlas): FloatTextManager {
  const atlas = sharedAtlas ?? generateFontAtlas(gl);

  const shader = compileShader(
    gl,
    textVertexShader,
    textFragmentShader,
    ['u_projection', 'u_time', 'u_cameraPos', 'u_atlasSize', 'u_fontAtlas'],
    ['a_position', 'a_textPos', 'a_textUV', 'a_textAnim'],
  );

  // VAO
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // Quad buffer (per-vertex, location 0)
  const quadVerts = new Float32Array([
    0, 0, 1, 0, 0, 1,
    1, 0, 1, 1, 0, 1,
  ]);
  const quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Instance buffer (per-instance, locations 1-3)
  const instBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_CHARS * BYTES_PER_CHAR, gl.DYNAMIC_DRAW);

  // a_textPos (location 1): vec4, stride 48, offset 0
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_CHAR, 0);
  gl.vertexAttribDivisor(1, 1);

  // a_textUV (location 2): vec4, stride 48, offset 16
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_CHAR, 16);
  gl.vertexAttribDivisor(2, 1);

  // a_textAnim (location 3): vec4, stride 48, offset 32
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, BYTES_PER_CHAR, 32);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  // Pre-allocated pools
  const instancePool = new Float32Array(MAX_CHARS * FLOATS_PER_CHAR);
  const activeBuffer = new Float32Array(MAX_CHARS * FLOATS_PER_CHAR);
  const particles: TextParticle[] = [];
  for (let i = 0; i < MAX_TEXTS; i++) {
    particles.push({ active: false, birthTime: 0, duration: 0, charCount: 0, slot: i });
  }
  let nextSlot = 0;

  return {
    spawn(x: number, y: number, text: string, time: number, options?: FloatTextOptions) {
      // Find inactive slot or recycle oldest
      let particle: TextParticle | null = null;
      for (let i = 0; i < MAX_TEXTS; i++) {
        const idx = (nextSlot + i) % MAX_TEXTS;
        if (!particles[idx].active) {
          particle = particles[idx];
          nextSlot = (idx + 1) % MAX_TEXTS;
          break;
        }
      }
      if (!particle) {
        particle = particles[nextSlot];
        particle.active = false;
        nextSlot = (nextSlot + 1) % MAX_TEXTS;
      }

      const color = options?.color ?? 0xffffff;
      const style = options?.style ?? 'rise';
      const duration = options?.duration ?? 1.0;
      const speed = options?.speed ?? 30;
      const scale = options?.scale ?? 1;

      const colorF = packColorF32(color);
      const flagsF = packFlagsF32(speed, style === 'pop');

      const str = text.slice(0, MAX_CHARS_PER_TEXT);

      // Compute total width for centering
      let totalWidth = 0;
      for (const ch of str) {
        const m = atlas.metrics.get(ch);
        if (m) totalWidth += m.advance * scale;
      }

      let cursorX = x - totalWidth / 2;
      const cursorY = y - atlas.charHeight * scale / 2;

      // Small random X jitter for pop style
      if (style === 'pop') {
        cursorX += (Math.random() - 0.5) * 6;
      }

      const baseOffset = particle.slot * MAX_CHARS_PER_TEXT * FLOATS_PER_CHAR;
      let charCount = 0;

      for (const ch of str) {
        const m = atlas.metrics.get(ch);
        if (!m) continue;

        const off = baseOffset + charCount * FLOATS_PER_CHAR;

        // a_textPos: worldX, worldY, charW, charH
        instancePool[off + 0] = cursorX;
        instancePool[off + 1] = cursorY;
        instancePool[off + 2] = m.w * scale;
        instancePool[off + 3] = atlas.charHeight * scale;

        // a_textUV: u, v, w, h (pixel coords in atlas)
        instancePool[off + 4] = m.x;
        instancePool[off + 5] = 0;
        instancePool[off + 6] = m.w;
        instancePool[off + 7] = atlas.charHeight;

        // a_textAnim: color, birthTime, duration, flags
        instancePool[off + 8] = colorF;
        instancePool[off + 9] = time;
        instancePool[off + 10] = duration;
        instancePool[off + 11] = flagsF;

        cursorX += m.advance * scale;
        charCount++;
      }

      particle.active = true;
      particle.birthTime = time;
      particle.duration = duration;
      particle.charCount = charCount;
    },

    update(time: number) {
      for (const p of particles) {
        if (p.active && time - p.birthTime > p.duration) {
          p.active = false;
        }
      }
    },

    render(projection: Float32Array, time: number, cameraX: number, cameraY: number) {
      // Pack active characters into contiguous buffer
      let activeCount = 0;
      for (const p of particles) {
        if (!p.active) continue;
        const srcOff = p.slot * MAX_CHARS_PER_TEXT * FLOATS_PER_CHAR;
        const dstOff = activeCount * FLOATS_PER_CHAR;
        const len = p.charCount * FLOATS_PER_CHAR;
        for (let i = 0; i < len; i++) {
          activeBuffer[dstOff + i] = instancePool[srcOff + i];
        }
        activeCount += p.charCount;
      }

      if (activeCount === 0) return;

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, activeBuffer, 0, activeCount * FLOATS_PER_CHAR);

      gl.useProgram(shader.program);
      gl.uniformMatrix3fv(shader.uniforms['u_projection'], false, projection);
      gl.uniform1f(shader.uniforms['u_time'], time);
      gl.uniform2f(shader.uniforms['u_cameraPos'], cameraX, cameraY);
      gl.uniform2f(shader.uniforms['u_atlasSize'], atlas.width, atlas.height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
      gl.uniform1i(shader.uniforms['u_fontAtlas'], 0);

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, activeCount);
      gl.bindVertexArray(null);
    },
  };
}
