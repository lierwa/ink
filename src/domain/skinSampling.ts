import PoissonDiskSampling from "poisson-disk-sampling";
import type { BinaryMask, Point, SkinContourLoop, SkinMeshResolution } from "./types";

interface PoissonSampler {
  fill(): Array<[number, number]>;
}

interface PoissonCtor {
  new (options: {
    shape: [number, number];
    minDistance: number;
    maxDistance: number;
    tries?: number;
  }): PoissonSampler;
}

const Poisson = PoissonDiskSampling as unknown as PoissonCtor;

export function sampleSkinInterior(
  mask: BinaryMask,
  loops: SkinContourLoop[],
  resolution: SkinMeshResolution,
): Point[] {
  if (mask.width <= 0 || mask.height <= 0) {
    return [];
  }

  const basePoints = runPoisson(mask, Math.max(1, resolution.innerRadius));
  const bandPoints = runPoisson(mask, Math.max(1, resolution.boundaryRadius));
  const output: Point[] = [];

  for (const point of basePoints) {
    if (isInsideMask(mask, point)) {
      output.push(point);
    }
  }

  // WHY: 边界带单独加密能提升轮廓保真度；TRADE-OFF: 点数上升后 CDT 耗时会变长。
  for (const point of bandPoints) {
    if (!isInsideMask(mask, point)) {
      continue;
    }
    if (!isWithinBoundaryBand(point, loops, resolution.boundaryBandWidth)) {
      continue;
    }
    output.push(point);
  }

  return dedupePoints(output);
}

function runPoisson(mask: BinaryMask, minDistance: number): Point[] {
  const sampler = new Poisson({
    shape: [mask.width, mask.height],
    minDistance,
    maxDistance: minDistance * 1.8,
    tries: 24,
  });

  return sampler.fill().map(([x, y]) => ({ x, y }));
}

function isInsideMask(mask: BinaryMask, point: Point): boolean {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
    return false;
  }

  return mask.data[y * mask.width + x] === 1;
}

function isWithinBoundaryBand(point: Point, loops: SkinContourLoop[], width: number): boolean {
  if (loops.length === 0) {
    return false;
  }

  let nearest = Number.POSITIVE_INFINITY;

  for (const loop of loops) {
    for (let i = 0; i < loop.points.length; i += 1) {
      const current = loop.points[i];
      const next = loop.points[(i + 1) % loop.points.length];
      nearest = Math.min(nearest, distancePointToSegment(point, current, next));
    }
  }

  return nearest <= width;
}

function distancePointToSegment(point: Point, start: Point, end: Point): number {
  const edgeX = end.x - start.x;
  const edgeY = end.y - start.y;
  const segmentLengthSq = edgeX * edgeX + edgeY * edgeY;

  if (segmentLengthSq < 1e-8) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = clamp(((point.x - start.x) * edgeX + (point.y - start.y) * edgeY) / segmentLengthSq, 0, 1);
  const projectionX = start.x + edgeX * t;
  const projectionY = start.y + edgeY * t;
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

function dedupePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  const output: Point[] = [];

  for (const point of points) {
    const key = `${Math.round(point.x * 100) / 100}:${Math.round(point.y * 100) / 100}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(point);
  }

  return output;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
