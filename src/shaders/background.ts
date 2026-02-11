/**
 * Background shader — renders a static world-space background.
 *
 * The background covers the world bounds and scrolls with the camera.
 */

export const backgroundVertexShader = /*glsl*/ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;

uniform vec2 u_viewport;
uniform vec2 u_worldSize;
uniform vec2 u_camera;

out vec2 v_texCoord;

void main() {
  // a_position is 0-1 quad, maps to viewport
  vec2 worldPos = a_position * u_viewport + u_camera;

  // Map world position to texture UV (0-1 over world bounds)
  v_texCoord = worldPos / u_worldSize;

  // Output clip-space position
  vec2 clip = a_position * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

export const backgroundFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform sampler2D u_texture;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`;
