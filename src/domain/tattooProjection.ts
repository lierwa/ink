import type { Point, Size, SphereSurface, TattooTransform } from "./types";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface TattooUv {
  u: number;
  v: number;
}

export function spherePointToNormal(point: Point, sphere: SphereSurface): Vector3 {
  const rawX = (point.x - sphere.cx) / sphere.r;
  const rawY = (point.y - sphere.cy) / sphere.r;
  const xy = clampToCircleRadially(rawX, rawY, 1);
  return normalizedSpherePointToNormal(xy);
}

function projectionCenterToNormal(
  point: Point,
  sphere: SphereSurface,
): Vector3 {
  const rawX = (point.x - sphere.cx) / sphere.r;
  const rawY = (point.y - sphere.cy) / sphere.r;
  const xy = clampToCircleByDominantAxis(rawX, rawY, 1);
  return normalizedSpherePointToNormal(xy);
}

function normalizedSpherePointToNormal(xy: Point): Vector3 {
  const x = xy.x;
  const y = xy.y;
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));

  return normalize3({ x, y, z });
}

export function projectPointToTattooUv(
  point: Point,
  sphere: SphereSurface,
  tattooSize: Size,
  transform: TattooTransform,
): TattooUv {
  const sphereNormal = spherePointToNormal(point, sphere);
  const centerNormal = projectionCenterToNormal(
    { x: transform.x, y: transform.y },
    sphere,
  );
  const basis = createTangentBasis(centerNormal, transform.rotation);
  const forward = dot3(sphereNormal, centerNormal);
  const tangentX = dot3(sphereNormal, basis.u);
  const tangentY = dot3(sphereNormal, basis.v);
  const tangentLength = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
  const theta = Math.atan2(tangentLength, forward);
  const angularScale = tangentLength < 0.0001 ? 1 : theta / tangentLength;
  const localX = (sphere.r * tangentX * angularScale) / transform.scale;
  const localY = (sphere.r * tangentY * angularScale) / transform.scale;

  return {
    u: localX / tattooSize.width + 0.5,
    v: localY / tattooSize.height + 0.5,
  };
}

export function pointIsInsideTattoo(
  point: Point,
  sphere: SphereSurface,
  tattooSize: Size,
  transform: TattooTransform,
): boolean {
  const uv = projectPointToTattooUv(point, sphere, tattooSize, transform);
  return uv.u >= 0 && uv.u <= 1 && uv.v >= 0 && uv.v <= 1;
}

function clampToCircleRadially(x: number, y: number, maxRadiusRatio: number): Point {
  const length = Math.sqrt(x * x + y * y);

  if (length <= maxRadiusRatio) {
    return { x, y };
  }

  return {
    x: (x / length) * maxRadiusRatio,
    y: (y / length) * maxRadiusRatio,
  };
}

function clampToCircleByDominantAxis(x: number, y: number, maxRadiusRatio: number): Point {
  const length = Math.sqrt(x * x + y * y);

  if (length <= maxRadiusRatio) {
    return { x, y };
  }

  // WHY: 投影中心接近轮廓线时切线图会退化；水平拖出侧边时保留 y 只限制 x，
  // TRADE-OFF: 这是交互稳定优先的安全投影中心，不代表真实球面采样点也被改写。
  if (Math.abs(x) >= Math.abs(y)) {
    const clampedY = clamp(y, -maxRadiusRatio, maxRadiusRatio);
    const xLimit = Math.sqrt(Math.max(0, maxRadiusRatio * maxRadiusRatio - clampedY * clampedY));
    return { x: Math.sign(x || 1) * xLimit, y: clampedY };
  }

  const clampedX = clamp(x, -maxRadiusRatio, maxRadiusRatio);
  const yLimit = Math.sqrt(Math.max(0, maxRadiusRatio * maxRadiusRatio - clampedX * clampedX));
  return { x: clampedX, y: Math.sign(y || 1) * yLimit };
}

function createTangentBasis(normal: Vector3, rotation: number): { u: Vector3; v: Vector3 } {
  const projectedRight = subtract3({ x: 1, y: 0, z: 0 }, scale3(normal, normal.x));
  const projectedDown = subtract3({ x: 0, y: 1, z: 0 }, scale3(normal, normal.y));
  const basis = createScreenAlignedBasis(normal, projectedRight, projectedDown);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    u: normalize3(add3(scale3(basis.u, cos), scale3(basis.v, sin))),
    v: normalize3(add3(scale3(basis.u, -sin), scale3(basis.v, cos))),
  };
}

function createScreenAlignedBasis(
  normal: Vector3,
  projectedRight: Vector3,
  projectedDown: Vector3,
): { u: Vector3; v: Vector3 } {
  // WHY: 贴图控制框来自屏幕/Fabric 语义，边缘处径向屏幕轴会退化到深度方向。
  // 选择投影长度更大的屏幕轴作为主轴，可在真实轮廓线上避免 90 度轴交换。
  if (length3(projectedRight) >= length3(projectedDown)) {
    const u = normalize3(projectedRight);
    return { u, v: normalize3(cross3(normal, u)) };
  }

  const v = normalize3(projectedDown);
  return { u: normalize3(cross3(v, normal)), v };
}

function add3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale3(value: Vector3, scale: number): Vector3 {
  return { x: value.x * scale, y: value.y * scale, z: value.z * scale };
}

function dot3(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length3(value: Vector3): number {
  return Math.sqrt(dot3(value, value));
}

function normalize3(value: Vector3): Vector3 {
  const length = length3(value);

  if (length < 0.0001) {
    return { x: 0, y: 0, z: 1 };
  }

  return scale3(value, 1 / length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
