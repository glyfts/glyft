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

in vec2 v_uv;
in vec3 v_worldPos;

out vec4 fragColor;

void main() {
  // Animated ripple
  vec2 uv = v_uv;
  float ripple1 = sin(uv.x * 12.0 + u_time * 1.5) * 0.02;
  float ripple2 = sin(uv.y * 10.0 + u_time * 1.2) * 0.02;
  float ripple3 = sin((uv.x + uv.y) * 8.0 + u_time * 0.8) * 0.015;
  float wave = ripple1 + ripple2 + ripple3;

  // Water color with subtle variation
  vec3 deepColor = vec3(0.1, 0.25, 0.45);
  vec3 shallowColor = vec3(0.2, 0.4, 0.6);
  vec3 waterColor = mix(deepColor, shallowColor, 0.5 + wave * 5.0);

  // Specular highlight from ripples
  float spec = pow(max(wave * 10.0 + 0.5, 0.0), 3.0) * 0.15;
  waterColor += vec3(spec);

  // Distance fog
  float dist = distance(v_worldPos, u_cameraPos);
  float fogFactor = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
  waterColor = mix(waterColor, u_fogColor, fogFactor);

  fragColor = vec4(waterColor, 0.7);
}
`;
