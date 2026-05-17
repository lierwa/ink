import { describe, expect, test } from "vitest";
import { sphere, stageSize } from "../src/sphereConfig";

describe("sphereConfig", () => {
  test("keeps the sphere inside the stage and exposes one source of truth", () => {
    expect(sphere.cx - sphere.r).toBeGreaterThanOrEqual(0);
    expect(sphere.cy - sphere.r).toBeGreaterThanOrEqual(0);
    expect(sphere.cx + sphere.r).toBeLessThanOrEqual(stageSize.width);
    expect(sphere.cy + sphere.r).toBeLessThanOrEqual(stageSize.height);
  });
});
