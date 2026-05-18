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
import { buildSphereMesh, buildSphereWireframeSegments, type SphereMeshData } from "../domain/sphereMesh";
import type { Rect, Size, SkinMeshData, SphereMeshResolution, SphereSurface, TattooTransform } from "../domain/types";

export interface PixiRendererInput {
  mount: HTMLElement;
  stageSize: Size;
  sphere: SphereSurface;
  mesh: SphereMeshResolution;
}

export interface PixiTattooState {
  texture: Texture;
  tattooSize: Size;
  transform: TattooTransform;
}

export interface BodySurfaceRenderState {
  texture: Texture;
  placementRect: Rect;
  mesh: SkinMeshData | null;
}

export interface PixiTattooRenderer {
  canvas: HTMLCanvasElement;
  setBodySurface(state: BodySurfaceRenderState): void;
  setTattoo(state: PixiTattooState): void;
  clearTattoo(): void;
  setDebugMeshVisible(visible: boolean): void;
  setSkinDebugMesh(mesh: SkinMeshData | null): void;
  destroy(): void;
}

export const tattooBlendMode = "normal";
export const hiddenMaskRenderableVisible = true;
export const hiddenMaskRenderableFlag = false;

export type TattooShaderResources = {
  uTexture: Texture["source"];
  tattooUniforms: UniformGroup<{
    uTattooSize: { value: Float32Array; type: "vec2<f32>" };
    uTattooTransform: { value: Float32Array; type: "vec4<f32>" };
    uTattooOpacity: { value: number; type: "f32" };
  }>;
};

export interface TattooShaderBindingTarget {
  resources: Record<string, unknown>;
}

export interface TattooShaderResourceInput {
  tattooSize: Size;
  transform: TattooTransform;
}

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
  input.mount.appendChild(app.canvas);

  const backdrop = createBackdrop(input.stageSize);
  const bodyMask = new Sprite(Texture.EMPTY);
  const bodySprite = new Sprite(Texture.EMPTY);
  const debugWireframe = new Graphics();
  let bodyMesh: SkinMeshData | null = null;
  let skinDebugMeshOverride: SkinMeshData | null = null;
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

  app.stage.addChild(backdrop);
  app.stage.addChild(bodyMask);
  app.stage.addChild(bodySprite);
  app.stage.addChild(tattooMesh);
  app.stage.addChild(debugWireframe);

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
      const previousGeometry = tattooMesh.geometry;
      tattooMesh.geometry = createMeshGeometry(activeProjectionMesh, input.stageSize);
      previousGeometry.destroy();
      drawActiveDebugMesh(debugWireframe, skinDebugMeshOverride ?? bodyMesh);
    },
    setTattoo(state) {
      applyTattooState(resources, shader, state);
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
  resources.uTexture = state.texture.source;
  resources.tattooUniforms.uniforms.uTattooSize[0] = state.tattooSize.width;
  resources.tattooUniforms.uniforms.uTattooSize[1] = state.tattooSize.height;
  resources.tattooUniforms.uniforms.uTattooTransform[0] = state.transform.x;
  resources.tattooUniforms.uniforms.uTattooTransform[1] = state.transform.y;
  resources.tattooUniforms.uniforms.uTattooTransform[2] = state.transform.scale;
  resources.tattooUniforms.uniforms.uTattooTransform[3] = state.transform.rotation;
  resources.tattooUniforms.uniforms.uTattooOpacity = state.transform.opacity;
  shader.resources.uTexture = resources.uTexture;
}

export function clearTattooState(
  resources: TattooShaderResources,
  shader: TattooShaderBindingTarget,
): void {
  resources.uTexture = Texture.EMPTY.source;
  resources.tattooUniforms.uniforms.uTattooOpacity = 0;
  shader.resources.uTexture = resources.uTexture;
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
    uTexture: Texture.EMPTY.source,
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
    uvs: createUvBufferFromPositions(mesh.positions, stageSize),
    indices: mesh.indices,
  });
}

export const tattooProjectionFragmentMain = `
      float safeScale = max(abs(uTattooTransform.z), 0.0001);
      vec2 localPoint = (vSurfacePoint - uTattooTransform.xy) / safeScale;
      float c = cos(uTattooTransform.w);
      float s = sin(uTattooTransform.w);
      vec2 rotatedPoint = vec2(
        localPoint.x * c + localPoint.y * s,
        localPoint.y * c - localPoint.x * s
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
      uniform sampler2D uTexture;
      uniform vec2 uTattooSize;
      uniform vec4 uTattooTransform;
      uniform float uTattooOpacity;
    `;

const tattooProjectionBit: HighShaderBit = {
  name: "tattoo-projection-bit",
  vertex: {
    header: "out vec2 vSurfacePoint;",
    main: "vSurfacePoint = position;",
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
    indices: new Uint32Array(mesh.indices),
  };
}

function createUvBufferFromPositions(positions: Float32Array, stageSize: Size): Float32Array {
  const uvs = new Float32Array(positions.length);
  const safeWidth = Math.max(stageSize.width, 1);
  const safeHeight = Math.max(stageSize.height, 1);

  for (let i = 0; i < positions.length; i += 2) {
    // WHY: 纹身采样已改为 position 驱动，UV 仅用于满足 MeshGeometry 顶点属性约束。
    // TRADE-OFF: 使用舞台归一化 UV（而非业务语义 UV）最稳妥，避免不同 body mesh 缺失 UV 时渲染失败。
    uvs[i] = positions[i] / safeWidth;
    uvs[i + 1] = positions[i + 1] / safeHeight;
  }

  return uvs;
}

export function createSkinWireframeSegments(mesh: SkinMeshData): Float32Array {
  const segments: number[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < mesh.indices.length; i += 3) {
    pushMeshEdge(segments, seen, mesh.positions, mesh.indices[i], mesh.indices[i + 1]);
    pushMeshEdge(segments, seen, mesh.positions, mesh.indices[i + 1], mesh.indices[i + 2]);
    pushMeshEdge(segments, seen, mesh.positions, mesh.indices[i + 2], mesh.indices[i]);
  }

  return new Float32Array(segments);
}

function createBackdrop(stageSize: Size): Graphics {
  const graphics = new Graphics();
  graphics.rect(0, 0, stageSize.width, stageSize.height);
  graphics.fill({ color: 0xe7ece8 });

  // WHY: 主画布统一使用网点背景，去掉白灰分层与 viewport 语义，让用户聚焦 body+tatoo 单一坐标系统。
  // TRADE-OFF: 相比纯色底纹绘制多一些像素点，但可显著提升透明区域与边界可读性。
  for (let y = 10; y < stageSize.height; y += 16) {
    for (let x = 10; x < stageSize.width; x += 16) {
      graphics.circle(x, y, 1.2);
    }
  }
  graphics.fill({ color: 0xcad3cd, alpha: 0.55 });

  return graphics;
}

function drawActiveDebugMesh(graphics: Graphics, mesh: SkinMeshData | null): void {
  graphics.clear();
  if (!mesh) {
    return;
  }

  const segments = createSkinWireframeSegments(mesh);

  for (let i = 0; i < segments.length; i += 4) {
    graphics.moveTo(segments[i], segments[i + 1]);
    graphics.lineTo(segments[i + 2], segments[i + 3]);
  }

  graphics.stroke({ color: 0x834336, width: 1, alpha: 0.7 });
}

export function createSphereWireframeSegments(mesh: SphereMeshData): Float32Array {
  return buildSphereWireframeSegments(mesh);
}

function pushMeshEdge(
  output: number[],
  seen: Set<string>,
  positions: Float32Array,
  first: number,
  second: number,
): void {
  const a = Math.min(first, second);
  const b = Math.max(first, second);
  const key = `${a}:${b}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);

  output.push(
    positions[a * 2],
    positions[a * 2 + 1],
    positions[b * 2],
    positions[b * 2 + 1],
  );
}
