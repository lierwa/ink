# Upload Confirm Crop Background Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local background-removal and crop-confirmation workflow so uploads become transparent, user-cropped tattoo assets only after explicit confirmation.

**Architecture:** Keep Pixi per-pixel sphere projection as the final tattoo renderer and Fabric as the invisible transform controller. Add a modal-owned draft workflow for AI background removal, line-art cleanup, original preview, and free rectangular crop export; only confirmed cropped canvases enter the existing app commit path. Surface grid controls remain debug/boundary controls and must not affect tattoo fitting semantics.

**Tech Stack:** TypeScript, Vite, Vitest, PixiJS 8, Fabric 7, `@imgly/background-removal`, `onnxruntime-web`.

---

## Reference Inputs

- Design spec: `docs/superpowers/specs/2026-05-17-upload-confirm-crop-background-removal-design.md`
- IMG.LY browser package docs: `https://www.npmjs.com/package/@imgly/background-removal?activeTab=readme`
  - Install: `@imgly/background-removal` plus `onnxruntime-web@1.21.0-dev.20250206-d981b153d3`
  - Usage shape:

```ts
import imglyRemoveBackground from "@imgly/background-removal";

const resultBlob = await imglyRemoveBackground(source);
```

The package returns a PNG `Blob`. The implementation must convert that blob into an `HTMLCanvasElement`.

## Target File Structure

- Create `src/image/cropCanvas.ts`
  - Pure canvas crop/export helper.
- Create `src/image/lineArtCleanup.ts`
  - Improved local line-art background cleanup.
- Create `src/image/backgroundRemoval.ts`
  - Small wrapper around `@imgly/background-removal`, with injectable remover for tests.
- Create `src/editor/uploadConfirmModal.ts`
  - Modal DOM, preview canvas, processing mode switch, crop rectangle interactions, Add/Cancel lifecycle.
- Create `src/appUploadWorkflow.ts`
  - Upload input orchestration, request sequencing, modal open, and confirmed-canvas commit.
- Modify `src/app.ts`
  - Remove direct upload processing functions and call `installUploadWorkflow`.
- Modify `src/appMarkup.ts`
  - Rename mesh controls to `Surface Grid`, `Radial Lines`, `Angular Lines`, and add helper copy.
- Modify `src/styles.css`
  - Add modal, checkerboard, crop overlay, and updated surface grid styles.
- Modify `package.json` / lockfile
  - Add AI background-removal dependencies.
- Add tests:
  - `tests/image/cropCanvas.test.ts`
  - `tests/image/lineArtCleanup.test.ts`
  - `tests/image/backgroundRemoval.test.ts`
  - `tests/editor/uploadConfirmModal.test.ts`
  - `tests/appUploadQueue.test.ts`

Current workspace is not a git repository. If execution happens inside a git repo, commit after each task. In this workspace, record changed files and verification output instead of committing.

---

## Task 1: Add Crop Export Helper

**Files:**
- Create: `src/image/cropCanvas.ts`
- Test: `tests/image/cropCanvas.test.ts`

- [ ] **Step 1: Write failing crop tests**

Create `tests/image/cropCanvas.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { cropCanvasToCanvas, normalizeCropRect } from "../../src/image/cropCanvas";

describe("normalizeCropRect", () => {
  test("clamps crop rectangle to source bounds and rounds to pixels", () => {
    expect(normalizeCropRect(
      { x: -2.4, y: 3.6, width: 9.2, height: 20.1 },
      { width: 10, height: 12 },
    )).toEqual({ x: 0, y: 4, width: 7, height: 8 });
  });

  test("keeps at least one pixel in each dimension", () => {
    expect(normalizeCropRect(
      { x: 4, y: 4, width: 0, height: -3 },
      { width: 10, height: 10 },
    )).toEqual({ x: 4, y: 4, width: 1, height: 1 });
  });
});

describe("cropCanvasToCanvas", () => {
  test("exports the selected transparent crop with expected drawImage arguments", () => {
    const source = createCanvasStub(20, 16);
    const result = cropCanvasToCanvas(source, { x: 3, y: 4, width: 8, height: 6 }, createCanvasStub);

    expect(result.width).toBe(8);
    expect(result.height).toBe(6);
    expect(result.context.drawImage).toHaveBeenCalledWith(source, 3, 4, 8, 6, 0, 0, 8, 6);
  });
});

function createCanvasStub(width = 0, height = 0): HTMLCanvasElement & {
  context: { drawImage: ReturnType<typeof vi.fn> };
} {
  const context = { drawImage: vi.fn() };
  return {
    width,
    height,
    context,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement & { context: typeof context };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/image/cropCanvas.test.ts
```

Expected: fail because `src/image/cropCanvas.ts` does not exist.

- [ ] **Step 3: Implement crop helper**

Create `src/image/cropCanvas.ts`:

```ts
import type { Size } from "../domain/types";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CanvasFactory = () => HTMLCanvasElement;

export function normalizeCropRect(rect: CropRect, sourceSize: Size): CropRect {
  const x = clamp(Math.round(rect.x), 0, Math.max(0, sourceSize.width - 1));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, sourceSize.height - 1));
  const maxWidth = Math.max(1, sourceSize.width - x);
  const maxHeight = Math.max(1, sourceSize.height - y);
  const width = clamp(Math.round(rect.width), 1, maxWidth);
  const height = clamp(Math.round(rect.height), 1, maxHeight);

  return { x, y, width, height };
}

export function cropCanvasToCanvas(
  source: HTMLCanvasElement,
  crop: CropRect,
  createCanvas: CanvasFactory = () => document.createElement("canvas"),
): HTMLCanvasElement {
  const rect = normalizeCropRect(crop, {
    width: source.width,
    height: source.height,
  });
  const output = createCanvas();
  output.width = rect.width;
  output.height = rect.height;
  const context = output.getContext("2d");

  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }

  context.clearRect(0, 0, output.width, output.height);
  context.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );

  return output;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun run test tests/image/cropCanvas.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit or record**

If in a git repo:

```bash
git add src/image/cropCanvas.ts tests/image/cropCanvas.test.ts
git commit -m "feat: add canvas crop export helper"
```

If not in a git repo, record changed files and test output.

---

## Task 2: Add Improved Line-Art Cleanup

**Files:**
- Create: `src/image/lineArtCleanup.ts`
- Modify: `src/image/imageProcessing.ts`
- Test: `tests/image/lineArtCleanup.test.ts`

- [ ] **Step 1: Write failing line-art tests**

Create `tests/image/lineArtCleanup.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { cleanupLineArtBackgroundFromPixels } from "../../src/image/lineArtCleanup";

describe("cleanupLineArtBackgroundFromPixels", () => {
  test("removes paper-like white and light gray pixels", () => {
    const pixels = new Uint8ClampedArray([
      250, 250, 248, 255,
      228, 229, 226, 255,
      24, 24, 24, 255,
    ]);

    cleanupLineArtBackgroundFromPixels(pixels);

    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBeLessThan(96);
    expect(pixels[11]).toBe(255);
  });

  test("preserves dark and mid-gray linework", () => {
    const pixels = new Uint8ClampedArray([
      30, 30, 30, 255,
      120, 120, 118, 255,
      178, 176, 172, 255,
    ]);

    cleanupLineArtBackgroundFromPixels(pixels);

    expect(pixels[3]).toBe(255);
    expect(pixels[7]).toBeGreaterThanOrEqual(180);
    expect(pixels[11]).toBeGreaterThanOrEqual(100);
  });

  test("does not make semi-transparent uploaded pixels opaque", () => {
    const pixels = new Uint8ClampedArray([
      250, 250, 250, 70,
      20, 20, 20, 90,
    ]);

    cleanupLineArtBackgroundFromPixels(pixels);

    expect(pixels[3]).toBeLessThanOrEqual(70);
    expect(pixels[7]).toBe(90);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/image/lineArtCleanup.test.ts
```

Expected: fail because `lineArtCleanup.ts` does not exist.

- [ ] **Step 3: Implement line-art cleanup**

Create `src/image/lineArtCleanup.ts`:

```ts
export interface LineArtCleanupOptions {
  whitePoint: number;
  fadeStart: number;
  opaqueAlphaThreshold: number;
}

export const defaultLineArtCleanupOptions: LineArtCleanupOptions = {
  whitePoint: 245,
  fadeStart: 175,
  opaqueAlphaThreshold: 180,
};

export function cleanupLineArtBackground(imageData: ImageData): ImageData {
  cleanupLineArtBackgroundFromPixels(imageData.data);
  return imageData;
}

export function cleanupLineArtBackgroundFromPixels(
  pixels: Uint8ClampedArray,
  options: LineArtCleanupOptions = defaultLineArtCleanupOptions,
): Uint8ClampedArray {
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    const alpha = pixels[i + 3];

    if (alpha < options.opaqueAlphaThreshold) {
      continue;
    }

    const brightness = (red + green + blue) / 3;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);

    if (brightness >= options.whitePoint && chroma <= 20) {
      pixels[i + 3] = 0;
      continue;
    }

    if (brightness > options.fadeStart && chroma <= 18) {
      const t = (brightness - options.fadeStart) / (options.whitePoint - options.fadeStart);
      const keepAlpha = Math.round(alpha * Math.max(0, 1 - t));
      pixels[i + 3] = Math.min(alpha, keepAlpha);
    }
  }

  return pixels;
}
```

Modify `src/image/imageProcessing.ts` so the existing remove-white path uses the line-art cleanup implementation while preserving the exported legacy function:

```ts
import { cleanupLineArtBackgroundFromPixels } from "./lineArtCleanup";

export function removeWhiteBackgroundFromPixels(
  pixels: Uint8ClampedArray,
  threshold = 235,
  opaqueAlphaThreshold = 220,
): Uint8ClampedArray {
  return cleanupLineArtBackgroundFromPixels(pixels, {
    whitePoint: Math.max(threshold, 235),
    fadeStart: 175,
    opaqueAlphaThreshold,
  });
}
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
bun run test tests/image/lineArtCleanup.test.ts tests/image/imageProcessing.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit or record**

If in a git repo:

```bash
git add src/image/lineArtCleanup.ts src/image/imageProcessing.ts tests/image/lineArtCleanup.test.ts
git commit -m "feat: improve line art background cleanup"
```

If not in a git repo, record changed files and test output.

---

## Task 3: Add Local AI Background Removal Wrapper

**Files:**
- Modify: `package.json`
- Lockfile generated by package manager
- Create: `src/image/backgroundRemoval.ts`
- Test: `tests/image/backgroundRemoval.test.ts`

- [ ] **Step 1: Install dependencies**

Run:

```bash
bun add @imgly/background-removal onnxruntime-web@1.21.0-dev.20250206-d981b153d3
```

Expected: `package.json` and lockfile update with the two dependencies.

If network access is blocked, request escalation for dependency installation and do not hand-edit lockfiles.

- [ ] **Step 2: Write failing wrapper tests**

Create `tests/image/backgroundRemoval.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { removeBackgroundToCanvas } from "../../src/image/backgroundRemoval";

describe("removeBackgroundToCanvas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("converts remover PNG blob output into a canvas", async () => {
    const outputCanvas = createCanvasStub();
    const image = createImageStub(14, 9);
    const remover = vi.fn(async () => new Blob(["png"], { type: "image/png" }));

    vi.stubGlobal("document", {
      createElement: vi.fn((tag: string) => {
        if (tag === "canvas") return outputCanvas;
        if (tag === "img") return image;
        throw new Error(`unexpected tag ${tag}`);
      }),
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:result"),
      revokeObjectURL: vi.fn(),
    });

    const result = await removeBackgroundToCanvas(new Blob(["input"], { type: "image/png" }), {
      remover,
    });

    expect(remover).toHaveBeenCalled();
    expect(result.width).toBe(14);
    expect(result.height).toBe(9);
    expect(outputCanvas.context.drawImage).toHaveBeenCalledWith(image, 0, 0);
  });

  test("wraps remover failures with a clear error", async () => {
    const remover = vi.fn(async () => {
      throw new Error("model failed");
    });

    await expect(
      removeBackgroundToCanvas(new Blob(["input"], { type: "image/png" }), { remover }),
    ).rejects.toThrow("AI background removal failed: model failed");
  });
});

function createImageStub(width: number, height: number): HTMLImageElement {
  return {
    width,
    height,
    onload: null,
    onerror: null,
    set src(_value: string) {
      queueMicrotask(() => this.onload?.(new Event("load")));
    },
  } as unknown as HTMLImageElement;
}

function createCanvasStub(): HTMLCanvasElement & {
  context: { drawImage: ReturnType<typeof vi.fn> };
} {
  const context = { drawImage: vi.fn() };
  return {
    width: 0,
    height: 0,
    context,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement & { context: typeof context };
}
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
bun run test tests/image/backgroundRemoval.test.ts
```

Expected: fail because `backgroundRemoval.ts` does not exist.

- [ ] **Step 4: Implement wrapper**

Create `src/image/backgroundRemoval.ts`:

```ts
import imglyRemoveBackground from "@imgly/background-removal";

export type BackgroundRemovalSource = ImageData | ArrayBuffer | Uint8Array | Blob | URL | string;
export type BackgroundRemover = (source: BackgroundRemovalSource) => Promise<Blob>;

export interface RemoveBackgroundOptions {
  remover?: BackgroundRemover;
  createCanvas?: () => HTMLCanvasElement;
  createImage?: () => HTMLImageElement;
}

export async function removeBackgroundToCanvas(
  source: BackgroundRemovalSource,
  options: RemoveBackgroundOptions = {},
): Promise<HTMLCanvasElement> {
  const remover = options.remover ?? imglyRemoveBackground;

  try {
    const blob = await remover(source);
    return await blobToCanvas(blob, options);
  } catch (error) {
    throw new Error(`AI background removal failed: ${getErrorMessage(error)}`);
  }
}

async function blobToCanvas(
  blob: Blob,
  options: RemoveBackgroundOptions,
): Promise<HTMLCanvasElement> {
  const image = options.createImage?.() ?? document.createElement("img");
  const objectUrl = URL.createObjectURL(blob);

  try {
    await loadImage(image, objectUrl);
    const canvas = options.createCanvas?.() ?? document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create a 2D canvas context.");
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(image: HTMLImageElement, source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not decode AI background removal output."));
    image.src = source;
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
```

- [ ] **Step 5: Run targeted tests and typecheck**

Run:

```bash
bun run test tests/image/backgroundRemoval.test.ts
bun run typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit or record**

If in a git repo:

```bash
git add package.json bun.lock src/image/backgroundRemoval.ts tests/image/backgroundRemoval.test.ts
git commit -m "feat: add local ai background removal wrapper"
```

If the lockfile name differs, add the actual generated lockfile.

---

## Task 4: Add Upload Confirm Modal Pure Result Contract

**Files:**
- Create: `src/editor/uploadConfirmModal.ts`
- Test: `tests/editor/uploadConfirmModal.test.ts`

- [ ] **Step 1: Write failing modal contract tests**

Create `tests/editor/uploadConfirmModal.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { openUploadConfirmModal, type ProcessedTattooOption } from "../../src/editor/uploadConfirmModal";

describe("openUploadConfirmModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("Cancel resolves null and removes the modal", async () => {
    const option = createOption("ai", createCanvasStub(12, 10));
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "ai",
      options: [option],
      cropCanvas: vi.fn(),
    });

    getButton("Cancel").click();

    await expect(promise).resolves.toBeNull();
    expect(document.querySelector("[data-upload-confirm-modal]")).toBeNull();
  });

  test("Add resolves the cropped canvas from the selected mode", async () => {
    const source = createCanvasStub(20, 18);
    const cropped = createCanvasStub(8, 7);
    const cropCanvas = vi.fn(() => cropped);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "ai",
      options: [createOption("ai", source)],
      cropCanvas,
    });

    getButton("Add").click();

    await expect(promise).resolves.toEqual({
      canvas: cropped,
      mode: "ai",
    });
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 20, height: 18 });
  });

  test("switches processing modes before Add", async () => {
    const ai = createCanvasStub(20, 18);
    const original = createCanvasStub(6, 5);
    const cropCanvas = vi.fn((source: HTMLCanvasElement) => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "ai",
      options: [
        createOption("ai", ai),
        createOption("original", original),
      ],
      cropCanvas,
    });

    (document.querySelector("input[value='original']") as HTMLInputElement).click();
    getButton("Add").click();

    await expect(promise).resolves.toEqual({
      canvas: original,
      mode: "original",
    });
  });
});

function createOption(mode: ProcessedTattooOption["mode"], canvas: HTMLCanvasElement): ProcessedTattooOption {
  return { mode, label: mode, canvas };
}

function createCanvasStub(width: number, height: number): HTMLCanvasElement {
  return {
    width,
    height,
    getContext: vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    })),
  } as unknown as HTMLCanvasElement;
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === name);

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button ${name}`);
  }

  return button;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/editor/uploadConfirmModal.test.ts
```

Expected: fail because `uploadConfirmModal.ts` does not exist.

- [ ] **Step 3: Implement modal contract and static crop defaults**

Create `src/editor/uploadConfirmModal.ts`:

```ts
import { cropCanvasToCanvas, type CropRect } from "../image/cropCanvas";

export type UploadProcessingMode = "ai" | "line-art" | "original";

export interface ProcessedTattooOption {
  mode: UploadProcessingMode;
  label: string;
  canvas: HTMLCanvasElement;
  error?: string;
}

export interface UploadConfirmResult {
  canvas: HTMLCanvasElement;
  mode: UploadProcessingMode;
}

export interface UploadConfirmModalInput {
  fileName: string;
  initialMode: UploadProcessingMode;
  options: ProcessedTattooOption[];
  cropCanvas?: (source: HTMLCanvasElement, crop: CropRect) => HTMLCanvasElement;
}

export function openUploadConfirmModal(input: UploadConfirmModalInput): Promise<UploadConfirmResult | null> {
  const cropCanvas = input.cropCanvas ?? cropCanvasToCanvas;
  const overlay = document.createElement("div");
  overlay.className = "upload-confirm-overlay";
  overlay.dataset.uploadConfirmModal = "true";
  overlay.innerHTML = createModalMarkup(input);
  document.body.appendChild(overlay);

  let selectedMode = input.initialMode;
  let selectedOption = getOption(input.options, selectedMode);
  let cropRect = createDefaultCrop(selectedOption.canvas);

  renderPreview(overlay, selectedOption.canvas, cropRect);

  return new Promise((resolve) => {
    const close = (result: UploadConfirmResult | null): void => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector<HTMLButtonElement>("[data-action='cancel']")?.addEventListener("click", () => close(null));
    overlay.querySelector<HTMLButtonElement>("[data-action='add']")?.addEventListener("click", () => {
      close({
        canvas: cropCanvas(selectedOption.canvas, cropRect),
        mode: selectedMode,
      });
    });

    for (const inputElement of overlay.querySelectorAll<HTMLInputElement>("input[name='upload-processing-mode']")) {
      inputElement.addEventListener("change", () => {
        selectedMode = inputElement.value as UploadProcessingMode;
        selectedOption = getOption(input.options, selectedMode);
        cropRect = createDefaultCrop(selectedOption.canvas);
        renderPreview(overlay, selectedOption.canvas, cropRect);
      });
    }
  });
}

function createModalMarkup(input: UploadConfirmModalInput): string {
  return `
    <div class="upload-confirm-dialog" role="dialog" aria-modal="true" aria-label="Confirm Tattoo Effect">
      <div class="upload-confirm-header">
        <div>
          <h2>Confirm Tattoo Effect</h2>
          <p>Drag crop box to select area</p>
        </div>
        <button type="button" data-action="cancel" aria-label="Close">x</button>
      </div>
      <div class="upload-confirm-body">
        <div class="upload-confirm-preview">
          <canvas data-preview-canvas></canvas>
          <div class="upload-crop-box" data-crop-box>
            <span data-crop-size></span>
          </div>
        </div>
        <div class="upload-confirm-controls">
          <p class="upload-file-name">${escapeHtml(input.fileName)}</p>
          ${input.options.map((option) => `
            <label>
              <input type="radio" name="upload-processing-mode" value="${option.mode}" ${option.mode === input.initialMode ? "checked" : ""}>
              <span>${escapeHtml(option.label)}</span>
            </label>
          `).join("")}
          <div class="upload-preview-scale" aria-label="Preview scale">
            <button type="button" data-preview-scale="1">100%</button>
            <button type="button" data-preview-scale="0.75">75%</button>
            <button type="button" data-preview-scale="0.5">50%</button>
          </div>
        </div>
      </div>
      <div class="upload-confirm-footer">
        <button type="button" data-action="cancel">Cancel</button>
        <button type="button" data-action="add">Add</button>
      </div>
    </div>
  `;
}

function renderPreview(root: HTMLElement, canvas: HTMLCanvasElement, crop: CropRect): void {
  const preview = root.querySelector<HTMLCanvasElement>("[data-preview-canvas]");
  const sizeLabel = root.querySelector<HTMLElement>("[data-crop-size]");

  if (!preview || !sizeLabel) {
    throw new Error("Upload confirmation modal preview is missing.");
  }

  preview.width = canvas.width;
  preview.height = canvas.height;
  const context = preview.getContext("2d");

  if (!context) {
    throw new Error("Could not create modal preview context.");
  }

  context.clearRect(0, 0, preview.width, preview.height);
  context.drawImage(canvas, 0, 0);
  sizeLabel.textContent = `${crop.width} x ${crop.height}`;
}

function createDefaultCrop(canvas: HTMLCanvasElement): CropRect {
  return { x: 0, y: 0, width: canvas.width, height: canvas.height };
}

function getOption(options: ProcessedTattooOption[], mode: UploadProcessingMode): ProcessedTattooOption {
  const option = options.find((candidate) => candidate.mode === mode);

  if (!option || option.error) {
    throw new Error(`Missing processed tattoo option: ${mode}`);
  }

  return option;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    };
    return replacements[character];
  });
}
```

This task intentionally starts with a static crop rectangle. Drag/resize interactions are added in Task 5.

- [ ] **Step 4: Run modal contract tests**

Run:

```bash
bun run test tests/editor/uploadConfirmModal.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit or record**

If in a git repo:

```bash
git add src/editor/uploadConfirmModal.ts tests/editor/uploadConfirmModal.test.ts
git commit -m "feat: add upload confirmation modal contract"
```

---

## Task 5: Add Crop Box Drag And Resize Interactions

**Files:**
- Modify: `src/editor/uploadConfirmModal.ts`
- Modify: `tests/editor/uploadConfirmModal.test.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Add failing interaction test**

Append to `tests/editor/uploadConfirmModal.test.ts`:

```ts
test("updates crop rectangle when crop box is dragged", async () => {
  const source = createCanvasStub(100, 80);
  const cropCanvas = vi.fn(() => source);
  const promise = openUploadConfirmModal({
    fileName: "tattoo.png",
    initialMode: "ai",
    options: [createOption("ai", source)],
    cropCanvas,
  });
  const cropBox = document.querySelector("[data-crop-box]") as HTMLElement;

  cropBox.dispatchEvent(new PointerEvent("pointerdown", {
    clientX: 10,
    clientY: 10,
    pointerId: 1,
    bubbles: true,
  }));
  window.dispatchEvent(new PointerEvent("pointermove", {
    clientX: 18,
    clientY: 22,
    pointerId: 1,
  }));
  window.dispatchEvent(new PointerEvent("pointerup", {
    clientX: 18,
    clientY: 22,
    pointerId: 1,
  }));
  getButton("Add").click();

  await promise;
  expect(cropCanvas).toHaveBeenCalledWith(source, { x: 8, y: 12, width: 92, height: 68 });
});

test("resizes crop rectangle as a free rectangle", async () => {
  const source = createCanvasStub(100, 80);
  const cropCanvas = vi.fn(() => source);
  const promise = openUploadConfirmModal({
    fileName: "tattoo.png",
    initialMode: "ai",
    options: [createOption("ai", source)],
    cropCanvas,
  });
  const handle = document.querySelector("[data-crop-resize='se']") as HTMLElement;

  handle.dispatchEvent(new PointerEvent("pointerdown", {
    clientX: 100,
    clientY: 80,
    pointerId: 2,
    bubbles: true,
  }));
  window.dispatchEvent(new PointerEvent("pointermove", {
    clientX: 82,
    clientY: 68,
    pointerId: 2,
  }));
  window.dispatchEvent(new PointerEvent("pointerup", {
    clientX: 82,
    clientY: 68,
    pointerId: 2,
  }));
  getButton("Add").click();

  await promise;
  expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 82, height: 68 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/editor/uploadConfirmModal.test.ts
```

Expected: fail because dragging does not update crop state.

- [ ] **Step 3: Implement crop interaction helpers**

In `src/editor/uploadConfirmModal.ts`, add pointer handling:

```ts
type CropPointerMode = "move" | "resize-se";

interface CropDragState {
  pointerId: number;
  startX: number;
  startY: number;
  cropStart: CropRect;
  mode: CropPointerMode;
}

function installCropDrag(
  root: HTMLElement,
  source: HTMLCanvasElement,
  getCrop: () => CropRect,
  setCrop: (crop: CropRect) => void,
): void {
  const cropBox = root.querySelector<HTMLElement>("[data-crop-box]");
  const resizeHandle = root.querySelector<HTMLElement>("[data-crop-resize='se']");

  if (!cropBox || !resizeHandle) {
    throw new Error("Upload crop box is missing.");
  }

  let drag: CropDragState | null = null;

  const startDrag = (event: PointerEvent, mode: CropPointerMode): void => {
    event.preventDefault();
    event.stopPropagation();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cropStart: getCrop(),
      mode,
    };
    cropBox.setPointerCapture(event.pointerId);
  };

  cropBox.addEventListener("pointerdown", (event) => startDrag(event, "move"));
  resizeHandle.addEventListener("pointerdown", (event) => startDrag(event, "resize-se"));

  window.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const nextCrop = drag.mode === "move"
      ? clampCrop({
          x: drag.cropStart.x + deltaX,
          y: drag.cropStart.y + deltaY,
          width: drag.cropStart.width,
          height: drag.cropStart.height,
        }, source)
      : clampCrop({
          x: drag.cropStart.x,
          y: drag.cropStart.y,
          width: drag.cropStart.width + deltaX,
          height: drag.cropStart.height + deltaY,
        }, source);
    setCrop(nextCrop);
  });

  window.addEventListener("pointerup", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    drag = null;
    if (cropBox.hasPointerCapture(event.pointerId)) {
      cropBox.releasePointerCapture(event.pointerId);
    }
  });
}

function clampCrop(crop: CropRect, source: HTMLCanvasElement): CropRect {
  const width = Math.min(Math.max(Math.round(crop.width), 1), source.width);
  const height = Math.min(Math.max(Math.round(crop.height), 1), source.height);
  return {
    x: Math.min(Math.max(Math.round(crop.x), 0), source.width - width),
    y: Math.min(Math.max(Math.round(crop.y), 0), source.height - height),
    width,
    height,
  };
}
```

Call `installCropDrag` after initial preview setup:

```ts
installCropDrag(
  overlay,
  selectedOption.canvas,
  () => cropRect,
  (nextCrop) => {
    cropRect = nextCrop;
    renderCropOverlay(overlay, cropRect, selectedOption.canvas);
  },
);
```

Split `renderPreview` so it calls `renderCropOverlay`:

```ts
function renderCropOverlay(root: HTMLElement, crop: CropRect, source: HTMLCanvasElement): void {
  const cropBox = root.querySelector<HTMLElement>("[data-crop-box]");
  const sizeLabel = root.querySelector<HTMLElement>("[data-crop-size]");

  if (!cropBox || !sizeLabel) {
    throw new Error("Upload crop overlay is missing.");
  }

  cropBox.style.left = `${crop.x}px`;
  cropBox.style.top = `${crop.y}px`;
  cropBox.style.width = `${crop.width}px`;
  cropBox.style.height = `${crop.height}px`;
  cropBox.style.maxWidth = `${source.width}px`;
  cropBox.style.maxHeight = `${source.height}px`;
  sizeLabel.textContent = `${crop.width} x ${crop.height}`;
}
```

Add resize handles in the modal markup:

```html
<button type="button" class="upload-crop-handle upload-crop-handle-se" data-crop-resize="se" aria-label="Resize crop"></button>
```

The resize behavior is required. Dragging `data-crop-resize="se"` changes width and height independently with the same `clampCrop` boundary checks. Keep free rectangle; do not force square ratio.

- [ ] **Step 4: Add modal styles**

Append to `src/styles.css`:

```css
.upload-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: rgba(13, 15, 18, 0.72);
}

.upload-confirm-dialog {
  width: min(92vw, 760px);
  max-height: 92vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  border-radius: 8px;
  background: #ffffff;
  color: #171b1c;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
  overflow: hidden;
}

.upload-confirm-header,
.upload-confirm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #e2e6e8;
}

.upload-confirm-footer {
  border-top: 1px solid #e2e6e8;
  border-bottom: 0;
}

.upload-confirm-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 16px;
  min-height: 0;
  padding: 16px;
}

.upload-confirm-preview {
  position: relative;
  min-height: 360px;
  overflow: auto;
  background-color: #f8f8f8;
  background-image:
    linear-gradient(45deg, #dedede 25%, transparent 25%),
    linear-gradient(-45deg, #dedede 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #dedede 75%),
    linear-gradient(-45deg, transparent 75%, #dedede 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
}

.upload-confirm-preview canvas {
  display: block;
}

.upload-crop-box {
  position: absolute;
  border: 2px solid #14171d;
  cursor: move;
  box-shadow: 0 0 0 9999px rgba(255, 255, 255, 0.24);
}

.upload-crop-box span {
  position: absolute;
  left: 6px;
  bottom: 6px;
  border-radius: 4px;
  padding: 4px 6px;
  background: #20242a;
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
}

.upload-crop-handle {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 12px;
  height: 12px;
  border: 2px solid #14171d;
  background: #ffffff;
  cursor: nwse-resize;
}
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
bun run test tests/editor/uploadConfirmModal.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit or record**

If in a git repo:

```bash
git add src/editor/uploadConfirmModal.ts tests/editor/uploadConfirmModal.test.ts src/styles.css
git commit -m "feat: add upload crop modal interactions"
```

---

## Task 6: Build Upload Processing Workflow

**Files:**
- Create: `src/appUploadWorkflow.ts`
- Modify: `src/app.ts`
- Test: `tests/appUploadQueue.test.ts`

- [ ] **Step 1: Add upload queue regression tests**

Create `tests/appUploadQueue.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import {
  createFabricUpdateQueue,
  getUploadCommitTransform,
  isSameTattooTransform,
} from "../src/appUploadQueue";
import type { TattooTransform } from "../src/domain/types";

const transform: TattooTransform = {
  x: 10,
  y: 20,
  scale: 0.4,
  rotation: 0.1,
  opacity: 0.8,
};

describe("upload transform commit helpers", () => {
  test("upload resets scale only when transform revision did not change", () => {
    expect(getUploadCommitTransform({
      tattooTransform: transform,
      transformRevision: 2,
    }, 2)).toEqual({ ...transform, scale: 1 });

    expect(getUploadCommitTransform({
      tattooTransform: { ...transform, scale: 0.7 },
      transformRevision: 3,
    }, 2)).toEqual({ ...transform, scale: 0.7 });
  });

  test("same transform comparison ignores tiny no-op deltas", () => {
    expect(isSameTattooTransform(transform, {
      ...transform,
      x: transform.x + 0.0000001,
    })).toBe(true);
  });
});

describe("createFabricUpdateQueue", () => {
  test("skips stale queued updates", async () => {
    let currentRequest = 1;
    const queue = createFabricUpdateQueue((requestId) => requestId === currentRequest);
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => true);

    const firstPromise = queue(1, first);
    currentRequest = 2;
    const secondPromise = queue(2, second);

    await expect(firstPromise).resolves.toBe(true);
    await expect(secondPromise).resolves.toBe(true);
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
bun run test tests/appUploadQueue.test.ts
```

Expected: pass against the current queue helpers. If it fails because the stale-queue expectation is too weak, adjust only after inspecting `appUploadQueue.ts`; do not weaken transform regression expectations.

- [ ] **Step 3: Implement app upload workflow module**

Create `src/appUploadWorkflow.ts`:

```ts
import { Texture } from "pixi.js";
import { openUploadConfirmModal, type ProcessedTattooOption } from "./editor/uploadConfirmModal";
import { type FabricTattooController } from "./editor/fabricController";
import { removeBackgroundToCanvas } from "./image/backgroundRemoval";
import { cleanupLineArtBackground } from "./image/lineArtCleanup";
import { createFabricUpdateQueue, getDefaultCommitTransform, getUploadCommitTransform, type RunCurrentFabricUpdate } from "./appUploadQueue";
import { defaultTattooDataUrl, defaultTattooSize } from "./defaultTattoo";
import { sphere } from "./sphereConfig";
import type { Size, TattooTransform } from "./domain/types";
import type { PixiTattooRenderer } from "./render/pixiRenderer";

export interface UploadWorkflowState {
  tattooTransform: TattooTransform;
  tattooSize: Size;
  tattooTexture: Texture;
  tattooDataUrl: string;
  transformRevision: number;
  removeWhiteUpload: boolean;
}

export interface UploadWorkflowElements {
  uploadInput: HTMLInputElement;
  removeWhiteInput: HTMLInputElement;
  statusLabel: HTMLElement;
}

export interface UploadWorkflowInput {
  state: UploadWorkflowState;
  elements: UploadWorkflowElements;
  fabric: FabricTattooController;
  pixi: PixiTattooRenderer;
  initialTransform: TattooTransform;
  renderTattoo(): void;
  syncPanelFromTransform(): void;
  createDefaultTattooCanvas(): Promise<HTMLCanvasElement>;
}

export function installUploadWorkflow(input: UploadWorkflowInput): void {
  let uploadedFile: File | null = null;
  let latestUploadRequestId = 0;
  const isCurrentRequest = (requestId: number): boolean => requestId === latestUploadRequestId;
  const runCurrentFabricUpdate = createFabricUpdateQueue(isCurrentRequest);
  const refresh = async (): Promise<void> => {
    const requestId = latestUploadRequestId + 1;
    latestUploadRequestId = requestId;

    if (!uploadedFile) {
      await updateDefaultTattoo(input, requestId, isCurrentRequest, runCurrentFabricUpdate);
      return;
    }

    await updateUploadedTattoo(uploadedFile, input, requestId, isCurrentRequest, runCurrentFabricUpdate);
  };

  input.elements.removeWhiteInput.addEventListener("change", () => {
    input.state.removeWhiteUpload = input.elements.removeWhiteInput.checked;
    void refresh();
  });

  input.elements.uploadInput.addEventListener("change", () => {
    uploadedFile = input.elements.uploadInput.files?.[0] ?? null;
    void refresh();
  });
}
```

Move the existing `updateUploadedTattoo` and `updateDefaultTattoo` logic from `src/app.ts` into this module, changing upload handling so it opens the modal before committing:

```ts
async function updateUploadedTattoo(
  uploadedFile: File,
  input: UploadWorkflowInput,
  requestId: number,
  isCurrentRequest: (requestId: number) => boolean,
  runCurrentFabricUpdate: RunCurrentFabricUpdate,
): Promise<void> {
  try {
    const startTransformRevision = input.state.transformRevision;
    input.elements.statusLabel.textContent = "processing upload...";
    const options = await createProcessedOptions(uploadedFile, input.state.removeWhiteUpload);

    if (!isCurrentRequest(requestId)) {
      return;
    }

    const confirmed = await openUploadConfirmModal({
      fileName: uploadedFile.name,
      initialMode: options.some((option) => option.mode === "ai" && !option.error) ? "ai" : "line-art",
      options,
    });

    if (!confirmed || !isCurrentRequest(requestId)) {
      input.elements.statusLabel.textContent = "upload cancelled";
      return;
    }

    const canvas = confirmed.canvas;
    const dataUrl = canvas.toDataURL("image/png");
    let committedTransform: TattooTransform | null = null;
    const didUpdateFabric = await runCurrentFabricUpdate(
      requestId,
      (shouldCommit) => input.fabric.setImage(
        dataUrl,
        getUploadCommitTransform(input.state, startTransformRevision),
        shouldCommit,
        () => {
          const nextTransform = getUploadCommitTransform(input.state, startTransformRevision);
          committedTransform = nextTransform;
          return nextTransform;
        },
      ),
    );

    if (!didUpdateFabric || !committedTransform) {
      return;
    }

    input.state.tattooTexture = Texture.from(canvas);
    input.state.tattooDataUrl = dataUrl;
    input.state.tattooSize = { width: canvas.width, height: canvas.height };
    input.state.tattooTransform = committedTransform;
    input.elements.statusLabel.textContent = `uploaded ${confirmed.mode}`;
    input.syncPanelFromTransform();
    input.renderTattoo();
  } catch (error) {
    if (!isCurrentRequest(requestId)) {
      return;
    }

    input.elements.statusLabel.textContent = `upload failed: ${getErrorMessage(error)}`;
  }
}
```

Add processing option creation:

```ts
async function createProcessedOptions(file: File, removeWhite: boolean): Promise<ProcessedTattooOption[]> {
  const originalCanvas = await fileToCanvas(file);
  const options: ProcessedTattooOption[] = [
    { mode: "original", label: "Original", canvas: originalCanvas },
  ];

  try {
    const aiCanvas = await removeBackgroundToCanvas(file);
    options.unshift({ mode: "ai", label: "AI Remove Background", canvas: aiCanvas });
  } catch (error) {
    options.unshift({
      mode: "ai",
      label: `AI Remove Background failed: ${getErrorMessage(error)}`,
      canvas: originalCanvas,
      error: getErrorMessage(error),
    });
  }

  if (removeWhite) {
    options.splice(1, 0, {
      mode: "line-art",
      label: "Line Art Cleanup",
      canvas: createLineArtCanvas(originalCanvas),
    });
  }

  return options;
}
```

Add these helpers to the same module:

```ts
async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const image = await fileToImage(file);
  const scale = Math.min(1, (sphere.r * 1.6) / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = requiredContext(canvas);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not read ${file.name}: unsupported file data.`));
        return;
      }

      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not decode ${file.name} as PNG, JPG, or WebP.`));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function createLineArtCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = requiredContext(canvas);
  context.drawImage(source, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  cleanupLineArtBackground(imageData);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function requiredContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }

  return context;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
```

`fileToCanvas` deliberately keeps the full scaled source bounds for the modal preview. Transparent cropping happens only through the crop rectangle when the user clicks `Add`.

- [ ] **Step 4: Modify `src/app.ts` to use workflow**

In `src/app.ts`:

- Remove imports of `imageFileToCanvas`, `createFabricUpdateQueue`, `getDefaultCommitTransform`, `getUploadCommitTransform`, and `RunCurrentFabricUpdate`.
- Import `installUploadWorkflow`.
- Replace `installUploadControls(state, elements, fabric, pixi);` with:

```ts
installUploadWorkflow({
  state,
  elements,
  fabric,
  pixi,
  initialTransform,
  renderTattoo: () => renderTattoo(state, pixi),
  syncPanelFromTransform: () => syncPanelFromTransform(state, elements),
  createDefaultTattooCanvas,
});
```

- Delete the old `installUploadControls`, `updateUploadedTattoo`, and `updateDefaultTattoo` functions from `app.ts`.

Keep `app.ts` at or under 500 lines.

- [ ] **Step 5: Run typecheck and tests**

Run:

```bash
bun run typecheck
bun run test
```

Expected: both pass.

- [ ] **Step 6: Commit or record**

If in a git repo:

```bash
git add src/app.ts src/appUploadWorkflow.ts tests/appUploadQueue.test.ts
git commit -m "feat: route uploads through confirmation workflow"
```

---

## Task 7: Rename Surface Grid Controls And Copy

**Files:**
- Modify: `src/appMarkup.ts`
- Modify: `src/styles.css`
- Test: existing typecheck/build

- [ ] **Step 1: Update markup copy**

In `src/appMarkup.ts`, change mesh section labels to:

```html
<div class="control-group surface-grid-group">
  <div>
    <span class="control-heading">Surface Grid</span>
    <p class="control-help">Tattoo projection is calculated per pixel. Grid density affects debug lines and surface boundary precision.</p>
  </div>
  <label>
    <span>Radial Lines</span>
    <input id="radialSegments" type="number" min="${meshResolutionLimits.radialSegments.min}" max="${meshResolutionLimits.radialSegments.max}" step="1" value="${meshResolution.radialSegments}" />
  </label>
  <label>
    <span>Angular Lines</span>
    <input id="angularSegments" type="number" min="${meshResolutionLimits.angularSegments.min}" max="${meshResolutionLimits.angularSegments.max}" step="1" value="${meshResolution.angularSegments}" />
  </label>
</div>
```

Keep element ids unchanged: `radialSegments` and `angularSegments`.

- [ ] **Step 2: Add compact helper styles**

In `src/styles.css`, add:

```css
.control-heading {
  display: block;
  color: #f7fbfa;
  font-size: 0.84rem;
  font-weight: 900;
  text-transform: uppercase;
}

.control-help {
  margin: 5px 0 0;
  color: #9ca9a7;
  font-size: 0.78rem;
  line-height: 1.35;
}

.surface-grid-group {
  gap: 10px;
}
```

- [ ] **Step 3: Verify no misleading mesh copy remains**

Run:

```bash
rg -n "Mesh quality|mesh quality|fitting|fit quality|Grid Density|Mesh" src tests
```

Expected: no misleading "mesh quality" or "fit quality" copy remains. `Mesh` may still appear in technical file names and debug labels.

- [ ] **Step 4: Run build checks**

Run:

```bash
bun run typecheck
bun run build
```

Expected: pass with only the existing Vite chunk-size warning.

- [ ] **Step 5: Commit or record**

If in a git repo:

```bash
git add src/appMarkup.ts src/styles.css
git commit -m "chore: clarify surface grid controls"
```

---

## Task 8: Harden Modal Visual States And Accessibility

**Files:**
- Modify: `src/editor/uploadConfirmModal.ts`
- Modify: `src/styles.css`
- Modify: `tests/editor/uploadConfirmModal.test.ts`

- [ ] **Step 1: Add failing keyboard/cancel tests**

Append to `tests/editor/uploadConfirmModal.test.ts`:

```ts
test("Escape cancels the modal", async () => {
  const promise = openUploadConfirmModal({
    fileName: "tattoo.png",
    initialMode: "ai",
    options: [createOption("ai", createCanvasStub(12, 10))],
    cropCanvas: vi.fn(),
  });

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  await expect(promise).resolves.toBeNull();
});

test("disabled failed mode cannot be selected for Add", async () => {
  const source = createCanvasStub(20, 18);
  const cropCanvas = vi.fn(() => source);
  const promise = openUploadConfirmModal({
    fileName: "tattoo.png",
    initialMode: "original",
    options: [
      { mode: "ai", label: "AI Remove Background failed", canvas: source, error: "failed" },
      createOption("original", source),
    ],
    cropCanvas,
  });

  const failedInput = document.querySelector("input[value='ai']") as HTMLInputElement;
  expect(failedInput.disabled).toBe(true);
  getButton("Add").click();

  await expect(promise).resolves.toEqual({ canvas: source, mode: "original" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/editor/uploadConfirmModal.test.ts
```

Expected: fail until Escape and disabled failed-mode behavior are implemented.

- [ ] **Step 3: Implement keyboard and failed-mode behavior**

In `createModalMarkup`, render failed mode inputs as disabled:

```ts
<input
  type="radio"
  name="upload-processing-mode"
  value="${option.mode}"
  ${option.mode === input.initialMode ? "checked" : ""}
  ${option.error ? "disabled" : ""}
>
```

Add Escape handling inside `openUploadConfirmModal`:

```ts
const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    close(null);
  }
};
window.addEventListener("keydown", onKeyDown);
```

Ensure `close` removes the listener:

```ts
const close = (result: UploadConfirmResult | null): void => {
  window.removeEventListener("keydown", onKeyDown);
  overlay.remove();
  resolve(result);
};
```

Guard against double-close:

```ts
let settled = false;
const close = (result: UploadConfirmResult | null): void => {
  if (settled) {
    return;
  }
  settled = true;
  window.removeEventListener("keydown", onKeyDown);
  overlay.remove();
  resolve(result);
};
```

- [ ] **Step 4: Run modal tests**

Run:

```bash
bun run test tests/editor/uploadConfirmModal.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit or record**

If in a git repo:

```bash
git add src/editor/uploadConfirmModal.ts tests/editor/uploadConfirmModal.test.ts src/styles.css
git commit -m "feat: harden upload confirmation modal states"
```

---

## Task 9: Full Verification And Acceptance Sweep

**Files:**
- No new files expected.

- [ ] **Step 1: Run full tests**

Run:

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: pass.

- [ ] **Step 3: Run production build**

Run:

```bash
bun run build
```

Expected: pass. The existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Search old architecture and misleading copy**

Run:

```bash
rg -n "buildWarpedMesh|buildWarpedGrid|sphereWarpPoint|minEdgeAlpha|minEdgeCompress|meshGrid" src tests
rg -n "Mesh quality|mesh quality|fit quality|fitting quality" src tests
```

Expected:

- First command has no matches.
- Second command has no matches.

- [ ] **Step 5: Manual browser smoke test**

Start or reuse the Vite dev server:

```bash
bun run dev -- --port 5173
```

Manual checks:

- Upload the skull/rose reference image.
- Modal opens before the tattoo changes on the sphere.
- AI mode shows a transparent checkerboard preview without a black square.
- Crop box starts at full processed image bounds.
- Crop box can be dragged and resized as a free rectangle.
- `Cancel` leaves the current tattoo unchanged.
- `Add` commits only the cropped transparent result.
- `Surface Grid` controls still change debug wireframe density.
- Changing grid density does not materially change tattoo fitting quality.
- Wheel zoom, middle drag pan, Space+left pan, and Fabric normal left drag still work.

- [ ] **Step 6: Final code review**

Use `superpowers:requesting-code-review` or the subagent-driven review gate. Review focus:

- AI dependency integration and license note are intentional.
- Modal does not leak event listeners.
- App state commits only on `Add`.
- Stale async work cannot overwrite newer upload, Fabric, Pixi, transform, or status state.
- `app.ts` remains at or under 500 lines and functions remain focused.
