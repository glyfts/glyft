/**
 * HP bar shaders for GPU-driven health bars above sprites.
 *
 * Single instanced quad per bar. Fragment shader draws background + fill
 * based on HP percentage. No texture sampling needed.
 *
 * Per-instance data: a_slot (float) — slot index into shared position texture.
 *
 * Position texture (RGBA32F, 128×2, shared with labels):
 * - Row 0: anchorX, anchorY, alpha, yShift
 * - Row 1: hpValue, barWidth (0=hidden), fillColor (packed, 0=auto), bgColor (packed)
 */

export const hpBarVertexShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

// Per-vertex (quad geometry)
layout(location = 0) in vec2 a_position;  // 0,0 to 1,1

// Per-instance
layout(location = 1) in float a_slot;

uniform mat3 u_projection;
uniform vec2 u_cameraPos;
uniform sampler2D u_posTex;
uniform float u_barHeight;  // e.g. 4.0

out vec2 v_uv;
out float v_hpPercent;
out float v_alpha;
out float v_fillColorPacked;
out float v_bgColorPacked;

void main() {
  int slot = int(a_slot);

  // Row 0: position data (anchorX, anchorY, alpha, yShift)
  vec4 posData = texelFetch(u_posTex, ivec2(slot, 0), 0);
  // Row 1: HP data (hpValue, barWidth, fillColor, bgColor)
  vec4 hpData = texelFetch(u_posTex, ivec2(slot, 1), 0);

  float alpha = posData.z;
  float barWidth = hpData.y;

  // barWidth <= 0 means bar is hidden
  if (alpha <= 0.0 || barWidth <= 0.0) {
    gl_Position = vec4(0.0);
    v_alpha = 0.0;
    return;
  }

  v_alpha = alpha;
  v_hpPercent = clamp(hpData.x, 0.0, 1.0);
  v_uv = a_position;
  v_fillColorPacked = hpData.z;
  v_bgColorPacked = hpData.w;

  // Position: centered on anchor, just above sprite (at anchor Y - barHeight)
  vec2 anchor = posData.xy;
  float barX = anchor.x - barWidth / 2.0;
  float barY = anchor.y - u_barHeight - 1.0;

  vec2 worldPos = vec2(barX, barY) + a_position * vec2(barWidth, u_barHeight);
  worldPos -= u_cameraPos;

  vec3 projected = u_projection * vec3(worldPos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);
}
`;

export const hpBarFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_hpPercent;
in float v_alpha;
in float v_fillColorPacked;
in float v_bgColorPacked;

out vec4 fragColor;

vec3 unpackColor(float packed) {
  uint p = floatBitsToUint(packed);
  return vec3(
    float((p >> 16u) & 0xFFu) / 255.0,
    float((p >> 8u) & 0xFFu) / 255.0,
    float(p & 0xFFu) / 255.0
  );
}

void main() {
  bool isFill = v_uv.x <= v_hpPercent;

  if (isFill) {
    // Fill color: auto preset or custom
    vec3 fillColor;
    uint fillBits = floatBitsToUint(v_fillColorPacked);
    if (fillBits == 0u) {
      // Auto: green → yellow → red based on HP %
      if (v_hpPercent > 0.5) {
        fillColor = vec3(0.2, 0.8, 0.2);
      } else if (v_hpPercent > 0.25) {
        fillColor = vec3(0.9, 0.8, 0.1);
      } else {
        fillColor = vec3(0.9, 0.2, 0.2);
      }
    } else {
      fillColor = unpackColor(v_fillColorPacked);
    }
    fragColor = vec4(fillColor, v_alpha);
  } else {
    // Background color
    vec3 bgColor = unpackColor(v_bgColorPacked);
    fragColor = vec4(bgColor, 0.6 * v_alpha);
  }
}
`;
