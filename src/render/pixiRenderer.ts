import {
  Application,
  compileHighShaderGlProgram,
  Graphics,
  localUniformBitGl,
  Mesh,
  MeshGeometry,
  roundPixelsBitGl,
  Shader,
  Sprite,
  Texture,
  UniformGroup,
  type HighShaderBit,
} from "pixi.js";
import { buildSphereMesh, type SphereMeshData } from "../domain/sphereMesh";
import type {
  BodySurfaceAnalysisDebugState,
  Rect,
  Size,
  SkinMeshData,
  SphereMeshResolution,
  SphereSurface,
  TattooTransform,
} from "../domain/types";
import { createBackdrop } from "./pixiBackdrop";
import { installContextLifecycleHandlers } from "./pixiContextLifecycle";
import { drawActiveDebugMesh, drawBodyAnalysisDebug } from "./pixiDebugGeometry";
import { ensureTattooSizeUniform, ensureTattooTransformUniform } from "./pixiShaderUniforms";
export {
  createBodyAnalysisDebugSegments,
  createSkinWireframeSegments,
  createSphereWireframeSegments,
} from "./pixiDebugGeometry";

export interface PixiRendererInput {
  mount: HTMLElement;
  stageSize: Size;
  sphere: SphereSurface;
  mesh: SphereMeshResolution;
  disableSurfaceWarp?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface PixiTattooState {
  texture: Texture;
  tattooSize: Size;
  transform: TattooTransform;
}

export interface BodySurfaceRenderState {
  texture: Texture;
  surfaceNormalTexture: Texture | null;
  placementRect: Rect;
  mesh: SkinMeshData | null;
}

export interface PixiTattooRenderer {
  canvas: HTMLCanvasElement;
  setBodySurface(state: BodySurfaceRenderState): void;
  setSurfaceNormalTexture(texture: Texture | null): void;
  setSurfaceIntensity(intensity: number): void;
  setTattoo(state: PixiTattooState): void;
  clearTattoo(): void;
  setDebugMeshVisible(visible: boolean): void;
  setSkinDebugMesh(mesh: SkinMeshData | null): void;
  setBodyAnalysisDebug(state: BodySurfaceAnalysisDebugState | null): void;
  setBodyAnalysisDebugVisible(visible: boolean): void;
  destroy(): void;
}

export const tattooBlendMode = "normal";
export const hiddenMaskRenderableVisible = true;
export const hiddenMaskRenderableFlag = false;

export type TattooShaderResources = {
  uTexture: Texture["source"];
  uSurfaceNormalTex: Texture["source"];
  tattooUniforms: UniformGroup<{
    uTattooSize: { value: Float32Array; type: "vec2<f32>" };
    uTattooTransform: { value: Float32Array; type: "vec4<f32>" };
    uTattooOpacity: { value: number; type: "f32" };
    uSurfaceEnabled: { value: number; type: "f32" };
    uSurfaceDepth: { value: number; type: "f32" };
    uSurfaceIntensity: { value: number; type: "f32" };
    uMaxWarpPx: { value: number; type: "f32" };
  }>;
};

export interface TattooShaderBindingTarget {
  resources: Record<string, unknown>;
}

export interface TattooShaderResourceInput {
  tattooSize: Size;
  transform: TattooTransform;
  surfaceDepth: number;
  surfaceIntensity?: number;
  maxWarpPx?: number;
}

// WHY: 先保证贴图保真与稳定，避免 2.5D 体积感过强导致图案结构被拉裂。
// TRADE-OFF: 视觉体积感会比原方案保守，但可显著降低“完全变样”风险。
const defaultSurfaceDepth = 0.92;
const defaultSurfaceIntensity = 1.4;
const defaultSurfaceWarpLimitPx = 56;

export async function createPixiTattooRenderer(
  input: PixiRendererInput,
): Promise<PixiTattooRenderer> {
  const app = new Application();

  await app.init({
    width: input.stageSize.width,
    height: input.stageSize.height,
    antialias: true,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preference: "webgl",
  });

  app.canvas.setAttribute("aria-label", "2D body tattoo preview canvas");
  installContextLifecycleHandlers(app.canvas, input);
  input.mount.appendChild(app.canvas);

  const backdrop = createBackdrop(input.stageSize);
  const bodyMask = new Sprite(Texture.EMPTY);
  const bodySprite = new Sprite(Texture.EMPTY);
  const debugWireframe = new Graphics();
  const bodyAnalysisDebug = new Graphics();
  let bodyMesh: SkinMeshData | null = null;
  let skinDebugMeshOverride: SkinMeshData | null = null;
  let bodyAnalysisDebugState: BodySurfaceAnalysisDebugState | null = null;
  const sphereMesh = buildSphereMesh({ sphere: input.sphere, resolution: input.mesh });
  const fallbackProjectionMesh = mapSphereMeshToSkinMesh(sphereMesh);
  let activeProjectionMesh = fallbackProjectionMesh;
  const resources = createTattooShaderResources({
    tattooSize: { width: 1, height: 1 },
    transform: {
      x: input.sphere.cx,
      y: input.sphere.cy,
      scale: 1,
      rotation: 0,
      opacity: 0,
    },
    surfaceDepth: defaultSurfaceDepth,
    surfaceIntensity: defaultSurfaceIntensity,
    maxWarpPx: defaultSurfaceWarpLimitPx,
  });
  const shader = createTattooShader(resources);
  const tattooMesh = new Mesh({
    geometry: createMeshGeometry(activeProjectionMesh, input.stageSize),
    shader,
  });

  configureBodyMaskForMasking(bodyMask);
  bodySprite.anchor.set(0);
  tattooMesh.blendMode = tattooBlendMode;
  tattooMesh.mask = bodyMask;
  debugWireframe.visible = false;
  bodyAnalysisDebug.visible = false;

  app.stage.addChild(backdrop);
  app.stage.addChild(bodyMask);
  app.stage.addChild(bodySprite);
  app.stage.addChild(tattooMesh);
  app.stage.addChild(debugWireframe);
  app.stage.addChild(bodyAnalysisDebug);

  return {
    canvas: app.canvas,
    setBodySurface(state) {
      bodySprite.texture = state.texture;
      bodySprite.x = state.placementRect.x;
      bodySprite.y = state.placementRect.y;
      bodySprite.width = state.placementRect.width;
      bodySprite.height = state.placementRect.height;

      bodyMask.texture = state.texture;
      bodyMask.x = state.placementRect.x;
      bodyMask.y = state.placementRect.y;
      bodyMask.width = state.placementRect.width;
      bodyMask.height = state.placementRect.height;

      bodyMesh = state.mesh;
      activeProjectionMesh = resolveProjectionMesh(state.mesh, fallbackProjectionMesh);
      applySurfaceNormalTextureState(resources, shader, state.surfaceNormalTexture, input.disableSurfaceWarp ?? false);

      const previousGeometry = tattooMesh.geometry;
      tattooMesh.geometry = createMeshGeometry(activeProjectionMesh, input.stageSize);
      previousGeometry.destroy();
      drawActiveDebugMesh(debugWireframe, skinDebugMeshOverride ?? bodyMesh);
      drawBodyAnalysisDebug(bodyAnalysisDebug, bodyAnalysisDebugState);
    },
    setTattoo(state) {
      applyTattooState(resources, shader, state);
    },
    setSurfaceNormalTexture(texture) {
      applySurfaceNormalTextureState(resources, shader, texture, input.disableSurfaceWarp ?? false);
    },
    setSurfaceIntensity(intensity) {
      resources.tattooUniforms.uniforms.uSurfaceIntensity = clampNumber(intensity, 0, 5);
    },
    clearTattoo() {
      clearTattooState(resources, shader);
    },
    setDebugMeshVisible(visible) {
      debugWireframe.visible = visible;
    },
    setSkinDebugMesh(mesh) {
      skinDebugMeshOverride = mesh;
      drawActiveDebugMesh(debugWireframe, skinDebugMeshOverride ?? bodyMesh);
    },
    setBodyAnalysisDebug(state) {
      bodyAnalysisDebugState = state;
      drawBodyAnalysisDebug(bodyAnalysisDebug, bodyAnalysisDebugState);
    },
    setBodyAnalysisDebugVisible(visible) {
      bodyAnalysisDebug.visible = visible;
    },
    destroy() {
      const geometry = tattooMesh.geometry;
      app.destroy({ removeView: true }, { children: true });
      geometry.destroy();
      shader.destroy();
    },
  };
}

export function applyTattooState(
  resources: TattooShaderResources,
  shader: TattooShaderBindingTarget,
  state: PixiTattooState,
): void {
  const tattooSizeUniform = ensureTattooSizeUniform(resources);
  const tattooTransformUniform = ensureTattooTransformUniform(resources);
  resources.uTexture = state.texture.source;
  tattooSizeUniform[0] = state.tattooSize.width;
  tattooSizeUniform[1] = state.tattooSize.height;
  tattooTransformUniform[0] = state.transform.x;
  tattooTransformUniform[1] = state.transform.y;
  tattooTransformUniform[2] = state.transform.scale;
  tattooTransformUniform[3] = state.transform.rotation;
  resources.tattooUniforms.uniforms.uTattooOpacity = state.transform.opacity;
  shader.resources.uTexture = resources.uTexture;
}

export function clearTattooState(
  resources: TattooShaderResources,
  shader: TattooShaderBindingTarget,
): void {
  resources.uTexture = getSafeFallbackTextureSource();
  resources.tattooUniforms.uniforms.uTattooOpacity = 0;
  shader.resources.uTexture = resources.uTexture;
}

export function applySurfaceNormalTextureState(
  resources: TattooShaderResources,
  shader: TattooShaderBindingTarget,
  texture: Texture | null,
  disableSurfaceWarp = false,
): void {
  const surfaceWarpEnabled = resolveSurfaceWarpEnabled({
    disableSurfaceWarp,
    surfaceNormalTexture: texture,
  });
  resources.uSurfaceNormalTex = texture?.source ?? getSafeFallbackTextureSource();
  resources.tattooUniforms.uniforms.uSurfaceEnabled = surfaceWarpEnabled ? 1 : 0;
  shader.resources.uSurfaceNormalTex = resources.uSurfaceNormalTex;
}

export function configureBodyMaskForMasking(mask: Sprite): void {
  // WHY: Pixi v8 中 `visible=false` 会让 mask 跳过渲染路径，导致整层贴图被完全裁空。
  // TRADE-OFF: 保持 `visible=true` 以参与 mask 计算，同时 `renderable=false` 避免重复绘制到舞台。
  mask.visible = hiddenMaskRenderableVisible;
  mask.renderable = hiddenMaskRenderableFlag;
}

export function createTattooShaderResources(
  input: TattooShaderResourceInput,
): TattooShaderResources {
  return {
    uTexture: getSafeFallbackTextureSource(),
    uSurfaceNormalTex: getSafeFallbackTextureSource(),
    tattooUniforms: new UniformGroup({
      uTattooSize: {
        value: new Float32Array([input.tattooSize.width, input.tattooSize.height]),
        type: "vec2<f32>",
      },
      uTattooTransform: {
        value: new Float32Array([
          input.transform.x,
          input.transform.y,
          input.transform.scale,
          input.transform.rotation,
        ]),
        type: "vec4<f32>",
      },
      uTattooOpacity: {
        value: input.transform.opacity,
        type: "f32",
      },
      uSurfaceEnabled: {
        value: 0,
        type: "f32",
      },
      uSurfaceDepth: {
        value: input.surfaceDepth,
        type: "f32",
      },
      uSurfaceIntensity: {
        value: clampNumber(input.surfaceIntensity ?? defaultSurfaceIntensity, 0, 5),
        type: "f32",
      },
      uMaxWarpPx: {
        value: input.maxWarpPx ?? defaultSurfaceWarpLimitPx,
        type: "f32",
      },
    }),
  };
}

function createTattooShader(resources: TattooShaderResources): Shader {
  return new Shader({
    glProgram: compileHighShaderGlProgram({
      name: "mesh-domain-tattoo-projection",
      bits: [
        localUniformBitGl,
        roundPixelsBitGl,
        tattooProjectionBit,
      ],
    }),
    resources,
  });
}

export function createMeshGeometry(mesh: SkinMeshData, stageSize: Size): MeshGeometry {
  return new MeshGeometry({
    positions: mesh.positions,
    uvs: createUvBuffer(mesh, stageSize),
    indices: mesh.indices,
  });
}

export const tattooProjectionFragmentMain = `
      float safeScale = max(abs(uTattooTransform.z), 0.0001);
      vec2 localPoint = (vSurfacePoint - uTattooTransform.xy) / safeScale;
      vec2 warpedPoint = localPoint;

      if (uSurfaceEnabled > 0.5) {
        vec4 encodedNormal = texture(uSurfaceNormalTex, vSurfaceUv);

        if (encodedNormal.a > 0.0) {
          vec3 surfaceNormal = normalize(encodedNormal.rgb * 2.0 - 1.0);
          float surfaceIntensity = clamp(uSurfaceIntensity, 0.0, 5.0);
          float appliedWarpLimit = min(64.0, uMaxWarpPx);
          float fitStrength = clamp(uSurfaceDepth * surfaceIntensity / 5.0, 0.0, 1.0);
          float warpScalePx = appliedWarpLimit * fitStrength * encodedNormal.a;
          vec2 warpOffsetPx = surfaceNormal.xy * warpScalePx;
          float warpLength = length(warpOffsetPx);

          if (warpLength > appliedWarpLimit) {
            warpOffsetPx *= appliedWarpLimit / warpLength;
          }

          warpedPoint = localPoint + warpOffsetPx;
        }
      }

      float c = cos(uTattooTransform.w);
      float s = sin(uTattooTransform.w);
      vec2 rotatedPoint = vec2(
        warpedPoint.x * c + warpedPoint.y * s,
        warpedPoint.y * c - warpedPoint.x * s
      );
      vec2 tattooUv = rotatedPoint / uTattooSize + vec2(0.5);

      if (
        tattooUv.x < 0.0 ||
        tattooUv.x > 1.0 ||
        tattooUv.y < 0.0 ||
        tattooUv.y > 1.0
      ) {
        outColor = vec4(0.0);
      } else {
        vec4 tattooColor = texture(uTexture, tattooUv);
        outColor = vec4(tattooColor.rgb, tattooColor.a * uTattooOpacity);
      }
    `;

export const tattooProjectionFragmentHeader = `
      in vec2 vSurfacePoint;
      in vec2 vSurfaceUv;
      uniform sampler2D uTexture;
      uniform sampler2D uSurfaceNormalTex;
      uniform vec2 uTattooSize;
      uniform vec4 uTattooTransform;
      uniform float uTattooOpacity;
      uniform float uSurfaceEnabled;
      uniform float uSurfaceDepth;
      uniform float uSurfaceIntensity;
      uniform float uMaxWarpPx;
    `;

const tattooProjectionBit: HighShaderBit = {
  name: "tattoo-projection-bit",
  vertex: {
    header: `
      out vec2 vSurfacePoint;
      out vec2 vSurfaceUv;
    `,
    main: `
      vSurfacePoint = position;
      vSurfaceUv = uv;
    `,
  },
  fragment: {
    header: tattooProjectionFragmentHeader,
    main: tattooProjectionFragmentMain,
  },
};

export function resolveProjectionMesh(
  mesh: SkinMeshData | null,
  fallbackMesh: SkinMeshData,
): SkinMeshData {
  if (!mesh || mesh.indices.length < 3 || mesh.positions.length < 6) {
    return fallbackMesh;
  }
  return mesh;
}

export function mapSphereMeshToSkinMesh(mesh: SphereMeshData): SkinMeshData {
  return {
    positions: new Float32Array(mesh.positions),
    uvs: new Float32Array(mesh.sphereUv),
    indices: new Uint32Array(mesh.indices),
  };
}

function createUvBuffer(mesh: SkinMeshData, stageSize: Size): Float32Array {
  if (isValidUvBuffer(mesh.uvs, mesh.positions.length)) {
    return new Float32Array(mesh.uvs);
  }

  return createUvBufferFromPositions(mesh.positions, stageSize);
}

function createUvBufferFromPositions(positions: Float32Array, stageSize: Size): Float32Array {
  const uvs = new Float32Array(positions.length);
  const safeWidth = Math.max(stageSize.width, 1);
  const safeHeight = Math.max(stageSize.height, 1);

  for (let i = 0; i < positions.length; i += 2) {
    // WHY: mesh 仍可能缺少业务 UV，回退到舞台归一化 UV 可确保法线采样与渲染路径不中断。
    // TRADE-OFF: 回退 UV 不能表达严格纹理参数化，但比渲染失败更可控。
    uvs[i] = positions[i] / safeWidth;
    uvs[i + 1] = positions[i + 1] / safeHeight;
  }

  return uvs;
}

interface SurfaceWarpEnableInput {
  disableSurfaceWarp: boolean;
  surfaceNormalTexture: Texture | null;
}

export function resolveSurfaceWarpEnabled(input: SurfaceWarpEnableInput): boolean {
  return !input.disableSurfaceWarp && Boolean(input.surfaceNormalTexture);
}

function isValidUvBuffer(uvs: Float32Array | undefined, expectedLength: number): uvs is Float32Array {
  if (!uvs || uvs.length !== expectedLength) {
    return false;
  }

  for (let i = 0; i < uvs.length; i += 1) {
    const value = uvs[i];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return false;
    }
  }

  return true;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getSafeFallbackTextureSource(): Texture["source"] {
  // WHY: Pixi 的 Texture.EMPTY 没有实际像素 resource，WebGL sampler 在状态切换后可能进入生成代码并读取空资源。
  // TRADE-OFF: 使用 1x1 WHITE 会多绑定一个真实纹理，但禁用态由 opacity/uSurfaceEnabled 控制，不改变最终视觉。
  return Texture.WHITE.source;
}
