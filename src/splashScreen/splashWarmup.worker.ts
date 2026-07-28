interface ShaderProgramSource {
  name: string;
  vertex: string;
  fragment: string;
}

interface WarmupRequest {
  programs: ShaderProgramSource[];
}

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
) => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create shader.');
  gl.shaderSource(shader, `#version 300 es\n${source}`);
  gl.compileShader(shader);
  return shader;
};

const waitForProgram = async (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  completionStatus: number | null,
) => {
  if (completionStatus !== null) {
    while (!gl.getProgramParameter(program, completionStatus)) {
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Shader program link failed.');
  }
};

self.onmessage = async (event: MessageEvent<WarmupRequest>) => {
  const startedAt = performance.now();
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = new OffscreenCanvas(2, 2);
    gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('Worker WebGL2 is unavailable.');

    const parallel = gl.getExtension('KHR_parallel_shader_compile') as
      | { COMPLETION_STATUS_KHR: number }
      | null;
    const linkedPrograms: Array<{
      name: string;
      program: WebGLProgram;
      vertex: WebGLShader;
      fragment: WebGLShader;
    }> = [];

    for (const source of event.data.programs) {
      const vertex = compileShader(gl, gl.VERTEX_SHADER, source.vertex);
      const fragment = compileShader(gl, gl.FRAGMENT_SHADER, source.fragment);
      const program = gl.createProgram();
      if (!program) throw new Error(`Unable to create ${source.name} program.`);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      linkedPrograms.push({ name: source.name, program, vertex, fragment });
    }

    await Promise.all(linkedPrograms.map(async ({ name, program }) => {
      try {
        await waitForProgram(gl, program, parallel?.COMPLETION_STATUS_KHR ?? null);
      } catch (error) {
        throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));

    linkedPrograms.forEach(({ program, vertex, fragment }) => {
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    });
    self.postMessage({
      ok: true,
      parallel: Boolean(parallel),
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
};
