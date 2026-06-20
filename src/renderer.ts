/**
 * WebGL2 Renderer
 *
 * Handles context creation, shader compilation, and low-level rendering.
 * All errors provide clear, actionable fix instructions.
 */

/**
 * Custom error class for Glyft with fix instructions.
 */
export class GlyftError extends Error {
  /** How to fix this error */
  readonly fix: string;

  constructor(message: string, fix: string) {
    super(`[Glyft] ${message}\n\nFix: ${fix}`);
    this.name = 'GlyftError';
    this.fix = fix;
  }
}

/** Compiled shader program */
export interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation>;
  attributes: Record<string, number>;
}

/**
 * Initialize WebGL2 context with optimal settings.
 *
 * @param canvas - The HTML canvas element to create the context on
 * @returns A WebGL2 rendering context configured for Glyft
 * @throws {GlyftError} If WebGL2 is not supported
 *
 * @example
 * ```typescript
 * const gl = createContext(document.getElementById('game') as HTMLCanvasElement);
 * ```
 */
export function createContext(canvas: HTMLCanvasElement, options?: { depth?: boolean }): WebGL2RenderingContext {
  if (!canvas) {
    throw new GlyftError(
      'Canvas element is null or undefined',
      'Make sure to pass a valid HTMLCanvasElement to Glyft constructor.\n' +
      'Example: new Glyft(document.getElementById("game") as HTMLCanvasElement, config)'
    );
  }

  if (!(canvas instanceof HTMLCanvasElement)) {
    const typeName = canvas && typeof canvas === 'object' && 'constructor' in canvas
      ? (canvas as { constructor?: { name?: string } }).constructor?.name ?? typeof canvas
      : typeof canvas;
    throw new GlyftError(
      `Expected HTMLCanvasElement but got ${typeName}`,
      'Pass a <canvas> element, not a <div> or other element.\n' +
      'Example: <canvas id="game"></canvas>'
    );
  }

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: options?.depth ?? false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });

  if (!gl) {
    throw new GlyftError(
      'WebGL2 not supported',
      'Glyft requires a browser with WebGL2 support. Try:\n' +
      '1. Update your browser to the latest version\n' +
      '2. Enable hardware acceleration in browser settings\n' +
      '3. Update your graphics drivers\n' +
      '4. Try a different browser (Chrome, Firefox, Edge)'
    );
  }

  // Default state
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  return gl;
}

/**
 * Compile a shader program from vertex and fragment source.
 *
 * @param gl - WebGL2 context
 * @param vertexSource - GLSL vertex shader source
 * @param fragmentSource - GLSL fragment shader source
 * @param uniformNames - Names of uniforms to locate
 * @param attributeNames - Names of attributes to locate
 * @returns Compiled shader program with uniform and attribute locations
 * @throws {GlyftError} If shader compilation or linking fails
 */
export function compileShader(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  uniformNames: string[],
  attributeNames: string[]
): ShaderProgram {
  const vertexShader = compileShaderStage(gl, gl.VERTEX_SHADER, vertexSource, 'vertex');
  const fragmentShader = compileShaderStage(gl, gl.FRAGMENT_SHADER, fragmentSource, 'fragment');

  const program = gl.createProgram();
  if (!program) {
    throw new GlyftError(
      'Failed to create shader program',
      'This is usually a GPU driver issue. Try updating your graphics drivers.'
    );
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new GlyftError(
      `Shader program failed to link`,
      `Link error: ${log}\n\n` +
      'This usually means the vertex and fragment shaders have mismatched varyings.\n' +
      'Check that all "out" variables in the vertex shader have matching "in" variables in the fragment shader.'
    );
  }

  // Clean up individual shaders
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  // Get uniform locations
  const uniforms: Record<string, WebGLUniformLocation> = {};
  for (const name of uniformNames) {
    const loc = gl.getUniformLocation(program, name);
    if (loc === null) {
      console.warn(`Uniform '${name}' not found in shader`);
    } else {
      uniforms[name] = loc;
    }
  }

  // Get attribute locations
  const attributes: Record<string, number> = {};
  for (const name of attributeNames) {
    const loc = gl.getAttribLocation(program, name);
    if (loc === -1) {
      console.warn(`Attribute '${name}' not found in shader`);
    }
    attributes[name] = loc;
  }

  return { program, uniforms, attributes };
}

/**
 * Compile a single shader stage with detailed error reporting.
 */
function compileShaderStage(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  shaderName: string = 'shader'
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new GlyftError(
      `Failed to create ${shaderName} shader`,
      'This is usually a GPU driver issue. Try updating your graphics drivers.'
    );
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'Unknown error';
    gl.deleteShader(shader);

    // Parse error log for line numbers and format nicely
    const errorLines = parseShaderErrors(log, source);

    throw new GlyftError(
      `${shaderName.charAt(0).toUpperCase() + shaderName.slice(1)} shader compilation failed`,
      `${errorLines}\n\n` +
      'Common causes:\n' +
      '- Syntax errors in GLSL code\n' +
      '- Using features not supported in GLSL ES 3.0\n' +
      '- Type mismatches in expressions\n' +
      '- Undeclared variables or functions'
    );
  }

  return shader;
}

/**
 * Parse shader error log and annotate source lines.
 */
function parseShaderErrors(log: string, source: string): string {
  const lines = source.split('\n');
  const errorRegex = /ERROR:\s*\d+:(\d+):\s*(.+)/gi;
  const errors: Array<{ line: number; message: string }> = [];

  let match;
  while ((match = errorRegex.exec(log)) !== null) {
    errors.push({ line: parseInt(match[1], 10), message: match[2] });
  }

  if (errors.length === 0) {
    return `Compiler output:\n${log}`;
  }

  let result = 'Errors found:\n\n';

  for (const error of errors) {
    const lineNum = error.line;
    const startLine = Math.max(0, lineNum - 3);
    const endLine = Math.min(lines.length - 1, lineNum + 1);

    result += `Line ${lineNum}: ${error.message}\n`;
    result += '─'.repeat(40) + '\n';

    for (let i = startLine; i <= endLine; i++) {
      const prefix = i + 1 === lineNum ? '>> ' : '   ';
      result += `${prefix}${String(i + 1).padStart(4)} | ${lines[i]}\n`;
    }
    result += '\n';
  }

  return result;
}

/**
 * Load an image and create a WebGL texture.
 *
 * @param gl - WebGL2 context
 * @param url - URL or path to the image file
 * @returns Promise that resolves to the loaded WebGL texture
 * @throws {GlyftError} If the image fails to load or texture creation fails
 *
 * @example
 * ```typescript
 * const texture = await loadTexture(gl, 'assets/sprites.png');
 * ```
 */
export async function loadTexture(
  gl: WebGL2RenderingContext,
  url: string,
  options?: { filter?: 'nearest' | 'linear' }
): Promise<WebGLTexture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      const texture = gl.createTexture();
      if (!texture) {
        reject(new GlyftError(
          'Failed to create texture',
          'This is usually a GPU memory issue. Try:\n' +
          '1. Close other browser tabs\n' +
          '2. Reduce image resolution\n' +
          '3. Update graphics drivers'
        ));
        return;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

      // Filtering: nearest for pixel art, linear for smooth art
      const filterMode = options?.filter === 'linear' ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterMode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterMode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      resolve(texture);
    };

    image.onerror = (_event) => {
      // Provide helpful path hints
      const isAbsolute = url.startsWith('/') || url.startsWith('http');
      const pathHint = isAbsolute
        ? `Make sure the file exists at: ${url}`
        : `Relative path "${url}" is resolved from the HTML file location.\n` +
          `If your HTML is at /game/index.html and image is at /game/assets/img.png,\n` +
          `use: loadAtlas('assets/img.png', ...)`;

      reject(new GlyftError(
        `Failed to load image: ${url}`,
        `${pathHint}\n\n` +
        'Common causes:\n' +
        '- File doesn\'t exist at the specified path\n' +
        '- Incorrect relative path (try absolute path starting with /)\n' +
        '- CORS policy blocking cross-origin requests\n' +
        '- File server not serving the directory'
      ));
    };

    image.src = url;
  });
}

/**
 * Create a data texture (for tilemap storage).
 */
export function createDataTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  data?: Uint8Array
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Failed to create data texture');
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);

  if (data) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  // No filtering for data textures
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return texture;
}

/**
 * Update a region of a data texture.
 */
export function updateDataTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  x: number,
  y: number,
  width: number,
  height: number,
  data: Uint8Array
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

/**
 * Create a vertex buffer.
 */
export function createBuffer(gl: WebGL2RenderingContext, data?: ArrayBuffer): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error('Failed to create buffer');
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  if (data) {
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  return buffer;
}

/**
 * Create a VAO for instanced rendering.
 */
export function createVAO(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error('Failed to create VAO');
  }
  return vao;
}

/**
 * Set canvas size to virtual viewport (pixel-perfect).
 * CSS handles scaling - canvas stays at exact viewport size.
 */
export function resizeCanvas(canvas: HTMLCanvasElement, viewport: [number, number]): boolean {
  const width = viewport[0];
  const height = viewport[1];

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}
