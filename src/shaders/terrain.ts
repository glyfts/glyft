/**
 * Terrain shaders for heightmap mesh rendering.
 *
 * Vertex shader: transforms terrain mesh through MVP matrix.
 * Fragment shader: multi-texture splatmap blending by height and slope,
 * directional lighting, and distance fog.
 */

export const terrainVertexShader = /*glsl*/ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_mvp;
uniform float u_maxHeight;

out vec3 v_normal;
out vec2 v_uv;
out vec3 v_worldPos;
out float v_heightNorm;

void main() {
  v_normal = a_normal;
  v_uv = a_uv;
  v_worldPos = a_position;
  v_heightNorm = clamp(a_position.y / max(u_maxHeight, 0.01), 0.0, 1.0);
  gl_Position = u_mvp * vec4(a_position, 1.0);
}
`;

export const terrainFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec3 u_lightDir;
uniform vec3 u_ambientColor;
uniform vec3 u_lightColor;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform int u_hardBlend; // 1 = hard texture transitions (dungeons), 0 = smooth (overworld)
uniform vec3 u_cameraPos;

// Splatmap textures (single-biome fallback)
uniform sampler2D u_texLow;
uniform sampler2D u_texMid;
uniform sampler2D u_texSteep;
uniform sampler2D u_texHigh;
// Biome texture arrays (indexed approach)
uniform highp sampler2DArray u_biomeArrayLow;
uniform highp sampler2DArray u_biomeArrayMid;
uniform highp sampler2DArray u_biomeArraySteep;
uniform highp sampler2DArray u_biomeArrayHigh;
uniform sampler2D u_biomeIndex;     // R channel = biome index (0-1 mapped to layer)
uniform int u_useBiomeArray;
uniform int u_biomeCount;
uniform int u_useSplatmap;
uniform float u_waterHeightNorm;
uniform vec2 u_worldSize;

in vec3 v_normal;
in vec2 v_uv;
in vec3 v_worldPos;
in float v_heightNorm;

out vec4 fragColor;

void main() {
  vec3 normal = normalize(v_normal);

  vec3 texColor;

  if (u_useSplatmap == 1) {
    float slope = normal.y;
    float sandLine = u_waterHeightNorm + 0.05;

    float steepness, lowWeight, highWeight, midWeight, rockWeight;

    if (u_hardBlend == 1) {
      // Hard transitions — sharp cutoffs for dungeons/caves
      steepness = slope < 0.7 ? 1.0 : 0.0;
      lowWeight = v_heightNorm < sandLine ? 1.0 : 0.0;
      highWeight = v_heightNorm > 0.5 ? 1.0 : 0.0;
      midWeight = (1.0 - lowWeight) * (1.0 - highWeight);
      rockWeight = steepness;
      lowWeight *= (1.0 - rockWeight);
      midWeight *= (1.0 - rockWeight);
      highWeight *= (1.0 - rockWeight);
    } else {
      // Smooth transitions — natural blending for overworld
      steepness = 1.0 - smoothstep(0.6, 0.85, slope);
      lowWeight = smoothstep(sandLine + 0.05, sandLine - 0.02, v_heightNorm);
      highWeight = smoothstep(0.65, 0.85, v_heightNorm);
      midWeight = max(1.0 - lowWeight - highWeight, 0.0);
      rockWeight = steepness;
      lowWeight *= (1.0 - rockWeight);
      midWeight *= (1.0 - rockWeight);
      highWeight *= (1.0 - rockWeight);
    }

    // Biome texture sampling
    if (u_useBiomeArray == 1 && u_worldSize.x > 0.0) {
      // Index-based biome blending using texture arrays
      // R = primary biome, G = secondary biome, B = blend factor
      vec2 biomeUV = v_worldPos.xz / u_worldSize;
      vec3 biomeData = texture(u_biomeIndex, biomeUV).rgb;
      float layerA = floor(biomeData.r * float(u_biomeCount - 1) + 0.5);
      float layerB = floor(biomeData.g * float(u_biomeCount - 1) + 0.5);
      float blend = biomeData.b;

      vec3 colA = texture(u_biomeArrayLow, vec3(v_uv, layerA)).rgb * lowWeight
                + texture(u_biomeArrayMid, vec3(v_uv, layerA)).rgb * midWeight
                + texture(u_biomeArraySteep, vec3(v_uv, layerA)).rgb * rockWeight
                + texture(u_biomeArrayHigh, vec3(v_uv, layerA)).rgb * highWeight;

      if (blend > 0.01) {
        vec3 colB = texture(u_biomeArrayLow, vec3(v_uv, layerB)).rgb * lowWeight
                  + texture(u_biomeArrayMid, vec3(v_uv, layerB)).rgb * midWeight
                  + texture(u_biomeArraySteep, vec3(v_uv, layerB)).rgb * rockWeight
                  + texture(u_biomeArrayHigh, vec3(v_uv, layerB)).rgb * highWeight;
        texColor = mix(colA, colB, blend);
      } else {
        texColor = colA;
      }
    } else {
      // Fallback: single texture set
      vec3 colLow = texture(u_texLow, v_uv).rgb;
      vec3 colMid = texture(u_texMid, v_uv).rgb;
      vec3 colSteep = texture(u_texSteep, v_uv).rgb;
      vec3 colHigh = texture(u_texHigh, v_uv).rgb;
      texColor = colLow * lowWeight + colMid * midWeight + colSteep * rockWeight + colHigh * highWeight;
    }
  } else {
    texColor = texture(u_texture, v_uv).rgb;
  }

  // Directional lighting (Lambert)
  float diffuse = max(dot(normal, u_lightDir), 0.0);
  vec3 lighting = u_ambientColor + u_lightColor * diffuse;
  vec3 color = texColor * lighting;

  // Distance fog
  float dist = distance(v_worldPos, u_cameraPos);
  float fogFactor = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
  color = mix(color, u_fogColor, fogFactor);

  fragColor = vec4(color, 1.0);
}
`;
