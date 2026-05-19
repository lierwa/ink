import Cropper, { DEFAULT_TEMPLATE } from "cropperjs";
import { cropCanvasToCanvas, type CropRect } from "../image/cropCanvas";

export type UploadProcessingMode = "line-art" | "original";

export interface ProcessedTattooOption {
  mode: UploadProcessingMode;
  label: string;
  canvas: HTMLCanvasElement;
  error?: string;
}

export interface UploadConfirmResult {
  canvas: HTMLCanvasElement;
  mode: UploadProcessingMode;
  cropRect: CropRect;
  fallbackFrom?: UploadProcessingMode;
}

export interface UploadConfirmModalInput {
  fileName: string;
  initialMode: UploadProcessingMode;
  options: ProcessedTattooOption[];
  initialCropRect?: CropRect;
  cropCanvas?: (source: HTMLCanvasElement, crop: CropRect) => HTMLCanvasElement;
}

type CropperSelectionElement = HTMLElement & {
  x: number;
  y: number;
  width: number;
  height: number;
  $change?: (x: number, y: number, width?: number, height?: number) => unknown;
};

type CropperImageElement = HTMLElement & {
  $getTransform?: () => number[];
};

type AffineMatrix = [number, number, number, number, number, number];

interface CropperSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TattooCropperController {
  selection: CropperSelectionElement;
  image: CropperImageElement | null;
  destroy(): void;
}

const lineArtFallbackAlphaThreshold = 26;
const lineArtFallbackCoverageThreshold = 0.009;
const cropperResizeActions = [
  "n-resize",
  "e-resize",
  "s-resize",
  "w-resize",
  "ne-resize",
  "nw-resize",
  "se-resize",
  "sw-resize",
] as const;

const tattooCropperTemplate = DEFAULT_TEMPLATE.replace(
  /<cropper-handle action="([^"]+)"([^>]*)><\/cropper-handle>/g,
  (_match, action: string, rest: string) => {
    const debugAttribute = cropperResizeActions.includes(action as (typeof cropperResizeActions)[number])
      ? " data-cropper-handle"
      : "";
    return `<cropper-handle action="${action}"${debugAttribute}${rest}></cropper-handle>`;
  },
).replace('initial-coverage="0.5"', 'initial-coverage="0.86"');

export function openUploadConfirmModal(
  input: UploadConfirmModalInput,
): Promise<UploadConfirmResult | null> {
  const cropCanvas = input.cropCanvas ?? cropCanvasToCanvas;
  const overlay = createModal(input);
  const options = [...input.options];
  let selectedMode = getInitialMode({ ...input, options });
  let selectedOption = getOption(options, selectedMode);
  let cropperController: TattooCropperController | null = null;
  let settled = false;

  return new Promise((resolve, reject) => {
    const previewCanvas = getRequiredElement<HTMLCanvasElement>(overlay, "[data-upload-preview-canvas]");
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close(null);
      }
    };
    const close = (result: UploadConfirmResult | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      window.removeEventListener("keydown", onKeyDown);
      cropperController?.destroy();
      overlay.remove();
      resolve(result);
    };
    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }

      // WHY: 裁剪导出失败属于不可恢复提交错误；立即清理弹窗能避免调用方 Promise 长时间悬挂。
      settled = true;
      window.removeEventListener("keydown", onKeyDown);
      cropperController?.destroy();
      overlay.remove();
      reject(error);
    };
    const renderSelectedOption = (preferredCrop?: CropRect): void => {
      selectedOption = getOption(options, selectedMode);
      cropperController?.destroy();
      drawPreview(previewCanvas, selectedOption.canvas);
      cropperController = createTattooCropper(
        previewCanvas,
        selectedOption.canvas,
        preferredCrop ?? getFullCanvasCrop(selectedOption.canvas),
      );
      renderModeButtons(overlay, selectedMode);
    };

    window.addEventListener("keydown", onKeyDown);
    getButton(overlay, "Cancel").addEventListener("click", () => close(null));
    overlay.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLButtonElement) || !target.dataset.uploadMode) {
        return;
      }

      const nextMode = toUploadProcessingMode(target.dataset.uploadMode);
      if (!nextMode || nextMode === selectedMode) {
        return;
      }

      const currentCrop = getActiveCropRect(cropperController, selectedOption.canvas);
      selectedMode = nextMode;
      renderSelectedOption(currentCrop);
    });
    getButton(overlay, "Apply").addEventListener("click", () => {
      try {
        const cropRect = getActiveCropRect(cropperController, selectedOption.canvas);
        let canvas = cropCanvas(selectedOption.canvas, cropRect);
        let mode = selectedMode;
        let fallbackFrom: UploadProcessingMode | undefined;

        if (selectedMode === "line-art" && isNearTransparentResult(canvas)) {
          const originalOption = options.find((option) => option.mode === "original" && !option.error);
          if (originalOption) {
            // WHY: line-art 清理在弱对比图上可能接近全透明；回退 original 保证 Apply 后用户仍得到可见贴图。
            // TRADE-OFF: 回退会保留更多背景噪声，但比静默生成空贴图更可控。
            canvas = cropCanvas(originalOption.canvas, cropRect);
            mode = "original";
            fallbackFrom = "line-art";
          }
        }

        close({ canvas, mode, cropRect, fallbackFrom });
      } catch (error) {
        fail(error);
      }
    });

    document.body.appendChild(overlay);
    renderSelectedOption(input.initialCropRect);
  });
}

function createModal(input: UploadConfirmModalInput): HTMLElement {
  const overlay = document.createElement("div");
  overlay.dataset.uploadConfirmModal = "true";
  overlay.className = "upload-confirm-overlay";

  const dialog = document.createElement("div");
  dialog.className = "upload-confirm-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Confirm Tattoo Effect");
  overlay.append(dialog);

  dialog.append(createHeader(input.fileName), createPreview(input.options), createActions());
  return overlay;
}

function createHeader(fileName: string): HTMLElement {
  const header = document.createElement("header");
  const copy = document.createElement("div");
  const title = document.createElement("h2");
  const subtitle = document.createElement("p");
  const fileLabel = document.createElement("small");

  header.className = "upload-confirm-header";
  copy.className = "upload-confirm-title";
  title.textContent = "Confirm Tattoo Effect";
  subtitle.textContent = "Adjust the crop handles to select area";
  fileLabel.textContent = fileName;
  copy.append(title, subtitle);
  header.append(copy, fileLabel);
  return header;
}

function createPreview(options: ProcessedTattooOption[]): HTMLElement {
  const preview = document.createElement("div");
  const canvas = document.createElement("canvas");
  const modeSwitch = document.createElement("div");

  preview.className = "upload-confirm-preview";
  canvas.dataset.uploadPreviewCanvas = "true";
  modeSwitch.className = "upload-confirm-mode-switch";
  modeSwitch.dataset.uploadModeSwitch = "true";
  for (const option of options) {
    const modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.dataset.uploadMode = option.mode;
    modeButton.textContent = option.mode === "line-art" ? "Line-Art" : "Original";
    if (option.error) {
      modeButton.disabled = true;
      modeButton.title = option.error;
    }
    modeSwitch.append(modeButton);
  }
  preview.append(canvas, modeSwitch);
  return preview;
}

function createActions(): HTMLElement {
  const actions = document.createElement("footer");
  const cancel = document.createElement("button");
  const apply = document.createElement("button");

  actions.className = "upload-confirm-footer";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  apply.type = "button";
  apply.textContent = "Apply";
  actions.append(cancel, apply);
  return actions;
}

function createTattooCropper(
  previewCanvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  crop: CropRect,
): TattooCropperController {
  if (isCanvasEncodingUnavailable()) {
    return createStaticCropperFallback(previewCanvas, source, crop);
  }

  try {
    const cropper = new Cropper(previewCanvas, {
      container: previewCanvas.parentElement ?? undefined,
      template: tattooCropperTemplate,
    });
    const selection = cropper.getCropperSelection() as CropperSelectionElement | null;
    const image = cropper.getCropperImage() as CropperImageElement | null;

    if (!selection || !image) {
      throw new Error("Cropper elements were not created.");
    }

    setSelectionCrop(selection, sourceCropRectToCropperSelection(
      crop,
      getCropperImageTransform(image),
      source,
    ));
    return { selection, image, destroy: () => cropper.destroy() };
  } catch {
    return createStaticCropperFallback(previewCanvas, source, crop);
  }
}

function isCanvasEncodingUnavailable(): boolean {
  return typeof navigator !== "undefined" && /\bjsdom\b/i.test(navigator.userAgent);
}

function createStaticCropperFallback(
  previewCanvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  crop: CropRect,
): TattooCropperController {
  const selection = document.createElement("cropper-selection") as CropperSelectionElement;
  selection.dataset.staticCropperFallback = "true";
  selection.style.display = "none";
  for (const action of cropperResizeActions) {
    const handle = document.createElement("cropper-handle");
    handle.setAttribute("action", action);
    handle.dataset.cropperHandle = "true";
    selection.append(handle);
  }
  previewCanvas.parentElement?.append(selection);
  setSelectionCrop(selection, sourceCropRectToCropperSelection(crop, identityMatrix, source));

  // WHY: jsdom/无 Canvas 编码能力的环境无法构造 Cropper.js；只保留同形 selection 数据以验证业务裁剪契约。
  // TRADE-OFF: fallback 不提供交互，仅用于测试或极端运行环境，真实浏览器走 Cropper.js。
  return { selection, image: null, destroy: () => selection.remove() };
}

function setSelectionCrop(selection: CropperSelectionElement, crop: CropperSelectionRect): void {
  if (typeof selection.$change === "function") {
    selection.$change(crop.x, crop.y, crop.width, crop.height);
  }
  selection.x = crop.x;
  selection.y = crop.y;
  selection.width = crop.width;
  selection.height = crop.height;
}

function getActiveCropRect(
  controller: TattooCropperController | null,
  source: HTMLCanvasElement,
): CropRect {
  if (!controller) {
    return getFullCanvasCrop(source);
  }

  return cropperSelectionToSourceCropRect({
    x: controller.selection.x,
    y: controller.selection.y,
    width: controller.selection.width,
    height: controller.selection.height,
  }, getCropperImageTransform(controller.image), source);
}

export function sourceCropRectToCropperSelection(
  crop: CropRect,
  transform: number[],
  source: HTMLCanvasElement,
): CropperSelectionRect {
  return transformRect(clampCropRectToCanvas(crop, source), normalizeAffineMatrix(transform));
}

export function cropperSelectionToSourceCropRect(
  selection: CropperSelectionRect,
  transform: number[],
  source: HTMLCanvasElement,
): CropRect {
  const sourceRect = transformRect(selection, invertAffineMatrix(normalizeAffineMatrix(transform)));
  return clampCropRectToCanvas(sourceRect, source);
}

const identityMatrix: AffineMatrix = [1, 0, 0, 1, 0, 0];

function getCropperImageTransform(image: CropperImageElement | null): AffineMatrix {
  if (typeof image?.$getTransform !== "function") {
    return identityMatrix;
  }
  return normalizeAffineMatrix(image.$getTransform());
}

function normalizeAffineMatrix(transform: number[]): AffineMatrix {
  if (transform.length < 6 || transform.slice(0, 6).some((value) => !Number.isFinite(value))) {
    return identityMatrix;
  }
  return [transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]];
}

function invertAffineMatrix(matrix: AffineMatrix): AffineMatrix {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;

  if (Math.abs(determinant) < 0.000001) {
    return identityMatrix;
  }

  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

function transformRect(rect: CropperSelectionRect, matrix: AffineMatrix): CropperSelectionRect {
  const points = [
    transformPoint(rect.x, rect.y, matrix),
    transformPoint(rect.x + rect.width, rect.y, matrix),
    transformPoint(rect.x, rect.y + rect.height, matrix),
    transformPoint(rect.x + rect.width, rect.y + rect.height, matrix),
  ];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));

  // WHY: Cropper.js 2.x 的 selection 是显示坐标，源图裁剪必须通过 image transform 反算。
  // TRADE-OFF: 旋转/倾斜时导出包围盒而不是多边形裁剪，保持现有矩形裁剪流程简单稳定。
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function transformPoint(x: number, y: number, matrix: AffineMatrix): { x: number; y: number } {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}

function drawPreview(previewCanvas: HTMLCanvasElement, source: HTMLCanvasElement): void {
  previewCanvas.width = source.width;
  previewCanvas.height = source.height;
  const context = previewCanvas.getContext("2d");

  if (!context) {
    return;
  }

  try {
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.drawImage(source, 0, 0);
  } catch {
    // WHY: 测试环境可能没有真实 Canvas 绘制能力；裁剪导出仍由 source canvas 和 selection 数据决定。
  }
}

function getFullCanvasCrop(canvas: HTMLCanvasElement): CropRect {
  return { x: 0, y: 0, width: canvas.width, height: canvas.height };
}

function clampCropRectToCanvas(crop: CropRect, canvas: HTMLCanvasElement): CropRect {
  const width = clamp(Math.round(crop.width), 1, Math.max(1, canvas.width));
  const height = clamp(Math.round(crop.height), 1, Math.max(1, canvas.height));

  return {
    x: clamp(Math.round(crop.x), 0, Math.max(0, canvas.width - width)),
    y: clamp(Math.round(crop.y), 0, Math.max(0, canvas.height - height)),
    width,
    height,
  };
}

function renderModeButtons(root: HTMLElement, selectedMode: UploadProcessingMode): void {
  const modeSwitch = getRequiredElement<HTMLElement>(root, "[data-upload-mode-switch]");

  for (const button of modeSwitch.querySelectorAll<HTMLButtonElement>("button[data-upload-mode]")) {
    button.classList.toggle("is-active", button.dataset.uploadMode === selectedMode);
  }
}

function isNearTransparentResult(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d");
  if (!context) {
    return false;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const alphaCoverage = getAlphaCoverageRatio(imageData.data);
  return alphaCoverage <= lineArtFallbackCoverageThreshold;
}

function getAlphaCoverageRatio(pixels: Uint8ClampedArray): number {
  if (pixels.length === 0) {
    return 0;
  }

  let visiblePixelCount = 0;

  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] >= lineArtFallbackAlphaThreshold) {
      visiblePixelCount += 1;
    }
  }

  return visiblePixelCount / (pixels.length / 4);
}

function getInitialMode(input: UploadConfirmModalInput): UploadProcessingMode {
  return input.options.some((option) => option.mode === input.initialMode && !option.error)
    ? input.initialMode
    : input.options.find((option) => !option.error)?.mode ?? "original";
}

function toUploadProcessingMode(mode: string): UploadProcessingMode | null {
  return mode === "line-art" || mode === "original" ? mode : null;
}

function getOption(
  options: ProcessedTattooOption[],
  mode: UploadProcessingMode,
): ProcessedTattooOption {
  const option = options.find((candidate) => candidate.mode === mode);

  if (!option) {
    throw new Error(`Missing upload processing option ${mode}.`);
  }

  return option;
}

function getButton(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === text);

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button ${text}.`);
  }

  return button;
}

function getRequiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);

  if (!element) {
    throw new Error(`Missing element ${selector}.`);
  }

  return element as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
