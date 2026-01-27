/**
 * Particle system shaders for GPU-driven visual effects.
 *
 * Single instanced quad per particle. Vertex shader handles all animation:
 * position (velocity + gravity), size interpolation, color lerp, and fade.
 * Fragment shader outputs solid color — no texture sampling.
 *
 * Per-instance data (12 floats / 48 bytes):
 * - a_partPos (vec4): spawnX, spawnY, velX, velY
 * - a_partDyn (vec4): birthTime, duration, gravity, (unused)
 * - a_partVis (vec4): colorStart (packed), colorEnd (packed), sizeStart, sizeEnd
 */

export const particleVertexShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

// Per-vertex (quad geometry)
layout(location = 0) in vec2 a_position;  // 0,0 to 1,1

// Per-instance
layout(location = 1) in vec4 a_partPos;   // spawnX, spawnY, velX, velY
layout(location = 2) in vec4 a_partDyn;   // birthTime, duration, gravity, (unused)
layout(location = 3) in vec4 a_partVis;   // colorStart(packed), colorEnd(packed), sizeStart, sizeEnd

uniform mat3 u_projection;
uniform float u_time;
uniform vec2 u_cameraPos;

out vec4 v_color;

vec3 unpackColor(float packed) {
  uint p = floatBitsToUint(packed);
  return vec3(
    float((p >> 16u) & 0xFFu) / 255.0,
    float((p >> 8u) & 0xFFu) / 255.0,
    float(p & 0xFFu) / 255.0
  );
}

void main() {
  float birthTime = a_partDyn.x;
  float duration = a_partDyn.y;
  float elapsed = u_time - birthTime;

  // Cull expired or invalid particles
  if (duration <= 0.0 || elapsed < 0.0 || elapsed > duration) {
    gl_Position = vec4(0.0);
    v_color = vec4(0.0);
    return;
  }

  float t = elapsed / duration;  // 0→1 normalized lifetime

  // Physics: position = spawn + vel*elapsed + 0.5*gravity*elapsed²
  float gravity = a_partDyn.z;
  vec2 spawnPos = a_partPos.xy;
  vec2 vel = a_partPos.zw;
  vec2 worldCenter = spawnPos + vel * elapsed + vec2(0.0, 0.5 * gravity * elapsed * elapsed);

  // Size interpolation
  float size = mix(a_partVis.z, a_partVis.w, t);

  // Color interpolation
  vec3 colStart = unpackColor(a_partVis.x);
  vec3 colEnd = unpackColor(a_partVis.y);
  vec3 color = mix(colStart, colEnd, t);

  // Alpha: fade out in last 30% of lifetime
  float alpha = t > 0.7 ? 1.0 - (t - 0.7) / 0.3 : 1.0;

  v_color = vec4(color, alpha);

  // Quad: expand from center
  vec2 localPos = (a_position - 0.5) * size;
  vec2 worldPos = worldCenter + localPos;
  worldPos -= u_cameraPos;

  vec3 projected = u_projection * vec3(worldPos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);
}
`;

export const particleFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

in vec4 v_color;

out vec4 fragColor;

void main() {
  if (v_color.a < 0.01) discard;
  fragColor = v_color;
}
`;
