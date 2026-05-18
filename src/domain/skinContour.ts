import simplify from "simplify-js";
import type {
  BinaryMask,
  Point,
  SkinContourExtractOptions,
  SkinContourLoop,
} from "./types";

interface NormalizedSkinContourExtractOptions {
  simplifyTolerance: number;
  highQualitySimplify: boolean;
  minLoopArea: number;
  resample: {
    minStep: number;
    maxStep: number;
  };
}

const defaultOptions: NormalizedSkinContourExtractOptions = {
  simplifyTolerance: 1.2,
  highQualitySimplify: false,
  minLoopArea: 9,
  resample: {
    minStep: 3,
    maxStep: 10,
  },
};

interface Edge {
  start: Point;
  end: Point;
  used: boolean;
}

export function extractSkinContours(
  mask: BinaryMask,
  options?: SkinContourExtractOptions,
): SkinContourLoop[] {
  validateMask(mask);
  const normalized = normalizeOptions(options);
  const edges = collectBoundaryEdges(mask);
  const loops = traceLoops(edges);
  const result: SkinContourLoop[] = [];

  for (const loop of loops) {
    const compact = compactLoop(loop);
    if (compact.length < 3) {
      continue;
    }

    const simplified = simplifyLoop(compact, normalized.simplifyTolerance, normalized.highQualitySimplify);
    const resampled = adaptiveResampleLoop(simplified, normalized.resample.minStep, normalized.resample.maxStep);
    if (resampled.length < 3) {
      continue;
    }

    const area = signedArea(resampled);
    if (Math.abs(area) < normalized.minLoopArea) {
      continue;
    }

    result.push({
      points: resampled,
      isHole: area < 0,
      area,
      perimeter: computePerimeter(resampled),
    });
  }

  return result.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
}

function validateMask(mask: BinaryMask): void {
  if (mask.width <= 0 || mask.height <= 0 || mask.width * mask.height !== mask.data.length) {
    throw new Error("Invalid binary mask dimensions or data length.");
  }
}

function normalizeOptions(options?: SkinContourExtractOptions): NormalizedSkinContourExtractOptions {
  const mergedResample = {
    ...defaultOptions.resample,
    ...(options?.resample ?? {}),
  };

  const minStep = Math.max(1, mergedResample.minStep ?? defaultOptions.resample.minStep);
  const maxStep = Math.max(minStep, mergedResample.maxStep ?? defaultOptions.resample.maxStep);

  return {
    ...defaultOptions,
    ...options,
    simplifyTolerance: Math.max(0, options?.simplifyTolerance ?? defaultOptions.simplifyTolerance),
    minLoopArea: Math.max(0, options?.minLoopArea ?? defaultOptions.minLoopArea),
    highQualitySimplify: options?.highQualitySimplify ?? defaultOptions.highQualitySimplify,
    resample: { minStep, maxStep },
  };
}

function collectBoundaryEdges(mask: BinaryMask): Edge[] {
  const edges: Edge[] = [];
  const { width, height, data } = mask;

  // WHY: 使用像素边界转线段，避免直接追踪像素中心带来的锯齿漂移；TRADE-OFF: 轮廓是栅格化折线，需要后续 simplify + 重采样平滑。
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] === 0) {
        continue;
      }

      if (y === 0 || data[(y - 1) * width + x] === 0) {
        edges.push(createEdge(x, y, x + 1, y));
      }
      if (x === width - 1 || data[y * width + x + 1] === 0) {
        edges.push(createEdge(x + 1, y, x + 1, y + 1));
      }
      if (y === height - 1 || data[(y + 1) * width + x] === 0) {
        edges.push(createEdge(x + 1, y + 1, x, y + 1));
      }
      if (x === 0 || data[y * width + x - 1] === 0) {
        edges.push(createEdge(x, y + 1, x, y));
      }
    }
  }

  return edges;
}

function createEdge(x1: number, y1: number, x2: number, y2: number): Edge {
  return {
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    used: false,
  };
}

function traceLoops(edges: Edge[]): Point[][] {
  const startMap = new Map<string, number[]>();

  for (let i = 0; i < edges.length; i += 1) {
    const key = pointKey(edges[i].start);
    const bucket = startMap.get(key);
    if (bucket === undefined) {
      startMap.set(key, [i]);
      continue;
    }
    bucket.push(i);
  }

  const loops: Point[][] = [];

  for (let i = 0; i < edges.length; i += 1) {
    if (edges[i].used) {
      continue;
    }

    const loop = traceSingleLoop(edges, startMap, i);
    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

function traceSingleLoop(edges: Edge[], startMap: Map<string, number[]>, startEdgeIndex: number): Point[] {
  const points: Point[] = [];
  let current = edges[startEdgeIndex];
  const startKey = pointKey(current.start);

  for (let guard = 0; guard <= edges.length; guard += 1) {
    current.used = true;
    points.push(current.start);

    const nextKey = pointKey(current.end);
    if (nextKey === startKey) {
      break;
    }

    const candidates = startMap.get(nextKey) ?? [];
    const nextIndex = candidates.find((index) => !edges[index].used);
    if (nextIndex === undefined) {
      break;
    }
    current = edges[nextIndex];
  }

  return points;
}

function compactLoop(points: Point[]): Point[] {
  const deduped: Point[] = [];

  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last !== undefined && last.x === point.x && last.y === point.y) {
      continue;
    }
    deduped.push({ x: point.x, y: point.y });
  }

  while (deduped.length >= 3 && isCollinear(deduped[deduped.length - 2], deduped[deduped.length - 1], deduped[0])) {
    deduped.pop();
  }

  const compacted: Point[] = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const prev = deduped[(i - 1 + deduped.length) % deduped.length];
    const curr = deduped[i];
    const next = deduped[(i + 1) % deduped.length];
    if (!isCollinear(prev, curr, next)) {
      compacted.push(curr);
    }
  }

  return compacted;
}

function simplifyLoop(points: Point[], tolerance: number, highQuality: boolean): Point[] {
  if (points.length <= 3 || tolerance === 0) {
    return points.map((point) => ({ x: point.x, y: point.y }));
  }

  const closedPoints = [...points, points[0]];
  const simplified = simplify(closedPoints, tolerance, highQuality);
  if (simplified.length <= 1) {
    return points.map((point) => ({ x: point.x, y: point.y }));
  }

  if (samePoint(simplified[0], simplified[simplified.length - 1])) {
    simplified.pop();
  }

  return simplified.map((point) => ({ x: point.x, y: point.y }));
}

function adaptiveResampleLoop(points: Point[], minStep: number, maxStep: number): Point[] {
  const result: Point[] = [];

  // WHY: 根据转角密度分配步长，边界拐点保细节而平直段减少点数；TRADE-OFF: 参数敏感，需要结合视觉效果做小范围调参。
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const curvature = Math.max(localCurvature(points, i), localCurvature(points, (i + 1) % points.length));
    const step = lerp(maxStep, minStep, curvature);
    const edgeLength = distance(current, next);
    const segmentCount = Math.max(1, Math.ceil(edgeLength / step));

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const t = segment / segmentCount;
      result.push({
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t,
      });
    }
  }

  return dedupeLoopPoints(result);
}

function localCurvature(points: Point[], index: number): number {
  const prev = points[(index - 1 + points.length) % points.length];
  const curr = points[index];
  const next = points[(index + 1) % points.length];
  const v1x = curr.x - prev.x;
  const v1y = curr.y - prev.y;
  const v2x = next.x - curr.x;
  const v2y = next.y - curr.y;
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);
  if (len1 === 0 || len2 === 0) {
    return 0;
  }

  const dot = clamp((v1x * v2x + v1y * v2y) / (len1 * len2), -1, 1);
  const turn = Math.acos(dot);
  return turn / Math.PI;
}

function signedArea(points: Point[]): number {
  let sum = 0;

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }

  return sum * 0.5;
}

function computePerimeter(points: Point[]): number {
  let length = 0;

  for (let i = 0; i < points.length; i += 1) {
    length += distance(points[i], points[(i + 1) % points.length]);
  }

  return length;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function isCollinear(a: Point, b: Point, c: Point): boolean {
  return Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-9;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function dedupeLoopPoints(points: Point[]): Point[] {
  if (points.length === 0) {
    return points;
  }

  const deduped: Point[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last !== undefined && samePoint(last, point)) {
      continue;
    }
    deduped.push(point);
  }

  if (deduped.length > 1 && samePoint(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop();
  }

  return deduped;
}

function pointKey(point: Point): string {
  return `${point.x}:${point.y}`;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp(t, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
