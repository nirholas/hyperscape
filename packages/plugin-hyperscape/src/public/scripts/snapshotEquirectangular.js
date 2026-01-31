/**
 * Equirectangular Panorama Snapshot Utility
 *
 * Captures a 360° panoramic view from the player's position and returns
 * it as a base64-encoded JPEG image.
 *
 * WEBGPU COMPATIBILITY NOTE:
 * This script currently uses WebGL-specific features:
 * - THREE.WebGLCubeRenderTarget for cube map capture
 * - THREE.ShaderMaterial with GLSL for equirectangular projection
 * - Synchronous readRenderTargetPixels (WebGPU requires async)
 *
 * For WebGPU, would need:
 * - Use THREE.CubeRenderTarget (works with both renderers)
 * - Use MeshBasicNodeMaterial with TSL for projection
 * - Use async readRenderTargetPixelsAsync for pixel reading
 * - Cube texture sampling in TSL: textureCube(envMap, direction)
 *
 * TSL equivalent of the projection shader would be:
 * ```
 * import { MeshBasicNodeMaterial, cubeTexture } from "three/webgpu";
 * const { Fn, uv, uniform, float, vec3, sin, cos, mul, sub, PI } = THREE_WEBGPU.TSL;
 *
 * const material = new MeshBasicNodeMaterial();
 * const uEnvMap = uniform(cubeRenderTarget.texture);
 * material.colorNode = Fn(() => {
 *   const uvCoord = uv();
 *   const flippedU = sub(float(1.0), uvCoord.x);
 *   const theta = mul(flippedU, mul(float(2.0), PI));
 *   const phi = mul(uvCoord.y, PI);
 *   const dir = vec3(
 *     mul(sin(theta), sin(phi)),
 *     cos(phi),
 *     mul(cos(theta), sin(phi))
 *   );
 *   return cubeTexture(uEnvMap, dir);
 * })();
 * ```
 */
window.snapshotEquirectangular = async function (playerData) {
  // THREE is already available via import maps in index.html
  const renderer = window.renderer;
  const scene = window.scene;

  const size = 1024;

  // Note: Using WebGLCubeRenderTarget for now (works with both renderers)
  // For native WebGPU, would use THREE.CubeRenderTarget
  const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  const eye = new THREE.Vector3().fromArray(playerData.position);
  eye.y += 2;

  const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);
  cubeCamera.position.copy(eye);
  cubeCamera.quaternion.set(...playerData.quaternion);
  cubeCamera.update(renderer, scene);

  const rtWidth = 2048;
  const rtHeight = 1024;

  const renderTarget = new THREE.WebGLRenderTarget(rtWidth, rtHeight);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sceneRTT = new THREE.Scene();

  // GLSL ShaderMaterial for equirectangular projection
  // TODO: Replace with MeshBasicNodeMaterial + TSL when WebGPU pipeline is ready
  const material = new THREE.ShaderMaterial({
    uniforms: {
      envMap: { value: cubeRenderTarget.texture },
      resolution: { value: new THREE.Vector2(rtWidth, rtHeight) },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
    fragmentShader: `
        precision mediump float;
        uniform samplerCube envMap;
        varying vec2 vUv;
  
        const float PI = 3.14159265359;
  
        void main() {
          vec2 uv = vUv;
          uv.x = 1.0 - uv.x;
          float theta = uv.x * 2.0 * PI;
          float phi = uv.y * PI;
          vec3 dir = vec3(
            sin(theta) * sin(phi),
            cos(phi),
            cos(theta) * sin(phi)
          );
          gl_FragColor = textureCube(envMap, dir);
        }
      `,
  });

  const plane = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(plane, material);
  sceneRTT.add(quad);

  renderer.setRenderTarget(renderTarget);
  renderer.render(sceneRTT, camera);
  renderer.setRenderTarget(null);

  const pixels = new Uint8Array(rtWidth * rtHeight * 4);
  renderer.readRenderTargetPixels(
    renderTarget,
    0,
    0,
    rtWidth,
    rtHeight,
    pixels,
  );

  const canvas = document.createElement("canvas");
  canvas.width = rtWidth;
  canvas.height = rtHeight;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(rtWidth, rtHeight);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/jpeg").split(",")[1];
};
