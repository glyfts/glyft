/**
 * Terrain shaders for heightmap mesh rendering.
 *
 * Vertex shader: transforms terrain mesh through MVP matrix.
 * Fragment shader: textured surface with directional lighting and distance fog.
 */

export const terrainVertexShader = /*glsl*/ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_mvp;

out vec3 v_normal;
out vec2 v_uv;
out vec3 v_worldPos;

void main() {
  v_normal = a_normal;
  v_uv = a_uv;
  v_worldPos = a_position;
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
uniform vec3 u_cameraPos;

in vec3 v_normal;
in vec2 v_uv;
in vec3 v_worldPos;

out vec4 fragColor;

void main() {
  // Sample texture
  vec4 texColor = texture(u_texture, v_uv);

  // Directional lighting (Lambert)
  vec3 normal = normalize(v_normal);
  float diffuse = max(dot(normal, u_lightDir), 0.0);
  vec3 lighting = u_ambientColor + u_lightColor * diffuse;

  vec3 color = texColor.rgb * lighting;

  // Distance fog
  float dist = distance(v_worldPos, u_cameraPos);
  float fogFactor = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
  color = mix(color, u_fogColor, fogFactor);

  fragColor = vec4(color, 1.0);
}
`;
