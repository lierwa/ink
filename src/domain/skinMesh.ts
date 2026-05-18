import cdt2d from "cdt2d";
import type {
  Point,
  SkinContourLoop,
  SkinMeshData,
  SkinMeshTriangulationOptions,
} from "./types";

type Triangle = [number, number, number];

type Cdt2dFunction = (
  points: Array<[number, number]>,
  edges?: Array<[number, number]>,
  options?: {
    delaunay?: boolean;
    interior?: boolean;
    exterior?: boolean;
    infinity?: boolean;
  },
) => Triangle[];

const triangulate = cdt2d as unknown as Cdt2dFunction;

const defaultTriangulationOptions: Required<SkinMeshTriangulationOptions> = {
  useConstraintEdges: true,
  allowLooseFallback: true,
  minTriangleArea: 1e-5,
};

export function buildSkinMesh(
  loops: SkinContourLoop[],
  interior: Point[],
  options?: SkinMeshTriangulationOptions,
): SkinMeshData {
  const triangulation = {
    ...defaultTriangulationOptions,
    ...options,
    minTriangleArea: Math.max(0, options?.minTriangleArea ?? defaultTriangulationOptions.minTriangleArea),
  };
  const contourPoints = loops.flatMap((loop) => loop.points);
  if (contourPoints.length < 3) {
    throw new Error("Cannot build skin mesh: contour point count is less than 3.");
  }

  const points = contourPoints.concat(interior);
  const pointPairs = points.map((point) => [point.x, point.y] as [number, number]);
  const edges = buildConstraintEdges(loops);
  const boundaryVertexCount = contourPoints.length;

  let faces = triangulation.useConstraintEdges
    ? triangulateWithConstraints(pointPairs, edges)
    : [];
  if (faces.length === 0 && triangulation.allowLooseFallback) {
    faces = triangulateAndFilter(pointPairs, loops);
  }

  const filteredFaces = filterDegenerateTriangles(points, faces, triangulation.minTriangleArea);
  if (filteredFaces.length === 0) {
    throw new Error("Cannot build skin mesh: triangulation produced no valid triangles.");
  }

  const positions = new Float32Array(points.length * 2);
  const boundaryFlags = new Uint8Array(points.length);

  for (let i = 0; i < points.length; i += 1) {
    positions[i * 2] = points[i].x;
    positions[i * 2 + 1] = points[i].y;
    boundaryFlags[i] = i < boundaryVertexCount ? 1 : 0;
  }

  return {
    positions,
    indices: new Uint32Array(filteredFaces.flat()),
    boundaryFlags,
  };
}

function triangulateWithConstraints(
  points: Array<[number, number]>,
  edges: Array<[number, number]>,
): Triangle[] {
  try {
    return triangulate(points, edges, { exterior: false });
  } catch {
    return [];
  }
}

function triangulateAndFilter(points: Array<[number, number]>, loops: SkinContourLoop[]): Triangle[] {
  try {
    const looseFaces = triangulate(points, [], { exterior: false });

    // WHY: 当约束边异常导致失败时，回退无约束 CDT 再按轮廓过滤，避免直接中断主流程。
    // TRADE-OFF: 边界不再是强约束，局部可能出现跨边界细小误差。
    return looseFaces.filter((face) => {
      const centroid = triangleCentroid(face, points);
      return isPointInsideContourSet(centroid, loops);
    });
  } catch {
    return [];
  }
}

function buildConstraintEdges(loops: SkinContourLoop[]): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  let offset = 0;

  for (const loop of loops) {
    if (loop.points.length < 2) {
      offset += loop.points.length;
      continue;
    }

    for (let i = 0; i < loop.points.length; i += 1) {
      const current = offset + i;
      const next = offset + ((i + 1) % loop.points.length);
      edges.push([current, next]);
    }

    offset += loop.points.length;
  }

  return edges;
}

function filterDegenerateTriangles(points: Point[], faces: Triangle[], minArea: number): Triangle[] {
  const output: Triangle[] = [];

  for (const face of faces) {
    if (!isFaceIndicesValid(face, points.length)) {
      continue;
    }

    const [a, b, c] = face;
    const area = Math.abs(signedArea(points[a], points[b], points[c]));
    if (area < minArea) {
      continue;
    }

    output.push(face);
  }

  return output;
}

function isFaceIndicesValid(face: Triangle, length: number): boolean {
  return (
    face[0] >= 0 &&
    face[1] >= 0 &&
    face[2] >= 0 &&
    face[0] < length &&
    face[1] < length &&
    face[2] < length
  );
}

function signedArea(a: Point, b: Point, c: Point): number {
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5;
}

function triangleCentroid(face: Triangle, points: Array<[number, number]>): Point {
  const a = points[face[0]];
  const b = points[face[1]];
  const c = points[face[2]];

  return {
    x: (a[0] + b[0] + c[0]) / 3,
    y: (a[1] + b[1] + c[1]) / 3,
  };
}

function isPointInsideContourSet(point: Point, loops: SkinContourLoop[]): boolean {
  const outerLoops = loops.filter((loop) => !loop.isHole);
  const holeLoops = loops.filter((loop) => loop.isHole);

  const inOuter = outerLoops.some((loop) => isPointInPolygon(point, loop.points));
  if (!inOuter) {
    return false;
  }

  return !holeLoops.some((loop) => isPointInPolygon(point, loop.points));
}

function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects =
      ((pi.y > point.y) !== (pj.y > point.y)) &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || 1e-9) + pi.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}
