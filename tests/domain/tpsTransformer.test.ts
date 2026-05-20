import { describe, expect, test } from "vitest";
import { createThinPlateSplineTransformer } from "../../src/domain/tpsTransformer";

describe("createThinPlateSplineTransformer", () => {
  test("maps every control point exactly enough for tattoo anchoring", () => {
    const transformer = createThinPlateSplineTransformer([
      { source: { x: 0, y: 0 }, destination: { x: 10, y: 20 } },
      { source: { x: 100, y: 0 }, destination: { x: 120, y: 25 } },
      { source: { x: 0, y: 100 }, destination: { x: 4, y: 130 } },
      { source: { x: 100, y: 100 }, destination: { x: 112, y: 118 } },
      { source: { x: 50, y: 50 }, destination: { x: 66, y: 74 } },
    ]);

    expect(transformer.transform({ x: 0, y: 0 })).toMatchObject({ x: expect.closeTo(10, 5), y: expect.closeTo(20, 5) });
    expect(transformer.transform({ x: 100, y: 0 })).toMatchObject({ x: expect.closeTo(120, 5), y: expect.closeTo(25, 5) });
    expect(transformer.transform({ x: 50, y: 50 })).toMatchObject({ x: expect.closeTo(66, 5), y: expect.closeTo(74, 5) });
  });

  test("creates visible non-linear displacement between edge and center control points", () => {
    const transformer = createThinPlateSplineTransformer([
      { source: { x: 0, y: 0 }, destination: { x: 0, y: 0 } },
      { source: { x: 100, y: 0 }, destination: { x: 100, y: 8 } },
      { source: { x: 0, y: 100 }, destination: { x: 0, y: 100 } },
      { source: { x: 100, y: 100 }, destination: { x: 100, y: 108 } },
      { source: { x: 50, y: 50 }, destination: { x: 58, y: 62 } },
    ]);

    const linearMidpoint = { x: 50, y: 54 };
    const warped = transformer.transform({ x: 50, y: 50 });

    expect(Math.hypot(warped.x - linearMidpoint.x, warped.y - linearMidpoint.y)).toBeGreaterThan(6);
  });
});
