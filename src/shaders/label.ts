/**
 * Label shaders for GPU-driven persistent text labels above sprites.
 *
 * Per-character instanced quads. Sprite position is read from a position
 * lookup texture via texelFetch — instance buffer only updates when text changes.
 *
 * Per-instance data (3 vec4s, 48 bytes per character):
 * - a_labelPos:   slotIndex, charOffsetX, charOffsetY, charW
 * - a_labelUV:    atlasU, atlasV, atlasW, atlasH
 * - a_labelStyle: charH, color(packed u32), 0, 0
 *
 * Position texture (RGBA32F, 128×2):
 * - Row 0: anchorX, anchorY, alpha, yShift
 * - Row 1: hpValue, barWidth, barVisible, 0 (used by HP bar shader)
 */

export const labelVertexShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

// Per-vertex (quad geometry)
layout(location = 0) in vec2 a_position;  // 0,0 to 1,1

// Per-instance
layout(location = 1) in vec4 a_labelPos;   // slotIndex, charOffsetX, charOffsetY, charW
layout(location = 2) in vec4 a_labelUV;    // atlasU, atlasV, atlasW, atlasH
layout(location = 3) in vec4 a_labelStyle; // charH, color(packed), 0, 0

uniform mat3 u_projection;
uniform vec2 u_cameraPos;
uniform vec2 u_atlasSize;
uniform sampler2D u_posTex;

out vec2 v_texCoord;
out float v_alpha;
out vec3 v_tint;

vec3 unpackColor(float packed) {
  uint p = floatBitsToUint(packed);
  return vec3(
    float((p >> 16u) & 0xFFu) / 255.0,
    float((p >> 8u) & 0xFFu) / 255.0,
    float(p & 0xFFu) / 255.0
  );
}

void main() {
  // Read parent sprite position from position texture
  int slot = int(a_labelPos.x);
  vec4 posData = texelFetch(u_posTex, ivec2(slot, 0), 0);

  float alpha = posData.z;
  if (alpha <= 0.0) {
    gl_Position = vec4(0.0);
    v_alpha = 0.0;
    return;
  }

  v_alpha = alpha;
  v_tint = unpackColor(a_labelStyle.y);

  // Texture coordinates
  v_texCoord = (a_labelUV.xy + a_position * a_labelUV.zw) / u_atlasSize;

  // World position — apply yShift from posData.w (pushes label up when HP bar present)
  vec2 charOffset = a_labelPos.yz;
  vec2 charSize = vec2(a_labelPos.w, a_labelStyle.x);

  vec2 worldPos = posData.xy + vec2(0.0, posData.w) + charOffset + a_position * charSize;
  worldPos -= u_cameraPos;

  vec3 projected = u_projection * vec3(worldPos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);
}
`;

export const labelFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform sampler2D u_fontAtlas;

in vec2 v_texCoord;
in float v_alpha;
in vec3 v_tint;

out vec4 fragColor;

void main() {
  vec4 texColor = texture(u_fontAtlas, v_texCoord);
  if (texColor.a < 0.01) discard;

  // White fill + black outline: R channel blends outline → tint
  vec3 color = mix(vec3(0.0), v_tint, texColor.r);
  fragColor = vec4(color, texColor.a * v_alpha);
}
`;
