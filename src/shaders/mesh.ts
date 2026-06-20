/**
 * Textured mesh shader for simple 3D geometry (buildings, props).
 *
 * Vertex: MVP transform with normal for lighting.
 * Fragment: Atlas texture sample + Lambert lighting + distance fog.
 * Matches terrain lighting for visual cohesion.
 */

export const meshVertexShader = /*glsl*/ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_viewProj;
uniform mat4 u_model;

out vec3 v_normal;
out vec2 v_uv;
out vec3 v_worldPos;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;
  gl_Position = u_viewProj * worldPos;
}
`;

export const meshFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec3 u_lightDir;
uniform vec3 u_ambientColor;
uniform vec3 u_lightColor;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform vec3 u_cameraPos;

in vec3 v_normal;
in vec2 v_uv;
in vec3 v_worldPos;

out vec4 fragColor;

void main() {
  vec4 texColor = texture(u_texture, v_uv);
  if (texColor.a < 0.01) discard;

  vec3 normal = normalize(v_normal);
  float diffuse = max(dot(normal, u_lightDir), 0.0);
  // Two-sided lighting for interior faces
  if (!gl_FrontFacing) {
    diffuse = max(dot(-normal, u_lightDir), 0.0);
  }
  vec3 lighting = u_ambientColor + u_lightColor * diffuse;
  vec3 color = texColor.rgb * lighting;

  float dist = distance(v_worldPos, u_cameraPos);
  float fogFactor = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
  color = mix(color, u_fogColor, fogFactor);

  fragColor = vec4(color, texColor.a);
}
`;
