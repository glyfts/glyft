/**
 * Text shaders for GPU-driven floating text (damage numbers, info text).
 *
 * Per-character instanced quads with GPU-driven rise/fade/pop animation.
 * Font atlas is white text with black outline on transparent background.
 *
 * Per-instance data (3 vec4s, 48 bytes per character):
 * - a_textPos:  worldX, worldY, charW, charH
 * - a_textUV:   u, v, w, h (pixel coords in font atlas)
 * - a_textAnim: color(packed u32), birthTime, duration, flags(packed u32)
 *
 * Flags packing (uint32 bit-cast as float):
 * - bits 0-15:  riseSpeed (uint16, actual = value × 0.1 px/s)
 * - bit 16:     style (0 = rise, 1 = pop)
 */

export const textVertexShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

// Per-vertex (quad geometry)
layout(location = 0) in vec2 a_position;  // 0,0 to 1,1

// Per-instance
layout(location = 1) in vec4 a_textPos;   // worldX, worldY, charW, charH
layout(location = 2) in vec4 a_textUV;    // u, v, w, h (pixel coords in font atlas)
layout(location = 3) in vec4 a_textAnim;  // color(packed), birthTime, duration, flags(packed)

uniform mat3 u_projection;
uniform float u_time;
uniform vec2 u_cameraPos;
uniform vec2 u_atlasSize;

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
  float birthTime = a_textAnim.y;
  float duration = a_textAnim.z;
  float elapsed = u_time - birthTime;

  // Expired or invalid — cull
  if (duration <= 0.0 || elapsed > duration || elapsed < 0.0) {
    gl_Position = vec4(0.0);
    v_alpha = 0.0;
    return;
  }

  float t = elapsed / duration;

  // Decode flags
  uint uflags = floatBitsToUint(a_textAnim.w);
  float riseSpeed = float(uflags & 0xFFFFu) * 0.1;
  bool isPop = (uflags & 0x10000u) != 0u;

  // Animation
  float yOffset = 0.0;
  float alpha = 1.0;
  float scaleAnim = 1.0;

  if (isPop) {
    // Pop: scale punch then fade
    if (t < 0.15) {
      scaleAnim = 1.0 + 0.3 * (t / 0.15);
    } else if (t < 0.30) {
      scaleAnim = 1.3 - 0.3 * ((t - 0.15) / 0.15);
    }
    if (t > 0.70) {
      alpha = 1.0 - (t - 0.70) / 0.30;
    }
    yOffset = elapsed * riseSpeed * 0.3;
  } else {
    // Rise: steady upward float + fade
    yOffset = elapsed * riseSpeed;
    alpha = 1.0 - t;
  }

  // Unpack color
  v_tint = unpackColor(a_textAnim.x);
  v_alpha = alpha;

  // Texture coordinates
  v_texCoord = (a_textUV.xy + a_position * a_textUV.zw) / u_atlasSize;

  // World position — scale around character center
  vec2 charSize = a_textPos.zw;
  vec2 animSize = charSize * scaleAnim;
  vec2 charCenter = a_textPos.xy + charSize * 0.5;
  vec2 localPos = (a_position - 0.5) * animSize;

  vec2 worldPos = charCenter + localPos;
  worldPos.y -= yOffset;
  worldPos -= u_cameraPos;

  vec3 projected = u_projection * vec3(worldPos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);
}
`;

export const textFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform sampler2D u_fontAtlas;

in vec2 v_texCoord;
in float v_alpha;
in vec3 v_tint;

out vec4 fragColor;

void main() {
  vec4 texColor = texture(u_fontAtlas, v_texCoord);
  if (texColor.a < 0.01) discard;

  // Atlas has white fill + black outline on transparent background.
  // Use R channel to blend: outline (R≈0) → black, fill (R≈1) → tint color
  vec3 color = mix(vec3(0.0), v_tint, texColor.r);
  fragColor = vec4(color, texColor.a * v_alpha);
}
`;
