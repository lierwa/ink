import { describe, expect, test } from "vitest";
import {
  pointIsInsideTattoo,
  projectPointToTattooUv,
  spherePointToNormal,
} from "../../src/domain/tattooProjection";
import type { Size, SphereSurface, TattooTransform } from "../../src/domain/types";

const sphere: SphereSurface = { cx: 450, cy: 310, r: 200 };
const size: Size = { width: 200, height: 160 };
const transform: TattooTransform = {
  x: 450,
  y: 310,
  scale: 1,
  rotation: 0,
  opacity: 0.84,
};

describe("spherePointToNormal", () => {
  test("reconstructs the front-facing unit normal for a sphere screen point", () => {
    expect(spherePointToNormal({ x: 450, y: 310 }, sphere)).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });

    const edge = spherePointToNormal({ x: 650, y: 310 }, sphere);
    expect(edge.x).toBeCloseTo(1);
    expect(edge.y).toBeCloseTo(0);
    expect(edge.z).toBeCloseTo(0);
  });

  test("projects off-sphere points to the nearest visible circle direction", () => {
    const normal = spherePointToNormal(
      { x: sphere.cx + sphere.r * 2, y: sphere.cy + sphere.r * 0.5 },
      sphere,
    );

    expect(normal.x).toBeCloseTo(0.9701425, 6);
    expect(normal.y).toBeCloseTo(0.2425356, 6);
    expect(normal.z).toBeCloseTo(0, 6);
  });
});

describe("tattoo projection", () => {
  test("maps the transform center to the center of the tattoo texture", () => {
    expect(projectPointToTattooUv({ x: 450, y: 310 }, sphere, size, transform)).toEqual({
      u: 0.5,
      v: 0.5,
    });
  });

  test("preserves tiny nonzero offsets instead of collapsing them to center", () => {
    const uv = projectPointToTattooUv(
      { x: sphere.cx + 0.001, y: sphere.cy },
      sphere,
      size,
      transform,
    );

    expect(uv.u).toBeGreaterThan(0.5);
    expect(uv.v).toBe(0.5);
  });

  test("uses angular sphere distance rather than flat screen distance", () => {
    const pointAtQuarterRadian = {
      x: sphere.cx + Math.sin(0.25) * sphere.r,
      y: sphere.cy,
    };

    const uv = projectPointToTattooUv(pointAtQuarterRadian, sphere, size, transform);

    expect(uv.u).toBeCloseTo(0.75, 4);
    expect(uv.v).toBeCloseTo(0.5, 4);
  });

  test("preserves angular distance for diagonal tangent offsets", () => {
    const theta = 0.25;
    const diagonalComponent = Math.sin(theta) / Math.sqrt(2);
    const pointAtDiagonalQuarterRadian = {
      x: sphere.cx + diagonalComponent * sphere.r,
      y: sphere.cy + diagonalComponent * sphere.r,
    };
    const expectedLocalComponent = (sphere.r * theta) / Math.sqrt(2);

    const uv = projectPointToTattooUv(pointAtDiagonalQuarterRadian, sphere, size, transform);

    expect(uv.u).toBeCloseTo(expectedLocalComponent / size.width + 0.5, 4);
    expect(uv.v).toBeCloseTo(expectedLocalComponent / size.height + 0.5, 4);
  });

  test("preserves angular distances beyond 90 degrees on the visible sphere", () => {
    const offCenterTransform: TattooTransform = {
      ...transform,
      x: sphere.cx + 0.8 * sphere.r,
    };
    const visibleFarSidePoint = {
      x: sphere.cx - 0.8 * sphere.r,
      y: sphere.cy,
    };

    const uv = projectPointToTattooUv(visibleFarSidePoint, sphere, size, offCenterTransform);
    const localX = (uv.u - 0.5) * size.width;
    const localY = (uv.v - 0.5) * size.height;
    const localDistance = Math.sqrt(localX * localX + localY * localY);

    expect(localDistance).toBeGreaterThan((Math.PI * sphere.r) / 2);
  });

  test("uses inverse rotation in the tangent frame", () => {
    const rotated: TattooTransform = {
      ...transform,
      rotation: Math.PI / 2,
    };
    const pointAtQuarterRadianDown = {
      x: sphere.cx,
      y: sphere.cy + Math.sin(0.25) * sphere.r,
    };

    const uv = projectPointToTattooUv(pointAtQuarterRadianDown, sphere, size, rotated);

    expect(uv.u).toBeCloseTo(0.75, 4);
    expect(uv.v).toBeCloseTo(0.5, 4);
  });

  test("keeps the left-edge tangent orientation continuous", () => {
    const nearLeftCenter: TattooTransform = {
      ...transform,
      x: sphere.cx - sphere.r + 0.01,
    };
    const edgeLeftCenter: TattooTransform = {
      ...transform,
      x: sphere.cx - sphere.r,
    };
    const visiblePointAbove = {
      x: sphere.cx - sphere.r + 20,
      y: sphere.cy - 20,
    };

    const nearUv = projectPointToTattooUv(visiblePointAbove, sphere, size, nearLeftCenter);
    const edgeUv = projectPointToTattooUv(visiblePointAbove, sphere, size, edgeLeftCenter);

    expect(edgeUv.u).toBeCloseTo(nearUv.u, 1);
    expect(edgeUv.v).toBeCloseTo(nearUv.v, 1);
  });

  test("keeps the right-edge tangent orientation continuous", () => {
    const nearRightCenter: TattooTransform = {
      ...transform,
      x: sphere.cx + sphere.r - 0.01,
    };
    const edgeRightCenter: TattooTransform = {
      ...transform,
      x: sphere.cx + sphere.r,
    };
    const visiblePointAbove = {
      x: sphere.cx + sphere.r - 20,
      y: sphere.cy - 20,
    };

    const nearUv = projectPointToTattooUv(visiblePointAbove, sphere, size, nearRightCenter);
    const edgeUv = projectPointToTattooUv(visiblePointAbove, sphere, size, edgeRightCenter);

    expect(edgeUv.u).toBeCloseTo(nearUv.u, 1);
    expect(edgeUv.v).toBeCloseTo(nearUv.v, 1);
  });

  test("keeps the projected center stable after dragging beyond the left edge", () => {
    const visiblePointAbove = {
      x: sphere.cx - sphere.r + 20,
      y: sphere.cy - 20,
    };
    const edgeUv = projectPointToTattooUv(visiblePointAbove, sphere, size, {
      ...transform,
      x: sphere.cx - sphere.r,
    });
    const outsideUv = projectPointToTattooUv(visiblePointAbove, sphere, size, {
      ...transform,
      x: sphere.cx - sphere.r - 60,
    });

    expect(outsideUv.u).toBeCloseTo(edgeUv.u, 6);
    expect(outsideUv.v).toBeCloseTo(edgeUv.v, 6);
  });

  test("uses the real off-center silhouette without turning screen-down into horizontal texture space", () => {
    const centerY = sphere.cy + 60;
    const leftX = sphere.cx
      - Math.sqrt(sphere.r ** 2 - (centerY - sphere.cy) ** 2);
    const visiblePointBelow = {
      x: leftX + 20,
      y: centerY + 40,
    };

    const uv = projectPointToTattooUv(visiblePointBelow, sphere, size, {
      ...transform,
      x: leftX,
      y: centerY,
    });

    expect(uv.u).toBeCloseTo(0.6459, 3);
    expect(uv.v).toBeCloseTo(0.7793, 3);
  });

  test("keeps off-center horizontal drags pinned to the same visible silhouette height", () => {
    const centerY = sphere.cy + 60;
    const leftX = sphere.cx
      - Math.sqrt(sphere.r ** 2 - (centerY - sphere.cy) ** 2);
    const visiblePointBelow = {
      x: leftX + 20,
      y: centerY + 40,
    };
    const edgeUv = projectPointToTattooUv(visiblePointBelow, sphere, size, {
      ...transform,
      x: leftX,
      y: centerY,
    });
    const outsideUv = projectPointToTattooUv(visiblePointBelow, sphere, size, {
      ...transform,
      x: leftX - 120,
      y: centerY,
    });

    expect(outsideUv.u).toBeCloseTo(edgeUv.u, 6);
    expect(outsideUv.v).toBeCloseTo(edgeUv.v, 6);
  });

  test("uses the real off-center top silhouette without turning screen-right into vertical texture space", () => {
    const centerX = sphere.cx + 60;
    const topY = sphere.cy
      - Math.sqrt(sphere.r ** 2 - (centerX - sphere.cx) ** 2);
    const visiblePointRight = {
      x: centerX + 40,
      y: topY + 20,
    };

    const uv = projectPointToTattooUv(visiblePointRight, sphere, size, {
      ...transform,
      x: centerX,
      y: topY,
    });

    expect(uv.u).toBeCloseTo(0.7234, 3);
    expect(uv.v).toBeCloseTo(0.6824, 3);
  });

  test("keeps off-center vertical drags pinned to the same visible silhouette width", () => {
    const centerX = sphere.cx + 60;
    const topY = sphere.cy
      - Math.sqrt(sphere.r ** 2 - (centerX - sphere.cx) ** 2);
    const visiblePointRight = {
      x: centerX + 40,
      y: topY + 20,
    };
    const edgeUv = projectPointToTattooUv(visiblePointRight, sphere, size, {
      ...transform,
      x: centerX,
      y: topY,
    });
    const outsideUv = projectPointToTattooUv(visiblePointRight, sphere, size, {
      ...transform,
      x: centerX,
      y: topY - 120,
    });

    expect(outsideUv.u).toBeCloseTo(edgeUv.u, 6);
    expect(outsideUv.v).toBeCloseTo(edgeUv.v, 6);
  });

  test("detects whether a sphere point samples inside the tattoo image", () => {
    expect(pointIsInsideTattoo({ x: 450, y: 310 }, sphere, size, transform)).toBe(true);
    expect(pointIsInsideTattoo({ x: 650, y: 310 }, sphere, size, transform)).toBe(false);
  });
});
