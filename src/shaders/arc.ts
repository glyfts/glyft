/**
 * Arc effect shaders with advanced features:
 * - Sweeping animation
 * - Predefined color gradients (fire, ice, holy, poison, shadow)
 * - Wave/sine/zigzag shapes
 * - Configurable trail duration
 * - Shape variants (arc, wave, zigzag, axe, spear)
 *
 * Per-instance data (12 floats / 48 bytes):
 * - a_arcPos (vec4): centerX, centerY, angle (radians), arcRadians
 * - a_arcDyn (vec4): range, birthTime, duration, flags (shape + gradient)
 * - a_arcVis (vec4): colorStart, colorEnd, waveAmp, waveFreq
 */

export const arcVertexShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 a_position;  // (dist 0.15-1, angleT 0-1)

layout(location = 1) in vec4 a_arcPos;    // centerX, centerY, angle, arcRadians
layout(location = 2) in vec4 a_arcDyn;    // range, birthTime, duration, flags
layout(location = 3) in vec4 a_arcVis;    // colorStart, colorEnd, waveAmp, waveFreq

uniform mat3 u_projection;
uniform float u_time;
uniform vec2 u_cameraPos;

out vec4 v_color;
out float v_dist;

// Shape constants
const int SHAPE_ARC = 0;
const int SHAPE_WAVE = 1;
const int SHAPE_ZIGZAG = 2;
const int SHAPE_AXE = 3;     // Wider at outer edge
const int SHAPE_SPEAR = 4;   // Pointed tip
const int SHAPE_THRUST = 5;  // Extends outward instead of sweeping

// Gradient constants
const int GRADIENT_DUO = 0;
const int GRADIENT_FIRE = 1;
const int GRADIENT_ICE = 2;
const int GRADIENT_HOLY = 3;
const int GRADIENT_POISON = 4;
const int GRADIENT_SHADOW = 5;

vec3 unpackColor(float packed) {
  uint p = floatBitsToUint(packed);
  return vec3(
    float((p >> 16u) & 0xFFu) / 255.0,
    float((p >> 8u) & 0xFFu) / 255.0,
    float(p & 0xFFu) / 255.0
  );
}

// Predefined gradient: returns color based on position t (0-1)
vec3 getGradientColor(int gradientType, float t, vec3 colStart, vec3 colEnd) {
  if (gradientType == GRADIENT_DUO) {
    return mix(colStart, colEnd, t);
  }
  else if (gradientType == GRADIENT_FIRE) {
    // Red → Orange → Yellow → White
    vec3 red = vec3(1.0, 0.2, 0.0);
    vec3 orange = vec3(1.0, 0.5, 0.0);
    vec3 yellow = vec3(1.0, 0.9, 0.2);
    vec3 white = vec3(1.0, 1.0, 0.9);
    if (t < 0.33) return mix(red, orange, t * 3.0);
    else if (t < 0.66) return mix(orange, yellow, (t - 0.33) * 3.0);
    else return mix(yellow, white, (t - 0.66) * 3.0);
  }
  else if (gradientType == GRADIENT_ICE) {
    // White → Cyan → Blue
    vec3 white = vec3(1.0, 1.0, 1.0);
    vec3 cyan = vec3(0.4, 0.9, 1.0);
    vec3 blue = vec3(0.2, 0.4, 1.0);
    if (t < 0.5) return mix(white, cyan, t * 2.0);
    else return mix(cyan, blue, (t - 0.5) * 2.0);
  }
  else if (gradientType == GRADIENT_HOLY) {
    // Gold → White → Gold (shimmering)
    vec3 gold = vec3(1.0, 0.85, 0.3);
    vec3 white = vec3(1.0, 1.0, 0.95);
    float wave = sin(t * 6.28318) * 0.5 + 0.5;
    return mix(gold, white, wave);
  }
  else if (gradientType == GRADIENT_POISON) {
    // Bright green → Yellow-green → Dark green
    vec3 bright = vec3(0.3, 1.0, 0.3);
    vec3 yellow = vec3(0.7, 0.9, 0.2);
    vec3 dark = vec3(0.1, 0.4, 0.1);
    if (t < 0.5) return mix(bright, yellow, t * 2.0);
    else return mix(yellow, dark, (t - 0.5) * 2.0);
  }
  else if (gradientType == GRADIENT_SHADOW) {
    // Purple → Dark purple → Black
    vec3 purple = vec3(0.6, 0.2, 0.8);
    vec3 darkPurple = vec3(0.3, 0.0, 0.4);
    vec3 black = vec3(0.1, 0.0, 0.15);
    if (t < 0.5) return mix(purple, darkPurple, t * 2.0);
    else return mix(darkPurple, black, (t - 0.5) * 2.0);
  }
  return mix(colStart, colEnd, t);
}

void main() {
  float birthTime = a_arcDyn.y;
  float duration = a_arcDyn.z;
  float flags = a_arcDyn.w;
  float elapsed = u_time - birthTime;

  if (duration <= 0.0 || elapsed < 0.0 || elapsed > duration) {
    gl_Position = vec4(0.0);
    v_color = vec4(0.0);
    v_dist = 0.0;
    return;
  }

  float t = elapsed / duration;

  // Unpack flags: shape in low 4 bits, gradient in next 4 bits
  int shapeType = int(flags) & 0xF;
  int gradientType = (int(flags) >> 4) & 0xF;

  // Arc parameters
  vec2 center = a_arcPos.xy;
  float angle = a_arcPos.z;
  float arcRadians = a_arcPos.w;
  float range = a_arcDyn.x;

  // Wave parameters
  float waveAmp = a_arcVis.z;
  float waveFreq = a_arcVis.w;

  // Vertex position
  float dist = a_position.x;
  float angleT = a_position.y;

  // ===== SHAPE MODIFIERS =====
  float distMod = dist;
  float angleMod = 0.0;

  if (shapeType == SHAPE_WAVE) {
    // Sine wave - vertices oscillate perpendicular to arc
    float wave = sin(angleT * waveFreq * 6.28318) * waveAmp;
    distMod = dist + wave * (1.0 - dist);  // More wave at inner edge
  }
  else if (shapeType == SHAPE_ZIGZAG) {
    // Zigzag pattern
    float zigzag = abs(fract(angleT * waveFreq) - 0.5) * 2.0 - 0.5;
    distMod = dist + zigzag * waveAmp * (1.0 - dist);
  }
  else if (shapeType == SHAPE_AXE) {
    // Axe head - wider at the leading edge
    float widthMod = 1.0 + (1.0 - angleT) * 0.5;  // 1.5x wider at end
    arcRadians *= widthMod;
  }
  else if (shapeType == SHAPE_SPEAR) {
    // Spear tip - narrower, with point at leading edge
    float narrowFactor = 0.3 + angleT * 0.7;  // Narrow at end
    float innerRadius = 0.15;
    distMod = innerRadius + (dist - innerRadius) * narrowFactor;
  }
  else if (shapeType == SHAPE_THRUST) {
    // Thrust - narrow wedge that extends outward
    // Make it pointed: narrower at the tip (outer edge)
    float pointFactor = 1.0 - (dist - 0.15) * 0.7;  // Narrower as dist increases
    arcRadians *= max(pointFactor, 0.2);  // Don't go too narrow
  }

  // ===== SWEEPING ANIMATION =====
  float sweepSpeed = 1.6;
  float sweepProgress = min(t * sweepSpeed, 1.0);

  float distBehindSweep;
  bool cullVertex = false;

  if (shapeType == SHAPE_THRUST) {
    // Thrust: extend outward based on dist instead of angleT
    float innerRadius = 0.15;
    float normalizedDist = (dist - innerRadius) / (1.0 - innerRadius);  // 0 at inner, 1 at outer
    distBehindSweep = sweepProgress - normalizedDist;
    cullVertex = normalizedDist > sweepProgress + 0.15;
  } else {
    // Normal sweep: reveal based on angleT (horizontal)
    distBehindSweep = sweepProgress - angleT;
    cullVertex = angleT > sweepProgress + 0.08;
  }

  if (cullVertex) {
    gl_Position = vec4(0.0);
    v_color = vec4(0.0);
    v_dist = 0.0;
    return;
  }

  // Calculate world position
  float angleOffset = (angleT - 0.5) * arcRadians;
  float vertAngle = angle + angleOffset + angleMod;
  vec2 worldPos = center + vec2(cos(vertAngle), sin(vertAngle)) * distMod * range;

  // ===== COLOR =====
  vec3 colStart = unpackColor(a_arcVis.x);
  vec3 colEnd = unpackColor(a_arcVis.y);
  // For thrust, color based on distance; for others, based on angleT
  float colorT = (shapeType == SHAPE_THRUST) ? ((dist - 0.15) / 0.85) : angleT;
  vec3 color = getGradientColor(gradientType, colorT, colStart, colEnd);

  // ===== ALPHA / FADE =====
  // Trail fade - configurable via sweep speed
  float trailFade = 1.0;
  if (distBehindSweep > 0.0) {
    trailFade = 1.0 - smoothstep(0.0, 0.6, distBehindSweep);
  }

  // Edge fade
  float innerRadius = 0.15;
  float normalizedDist = (distMod - innerRadius) / (1.0 - innerRadius);
  float edgeFade = 1.0 - normalizedDist * 0.3;

  // Leading edge glow
  float leadingEdgeGlow = 1.0 - smoothstep(0.0, 0.12, abs(angleT - sweepProgress));

  // Intensity boost for certain gradients
  float intensityBoost = 1.0;
  if (gradientType == GRADIENT_FIRE) intensityBoost = 1.2;
  if (gradientType == GRADIENT_HOLY) intensityBoost = 1.3;

  float alpha = (edgeFade * trailFade * 0.85 + leadingEdgeGlow * 0.4) * intensityBoost;

  // End fade
  float endFade = 1.0 - smoothstep(0.65, 1.0, t);
  alpha *= endFade;

  v_color = vec4(color, min(alpha, 1.0));
  v_dist = distMod;

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
