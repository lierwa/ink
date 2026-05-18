import { describe, expect, test } from "vitest";
import { extractSkinContours } from "../../src/domain/skinContour";
import { postProcessSkinMask } from "../../src/domain/skinMaskProcess";
import { buildSkinMesh } from "../../src/domain/skinMesh";
import { buildSkinMeshFromMask } from "../../src/domain/skinMeshPipeline";
import type { Point, SkinContourLoop, SkinMask } from "../../src/domain/types";

function createMask(width: number, height: number, predicate: (x: number, y: number) => boolean): SkinMask {
  const probabilities = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      probabilities[y * width + x] = predicate(x, y) ? 0.9 : 0.1;
    }
  }
  return { width, height, probabilities };
}

describe("skin mesh foundations", () => {
  test("builds stable contour candidates from mask post-processing output", () => {
    const mask = createMask(14, 10, (x, y) => x >= 2 && x <= 11 && y >= 2 && y <= 7);
    const binary = postProcessSkinMask(mask, {
      threshold: 0.5,
      keepLargestComponent: true,
      minComponentArea: 8,
      morphology: { enabled: true, openIterations: 0, closeIterations: 1, kernelSize: 3 },
    });
    const contours = extractSkinContours(binary, {
      simplifyTolerance: 0.5,
      minLoopArea: 4,
      resample: { minStep: 2, maxStep: 6 },
    });

    expect(contours.length).toBeGreaterThan(0);
    expect(contours[0].isHole).toBe(false);
    expect(contours[0].perimeter).toBeGreaterThan(0);
    expect(contours[0].points.length).toBeGreaterThan(6);
  });
});

describe("buildSkinMesh", () => {
  test("returns indexed triangles for a contour with interior points", () => {
    const contour: SkinContourLoop = {
      isHole: false,
      area: 1600,
      perimeter: 160,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ],
    };

    const interior: Point[] = [
      { x: 20, y: 20 },
      { x: 10, y: 10 },
      { x: 30, y: 30 },
    ];

    const mesh = buildSkinMesh([contour], interior);

    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.boundaryFlags?.length).toBe(mesh.positions.length / 2);
    expect(mesh.boundaryFlags?.[0]).toBe(1);
  });
});

describe("buildSkinMeshFromMask", () => {
  test("builds a non-empty mesh directly from processed mask pipeline", () => {
    const mask = createMask(48, 36, (x, y) => x >= 8 && x <= 38 && y >= 6 && y <= 30);
    const mesh = buildSkinMeshFromMask(mask, {
      maskProcess: {
        threshold: 0.4,
        minComponentArea: 20,
        keepLargestComponent: true,
        morphology: { enabled: true, openIterations: 0, closeIterations: 1, kernelSize: 3 },
      },
      contourExtract: {
        simplifyTolerance: 0.6,
        minLoopArea: 10,
        resample: { minStep: 2, maxStep: 6 },
      },
      resolution: {
        innerRadius: 7,
        boundaryBandWidth: 10,
        boundaryRadius: 4,
      },
    });

    expect(mesh.positions.length).toBeGreaterThan(20);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
  });
});
