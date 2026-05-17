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
import { buildSphereMesh, buildSphereWireframeSegments } from "../domain/sphereMesh";
import type { Size, SphereMeshResolution, SphereSurface, TattooTransform } from "../domain/types";

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

export interface PixiTattooRenderer {
  canvas: HTMLCanvasElement;
  setTattoo(state: PixiTattooState): void;
  setDebugMeshVisible(visible: boolean): void;
  setMeshResolution(resolution: SphereMeshResolution): void;
  destroy(): void;
}

export const tattooBlendMode = "normal";

export type TattooShaderResources = {
  uTexture: Texture["source"];
  tattooUniforms: UniformGroup<{
    uSphere: { value: Float32Array; type: "vec3<f32>" };
    uTattooSize: { value: Float32Array; type: "vec2<f32>" };
    uTattooTransform: { value: Float32Array; type: "vec4<f32>" };
    uTattooOpacity: { value: number; type: "f32" };
  }>;
};

export interface TattooShaderResourceInput {
  sphere: SphereSurface;
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

  app.canvas.setAttribute("aria-label", "2D sphere tattoo preview canvas");
  input.mount.appendChild(app.canvas);

  app.stage.addChild(createBackdrop(input.stageSize));
  app.stage.addChild(createSphereSprite(input.sphere));

  const sphereMesh = buildSphereMesh({ sphere: input.sphere, resolution: input.mesh });
  const resources = createTattooShaderResources({
    sphere: input.sphere,
    tattooSize: { width: 1, height: 1 },
    transform: {
      x: input.sphere.cx,
      y: input.sphere.cy,
      scale: 1,
      rotation: 0,
      opacity: 1,
    },
  });
  const shader = createTattooShader(resources);
  const tattooMesh = new Mesh({
    geometry: createMeshGeometry(sphereMesh),
    shader,
  });
  const mask = createHardSphereMaskSprite(input.stageSize, input.sphere);
  // WHY: 背景透明度由上传清理阶段的 alpha 决定；渲染层只做普通覆盖，避免混合模式把贴图颜色再次改暗。
  // TRADE-OFF: 不模拟墨水乘色效果，优先保证球面显示接近裁剪 modal 的原始像素。
  tattooMesh.blendMode = tattooBlendMode;
  tattooMesh.mask = mask;
  const debugWireframe = createWireframeOverlay(sphereMesh);
  debugWireframe.visible = false;

  app.stage.addChild(mask);
  app.stage.addChild(tattooMesh);
  app.stage.addChild(debugWireframe);

  return {
    canvas: app.canvas,
    setTattoo(state) {
      resources.uTexture = state.texture.source;
      resources.tattooUniforms.uniforms.uTattooSize[0] = state.tattooSize.width;
      resources.tattooUniforms.uniforms.uTattooSize[1] = state.tattooSize.height;
      resources.tattooUniforms.uniforms.uTattooTransform[0] = state.transform.x;
      resources.tattooUniforms.uniforms.uTattooTransform[1] = state.transform.y;
      resources.tattooUniforms.uniforms.uTattooTransform[2] = state.transform.scale;
      resources.tattooUniforms.uniforms.uTattooTransform[3] = state.transform.rotation;
      resources.tattooUniforms.uniforms.uTattooOpacity = state.transform.opacity;
      shader.resources.uTexture = resources.uTexture;
    },
    setDebugMeshVisible(visible) {
      debugWireframe.visible = visible;
    },
    setMeshResolution(resolution) {
      const nextMesh = buildSphereMesh({ sphere: input.sphere, resolution });
      const previousGeometry = tattooMesh.geometry;
      tattooMesh.geometry = createMeshGeometry(nextMesh);
      previousGeometry.destroy();
      drawWireframeOverlay(debugWireframe, nextMesh);
    },
    destroy() {
      const geometry = tattooMesh.geometry;
      app.destroy({ removeView: true }, { children: true });
      geometry.destroy();
      shader.destroy();
    },
  };
}

export function createTattooShaderResources(
  input: TattooShaderResourceInput,
): TattooShaderResources {
  return {
    uTexture: Texture.EMPTY.source,
    tattooUniforms: new UniformGroup({
      uSphere: {
        value: new Float32Array([input.sphere.cx, input.sphere.cy, input.sphere.r]),
        type: "vec3<f32>",
      },
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
      name: "sphere-tattoo-projection",
      bits: [
        localUniformBitGl,
        roundPixelsBitGl,
        tattooProjectionBit,
      ],
    }),
    resources,
  });
}

function createMeshGeometry(mesh: ReturnType<typeof buildSphereMesh>): MeshGeometry {
  return new MeshGeometry({
    positions: mesh.positions,
    uvs: mesh.sphereUv,
    indices: mesh.indices,
  });
}

function createWireframeOverlay(mesh: ReturnType<typeof buildSphereMesh>): Graphics {
  const graphics = new Graphics();
  drawWireframeOverlay(graphics, mesh);
  return graphics;
}

function drawWireframeOverlay(graphics: Graphics, mesh: ReturnType<typeof buildSphereMesh>): void {
  const segments = buildSphereWireframeSegments(mesh);
  graphics.clear();

  for (let i = 0; i < segments.length; i += 4) {
    graphics.moveTo(segments[i], segments[i + 1]);
    graphics.lineTo(segments[i + 2], segments[i + 3]);
  }

  graphics.stroke({ color: 0x23424a, width: 1, alpha: 0.38 });
}

export const tattooProjectionFragmentMain = `
      vec3 sphereNormal = normalFromPoint(vSpherePoint);
      vec3 centerNormal = projectionCenterToNormal(uTattooTransform.xy);
      vec3 projectedRight = vec3(1.0, 0.0, 0.0) - centerNormal * centerNormal.x;
      vec3 projectedDown = vec3(0.0, 1.0, 0.0) - centerNormal * centerNormal.y;
      float rightLength = length(projectedRight);
      float downLength = length(projectedDown);
      vec3 unrotatedU;
      vec3 unrotatedV;

      // WHY: 贴图控制框来自屏幕/Fabric 语义，边缘处径向屏幕轴会退化到深度方向。
      // 选择投影长度更大的屏幕轴作为主轴，可在真实轮廓线上避免 90 度轴交换。
      if (rightLength >= downLength) {
        unrotatedU = safeNormalize(projectedRight);
        unrotatedV = safeNormalize(cross(centerNormal, unrotatedU));
      } else {
        unrotatedV = safeNormalize(projectedDown);
        unrotatedU = safeNormalize(cross(unrotatedV, centerNormal));
      }
      float c = cos(uTattooTransform.w);
      float s = sin(uTattooTransform.w);
      vec3 tangentU = safeNormalize(unrotatedU * c + unrotatedV * s);
      vec3 tangentV = safeNormalize(unrotatedU * -s + unrotatedV * c);
      float tangentX = dot(sphereNormal, tangentU);
      float tangentY = dot(sphereNormal, tangentV);
      float tangentLength = length(vec2(tangentX, tangentY));
      float forward = dot(sphereNormal, centerNormal);
      float theta = atan(tangentLength, forward);
      float angularScale = tangentLength < 0.0001 ? 1.0 : theta / tangentLength;
      float localX = (uSphere.z * tangentX * angularScale) / uTattooTransform.z;
      float localY = (uSphere.z * tangentY * angularScale) / uTattooTransform.z;
      vec2 tattooUv = vec2(localX, localY) / uTattooSize + vec2(0.5);

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
      in vec2 vSpherePoint;
      uniform sampler2D uTexture;
      uniform vec3 uSphere;
      uniform vec2 uTattooSize;
      uniform vec4 uTattooTransform;
      uniform float uTattooOpacity;

      vec3 safeNormalize(vec3 value) {
        float magnitude = length(value);
        return magnitude < 0.0001 ? vec3(0.0) : value / magnitude;
      }

      vec3 normalFromXy(vec2 xy) {
        float z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
        return safeNormalize(vec3(xy, z));
      }

      vec3 normalFromPoint(vec2 point) {
        vec2 rawXy = (point - uSphere.xy) / uSphere.z;
        float xyLength = length(rawXy);
        vec2 xy = xyLength > 1.0 ? rawXy / xyLength : rawXy;
        return normalFromXy(xy);
      }

      vec2 clampProjectionCenterXy(vec2 rawXy) {
        float xyLength = length(rawXy);

        if (xyLength <= 1.0) {
          return rawXy;
        }

        // TRADE-OFF: 控制框可拖出球面；水平拖出侧边时保留 y，只把中心卡到同高度真实轮廓线。
        if (abs(rawXy.x) >= abs(rawXy.y)) {
          float clampedY = clamp(rawXy.y, -1.0, 1.0);
          float xLimit = sqrt(max(0.0, 1.0 - clampedY * clampedY));
          return vec2(sign(rawXy.x) * xLimit, clampedY);
        }

        float clampedX = clamp(rawXy.x, -1.0, 1.0);
        float yLimit = sqrt(max(0.0, 1.0 - clampedX * clampedX));
        return vec2(clampedX, sign(rawXy.y) * yLimit);
      }

      vec3 projectionCenterToNormal(vec2 point) {
        vec2 rawXy = (point - uSphere.xy) / uSphere.z;
        return normalFromXy(clampProjectionCenterXy(rawXy));
      }
    `;

const tattooProjectionBit: HighShaderBit = {
  name: "tattoo-projection-bit",
  vertex: {
    header: "out vec2 vSpherePoint;",
    main: "vSpherePoint = position;",
  },
  fragment: {
    header: tattooProjectionFragmentHeader,
    main: tattooProjectionFragmentMain,
  },
};

function createBackdrop(stageSize: Size): Graphics {
  return new Graphics()
    .rect(0, 0, stageSize.width, stageSize.height)
    .fill({ color: 0xdce4e2 });
}

function createSphereSprite(sphere: SphereSurface): Sprite {
  const sprite = new Sprite(Texture.from(createSphereCanvas(sphere)));
  sprite.x = sphere.cx - sphere.r;
  sprite.y = sphere.cy - sphere.r;
  return sprite;
}

function createSphereCanvas(sphere: SphereSurface): HTMLCanvasElement {
  const size = sphere.r * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = requiredContext(canvas);
  const center = sphere.r;
  const gradient = context.createRadialGradient(
    center - sphere.r * 0.34,
    center - sphere.r * 0.28,
    sphere.r * 0.12,
    center,
    center,
    sphere.r,
  );
  gradient.addColorStop(0, "#dba18f");
  gradient.addColorStop(0.72, "#c98f7c");
  gradient.addColorStop(1, "#9a6d62");

  context.fillStyle = gradient;
  context.beginPath();
  context.arc(center, center, sphere.r, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#7f5c54";
  context.lineWidth = 2;
  context.stroke();
  return canvas;
}

function createHardSphereMaskSprite(stageSize: Size, sphere: SphereSurface): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = stageSize.width;
  canvas.height = stageSize.height;
  const context = requiredContext(canvas);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(sphere.cx, sphere.cy, sphere.r, 0, Math.PI * 2);
  context.fill();

  return new Sprite(Texture.from(canvas));
}

function requiredContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }

  return context;
}
