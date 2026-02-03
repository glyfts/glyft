/**
 * Arc effect shaders for GPU-driven melee swing visuals.
 *
 * Renders arc/pie-slice shapes for melee weapon swings.
 * Single instanced draw call for all active arcs.
 *
 * Per-instance data (12 floats / 48 bytes):
 * - a_arcPos (vec4): centerX, centerY, angle (radians), arcRadians
 * - a_arcDyn (vec4): range, birthTime, duration, (unused)
 * - a_arcVis (vec4): color (packed), colorEnd (packed), thickness, (unused)
 */

export const arcVertexShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

// Per-vertex (arc geometry - fan of triangles)
layout(location = 0) in vec2 a_position;  // Pre-computed arc vertex, normalized 0-1 range

// Per-instance
layout(location = 1) in vec4 a_arcPos;    // centerX, centerY, angle (radians), arcRadians
layout(location = 2) in vec4 a_arcDyn;    // range, birthTime, duration, (unused)
layout(location = 3) in vec4 a_arcVis;    // colorStart (packed), colorEnd (packed), (unused), (unused)

uniform mat3 u_projection;
uniform float u_time;
uniform vec2 u_cameraPos;

out vec4 v_color;
out float v_dist;  // Distance from center for gradient

vec3 unpackColor(float packed) {
  uint p = floatBitsToUint(packed);
  return vec3(
    float((p >> 16u) & 0xFFu) / 255.0,
    float((p >> 8u) & 0xFFu) / 255.0,
    float(p & 0xFFu) / 255.0
  );
}

void main() {
  float birthTime = a_arcDyn.y;
  float duration = a_arcDyn.z;
  float elapsed = u_time - birthTime;

  // Cull expired or invalid arcs
  if (duration <= 0.0 || elapsed < 0.0 || elapsed > duration) {
    gl_Position = vec4(0.0);
    v_color = vec4(0.0);
    v_dist = 0.0;
    return;
  }

  float t = elapsed / duration;  // 0→1 normalized lifetime

  // Extract arc parameters
  vec2 center = a_arcPos.xy;
  float angle = a_arcPos.z;       // Center angle in radians
  float arcRadians = a_arcPos.w;  // Total arc width in radians
  float range = a_arcDyn.x;       // Arc radius in pixels

  // a_position.x = 0 at center, 1 at edge
  // a_position.y = angle offset from -0.5 to +0.5
  float dist = a_position.x;
  float angleOffset = (a_position.y - 0.5) * arcRadians;
  float vertAngle = angle + angleOffset;

  // Calculate world position
  vec2 worldPos = center + vec2(cos(vertAngle), sin(vertAngle)) * dist * range;

  // Color interpolation
  vec3 colStart = unpackColor(a_arcVis.x);
  vec3 colEnd = unpackColor(a_arcVis.y);
  vec3 color = mix(colStart, colEnd, t);

  // Alpha: start strong, fade out over lifetime
  // Fade from inner edge to outer edge for a "sweep" effect
  // dist ranges from ~0.15 (inner) to 1.0 (outer)
  float innerRadius = 0.15;
  float normalizedDist = (dist - innerRadius) / (1.0 - innerRadius);  // 0 at inner, 1 at outer
  float edgeFade = 1.0 - normalizedDist * 0.5;  // Fade slightly toward outer edge
  float timeFade = 1.0 - t * t;  // Quadratic fade
  float alpha = edgeFade * timeFade * 0.9;

  v_color = vec4(color, alpha);
  v_dist = dist;

  // Apply camera transform and projection
  worldPos -= u_cameraPos;
  vec3 projected = u_projection * vec3(worldPos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);
}
`;

export const arcFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

in vec4 v_color;
in float v_dist;

out vec4 fragColor;

void main() {
  if (v_color.a < 0.01) discard;
  fragColor = v_color;
}
`;
