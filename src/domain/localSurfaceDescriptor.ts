import type {
  LocalSurfaceDescriptor,
  Point,
  Rect,
  ShadingGeometryAssistInput,
  Size,
  SkinMask,
  SkinMeshData,
  SurfaceAxis,
} from "./types";
import { resolveShadingGeometryAssist } from "./shadingGeometryAssist";

export interface LocalSurfaceDescriptorInput {
  mask: SkinMask;
  mesh: SkinMeshData;
  placementRect: Rect;
  tattooBounds: Rect;
  stageSize: Size;
  shadingAssist?: ShadingGeometryAssistInput;
}

export function resolveLocalSurfaceDescriptor(input: LocalSurfaceDescriptorInput): LocalSurfaceDescriptor {
  const padding = Math.max(input.tattooBounds.width, input.tattooBounds.height) * 0.75;
  const searchBounds = expandRect(input.tattooBounds, padding);
  const vertices = collectVerticesInRect(input.mesh, searchBounds);

  if (vertices.length < 3) {
    return createInsufficientDescriptor(searchBounds);
  }

  const localBounds = boundsOfPoints(vertices);
  const axis = createLocalAxis(localBounds);
  const localWidth = Math.max(1, Math.min(localBounds.width, localBounds.height));
  const aspect = Math.max(localBounds.width, localBounds.height) / localWidth;
  const proxy = aspect >= 1.45 ? "ellipticalCylinder" : "curvedPlane";
  const edgeTurn = estimateEdgeTurn(input.tattooBounds, localBounds);
  const acrossAxis = clamp(0.22 + edgeTurn * 0.42 + (proxy === "ellipticalCylinder" ? 0.12 : 0), 0.08, 0.86);
  // WHY: 光照明暗变化最能验证横跨局部表面的曲率方向，而不是沿贴图长轴的延展方向。
  // TRADE-OFF: 只在 cross/normal 轴上加权会放弃斜向高光信息，但能降低纹理方向误判曲率的风险。
  const normalAxis = { x: -axis.direction.y, y: axis.direction.x };
  const shadingLocalBounds = input.shadingAssist?.sourceCanvas
    ? mapStageBoundsToSourceCanvas(localBounds, input.placementRect, input.shadingAssist.sourceCanvas)
    : localBounds;
  const shading = resolveShadingGeometryAssist({
    enabled: Boolean(input.shadingAssist?.enabled),
    sourceCanvas: input.shadingAssist?.sourceCanvas,
    localBounds: shadingLocalBounds,
    crossAxis: normalAxis,
    maxAdjustmentRatio: input.shadingAssist?.maxAdjustmentRatio,
  });
  const assistedAcrossAxis = clamp(acrossAxis * shading.curvatureMultiplier, 0.08, 0.86);

  // WHY: 2D mask/mesh 只能稳定给出局部宽度与边界距离，不能证明真实人体曲率。
  // TRADE-OFF: 先输出保守 proxy descriptor，后续 renderer 可用同一接口替换为 UV/mesh remap。
  return {
    source: shading.debug.used ? "geometry-shading" : "geometry",
    proxy,
    axis,
    localBounds,
    localWidth,
    edgeTurn,
    curvature: {
      acrossAxis: assistedAcrossAxis,
      alongAxis: proxy === "ellipticalCylinder" ? 0.04 : 0.1,
    },
    confidence: clamp(0.48 + edgeTurn * 0.24 + Math.min(aspect, 3) * 0.06, 0, 1),
    shading: shading.debug,
  };
}

function collectVerticesInRect(mesh: SkinMeshData, rect: Rect): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < mesh.positions.length; index += 2) {
    const point = { x: mesh.positions[index], y: mesh.positions[index + 1] };
    if (pointInsideRect(point, rect)) {
      points.push(point);
    }
  }
  return points;
}

function createInsufficientDescriptor(bounds: Rect): LocalSurfaceDescriptor {
  return {
    source: "insufficient",
    proxy: "genericEdgeTurn",
    axis: createLocalAxis(bounds),
    localBounds: bounds,
    localWidth: Math.max(1, Math.min(bounds.width, bounds.height)),
    edgeTurn: 0,
    curvature: { acrossAxis: 0, alongAxis: 0 },
    confidence: 0,
  };
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function boundsOfPoints(points: Point[]): Rect {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function createLocalAxis(bounds: Rect): SurfaceAxis {
  const isVertical = bounds.height >= bounds.width;
  return {
    origin: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    direction: isVertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
    length: isVertical ? bounds.height : bounds.width,
  };
}

function estimateEdgeTurn(tattooBounds: Rect, localBounds: Rect): number {
  const center = {
    x: tattooBounds.x + tattooBounds.width / 2,
    y: tattooBounds.y + tattooBounds.height / 2,
  };
  const left = center.x - localBounds.x;
  const right = localBounds.x + localBounds.width - center.x;
  const top = center.y - localBounds.y;
  const bottom = localBounds.y + localBounds.height - center.y;
  const edgeDistance = Math.max(0, Math.min(left, right, top, bottom));
  const radius = Math.max(1, Math.min(localBounds.width, localBounds.height) * 0.5);
  return 1 - clamp(edgeDistance / radius, 0, 1);
}

function mapStageBoundsToSourceCanvas(
  localBounds: Rect,
  placementRect: Rect,
  sourceCanvas: HTMLCanvasElement,
): Rect {
  // WHY: mesh/localBounds 已经被映射到 stage placement 坐标，而 canvas readback 只能使用原图像素坐标。
  // TRADE-OFF: 这里只做线性反映射，越界与取整继续交给 shadingGeometryAssist 统一 clamp，避免重复边界策略。
  return {
    x: ((localBounds.x - placementRect.x) / placementRect.width) * sourceCanvas.width,
    y: ((localBounds.y - placementRect.y) / placementRect.height) * sourceCanvas.height,
    width: (localBounds.width / placementRect.width) * sourceCanvas.width,
    height: (localBounds.height / placementRect.height) * sourceCanvas.height,
  };
}

function pointInsideRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
