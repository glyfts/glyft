/**
 * Ocean water shader with Gerstner wave vertex displacement.
 *
 * The vertex shader displaces a subdivided grid using layered trochoidal waves.
 * The fragment shader handles depth colouring, specular, foam hints, and fog.
 *
 * The vertex shader source is generated at runtime by injectWaves()
 * so the wave parameters are baked as constants (no uniform array overhead).
 */

import { waveGLSL, DEFAULT_WAVES, type WaveDef } from '../waves';

/** Generate the water vertex shader with baked wave constants */
export function generateWaterVertexShader(waves: WaveDef[] = DEFAULT_WAVES): string {
  return /*glsl*/ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position; // 0,0 to 1,1 grid

uniform mat4 u_mvp;
uniform vec2 u_worldSize;
uniform float u_waterHeight;
uniform float u_time;
uniform float u_waveScale;    // amplitude multiplier (1.0 = normal)
uniform float u_waveSpeedMul; // speed multiplier (1.0 = normal)

out vec2 v_uv;
out vec3 v_worldPos;
out float v_waveHeight;

${waveGLSL(waves)}

void main() {
  float scale = 4.0;
  float offsetX = u_worldSize.x * (1.0 - scale) * 0.5;
  float offsetZ = u_worldSize.y * (1.0 - scale) * 0.5;
  vec3 pos = vec3(
    a_position.x * u_worldSize.x * scale + offsetX,
    u_waterHeight,
    a_position.y * u_worldSize.y * scale + offsetZ
  );

  // Apply Gerstner wave displacement with runtime scaling
  float baseY = pos.y;
  applyWaves(pos);
  // Scale displacement from base
  pos.x = mix(a_position.x * u_worldSize.x * scale + offsetX, pos.x, u_waveScale);
  pos.z = mix(a_position.y * u_worldSize.y * scale + offsetZ, pos.z, u_waveScale);
  pos.y = baseY + (pos.y - baseY) * u_waveScale;
  v_waveHeight = (pos.y - baseY);

  v_uv = a_position * 8.0 * scale;
  v_worldPos = pos;
  gl_Position = u_mvp * vec4(pos, 1.0);
}
`;
}

export const waterFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform float u_time;
uniform vec3 u_cameraPos;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform vec2 u_worldSize;
uniform vec3 u_deepColor;
uniform vec3 u_shallowColor;
uniform float u_alpha;
uniform float u_speed;
uniform float u_emissive;
uniform sampler2D u_foamTex;
uniform float u_hasFoam;     // 1.0 if foam texture present, 0.0 if not
uniform sampler2D u_seaTex;
uniform float u_hasSea;      // 1.0 if sea texture present, 0.0 if not

in vec2 v_uv;
in vec3 v_worldPos;
in float v_waveHeight;

out vec4 fragColor;

void main() {
  vec2 uv = v_uv;
  float spd = u_speed;

  // Small surface detail ripples
  float ripple1 = sin(uv.x * 12.0 + u_time * 1.5 * spd) * 0.015;
  float ripple2 = sin(uv.y * 10.0 + u_time * 1.2 * spd) * 0.015;
  float ripple3 = sin((uv.x + uv.y) * 8.0 + u_time * 0.8 * spd) * 0.01;
  float detail = ripple1 + ripple2 + ripple3;

  // Depth: distance from terrain bounds
  float dx = max(0.0, max(-v_worldPos.x, v_worldPos.x - u_worldSize.x)) / (u_worldSize.x * 0.5);
  float dz = max(0.0, max(-v_worldPos.z, v_worldPos.z - u_worldSize.y)) / (u_worldSize.y * 0.5);
  float depth = clamp(max(dx, dz), 0.0, 1.0);

  // Base surface colour
  float shallowBlend = (0.45 + detail * 4.0 + v_waveHeight * 0.4) * (1.0 - depth);
  vec3 tint = mix(u_deepColor, u_shallowColor, clamp(shallowBlend, 0.0, 1.0));

  vec3 surfaceColor;
  if (u_hasSea > 0.5) {
    // Sample sea texture: scroll slowly for movement
    vec2 seaUV1 = v_worldPos.xz * 0.05 + vec2(u_time * 0.008, u_time * 0.006);
    vec2 seaUV2 = v_worldPos.xz * 0.03 + vec2(-u_time * 0.005, u_time * 0.01);
    vec3 seaCol1 = texture(u_seaTex, seaUV1).rgb;
    vec3 seaCol2 = texture(u_seaTex, seaUV2).rgb;
    vec3 seaCol = mix(seaCol1, seaCol2, 0.5);
    // Tint the texture with the depth colour
    surfaceColor = seaCol * tint * 3.5;
  } else {
    surfaceColor = tint;
  }

  // Foam on wave crests: subtle blend
  float foamMask = smoothstep(0.15, 0.45, v_waveHeight);
  if (u_hasFoam > 0.5) {
    vec2 foamUV = v_worldPos.xz * 0.08 + vec2(u_time * 0.02, u_time * 0.015);
    vec3 foamCol = texture(u_foamTex, foamUV).rgb;
    surfaceColor = mix(surfaceColor, foamCol * vec3(0.95, 0.93, 0.88), foamMask * 0.3);
  } else {
    surfaceColor += vec3(0.92, 0.90, 0.85) * foamMask * 0.12;
  }

  // Opacity
  float waterAlpha = mix(u_alpha, 1.0, depth * 0.8);

  // Soft broad specular highlights
  float spec = pow(max(detail * 8.0 + 0.5, 0.0), 2.0) * 0.08 * (1.0 - depth * 0.7);
  surfaceColor += vec3(0.95, 0.92, 0.85) * spec;

  // Lava mode
  if (u_emissive > 0.0) {
    float crack = sin(uv.x * 20.0 + u_time * 0.5) * sin(uv.y * 18.0 - u_time * 0.3);
    float glow = smoothstep(0.3, 0.8, crack) * u_emissive;
    surfaceColor += vec3(glow * 0.8, glow * 0.3, glow * 0.05);
  }

  // Fog
  float dist = distance(v_worldPos, u_cameraPos);
  float fogFactor = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
  surfaceColor = mix(surfaceColor, u_fogColor, fogFactor);

  fragColor = vec4(surfaceColor, waterAlpha);
}
`;
