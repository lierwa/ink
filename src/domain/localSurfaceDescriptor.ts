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

  // WHY: 2D mask/mesh 只能稳定给出局部宽度与边界距离，不能证明真实人体曲率。
  // TRADE-OFF: 先输出保守 proxy descriptor，后续 renderer 可用同一接口替换为 UV/mesh remap。
  return {
    source: "geometry",
    proxy,
    axis,
    localBounds,
    localWidth,
    edgeTurn,
    curvature: {
      acrossAxis,
      alongAxis: proxy === "ellipticalCylinder" ? 0.04 : 0.1,
    },
    confidence: clamp(0.48 + edgeTurn * 0.24 + Math.min(aspect, 3) * 0.06, 0, 1),
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

function pointInsideRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
