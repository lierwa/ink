import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("application styles", () => {
  test("tattoo upload preview does not use scrollable overflow", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const previewRule = css.match(/\.upload-confirm-preview\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(previewRule).not.toMatch(/overflow\s*:\s*(auto|scroll)/);
  });

  test("tattoo upload preview is compact and centered", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const previewRule = css.match(/\.upload-confirm-preview\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(previewRule).toMatch(/width:\s*min\(82vw,\s*720px\)/);
    expect(previewRule).toMatch(/height:\s*min\(68vh,\s*520px\)/);
    expect(previewRule).not.toMatch(/960px/);
  });

  test("tattoo cropper handles are small point handles", () => {
    const css = readFileSync("src/styles.css", "utf8");

    expect(css).toContain("cropper-handle[data-cropper-handle]");
    expect(css).toContain("width: 10px");
    expect(css).toContain("height: 10px");
  });
});
