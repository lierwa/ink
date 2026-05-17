// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openUploadConfirmModal, type ProcessedTattooOption } from "../../src/editor/uploadConfirmModal";

describe("openUploadConfirmModal", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalGetContext,
    });
    vi.restoreAllMocks();
  });

  test("Cancel resolves null and removes the modal", async () => {
    const option = createOption("line-art", createCanvasStub(12, 10));
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
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
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });

    getButton("Add").click();

    await expect(promise).resolves.toEqual({
      canvas: cropped,
      mode: "line-art",
    });
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 20, height: 18 });
    expect(document.querySelector("[data-upload-confirm-modal]")).toBeNull();
  });

  test("does not render processing mode choices", async () => {
    const source = createCanvasStub(20, 18);
    const cropCanvas = vi.fn((source: HTMLCanvasElement) => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });

    expect(document.querySelector("input[name='upload-processing-mode']")).toBeNull();
    getButton("Add").click();

    await expect(promise).resolves.toEqual({
      canvas: source,
      mode: "line-art",
    });
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 20, height: 18 });
  });

  test("Add rejects and removes the modal when crop export fails", async () => {
    const cropError = new Error("crop failed");
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", createCanvasStub(20, 18))],
      cropCanvas: vi.fn(() => {
        throw cropError;
      }),
    });

    getButton("Add").click();

    await expect(promise).rejects.toThrow("crop failed");
    expect(document.querySelector("[data-upload-confirm-modal]")).toBeNull();
  });

  test("updates crop rectangle when crop box is dragged", async () => {
    const source = createCanvasStub(100, 80);
    const cropCanvas = vi.fn(() => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });
    const cropBox = getRequiredElement<HTMLElement>("[data-crop-box]");
    const handle = getRequiredElement<HTMLElement>("[data-crop-resize='se']");

    dragPointer(handle, 100, 80, 70, 60, 3);
    dragPointer(cropBox, 10, 10, 18, 22, 1);
    getButton("Add").click();

    await promise;
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 8, y: 12, width: 70, height: 60 });
  });

  test("dragging a smaller crop near bounds preserves size and clamps x and y", async () => {
    const source = createCanvasStub(100, 80);
    const cropCanvas = vi.fn(() => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });
    const cropBox = getRequiredElement<HTMLElement>("[data-crop-box]");
    const handle = getRequiredElement<HTMLElement>("[data-crop-resize='se']");

    dragPointer(handle, 100, 80, 30, 20, 4);
    dragPointer(cropBox, 0, 0, 200, 200, 5);
    getButton("Add").click();

    await promise;
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 70, y: 60, width: 30, height: 20 });
  });

  test("resizing from x greater than zero clamps size without moving top-left", async () => {
    const source = createCanvasStub(100, 80);
    const cropCanvas = vi.fn(() => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });
    const cropBox = getRequiredElement<HTMLElement>("[data-crop-box]");
    const handle = getRequiredElement<HTMLElement>("[data-crop-resize='se']");

    dragPointer(handle, 100, 80, 40, 40, 6);
    dragPointer(cropBox, 0, 0, 25, 10, 7);
    dragPointer(handle, 65, 50, 200, 200, 8);
    getButton("Add").click();

    await promise;
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 25, y: 10, width: 75, height: 70 });
  });

  test("clamps resize to at least one source pixel", async () => {
    const source = createCanvasStub(100, 80);
    const cropCanvas = vi.fn(() => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });
    const handle = getRequiredElement<HTMLElement>("[data-crop-resize='se']");

    dragPointer(handle, 100, 80, -50, -50, 9);
    getButton("Add").click();

    await promise;
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 1, height: 1 });
  });

  test("resizes crop rectangle as a free rectangle", async () => {
    const source = createCanvasStub(100, 80);
    const cropCanvas = vi.fn(() => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });
    const handle = getRequiredElement<HTMLElement>("[data-crop-resize='se']");

    dragPointer(handle, 100, 80, 82, 68, 2);
    getButton("Add").click();

    await promise;
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 82, height: 68 });
  });

  test("updates overlay position, size, and live size label in display pixels", () => {
    openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", createCanvasStub(100, 80))],
      cropCanvas: vi.fn(),
    });
    getButton("50%").click();
    const cropBox = getRequiredElement<HTMLElement>("[data-crop-box]");
    const handle = getRequiredElement<HTMLElement>("[data-crop-resize='se']");

    dragPointer(handle, 50, 40, 41, 34, 10);
    dragPointer(cropBox, 0, 0, 4, 6, 11);

    expect(cropBox.style.left).toBe("4px");
    expect(cropBox.style.top).toBe("6px");
    expect(cropBox.style.width).toBe("41px");
    expect(cropBox.style.height).toBe("34px");
    expect(getRequiredElement<HTMLElement>("[data-crop-size]").textContent).toBe("82 x 68");
  });

  test("scaled preview controls keep exported crop in source pixels", async () => {
    const source = createCanvasStub(100, 80);
    const cropCanvas = vi.fn(() => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });
    getButton("50%").click();
    const handle = getRequiredElement<HTMLElement>("[data-crop-resize='se']");

    dragPointer(handle, 50, 40, 41, 34, 12);
    getButton("Add").click();

    await promise;
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 82, height: 68 });
  });

  test("pointercancel ends active drag so later pointer moves are ignored", async () => {
    const source = createCanvasStub(100, 80);
    const cropCanvas = vi.fn(() => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });
    const handle = getRequiredElement<HTMLElement>("[data-crop-resize='se']");

    handle.dispatchEvent(createPointerEvent("pointerdown", {
      clientX: 100,
      clientY: 80,
      pointerId: 13,
      bubbles: true,
    }));
    window.dispatchEvent(createPointerEvent("pointercancel", { pointerId: 13 }));
    window.dispatchEvent(createPointerEvent("pointermove", {
      clientX: 20,
      clientY: 20,
      pointerId: 13,
    }));
    getButton("Add").click();

    await promise;
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 100, height: 80 });
  });

  test("Escape cancels the modal", async () => {
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", createCanvasStub(12, 10))],
      cropCanvas: vi.fn(),
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    await expect(promise).resolves.toBeNull();
    expect(document.querySelector("[data-upload-confirm-modal]")).toBeNull();
  });

  test("falls back to the first available option without rendering mode controls", async () => {
    const source = createCanvasStub(20, 18);
    const cropCanvas = vi.fn(() => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [
        { mode: "line-art", label: "Line Art Cleanup failed", canvas: source, error: "failed" },
        createOption("original", source),
      ],
      cropCanvas,
    });

    expect(document.querySelector("input[name='upload-processing-mode']")).toBeNull();
    getButton("Add").click();

    await expect(promise).resolves.toEqual({ canvas: source, mode: "original" });
  });
});

function createOption(mode: ProcessedTattooOption["mode"], canvas: HTMLCanvasElement): ProcessedTattooOption {
  return { mode, label: mode, canvas };
}

function createCanvasStub(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === name);

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button ${name}`);
  }

  return button;
}

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);

  if (!element) {
    throw new Error(`Missing element ${selector}`);
  }

  return element as T;
}

function dragPointer(
  target: HTMLElement,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  pointerId: number,
): void {
  target.dispatchEvent(createPointerEvent("pointerdown", {
    clientX: startX,
    clientY: startY,
    pointerId,
    bubbles: true,
  }));
  window.dispatchEvent(createPointerEvent("pointermove", {
    clientX: endX,
    clientY: endY,
    pointerId,
  }));
  window.dispatchEvent(createPointerEvent("pointerup", {
    clientX: endX,
    clientY: endY,
    pointerId,
  }));
}

function createPointerEvent(type: string, init: PointerEventInit): PointerEvent {
  if (typeof PointerEvent === "function") {
    return new PointerEvent(type, init);
  }

  const event = new MouseEvent(type, init) as PointerEvent;

  Object.defineProperty(event, "pointerId", {
    configurable: true,
    value: init.pointerId ?? 0,
  });
  return event;
}
