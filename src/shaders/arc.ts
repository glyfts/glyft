/**
 * Arc effect shaders for GPU-driven melee swing visuals.
 *
 * Renders arc/pie-slice shapes for melee weapon swings with sweeping animation.
 * Single instanced draw call for all active arcs.
 *
 * Per-instance data (12 floats / 48 bytes):
 * - a_arcPos (vec4): centerX, centerY, angle (radians), arcRadians
 * - a_arcDyn (vec4): range, birthTime, duration, sweepDir
 * - a_arcVis (vec4): color (packed), colorEnd (packed), (unused), (unused)
 */

export const arcVertexShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

// Per-vertex (arc geometry - truncated arc quads)
layout(location = 0) in vec2 a_position;  // (dist, angleT) where dist is 0.15-1, angleT is 0-1

// Per-instance
layout(location = 1) in vec4 a_arcPos;    // centerX, centerY, angle (radians), arcRadians
layout(location = 2) in vec4 a_arcDyn;    // range, birthTime, duration, sweepDir
layout(location = 3) in vec4 a_arcVis;    // colorStart (packed), colorEnd (packed), (unused), (unused)

uniform mat3 u_projection;
uniform float u_time;
uniform vec2 u_cameraPos;

out vec4 v_color;
out float v_dist;

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

  // Vertex position within arc
  float dist = a_position.x;      // 0.15 at inner edge, 1.0 at outer edge
  float angleT = a_position.y;    // 0-1 across the arc width

  // ===== SWEEPING ANIMATION =====
  // Sweep progresses from 0 to 1 over ~60% of duration, then trail fades
  float sweepSpeed = 1.6;  // Complete sweep in 60% of duration
  float sweepProgress = min(t * sweepSpeed, 1.0);

  // Calculate how far this vertex is behind the sweep front
  float distBehindSweep = sweepProgress - angleT;

  // Vertices ahead of sweep are invisible
  if (angleT > sweepProgress + 0.08) {  // Small buffer for anti-aliasing
    gl_Position = vec4(0.0);
    v_color = vec4(0.0);
    v_dist = 0.0;
    return;
  }

  // Calculate world position
  float angleOffset = (angleT - 0.5) * arcRadians;
  float vertAngle = angle + angleOffset;
  vec2 worldPos = center + vec2(cos(vertAngle), sin(vertAngle)) * dist * range;

  // ===== COLOR ANIMATION =====
  // Color transitions from start to end as the sweep progresses
  vec3 colStart = unpackColor(a_arcVis.x);
  vec3 colEnd = unpackColor(a_arcVis.y);

  // Leading edge gets the "end" color, trail gets interpolated
  float colorT = angleT;  // 0 at start of sweep, 1 at end
  vec3 color = mix(colStart, colEnd, colorT);

  // ===== ALPHA / FADE =====
  // Leading edge is bright, trail fades out
  float trailFade = 1.0;
  if (distBehindSweep > 0.0) {
    // Trail fades based on how far behind the sweep front
    trailFade = 1.0 - smoothstep(0.0, 0.5, distBehindSweep);
  }

  // Edge fade (inner to outer)
  float innerRadius = 0.15;
  float normalizedDist = (dist - innerRadius) / (1.0 - innerRadius);
  float edgeFade = 1.0 - normalizedDist * 0.3;

  // Leading edge glow - vertices near the sweep front are brighter
  float leadingEdgeGlow = 1.0 - smoothstep(0.0, 0.15, abs(angleT - sweepProgress));

  // Final alpha
  float alpha = edgeFade * trailFade * 0.9 + leadingEdgeGlow * 0.3;

  // Overall fade out in the last 30% of duration
  float endFade = 1.0 - smoothstep(0.7, 1.0, t);
  alpha *= endFade;

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
