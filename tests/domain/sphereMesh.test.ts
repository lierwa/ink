import { describe, expect, test } from "vitest";
import {
  buildSphereMesh,
  buildSphereWireframeSegments,
  meshResolutionLimits,
  normalizeMeshResolution,
} from "../../src/domain/sphereMesh";
import type { SphereMeshResolution, SphereSurface } from "../../src/domain/types";

const sphere: SphereSurface = { cx: 450, cy: 310, r: 205 };
const resolution: SphereMeshResolution = {
  radialSegments: 8,
  angularSegments: 32,
};

describe("normalizeMeshResolution", () => {
  test("rounds decimal segment values consistently", () => {
    expect(normalizeMeshResolution({
      radialSegments: 12.49,
      angularSegments: 48.5,
    })).toEqual({
      radialSegments: 12,
      angularSegments: 49,
    });
  });

  test("clamps segment values to the shared min and max bounds", () => {
    expect(normalizeMeshResolution({
      radialSegments: meshResolutionLimits.radialSegments.min - 10,
      angularSegments: meshResolutionLimits.angularSegments.max + 10,
    })).toEqual({
      radialSegments: meshResolutionLimits.radialSegments.min,
      angularSegments: meshResolutionLimits.angularSegments.max,
    });
  });

  test("falls back non-finite segment values to the shared minimums", () => {
    expect(normalizeMeshResolution({
      radialSegments: Number.NaN,
      angularSegments: Number.POSITIVE_INFINITY,
    })).toEqual({
      radialSegments: meshResolutionLimits.radialSegments.min,
      angularSegments: meshResolutionLimits.angularSegments.min,
    });
  });
});

describe("buildSphereMesh", () => {
  test("uses polar rings so the outer ring lands exactly on the visible circle", () => {
    const mesh = buildSphereMesh({ sphere, resolution });
    const outerStart = 1 + (resolution.radialSegments - 1) * resolution.angularSegments;

    for (let i = 0; i < resolution.angularSegments; i += 1) {
      const vertex = outerStart + i;
      const x = mesh.positions[vertex * 2];
      const y = mesh.positions[vertex * 2 + 1];
      const dx = x - sphere.cx;
      const dy = y - sphere.cy;

      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(sphere.r, 4);
    }
  });

  test("never emits triangle vertices outside the visible sphere", () => {
    const mesh = buildSphereMesh({ sphere, resolution });

    for (const index of mesh.indices) {
      const x = mesh.positions[index * 2];
      const y = mesh.positions[index * 2 + 1];
      const dx = x - sphere.cx;
      const dy = y - sphere.cy;

      expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(sphere.r + 0.001);
    }
  });

  test("uses the full visible sphere as the mesh domain", () => {
    const mesh = buildSphereMesh({ sphere, resolution });
    const xs: number[] = [];
    const ys: number[] = [];

    for (let i = 0; i < mesh.positions.length; i += 2) {
      xs.push(mesh.positions[i]);
      ys.push(mesh.positions[i + 1]);
    }

    expect(Math.min(...xs)).toBeCloseTo(sphere.cx - sphere.r, 5);
    expect(Math.max(...xs)).toBeCloseTo(sphere.cx + sphere.r, 5);
    expect(Math.min(...ys)).toBeCloseTo(sphere.cy - sphere.r, 5);
    expect(Math.max(...ys)).toBeCloseTo(sphere.cy + sphere.r, 5);
  });
});

describe("buildSphereWireframeSegments", () => {
  test("returns unique line segments for triangle edges", () => {
    const mesh = buildSphereMesh({ sphere, resolution });
    const segments = buildSphereWireframeSegments(mesh);

    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length % 4).toBe(0);

    const seen = new Set<string>();
    for (let i = 0; i < segments.length; i += 4) {
      const key = Array.from(segments.slice(i, i + 4)).join(",");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
