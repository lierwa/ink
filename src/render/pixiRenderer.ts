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
  SkinMask,
  SkinMeshData,
  SphereMeshResolution,
  SphereSurface,
  TattooTransform,
  TattooWarpMeshData,
} from "../domain/types";
import { createBackdrop } from "./pixiBackdrop";
import { installContextLifecycleHandlers } from "./pixiContextLifecycle";
import { drawBodyAnalysisDebug, syncDebugMeshWireframe } from "./pixiDebugGeometry";
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
  warpMesh: TattooWarpMeshData | null;
}

type PixiTattooStateInput = PixiTattooState | Omit<PixiTattooState, "warpMesh">;

export interface BodySurfaceRenderState {
  texture: Texture;
  surfaceNormalTexture: Texture | null;
  placementRect: Rect;
  mask: SkinMask;
  mesh: SkinMeshData | null;
}

export interface PixiTattooRenderer {
  canvas: HTMLCanvasElement;
  setBodySurface(state: BodySurfaceRenderState): void;
  setSurfaceNormalTexture(texture: Texture | null): void;
  setTattoo(state: PixiTattooStateInput): void;
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
    uStageSize: { value: Float32Array; type: "vec2<f32>" };
    uTattooOpacity: { value: number; type: "f32" };
    uSurfaceEnabled: { value: number; type: "f32" };
    uSurfaceDepth: { value: number; type: "f32" };
    uMaxWarpPx: { value: number; type: "f32" };
  }>;
};

export interface TattooShaderBindingTarget {
  resources: Record<string, unknown>;
}

export interface TattooShaderResourceInput {
  stageSize: Size;
  tattooSize: Size;
  transform: TattooTransform;
  surfaceDepth: number;
  maxWarpPx?: number;
}

export interface TattooSpriteBindingTarget {
  texture: Texture;
  anchor: { set(value: number): void };
  scale: { set(value: number): void };
  x: number;
  y: number;
  rotation: number;
  alpha: number;
  visible: boolean;
}

// WHY: 先保证贴图保真与稳定，避免 2.5D 体积感过强导致图案结构被拉裂。
// TRADE-OFF: 视觉体积感会比原方案保守，但可显著降低“完全变样”风险。
const defaultSurfaceDepth = 0.92;
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
  const tattooSprite = new Sprite(Texture.EMPTY);
  const debugWireframe = new Graphics();
  const bodyAnalysisDebug = new Graphics();
  let bodyMesh: SkinMeshData | null = null;
  let bodyMaskTexture: Texture | null = null;
  let currentTattooState: PixiTattooState | null = null;
  let currentSurfaceWarpEnabled = false;
  let skinDebugMeshOverride: SkinMeshData | null = null;
  let bodyAnalysisDebugState: BodySurfaceAnalysisDebugState | null = null;
  const sphereMesh = buildSphereMesh({ sphere: input.sphere, resolution: input.mesh });
  const fallbackProjectionMesh = mapSphereMeshToSkinMesh(sphereMesh);
  let activeProjectionMesh = fallbackProjectionMesh;
  const resources = createTattooShaderResources({
    stageSize: input.stageSize,
    tattooSize: { width: 1, height: 1 },
    transform: {
      x: input.sphere.cx,
      y: input.sphere.cy,
      scale: 1,
      rotation: 0,
      opacity: 0,
    },
    surfaceDepth: defaultSurfaceDepth,
    maxWarpPx: defaultSurfaceWarpLimitPx,
  });
  const shader = createTattooShader(resources);
  const tattooMesh = new Mesh({
    geometry: createMeshGeometry(activeProjectionMesh, input.stageSize),
    shader,
  });

  app.stage.sortableChildren = true;
  backdrop.zIndex = 0;
  bodyMask.zIndex = 1;
  bodySprite.zIndex = 2;
  tattooMesh.zIndex = 3;
  tattooSprite.zIndex = 4;
  debugWireframe.zIndex = 100;
  bodyAnalysisDebug.zIndex = 101;

  configureBodyMaskForMasking(bodyMask);
  bodySprite.anchor.set(0);
  tattooMesh.blendMode = tattooBlendMode;
  tattooMesh.mask = bodyMask;
  tattooMesh.visible = false;
  // WHY: 当前 shader mesh 在部分上传路径里会完成纹理绑定但画面不可见；Sprite 层作为同一 Pixi 舞台内的确定性预览路径。
  // TRADE-OFF: Sprite 预览不做曲面 warp，但先保证“上传后在 body 上看得到 tattoo”这个核心反馈不丢。
  tattooSprite.anchor.set(0.5);
  tattooSprite.blendMode = tattooBlendMode;
  tattooSprite.mask = bodyMask;
  tattooSprite.visible = false;
  tattooSprite.alpha = 0;
  debugWireframe.visible = false;
  bodyAnalysisDebug.visible = false;

  app.stage.addChild(backdrop);
  app.stage.addChild(bodyMask);
  app.stage.addChild(bodySprite);
  app.stage.addChild(tattooMesh);
  app.stage.addChild(tattooSprite);
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

      const previousBodyMaskTexture = bodyMaskTexture;
      bodyMaskTexture = createSkinMaskAlphaTexture(state.mask);
      bodyMask.texture = bodyMaskTexture;
      // WHY: Pixi mask sprite 先换到新 alpha 纹理，再释放旧纹理，避免销毁仍被当前 sprite 引用的 resource。
      // TRADE-OFF: 替换时多保留旧纹理一个同步步骤，但 body 上传频率低，资源安全优先。
      previousBodyMaskTexture?.destroy(true);
      bodyMask.x = state.placementRect.x;
      bodyMask.y = state.placementRect.y;
      bodyMask.width = state.placementRect.width;
      bodyMask.height = state.placementRect.height;

      bodyMesh = state.mesh;
      activeProjectionMesh = resolveProjectionMesh(state.mesh, fallbackProjectionMesh);
      currentSurfaceWarpEnabled = applySurfaceNormalTextureState(resources, shader, state.surfaceNormalTexture, input.disableSurfaceWarp ?? false);
      if (currentTattooState) {
        applyTattooSpriteState(tattooSprite, currentTattooState, {
          surfaceWarpEnabled: resolveFlatFallbackHidden(currentTattooState, currentSurfaceWarpEnabled),
        });
      }

      const previousGeometry = tattooMesh.geometry;
      tattooMesh.geometry = createMeshGeometry(activeProjectionMesh, input.stageSize);
      previousGeometry.destroy();
      syncDebugMeshWireframe(debugWireframe, debugWireframe.visible, skinDebugMeshOverride ?? bodyMesh);
      drawBodyAnalysisDebug(bodyAnalysisDebug, bodyAnalysisDebugState);
    },
    setTattoo(state) {
      const tattooState = normalizeTattooState(state);
      currentTattooState = tattooState;
      applyTattooState(resources, shader, tattooState);
      const previousGeometry = tattooMesh.geometry;
      // WHY: TPS 已经把 tattoo local grid 烘焙成 stage positions + tattoo UV，shader 只应采样 mesh UV，避免再用 flat transform 二次变形。
      // TRADE-OFF: 每次 tattoo 状态更新会替换 geometry，但当前交互频率低于逐帧动画，换取渲染路径职责清晰。
      tattooMesh.geometry = createMeshGeometry(tattooState.warpMesh ?? activeProjectionMesh, input.stageSize);
      previousGeometry.destroy();
      applyTattooMeshVisibilityState(tattooMesh, tattooState.transform.opacity);
      applyTattooSpriteState(tattooSprite, tattooState, {
        surfaceWarpEnabled: resolveFlatFallbackHidden(tattooState, currentSurfaceWarpEnabled),
      });
    },
    setSurfaceNormalTexture(texture) {
      currentSurfaceWarpEnabled = applySurfaceNormalTextureState(resources, shader, texture, input.disableSurfaceWarp ?? false);
      if (currentTattooState) {
        applyTattooSpriteState(tattooSprite, currentTattooState, {
          surfaceWarpEnabled: resolveFlatFallbackHidden(currentTattooState, currentSurfaceWarpEnabled),
        });
      }
    },
    clearTattoo() {
      currentTattooState = null;
      clearTattooState(resources, shader);
      applyTattooMeshVisibilityState(tattooMesh, 0);
      clearTattooSpriteState(tattooSprite);
    },
    setDebugMeshVisible(visible) {
      syncDebugMeshWireframe(debugWireframe, visible, skinDebugMeshOverride ?? bodyMesh);
    },
    setSkinDebugMesh(mesh) {
      skinDebugMeshOverride = mesh;
      syncDebugMeshWireframe(debugWireframe, debugWireframe.visible, skinDebugMeshOverride ?? bodyMesh);
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
      bodyMaskTexture?.destroy(true);
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

function normalizeTattooState(state: PixiTattooStateInput): PixiTattooState {
  if ("warpMesh" in state) {
    return state;
  }

  // WHY: Task 3 只 owns renderer，app 集成会在后续任务补真实 warpMesh；这里把旧调用收口为 null，避免跨文件修改。
  // TRADE-OFF: 短期保留一个兼容入口，但 renderer 内部始终使用完整 PixiTattooState，后续删除成本低。
  return {
    ...state,
    warpMesh: null,
  };
}

export function clearTattooState(
  resources: TattooShaderResources,
  shader: TattooShaderBindingTarget,
): void {
  resources.uTexture = getSafeFallbackTextureSource();
  resources.tattooUniforms.uniforms.uTattooOpacity = 0;
  shader.resources.uTexture = resources.uTexture;
}

export function applyTattooSpriteState(
  sprite: TattooSpriteBindingTarget,
  state: PixiTattooState,
  options: { surfaceWarpEnabled?: boolean } = {},
): void {
  sprite.texture = state.texture;
  sprite.anchor.set(0.5);
  sprite.scale.set(state.transform.scale);
  sprite.x = state.transform.x;
  sprite.y = state.transform.y;
  sprite.rotation = state.transform.rotation;
  sprite.alpha = state.transform.opacity;
  sprite.visible = state.transform.opacity > 0 && !resolveFlatFallbackHidden(state, options.surfaceWarpEnabled ?? false);
}

export function resolveFlatFallbackHidden(
  state: Pick<PixiTattooState, "warpMesh">,
  currentSurfaceWarpEnabled: boolean,
): boolean {
  return Boolean(state.warpMesh) || currentSurfaceWarpEnabled;
}

export function applyTattooMeshVisibilityState(
  mesh: { visible: boolean },
  opacity: number,
): void {
  mesh.visible = opacity > 0;
}

export function clearTattooSpriteState(
  sprite: Pick<TattooSpriteBindingTarget, "texture" | "alpha" | "visible">,
): void {
  sprite.texture = Texture.EMPTY;
  sprite.alpha = 0;
  sprite.visible = false;
}

export function applySurfaceNormalTextureState(
  resources: TattooShaderResources,
  shader: TattooShaderBindingTarget,
  texture: Texture | null,
  disableSurfaceWarp = false,
): boolean {
  const surfaceWarpEnabled = resolveSurfaceWarpEnabled({
    disableSurfaceWarp,
    surfaceNormalTexture: texture,
  });
  resources.uSurfaceNormalTex = texture?.source ?? getSafeFallbackTextureSource();
  resources.tattooUniforms.uniforms.uSurfaceEnabled = surfaceWarpEnabled ? 1 : 0;
  shader.resources.uSurfaceNormalTex = resources.uSurfaceNormalTex;
  return surfaceWarpEnabled;
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
      uStageSize: {
        value: new Float32Array([input.stageSize.width, input.stageSize.height]),
        type: "vec2<f32>",
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
      uMaxWarpPx: {
        value: input.maxWarpPx ?? defaultSurfaceWarpLimitPx,
        type: "f32",
      },
    }),
  };
}

export function createSkinMaskAlphaCanvas(mask: SkinMask): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const width = Math.max(1, Math.round(mask.width));
  const height = Math.max(1, Math.round(mask.height));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return canvas;
  }

  const imageData = context.createImageData(width, height);
  imageData.data.set(createSkinMaskAlphaPixels(mask));

  // WHY: 上传 body 通常是 JPG/WebP，原图 alpha 是整张矩形；用 skin mask alpha 作为 Pixi mask 才能把 tattoo 限制在可贴肤区域。
  // TRADE-OFF: mask 纹理会随 body mesh 更新重建一次，但 Pixi Sprite mask 路径成熟稳定，避免自研裁剪 shader。
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export function createSkinMaskAlphaPixels(mask: SkinMask): Uint8ClampedArray {
  const width = Math.max(1, Math.round(mask.width));
  const height = Math.max(1, Math.round(mask.height));
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    const probability = mask.probabilities[i] ?? 0;
    const alpha = Math.round(clamp(probability, 0, 1) * 255);
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = alpha;
  }

  return pixels;
}

function createSkinMaskAlphaTexture(mask: SkinMask): Texture {
  return Texture.from(createSkinMaskAlphaCanvas(mask));
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
      vec2 tattooUv = vSurfaceUv;
      float surfaceLight = 1.0;

      if (uSurfaceEnabled > 0.5) {
        vec4 encodedNormal = texture(uSurfaceNormalTex, vec2(
          clamp(vSurfacePoint.x / max(uStageSize.x, 1.0), 0.0, 1.0),
          clamp(vSurfacePoint.y / max(uStageSize.y, 1.0), 0.0, 1.0)
        ));

        if (encodedNormal.a > 0.0) {
          vec3 surfaceNormal = normalize(encodedNormal.rgb * 2.0 - 1.0);
          surfaceLight = clamp(dot(surfaceNormal, normalize(vec3(-0.35, -0.25, 0.9))) * 0.38 + 0.72, 0.72, 1.12);
        }
      }

      if (
        tattooUv.x < 0.0 ||
        tattooUv.x > 1.0 ||
        tattooUv.y < 0.0 ||
        tattooUv.y > 1.0
      ) {
        outColor = vec4(0.0);
      } else {
        vec4 tattooColor = texture(uTexture, tattooUv);
        outColor = vec4(tattooColor.rgb * surfaceLight, tattooColor.a * uTattooOpacity);
      }
    `;

export const tattooProjectionFragmentHeader = `
      in vec2 vSurfacePoint;
      in vec2 vSurfaceUv;
      uniform sampler2D uTexture;
      uniform sampler2D uSurfaceNormalTex;
      uniform vec2 uTattooSize;
      uniform vec4 uTattooTransform;
      uniform vec2 uStageSize;
      uniform float uTattooOpacity;
      uniform float uSurfaceEnabled;
      uniform float uSurfaceDepth;
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

function getSafeFallbackTextureSource(): Texture["source"] {
  // WHY: Pixi 的 Texture.EMPTY 没有实际像素 resource，WebGL sampler 在状态切换后可能进入生成代码并读取空资源。
  // TRADE-OFF: 使用 1x1 WHITE 会多绑定一个真实纹理，但禁用态由 opacity/uSurfaceEnabled 控制，不改变最终视觉。
  return Texture.WHITE.source;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
