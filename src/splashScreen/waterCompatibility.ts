export type WaterCompatibilityReason =
  | 'supported'
  | 'forced-compatibility'
  | 'webgl2-unavailable'
  | 'half-float-unavailable'
  | 'software-renderer'
  | 'legacy-integrated-gpu'
  | 'low-end-mobile'
  | 'runtime-failure';

export interface WaterCompatibilityProfile {
  mode: 'full' | 'compatibility';
  mainWater: boolean;
  pointerWater: boolean;
  reason: WaterCompatibilityReason;
  renderer: string;
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render|lavapipe/i;
const LEGACY_INTEL_PATTERN =
  /intel.*(?:gma|hd graphics\s*(?:2000|2500|3000|4000|4200|4400|4600|5000|5100|5200|5300|5500|400|405|500|505|510|515|520|530)|uhd graphics\s*60[05])/i;
const LOW_END_MOBILE_GPU_PATTERN =
  /adreno.*(?:3\d{2}|4\d{2}|50[568])|mali-(?:4\d{2}|t\d{3}|g31|g51)|powervr.*sgx/i;

function isHalfFloatFramebufferSupported(gl: WebGL2RenderingContext) {
  if (!gl.getExtension('EXT_color_buffer_float')) return false;
  if (!gl.getExtension('OES_texture_float_linear')) return false;

  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) return false;

  let supported = false;
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      4,
      4,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    supported = gl.getError() === gl.NO_ERROR
      && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
  }
  return supported;
}

function getRendererName(gl: WebGL2RenderingContext) {
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  if (debugInfo) {
    return String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? 'unknown');
  }
  return String(gl.getParameter(gl.RENDERER) ?? 'unknown');
}

function releaseContext(gl: WebGL2RenderingContext) {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

export function detectWaterCompatibility(): WaterCompatibilityProfile {
  const forcedMode = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('waterMode')
    : null;
  if (forcedMode === 'compat') {
    return {
      mode: 'compatibility',
      mainWater: false,
      pointerWater: false,
      reason: 'forced-compatibility',
      renderer: 'forced',
    };
  }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    failIfMajorPerformanceCaveat: forcedMode !== 'full' && forcedMode !== 'pointer',
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (!gl) {
    return {
      mode: 'compatibility',
      mainWater: false,
      pointerWater: false,
      reason: 'webgl2-unavailable',
      renderer: 'unavailable',
    };
  }

  const renderer = getRendererName(gl);
  const halfFloatSupported = isHalfFloatFramebufferSupported(gl);
  const softwareRenderer = SOFTWARE_RENDERER_PATTERN.test(renderer);
  const legacyIntegratedGpu = LEGACY_INTEL_PATTERN.test(renderer);
  const lowEndMobileGpu = LOW_END_MOBILE_GPU_PATTERN.test(renderer);
  const navigatorInfo = navigator as NavigatorWithDeviceMemory;
  const deviceMemory = navigatorInfo.deviceMemory;
  const hardwareConcurrency = navigator.hardwareConcurrency || 0;
  const mobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const constrainedMobileDevice = mobileDevice && (
    lowEndMobileGpu
    || (deviceMemory !== undefined && deviceMemory <= 4 && hardwareConcurrency > 0 && hardwareConcurrency <= 4)
    || (deviceMemory !== undefined && deviceMemory <= 2)
    || (hardwareConcurrency > 0 && hardwareConcurrency <= 2)
  );

  releaseContext(gl);

  if (!halfFloatSupported) {
    return {
      mode: 'compatibility',
      mainWater: false,
      pointerWater: false,
      reason: 'half-float-unavailable',
      renderer,
    };
  }
  if (forcedMode === 'full') {
    return {
      mode: 'full',
      mainWater: true,
      pointerWater: true,
      reason: 'supported',
      renderer,
    };
  }
  if (forcedMode === 'pointer') {
    return {
      mode: 'compatibility',
      mainWater: false,
      pointerWater: true,
      reason: 'forced-compatibility',
      renderer,
    };
  }
  if (softwareRenderer) {
    return {
      mode: 'compatibility',
      mainWater: false,
      pointerWater: false,
      reason: 'software-renderer',
      renderer,
    };
  }
  if (constrainedMobileDevice) {
    return {
      mode: 'compatibility',
      mainWater: false,
      pointerWater: false,
      reason: 'low-end-mobile',
      renderer,
    };
  }
  if (legacyIntegratedGpu) {
    return {
      mode: 'compatibility',
      mainWater: false,
      pointerWater: true,
      reason: 'legacy-integrated-gpu',
      renderer,
    };
  }

  return {
    mode: 'full',
    mainWater: true,
    pointerWater: true,
    reason: 'supported',
    renderer,
  };
}
