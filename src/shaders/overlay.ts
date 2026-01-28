/**
 * Overlay shader — composites a 2D canvas texture over the WebGL scene.
 *
 * Uses the same 0-to-1 quad VAO as the tilemap shader.
 * No camera or projection — screen-space only.
 */

export const overlayVertexShader = /*glsl*/ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;

out vec2 v_texCoord;

void main() {
  v_texCoord = a_position;
  vec2 clip = a_position * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

export const overlayFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform sampler2D u_overlayTexture;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 color = texture(u_overlayTexture, v_texCoord);
  if (color.a < 0.01) discard;
  fragColor = color;
}
`;
