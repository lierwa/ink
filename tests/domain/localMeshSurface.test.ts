// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { buildLocalMeshSurface } from "../../src/domain/localMeshSurface";
import type { SkinMask, SkinMeshData } from "../../src/domain/types";

function fullMask(width = 120, height = 120): SkinMask {
  return { width, height, probabilities: new Float32Array(width * height).fill(1) };
}

function mesh(): SkinMeshData {
  return {
    positions: new Float32Array([
      20, 20, 60, 20, 100, 20,
      20, 60, 60, 60, 100, 60,
      20, 100, 60, 100, 100, 100,
    ]),
    indices: new Uint32Array([
      0, 1, 4, 0, 4, 3,
      1, 2, 5, 1, 5, 4,
      3, 4, 7, 3, 7, 6,
      4, 5, 8, 4, 8, 7,
    ]),
  };
}

describe("buildLocalMeshSurface", () => {
  test("uses vertices near tattoo bounds for patch bounds and normals", () => {
    const result = buildLocalMeshSurface({
      mask: fullMask(),
      mesh: mesh(),
      stageSize: { width: 120, height: 120 },
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      tattooBounds: { x: 70, y: 70, width: 28, height: 24 },
    });

    expect(result.debug.source).toBe("local-mesh");
    expect(result.debug.patchBounds?.x).toBeGreaterThanOrEqual(55);
    expect(result.debug.patchBounds?.width).toBeLessThan(70);
    expect(result.surfaceField.normalStats?.activePixelRatio).toBeGreaterThan(0);
    expect(result.surfaceField.normalStats?.maxNormalXY).toBeGreaterThan(0);
  });

  test("keeps descriptor-driven local normal xy conservative but nonzero", () => {
    const result = buildLocalMeshSurface({
      mask: fullMask(),
      mesh: mesh(),
      stageSize: { width: 120, height: 120 },
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      tattooBounds: { x: 35, y: 20, width: 54, height: 80 },
    });

    expect(result.surfaceField.normalStats?.maxNormalXY).toBeLessThanOrEqual(0.5);
    // WHY: descriptor normal 只来自局部 2D mesh 代理，应保持保守但不能退化成完全平面。
    // TRADE-OFF: meanNormalXY 低于“medium visible”阈值也可接受，真实增强交给 shading assist 弱投票。
    expect(result.surfaceField.normalStats?.meanNormalXY).toBeGreaterThanOrEqual(0.11);
  });

  test("uses enabled shading assist to increase descriptor curvature and warp strength", () => {
    const sourceCanvas = createCrossAxisGradientCanvas();
    const input = {
      mask: fullMask(),
      mesh: mesh(),
      stageSize: { width: 120, height: 120 },
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      tattooBounds: { x: 35, y: 20, width: 54, height: 80 },
    };

    const disabled = buildLocalMeshSurface({
      ...input,
      shadingAssist: { enabled: false, sourceCanvas },
    });
    const enabled = buildLocalMeshSurface({
      ...input,
      shadingAssist: { enabled: true, sourceCanvas, maxAdjustmentRatio: 0.25 },
    });

    expect(enabled.debug.source).toBe("local-mesh");
    expect(enabled.debug.shading?.used).toBe(true);
    expect(enabled.debug.curvature?.acrossAxis).toBeGreaterThan(disabled.debug.curvature?.acrossAxis ?? 0);
    // WHY: shading assist 不改颜色/合成，只通过 descriptor curvature 间接增强 normal 场强度。
    // TRADE-OFF: 测试比较最终 meanNormalXY，能覆盖 local mesh 与 descriptor 的集成边界。
    expect(enabled.surfaceField.normalStats?.meanNormalXY).toBeGreaterThan(
      disabled.surfaceField.normalStats?.meanNormalXY ?? 0,
    );
  });

  test("exposes proxy and shading debug from local descriptor", () => {
    const result = buildLocalMeshSurface({
      mask: fullMask(),
      mesh: mesh(),
      stageSize: { width: 120, height: 120 },
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      tattooBounds: { x: 35, y: 20, width: 54, height: 80 },
      shadingAssist: { enabled: false },
    });

    expect(result.debug.source).toBe("local-mesh");
    expect(result.debug.proxy).toBeDefined();
    expect(result.debug.edgeTurn).toEqual(expect.any(Number));
    expect(result.debug.curvature?.acrossAxis).toBeGreaterThan(0);
    expect(result.debug.patchBounds).toBeDefined();
    expect(result.debug.confidence).toBeGreaterThan(0);
    expect(result.debug.shading?.reason).toBe("disabled");
  });

  test("reports insufficient mesh when tattoo has no nearby skin vertices", () => {
    const result = buildLocalMeshSurface({
      mask: fullMask(),
      mesh: mesh(),
      stageSize: { width: 120, height: 120 },
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      tattooBounds: { x: 0, y: 0, width: 8, height: 8 },
    });

    expect(result.debug.source).toBe("insufficient-mesh");
    expect(result.surfaceField.normalStats?.maxNormalXY).toBe(0);
  });
});

function createCrossAxisGradientCanvas(): HTMLCanvasElement {
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
  // WHY: HTMLCanvasElement.getContext 有多个 DOM overload，直接 spy 容易误推断到 webgpu 分支。
  // TRADE-OFF: 只覆盖当前 canvas 实例，保持类型检查稳定并避免污染其他测试。
  Object.defineProperty(canvas, "getContext", {
    value: vi.fn((contextId: string) =>
      contextId === "2d" ? (context as CanvasRenderingContext2D) : null,
    ),
  });
}
