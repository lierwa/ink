import type {
  BodySurfaceAnalysisDebugState,
  Point,
  Rect,
  Size,
  SkinMask,
  SkinMeshData,
  SurfaceAxis,
  SurfaceFieldData,
} from "./types";

export interface LocalMeshSurfaceInput {
  mask: SkinMask;
  mesh: SkinMeshData;
  stageSize: Size;
  placementRect: Rect;
  tattooBounds: Rect;
}

export interface LocalMeshSurfaceResult {
  surfaceField: SurfaceFieldData;
  debug: BodySurfaceAnalysisDebugState;
}

export function buildLocalMeshSurface(input: LocalMeshSurfaceInput): LocalMeshSurfaceResult {
  const padding = Math.max(input.tattooBounds.width, input.tattooBounds.height) * 0.75;
  const searchBounds = expandRect(input.tattooBounds, padding);
  const vertices = collectVerticesInRect(input.mesh, searchBounds);

  if (vertices.length < 3) {
    const surfaceField = createFlatSurface(input.stageSize);
    return {
      surfaceField,
      debug: {
        source: "insufficient-mesh",
        confidence: 0,
        patchBounds: searchBounds,
        normalStats: surfaceField.normalStats,
        warning: "insufficient local mesh",
      },
    };
  }

  const localBounds = boundsOfPoints(vertices);
  const axis = createLocalAxis(localBounds);
  const surfaceField = buildNormalField({
    mask: input.mask,
    stageSize: input.stageSize,
    placementRect: input.placementRect,
    tattooBounds: input.tattooBounds,
    localBounds,
    axis,
  });

  return {
    surfaceField,
    debug: {
      source: "local-mesh",
      confidence: surfaceField.normalStats?.meanNormalXY ?? 0,
      axis,
      patchBounds: localBounds,
      normalStats: surfaceField.normalStats,
    },
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

function buildNormalField(input: {
  mask: SkinMask;
  stageSize: Size;
  placementRect: Rect;
  tattooBounds: Rect;
  localBounds: Rect;
  axis: SurfaceAxis;
}): SurfaceFieldData {
  const width = Math.max(1, Math.round(input.stageSize.width));
  const height = Math.max(1, Math.round(input.stageSize.height));
  const normalRgba = new Uint8ClampedArray(width * height * 4);
  const normalAxis = { x: -input.axis.direction.y, y: input.axis.direction.x };
  const radius = Math.max(1, Math.min(input.localBounds.width, input.localBounds.height) * 0.5);
  const safeNormalXYLimit = 0.48;
  let active = 0;
  let maxNormalXY = 0;
  let sumNormalXY = 0;

  // WHY: 当前 mesh 来自 2D 皮肤 mask，不是真实 3D 人体。
  // TRADE-OFF: 这里把 tattoo 附近的局部 mesh 密度/边界距离当作曲面代理，
  // 避免 Pose 语义区域把臀部贴图错误套用到上臂轴线上。
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!pointInsideRect({ x, y }, input.tattooBounds) || !insideMask(input.mask, input.placementRect, x, y)) {
        writeNormal(normalRgba, index, 0, 0, 1, 0);
        continue;
      }

      const relX = x - input.axis.origin.x;
      const relY = y - input.axis.origin.y;
      const cross = clamp((relX * normalAxis.x + relY * normalAxis.y) / radius, -1, 1);
      const edgeRatio = distanceToRectEdgeRatio({ x, y }, input.localBounds);
      // WHY: 局部 mesh 只是 2D mask 代理，过强 normal 会被 shader 放大成横向撕裂。
      // TRADE-OFF: 限制 XY 强度会弱化 2.5D 起伏，但优先保证 tattoo 图案结构不变形。
      const strength = clamp(0.31 + (1 - edgeRatio) * 0.3, 0.2, safeNormalXYLimit);
      const nx = normalAxis.x * cross * strength;
      const ny = normalAxis.y * cross * strength;
      const nz = Math.sqrt(Math.max(0.2, 1 - nx * nx - ny * ny));
      const normalXY = Math.hypot(nx, ny);

      active += 1;
      maxNormalXY = Math.max(maxNormalXY, normalXY);
      sumNormalXY += normalXY;
      writeNormal(normalRgba, index, nx, ny, nz, 255);
    }
  }

  return {
    width,
    height,
    normalRgba,
    normalStats: {
      activePixelRatio: active / (width * height),
      maxNormalXY,
      meanNormalXY: active > 0 ? sumNormalXY / active : 0,
    },
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

function pointInsideRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function insideMask(mask: SkinMask, placementRect: Rect, x: number, y: number): boolean {
  const u = (x - placementRect.x) / placementRect.width;
  const v = (y - placementRect.y) / placementRect.height;
  const maskX = Math.floor(u * mask.width);
  const maskY = Math.floor(v * mask.height);
  if (maskX < 0 || maskX >= mask.width || maskY < 0 || maskY >= mask.height) {
    return false;
  }
  return mask.probabilities[maskY * mask.width + maskX] >= 0.5;
}

function distanceToRectEdgeRatio(point: Point, rect: Rect): number {
  const left = point.x - rect.x;
  const right = rect.x + rect.width - point.x;
  const top = point.y - rect.y;
  const bottom = rect.y + rect.height - point.y;
  const edgeDistance = Math.max(0, Math.min(left, right, top, bottom));
  const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
  return clamp(edgeDistance / radius, 0, 1);
}

function writeNormal(
  target: Uint8ClampedArray,
  index: number,
  nx: number,
  ny: number,
  nz: number,
  alpha: number,
): void {
  target[index] = Math.round((clamp(nx, -1, 1) * 0.5 + 0.5) * 255);
  target[index + 1] = Math.round((clamp(ny, -1, 1) * 0.5 + 0.5) * 255);
  target[index + 2] = Math.round(clamp(nz, 0, 1) * 255);
  target[index + 3] = alpha;
}

function createFlatSurface(size: Size): SurfaceFieldData {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const normalRgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < normalRgba.length; index += 4) {
    writeNormal(normalRgba, index, 0, 0, 1, 0);
  }
  return {
    width,
    height,
    normalRgba,
    normalStats: { activePixelRatio: 0, maxNormalXY: 0, meanNormalXY: 0 },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
