/**
 * GPU-driven sprite label system.
 *
 * Renders persistent text labels above sprites (names, titles, item labels).
 * Position tracked via RGBA32F texture lookup — instance buffer only updates
 * when label text changes, not per frame.
 *
 * Slot allocator manages up to 128 labeled sprites. Each label supports
 * up to 16 characters plus an optional icon. One draw call for all visible labels.
 *
 * Position texture (128×2) is shared with the HP bar system:
 * - Row 0: (anchorX, anchorY, alpha, yShift)
 * - Row 1: (hpValue, barWidth, barVisible, 0)
 */

import { compileShader } from './renderer';
import { labelVertexShader, labelFragmentShader } from './shaders/label';
import { packColorF32, type FontAtlas } from './floattext';

// Pool limits
const MAX_LABELS = 128;
const MAX_LABEL_CHARS = 18; // 16 text + 1 icon + padding
const MAX_CHARS = MAX_LABELS * MAX_LABEL_CHARS;
const FLOATS_PER_CHAR = 12;
const BYTES_PER_CHAR = FLOATS_PER_CHAR * 4;

interface LabelSlot {
  active: boolean;
  spriteId: string;
  charCount: number;
}

export interface LabelSpriteData {
  id: string;
  x: number;
  y: number;
  frameW: number;
  exists: boolean;
  labelSlot: number;
  labelVisible: string;
  labelRange: number;
  hpBarVisible: boolean;
}

export interface LabelManager {
  /** Allocate a slot for a sprite. Returns slot index or -1 if full. */
  allocSlot(spriteId: string): number;
  /** Free a slot. */
  freeSlot(slot: number): void;
  /** Set/update label text, color, and optional icon for a slot. */
  setLabel(slot: number, text: string, color: number, icon?: string, iconColor?: number): void;
  /** Update position texture with current sprite positions + visibility. */
  updatePositions(
    sprites: Map<string, LabelSpriteData>,
    cameraX: number,
    cameraY: number,
    viewportW: number,
    viewportH: number,
    hoveredSpriteId: string | null,
  ): void;
  /** Render all visible labels. */
  render(projection: Float32Array, cameraX: number, cameraY: number): void;
  /** Get the shared position texture handle (for HP bar manager). */
  getPositionTexture(): WebGLTexture;
  /** Write HP bar data to Row 1 of position texture. fillColor=0 means 'auto' (green/yellow/red). barWidth=0 means hidden. */
  setHpData(slot: number, hpValue: number, barWidth: number, visible: boolean, fillColor: number, bgColor: number): void;
  /** Set the Y shift for a slot (pushes label up when HP bar present). */
  setYShift(slot: number, shift: number): void;
}

export function createLabelManager(gl: WebGL2RenderingContext, fontAtlas: FontAtlas): LabelManager {
  const shader = compileShader(
    gl,
    labelVertexShader,
    labelFragmentShader,
    ['u_projection', 'u_cameraPos', 'u_atlasSize', 'u_posTex', 'u_fontAtlas'],
    ['a_position', 'a_labelPos', 'a_labelUV', 'a_labelStyle'],
  );

  // --- VAO setup ---
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

  // a_labelPos (location 1): vec4, stride 48, offset 0
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_CHAR, 0);
  gl.vertexAttribDivisor(1, 1);

  // a_labelUV (location 2): vec4, stride 48, offset 16
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_CHAR, 16);
  gl.vertexAttribDivisor(2, 1);

  // a_labelStyle (location 3): vec4, stride 48, offset 32
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, BYTES_PER_CHAR, 32);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  // --- Position texture (RGBA32F, 128×2) ---
  // Row 0: (anchorX, anchorY, alpha, yShift)
  // Row 1: (hpValue, barWidth, barVisible, 0)
  const posTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, posTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_LABELS, 2, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // --- Pre-allocated pools ---
  const posTexData = new Float32Array(MAX_LABELS * 2 * 4); // 128×2 RGBA
  const yShifts = new Float32Array(MAX_LABELS); // per-slot Y shift
  const instancePool = new Float32Array(MAX_CHARS * FLOATS_PER_CHAR);
  const activeBuffer = new Float32Array(MAX_CHARS * FLOATS_PER_CHAR);

  const slots: LabelSlot[] = [];
  for (let i = 0; i < MAX_LABELS; i++) {
    slots.push({ active: false, spriteId: '', charCount: 0 });
  }

  return {
    allocSlot(spriteId: string): number {
      for (let i = 0; i < MAX_LABELS; i++) {
        if (!slots[i].active) {
          slots[i].active = true;
          slots[i].spriteId = spriteId;
          slots[i].charCount = 0;
          return i;
        }
      }
      return -1; // Full
    },

    freeSlot(slot: number): void {
      if (slot < 0 || slot >= MAX_LABELS) return;
      slots[slot].active = false;
      slots[slot].charCount = 0;
      yShifts[slot] = 0;
      // Clear HP data for this slot (Row 1: hpValue, barWidth, fillColor, bgColor)
      const row1Base = MAX_LABELS * 4;
      posTexData[row1Base + slot * 4 + 1] = 0; // barWidth = 0 (hidden)
    },

    setLabel(slot: number, text: string, color: number, icon?: string, iconColor?: number): void {
      if (slot < 0 || slot >= MAX_LABELS || !slots[slot].active) return;

      const str = text.slice(0, 16); // Max 16 text characters
      const colorF = packColorF32(color);
      const scale = 0.75; // Labels slightly smaller than float text

      // Compute total width for centering
      let totalWidth = 0;
      for (const ch of str) {
        const m = fontAtlas.metrics.get(ch);
        if (m) totalWidth += m.advance * scale;
      }

      const startX = -totalWidth / 2;
      let cursorX = startX;
      const cursorY = -fontAtlas.charHeight * scale; // Above anchor point

      const baseOffset = slot * MAX_LABEL_CHARS * FLOATS_PER_CHAR;
      let charCount = 0;

      for (const ch of str) {
        const m = fontAtlas.metrics.get(ch);
        if (!m) continue;

        const off = baseOffset + charCount * FLOATS_PER_CHAR;
        const charW = m.w * scale;
        const charH = fontAtlas.charHeight * scale;

        // a_labelPos: slotIndex, charOffsetX, charOffsetY, charW
        instancePool[off + 0] = slot;
        instancePool[off + 1] = cursorX;
        instancePool[off + 2] = cursorY;
        instancePool[off + 3] = charW;

        // a_labelUV: atlasU, atlasV, atlasW, atlasH
        instancePool[off + 4] = m.x;
        instancePool[off + 5] = 0;
        instancePool[off + 6] = m.w;
        instancePool[off + 7] = fontAtlas.charHeight;

        // a_labelStyle: charH, color(packed), 0, 0
        instancePool[off + 8] = charH;
        instancePool[off + 9] = colorF;
        instancePool[off + 10] = 0;
        instancePool[off + 11] = 0;

        cursorX += m.advance * scale;
        charCount++;
      }

      // Icon character (above the text line, centered)
      if (icon) {
        const im = fontAtlas.metrics.get(icon);
        if (im) {
          const iconScale = 1.0; // Icons at full font size
          const iconW = im.w * iconScale;
          const iconH = fontAtlas.charHeight * iconScale;
          const iconX = -iconW / 2;
          const iconY = cursorY - iconH - 2; // Above label text

          const off = baseOffset + charCount * FLOATS_PER_CHAR;
          instancePool[off + 0] = slot;
          instancePool[off + 1] = iconX;
          instancePool[off + 2] = iconY;
          instancePool[off + 3] = iconW;
          instancePool[off + 4] = im.x;
          instancePool[off + 5] = 0;
          instancePool[off + 6] = im.w;
          instancePool[off + 7] = fontAtlas.charHeight;
          instancePool[off + 8] = iconH;
          instancePool[off + 9] = packColorF32(iconColor ?? 0xffff00);
          instancePool[off + 10] = 0;
          instancePool[off + 11] = 0;
          charCount++;
        }
      }

      slots[slot].charCount = charCount;
    },

    updatePositions(
      sprites: Map<string, LabelSpriteData>,
      cameraX: number,
      cameraY: number,
      viewportW: number,
      viewportH: number,
      hoveredSpriteId: string | null,
    ): void {
      for (let i = 0; i < MAX_LABELS; i++) {
        if (!slots[i].active || slots[i].charCount === 0) {
          posTexData[i * 4 + 2] = 0; // alpha = 0
          continue;
        }

        const sprite = sprites.get(slots[i].spriteId);
        if (!sprite || !sprite.exists) {
          posTexData[i * 4 + 2] = 0;
          continue;
        }

        // Anchor: center-top of sprite, slightly above
        posTexData[i * 4 + 0] = sprite.x + sprite.frameW / 2;
        posTexData[i * 4 + 1] = sprite.y - 2;

        // Visibility alpha
        let alpha = 1.0;
        if (sprite.labelVisible === 'hover') {
          alpha = sprite.id === hoveredSpriteId ? 1.0 : 0.0;
        } else if (sprite.labelVisible === 'proximity') {
          const viewCenterX = cameraX + viewportW / 2;
          const viewCenterY = cameraY + viewportH / 2;
          const dx = (sprite.x + sprite.frameW / 2) - viewCenterX;
          const dy = (sprite.y + sprite.frameW / 2) - viewCenterY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          alpha = dist < sprite.labelRange ? 1.0 : 0.0;
        }

        posTexData[i * 4 + 2] = alpha;
        posTexData[i * 4 + 3] = yShifts[i]; // Y shift for HP bar offset
      }

      // Upload full 128×2 position texture
      gl.bindTexture(gl.TEXTURE_2D, posTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_LABELS, 2, gl.RGBA, gl.FLOAT, posTexData);
    },

    render(projection: Float32Array, cameraX: number, cameraY: number): void {
      // Pack active characters into contiguous buffer
      let activeCount = 0;
      for (let i = 0; i < MAX_LABELS; i++) {
        if (!slots[i].active || slots[i].charCount === 0) continue;
        const srcOff = i * MAX_LABEL_CHARS * FLOATS_PER_CHAR;
        const dstOff = activeCount * FLOATS_PER_CHAR;
        const len = slots[i].charCount * FLOATS_PER_CHAR;
        for (let j = 0; j < len; j++) {
          activeBuffer[dstOff + j] = instancePool[srcOff + j];
        }
        activeCount += slots[i].charCount;
      }

      if (activeCount === 0) return;

      gl.bindVertexArray(vao);

      // Upload instance data (only when dirty or always — cheap enough)
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, activeBuffer, 0, activeCount * FLOATS_PER_CHAR);

      gl.useProgram(shader.program);
      gl.uniformMatrix3fv(shader.uniforms['u_projection'], false, projection);
      gl.uniform2f(shader.uniforms['u_cameraPos'], cameraX, cameraY);
      gl.uniform2f(shader.uniforms['u_atlasSize'], fontAtlas.width, fontAtlas.height);

      // Bind position texture to unit 0
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, posTex);
      gl.uniform1i(shader.uniforms['u_posTex'], 0);

      // Bind font atlas to unit 1
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fontAtlas.texture);
      gl.uniform1i(shader.uniforms['u_fontAtlas'], 1);

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, activeCount);
      gl.bindVertexArray(null);
    },

    getPositionTexture(): WebGLTexture {
      return posTex;
    },

    setHpData(slot: number, hpValue: number, barWidth: number, visible: boolean, fillColor: number, bgColor: number): void {
      if (slot < 0 || slot >= MAX_LABELS) return;
      const row1Base = MAX_LABELS * 4; // Row 1 starts after Row 0
      posTexData[row1Base + slot * 4 + 0] = hpValue;
      posTexData[row1Base + slot * 4 + 1] = visible ? barWidth : 0; // barWidth=0 means hidden
      posTexData[row1Base + slot * 4 + 2] = fillColor; // 0 = auto (green/yellow/red), else packed color
      posTexData[row1Base + slot * 4 + 3] = bgColor; // packed bg color
    },

    setYShift(slot: number, shift: number): void {
      if (slot < 0 || slot >= MAX_LABELS) return;
      yShifts[slot] = shift;
    },
  };
}
