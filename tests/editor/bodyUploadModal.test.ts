// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { defaultBodyMeshPipelineParams } from "../../src/domain/skinMeshPipeline";
import { openBodyUploadModal } from "../../src/editor/bodyUploadModal";

function createPreview() {
  return {
    mask: {
      width: 2,
      height: 2,
      probabilities: new Float32Array([1, 0, 0, 1]),
    },
    mesh: {
      positions: new Float32Array([0, 0, 2, 0, 2, 2]),
      indices: new Uint32Array([0, 1, 2]),
    },
  };
}

describe("openBodyUploadModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("Cancel resolves null and removes the modal", async () => {
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 6;

    const promise = openBodyUploadModal({
      fileName: "body.png",
      sourceCanvas: source,
      buildPreview: vi.fn(async () => createPreview()),
    });

    await waitFor(() => {
      expect(getButton("Cancel")).toBeDefined();
    });
    getButton("Cancel").click();

    await expect(promise).resolves.toBeNull();
    expect(document.querySelector(".body-upload-overlay")).toBeNull();
  });

  test("Rebuild Mesh uses current form params", async () => {
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 6;
    let latestParams: { threshold: number } | undefined;
    const buildPreview = vi.fn(async (_canvas: HTMLCanvasElement, params: { threshold: number }) => {
      latestParams = params;
      return createPreview();
    });

    const promise = openBodyUploadModal({
      fileName: "body.png",
      sourceCanvas: source,
      buildPreview,
    });

    await waitFor(() => expect(buildPreview).toHaveBeenCalledTimes(1));
    const thresholdInput = getNumberInput("threshold");
    thresholdInput.value = "0.66";
    getButton("Rebuild Mesh").click();

    await waitFor(() => expect(buildPreview).toHaveBeenCalledTimes(2));
    if (!latestParams) {
      throw new Error("Missing rebuild params.");
    }
    expect(latestParams.threshold).toBe(0.66);

    getButton("Cancel").click();
    await promise;
  });

  test("Reset Params restores recommended defaults", async () => {
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 6;
    const buildPreview = vi.fn(async () => createPreview());

    const promise = openBodyUploadModal({
      fileName: "body.png",
      sourceCanvas: source,
      buildPreview,
    });

    await waitFor(() => expect(buildPreview).toHaveBeenCalledTimes(1));
    const thresholdInput = getNumberInput("threshold");
    thresholdInput.value = "0.2";
    getButton("Reset Params").click();

    await waitFor(() => expect(buildPreview).toHaveBeenCalledTimes(2));
    expect(getNumberInput("threshold").value).toBe(String(defaultBodyMeshPipelineParams.threshold));
    expect(getRangeInput("threshold").value).toBe(String(defaultBodyMeshPipelineParams.threshold));

    getButton("Cancel").click();
    await promise;
  });

  test("slider input triggers one debounced rebuild with latest params", async () => {
    vi.useFakeTimers();
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 6;
    let latestThreshold = 0;
    const buildPreview = vi.fn(async (_canvas: HTMLCanvasElement, params: { threshold: number }) => {
      latestThreshold = params.threshold;
      return createPreview();
    });

    const promise = openBodyUploadModal({
      fileName: "body.png",
      sourceCanvas: source,
      buildPreview,
    });

    await waitFor(() => expect(buildPreview).toHaveBeenCalledTimes(1));

    const rangeInput = getRangeInput("threshold");
    rangeInput.value = "0.2";
    rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    rangeInput.value = "0.74";
    rangeInput.dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(119);
    expect(buildPreview).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await waitFor(() => expect(buildPreview).toHaveBeenCalledTimes(2));
    expect(latestThreshold).toBe(0.74);

    getButton("Cancel").click();
    await promise;
  });

  test("slider and number inputs stay synchronized", async () => {
    vi.useFakeTimers();
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 6;

    const promise = openBodyUploadModal({
      fileName: "body.png",
      sourceCanvas: source,
      buildPreview: vi.fn(async () => createPreview()),
    });

    await waitFor(() => {
      expect(getRangeInput("threshold")).toBeDefined();
    });

    const rangeInput = getRangeInput("threshold");
    const numberInput = getNumberInput("threshold");

    rangeInput.value = "0.61";
    rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(numberInput.value).toBe("0.61");

    numberInput.value = "0.42";
    numberInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(rangeInput.value).toBe("0.42");

    vi.runAllTimers();
    await Promise.resolve();

    getButton("Cancel").click();
    await promise;
  });

  test("switching preview mode only updates view without rebuilding mesh", async () => {
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 6;
    const buildPreview = vi.fn(async () => createPreview());

    const promise = openBodyUploadModal({
      fileName: "body.png",
      sourceCanvas: source,
      buildPreview,
    });

    await waitFor(() => expect(buildPreview).toHaveBeenCalledTimes(1));

    getButton("Skin Mask").click();
    getButton("Mesh Overlay").click();
    getButton("Original").click();

    expect(buildPreview).toHaveBeenCalledTimes(1);
    getButton("Cancel").click();
    await promise;
  });

  test("Apply Body resolves latest preview and params", async () => {
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 6;

    const promise = openBodyUploadModal({
      fileName: "body.png",
      sourceCanvas: source,
      buildPreview: vi.fn(async () => createPreview()),
    });

    await waitFor(() => {
      expect(getButton("Apply Body")).toBeDefined();
    });
    getButton("Apply Body").click();

    await expect(promise).resolves.toMatchObject({
      sourceCanvas: source,
      params: defaultBodyMeshPipelineParams,
    });
  });

  test("renders bilingual labels in English（中文） format", async () => {
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 6;

    const promise = openBodyUploadModal({
      fileName: "body.png",
      sourceCanvas: source,
      buildPreview: vi.fn(async () => createPreview()),
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Threshold（阈值）");
      expect(document.body.textContent).toContain("Enable CDT Constraints（启用 CDT 约束边）");
    });

    getButton("Cancel").click();
    await promise;
  });

  test("shows rebuild warning from preview result when mesh falls back", async () => {
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 6;

    const promise = openBodyUploadModal({
      fileName: "body.png",
      sourceCanvas: source,
      buildPreview: vi.fn(async () => ({
        ...createPreview(),
        warning: "mesh rebuild failed: triangulation produced no valid triangles",
      })),
    });

    await waitFor(() => {
      const status = document.querySelector<HTMLElement>("[data-body-modal-status]");
      expect(status?.textContent).toBe("mesh rebuild failed: triangulation produced no valid triangles");
    });

    getButton("Cancel").click();
    await promise;
  });

  test("large body images render into a bounded contain preview canvas", async () => {
    const source = document.createElement("canvas");
    source.width = 4000;
    source.height = 6000;

    const promise = openBodyUploadModal({
      fileName: "huge-body.png",
      sourceCanvas: source,
      buildPreview: vi.fn(async () => ({
        mask: {
          width: source.width,
          height: source.height,
          probabilities: new Float32Array(source.width * source.height).fill(1),
        },
        mesh: {
          positions: new Float32Array([0, 0, source.width, 0, source.width, source.height]),
          indices: new Uint32Array([0, 1, 2]),
        },
      })),
    });

    await waitFor(() => {
      expect(document.querySelector("[data-body-preview-canvas]")).toBeInstanceOf(HTMLCanvasElement);
    });

    const canvas = document.querySelector<HTMLCanvasElement>("[data-body-preview-canvas]");
    if (!canvas) {
      throw new Error("Missing preview canvas.");
    }

    expect(canvas.width).toBeLessThan(source.width);
    expect(canvas.height).toBeLessThan(source.height);
    expect(canvas.width).toBeLessThanOrEqual(720);
    expect(canvas.height).toBeLessThanOrEqual(560);

    getButton("Cancel").click();
    await promise;
  });
});

function getButton(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === text);

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${text}`);
  }

  return button;
}

function getNumberInput(paramKey: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`[data-body-param-number='${paramKey}']`);

  if (!input) {
    throw new Error(`Missing number input: ${paramKey}`);
  }

  return input;
}

function getRangeInput(paramKey: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`[data-body-param-range='${paramKey}']`);

  if (!input) {
    throw new Error(`Missing range input: ${paramKey}`);
  }

  return input;
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    try {
      assertion();
      return;
    } catch {
      await Promise.resolve();
    }
  }

  assertion();
}
