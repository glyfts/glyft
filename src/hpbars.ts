/**
 * GPU-driven HP bar system.
 *
 * Renders health bars above sprites using instanced quads. Each bar is a
 * single quad — the fragment shader draws background + fill based on HP %.
 *
 * Shares the 128-slot position texture with the label system:
 * - Row 0: sprite position + alpha (written by LabelManager)
 * - Row 1: HP value + bar width + visibility (written by LabelManager.setHpData)
 *
 * One draw call for all visible bars.
 */

import { compileShader } from './renderer';
import { hpBarVertexShader, hpBarFragmentShader } from './shaders/hpbar';

const MAX_BARS = 128;
const BAR_HEIGHT = 4.0;

export interface HpBarManager {
  /** Rebuild the active slot index buffer from current slot states. */
  updateActiveSlots(activeSlots: number[]): void;
  /** Render all visible HP bars. */
  render(projection: Float32Array, cameraX: number, cameraY: number): void;
}

export function createHpBarManager(gl: WebGL2RenderingContext, posTex: WebGLTexture): HpBarManager {
  const shader = compileShader(
    gl,
    hpBarVertexShader,
    hpBarFragmentShader,
    ['u_projection', 'u_cameraPos', 'u_posTex', 'u_barHeight'],
    ['a_position', 'a_slot'],
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

  // Slot index buffer (per-instance, location 1)
  const slotBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, slotBuf);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_BARS * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  gl.bindVertexArray(null);

  // Pre-allocated slot index array
  const slotIndices = new Float32Array(MAX_BARS);
  let activeCount = 0;

  return {
    updateActiveSlots(activeSlots: number[]): void {
      activeCount = Math.min(activeSlots.length, MAX_BARS);
      for (let i = 0; i < activeCount; i++) {
        slotIndices[i] = activeSlots[i];
      }
    },

    render(projection: Float32Array, cameraX: number, cameraY: number): void {
      if (activeCount === 0) return;

      gl.bindVertexArray(vao);

      // Upload slot indices
      gl.bindBuffer(gl.ARRAY_BUFFER, slotBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, slotIndices, 0, activeCount);

      gl.useProgram(shader.program);
      gl.uniformMatrix3fv(shader.uniforms['u_projection'], false, projection);
      gl.uniform2f(shader.uniforms['u_cameraPos'], cameraX, cameraY);
      gl.uniform1f(shader.uniforms['u_barHeight'], BAR_HEIGHT);

      // Bind shared position texture to unit 0
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, posTex);
      gl.uniform1i(shader.uniforms['u_posTex'], 0);

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, activeCount);
      gl.bindVertexArray(null);
    },
  };
}
