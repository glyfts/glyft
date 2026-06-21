/**
 * Water surface shader.
 *
 * Renders a flat transparent plane with animated ripple effect.
 */

export const waterVertexShader = /*glsl*/ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position; // 0,0 to 1,1 quad

uniform mat4 u_mvp;
uniform vec2 u_worldSize;
uniform float u_waterHeight;

out vec2 v_uv;
out vec3 v_worldPos;

void main() {
  vec3 pos = vec3(
    a_position.x * u_worldSize.x,
    u_waterHeight,
    a_position.y * u_worldSize.y
  );
  v_uv = a_position * 8.0; // Tile UVs
  v_worldPos = pos;
  gl_Position = u_mvp * vec4(pos, 1.0);
}
`;

export const waterFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform float u_time;
uniform vec3 u_cameraPos;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform vec3 u_deepColor;
uniform vec3 u_shallowColor;
uniform float u_alpha;
uniform float u_speed;    // Animation speed multiplier
uniform float u_emissive; // Glow intensity (0 = water, 1 = lava)

in vec2 v_uv;
in vec3 v_worldPos;

out vec4 fragColor;

void main() {
  vec2 uv = v_uv;
  float spd = u_speed;
  float ripple1 = sin(uv.x * 12.0 + u_time * 1.5 * spd) * 0.02;
  float ripple2 = sin(uv.y * 10.0 + u_time * 1.2 * spd) * 0.02;
  float ripple3 = sin((uv.x + uv.y) * 8.0 + u_time * 0.8 * spd) * 0.015;
  float wave = ripple1 + ripple2 + ripple3;

  vec3 surfaceColor = mix(u_deepColor, u_shallowColor, 0.5 + wave * 5.0);

  // Specular / emissive glow
  float spec = pow(max(wave * 10.0 + 0.5, 0.0), 3.0) * 0.15;
  surfaceColor += vec3(spec);

  // Lava glow: bright pulsing cracks
  if (u_emissive > 0.0) {
    float crack = sin(uv.x * 20.0 + u_time * 0.5) * sin(uv.y * 18.0 - u_time * 0.3);
    float glow = smoothstep(0.3, 0.8, crack) * u_emissive;
    surfaceColor += vec3(glow * 0.8, glow * 0.3, glow * 0.05);
  }

  float dist = distance(v_worldPos, u_cameraPos);
  float fogFactor = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
  surfaceColor = mix(surfaceColor, u_fogColor, fogFactor);

  fragColor = vec4(surfaceColor, u_alpha);
}
`;
