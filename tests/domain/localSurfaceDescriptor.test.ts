// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { resolveLocalSurfaceDescriptor } from "../../src/domain/localSurfaceDescriptor";
import type { SkinMask, SkinMeshData } from "../../src/domain/types";

function fullMask(width = 120, height = 120): SkinMask {
  return { width, height, probabilities: new Float32Array(width * height).fill(1) };
}

function verticalMesh(): SkinMeshData {
  return {
    positions: new Float32Array([
      50, 10, 70, 10,
      48, 60, 72, 60,
      50, 110, 70, 110,
    ]),
    indices: new Uint32Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]),
  };
}

describe("resolveLocalSurfaceDescriptor", () => {
  test("classifies a narrow local patch as an elliptical cylinder", () => {
    const descriptor = resolveLocalSurfaceDescriptor({
      mask: fullMask(),
      mesh: verticalMesh(),
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      stageSize: { width: 120, height: 120 },
      tattooBounds: { x: 45, y: 32, width: 30, height: 48 },
    });

    expect(descriptor.source).toBe("geometry");
    expect(descriptor.proxy).toBe("ellipticalCylinder");
    expect(descriptor.axis.direction.y).toBe(1);
    expect(descriptor.curvature.acrossAxis).toBeGreaterThan(0);
  });

  test("uses aligned shading assist to increase across-axis curvature", () => {
    const sourceCanvas = createGradientCanvas();
    const input = {
      mask: fullMask(),
      mesh: verticalMesh(),
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      stageSize: { width: 120, height: 120 },
      tattooBounds: { x: 45, y: 32, width: 30, height: 48 },
    };

    const geometryOnly = resolveLocalSurfaceDescriptor({
      ...input,
      shadingAssist: { enabled: false, sourceCanvas },
    });
    const assisted = resolveLocalSurfaceDescriptor({
      ...input,
      shadingAssist: { enabled: true, sourceCanvas, maxAdjustmentRatio: 0.25 },
    });

    expect(assisted.source).toBe("geometry-shading");
    expect(assisted.shading?.used).toBe(true);
    expect(assisted.curvature.acrossAxis).toBeGreaterThan(geometryOnly.curvature.acrossAxis);
  });
});

function createGradientCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 120;
  mockCanvas2DContext(canvas, {
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const value = Math.round((x / Math.max(1, width - 1)) * 255);
          data[index] = value;
          data[index + 1] = value;
          data[index + 2] = value;
          data[index + 3] = 255;
        }
      }
      return { width, height, data } as ImageData;
    }),
  });
  return canvas;
}

function mockCanvas2DContext(
  canvas: HTMLCanvasElement,
  context: Pick<CanvasRenderingContext2D, "getImageData">,
): void {
  // WHY: HTMLCanvasElement.getContext 有多个 DOM overload，直接 spy 会被推断到 webgpu 分支；
  // TRADE-OFF: defineProperty 只覆盖当前测试 canvas，避免影响全局原型但保留类型安全。
  Object.defineProperty(canvas, "getContext", {
    value: vi.fn((contextId: string) =>
      contextId === "2d" ? (context as CanvasRenderingContext2D) : null,
    ),
  });
}
