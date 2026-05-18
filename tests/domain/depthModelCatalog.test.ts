import { describe, expect, test } from "vitest";
import { discoverDepthModelOptions, resolvePreferredDepthModel } from "../../src/domain/depthModelCatalog";

describe("discoverDepthModelOptions", () => {
  test("builds model options from runtime catalog endpoint", async () => {
    const options = await discoverDepthModelOptions({
      fetcher: async () =>
        new Response(JSON.stringify({
          models: [
            { url: "/ignored.onnx", sizeBytes: 100 * 1024 * 1024 },
            { url: "/models/depth-anything-v2-small.onnx", sizeBytes: 94 * 1024 * 1024 },
            { url: "/models/depth-anything-v2-small-q4f16.onnx", sizeBytes: 19 * 1024 * 1024 },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(options.map((option) => option.url)).toEqual([
      "/models/depth-anything-v2-small-q4f16.onnx",
      "/models/depth-anything-v2-small.onnx",
    ]);
    expect(options[1].label).toContain("depth-anything-v2-small.onnx");
    expect(options[0].label).toContain("MB");
  });

  test("falls back to default paths when catalog endpoint is unavailable", async () => {
    const options = await discoverDepthModelOptions({
      fetcher: async () => {
        throw new Error("offline");
      },
    });

    expect(options.length).toBeGreaterThan(0);
    expect(options.some((option) => option.url === "/models/depth-anything-v2-small.onnx")).toBe(true);
  });

  test("filters out unreachable fallback models", async () => {
    const options = await discoverDepthModelOptions({
      fetcher: async (input, init) => {
        if (typeof input !== "string") {
          return new Response(null, { status: 404 });
        }
        if (input === "/__depth-models") {
          return new Response("{}", { status: 500 });
        }
        if (init?.method === "HEAD") {
          return new Response(null, { status: input === "/models/depth-anything-v2-small-q4f16.onnx" ? 404 : 200 });
        }
        return new Response(null, { status: 404 });
      },
    });

    expect(options.some((option) => option.url === "/models/depth-anything-v2-small-q4f16.onnx")).toBe(false);
  });
});

describe("resolvePreferredDepthModel", () => {
  test("prefers /models/depth-anything-v2-small.onnx when available", () => {
    const preferred = resolvePreferredDepthModel([
      { id: "a", url: "/models/depth-anything-v2-small-q4f16.onnx", label: "a" },
      { id: "b", url: "/models/depth-anything-v2-small.onnx", label: "b" },
    ]);

    expect(preferred?.id).toBe("b");
  });
});
