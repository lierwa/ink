import { describe, expect, test, vi } from "vitest";
import { replaceTextureBindingBeforeDestroy } from "../src/appSurfaceRuntime";

describe("replaceTextureBindingBeforeDestroy", () => {
  test("binds the replacement texture before destroying the previous texture", () => {
    const calls: string[] = [];
    const previous = {
      destroy: vi.fn(() => calls.push("destroy previous")),
    };
    const next = { source: "next" };

    replaceTextureBindingBeforeDestroy(previous as never, next as never, (texture) => {
      expect(texture).toBe(next);
      calls.push("bind next");
    });

    expect(calls).toEqual(["bind next", "destroy previous"]);
    expect(previous.destroy).toHaveBeenCalledWith(true);
  });
});
