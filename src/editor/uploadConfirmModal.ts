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
  fallbackFrom?: UploadProcessingMode;
}

export interface UploadConfirmModalInput {
  fileName: string;
  initialMode: UploadProcessingMode;
  options: ProcessedTattooOption[];
  cropCanvas?: (source: HTMLCanvasElement, crop: CropRect) => HTMLCanvasElement;
}

type CropPointerMode = "move" | "resize-se";

interface CropDragState {
  pointerId: number;
  startX: number;
  startY: number;
  cropStart: CropRect;
  sourcePixelsPerClientX: number;
  sourcePixelsPerClientY: number;
  mode: CropPointerMode;
}

type RemoveListeners = () => void;

const lineArtFallbackAlphaThreshold = 26;
const lineArtFallbackCoverageThreshold = 0.009;

export function openUploadConfirmModal(
  input: UploadConfirmModalInput,
): Promise<UploadConfirmResult | null> {
  const cropCanvas = input.cropCanvas ?? cropCanvasToCanvas;
  const overlay = createModal(input);
  const options = [...input.options];
  let selectedMode = getInitialMode({ ...input, options });
  let selectedOption = getOption(options, selectedMode);
  let cropRect = getFullCanvasCrop(selectedOption.canvas);
  let previewScale = 1;
  let settled = false;

  return new Promise((resolve, reject) => {
    const previewCanvas = getRequiredElement<HTMLCanvasElement>(overlay, "[data-upload-preview-canvas]");
    const removeCropDrag = installCropDrag(
      overlay,
      previewCanvas,
      () => selectedOption.canvas,
      () => cropRect,
      () => previewScale,
      (nextCrop) => {
        cropRect = nextCrop;
        renderCropOverlay(overlay, cropRect, selectedOption.canvas, previewScale);
      },
    );
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
      removeCropDrag();
      overlay.remove();
      resolve(result);
    };
    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }

      // WHY: Task 4 暂不做可恢复错误 UI；裁剪导出失败时清理模态框并拒绝 Promise，避免调用方永久等待。
      settled = true;
      window.removeEventListener("keydown", onKeyDown);
      removeCropDrag();
      overlay.remove();
      reject(error);
    };
    const renderSelectedOption = (): void => {
      selectedOption = getOption(options, selectedMode);
      cropRect = clampCropRectToCanvas(cropRect, selectedOption.canvas);
      drawPreview(previewCanvas, selectedOption.canvas);
      previewScale = getFittedPreviewScale(selectedOption.canvas, previewScale);
      renderPreviewScale(previewCanvas, selectedOption.canvas, previewScale);
      renderCropOverlay(overlay, cropRect, selectedOption.canvas, previewScale);
      renderModeButtons(overlay, selectedMode);
    };

    overlay.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLButtonElement) || !target.dataset.previewScale) {
        return;
      }

      previewScale = getFittedPreviewScale(selectedOption.canvas, Number(target.dataset.previewScale));
      renderPreviewScale(previewCanvas, selectedOption.canvas, previewScale);
      renderCropOverlay(overlay, cropRect, selectedOption.canvas, previewScale);
    });
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

      selectedMode = nextMode;
      renderSelectedOption();
    });
    getButton(overlay, "Apply").addEventListener("click", () => {
      try {
        let canvas = cropCanvas(selectedOption.canvas, cropRect);
        let mode = selectedMode;
        let fallbackFrom: UploadProcessingMode | undefined;

        if (selectedMode === "line-art" && isNearTransparentResult(canvas)) {
          const originalOption = options.find((option) => option.mode === "original" && !option.error);
          if (originalOption) {
            // WHY: line-art 在少数输入上会“清理过度”接近全透明；自动回退 original 以保证 Apply 后始终可见。
            // TRADE-OFF: 极端情况下保留了更多底噪，但避免用户得到“贴图丢失”的错误感知。
            canvas = cropCanvas(originalOption.canvas, cropRect);
            mode = "original";
            fallbackFrom = "line-art";
          }
        }

        close({ canvas, mode, fallbackFrom });
      } catch (error) {
        fail(error);
      }
    });

    document.body.appendChild(overlay);
    renderSelectedOption();
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

  dialog.append(createHeader(input.fileName), createPreview(input.options), createProcessingControls(), createActions());
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
  subtitle.textContent = "Drag crop box to select area";
  fileLabel.textContent = fileName;
  copy.append(title, subtitle);
  header.append(copy, fileLabel);
  return header;
}

function createPreview(options: ProcessedTattooOption[]): HTMLElement {
  const preview = document.createElement("div");
  const canvas = document.createElement("canvas");
  const modeSwitch = document.createElement("div");
  const cropBox = document.createElement("div");
  const cropSize = document.createElement("span");
  const handle = document.createElement("button");

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
  cropBox.className = "upload-crop-box";
  cropBox.dataset.cropBox = "true";
  cropBox.dataset.uploadCropBox = "true";
  cropSize.dataset.cropSize = "true";
  cropSize.dataset.uploadCropSize = "true";
  handle.className = "upload-crop-handle";
  handle.type = "button";
  handle.dataset.cropResize = "se";
  handle.setAttribute("aria-label", "Resize crop");
  cropBox.append(cropSize, handle);
  preview.append(canvas, modeSwitch, cropBox);
  return preview;
}

function createProcessingControls(): HTMLElement {
  const controls = document.createElement("section");
  const scales = document.createElement("div");

  controls.className = "upload-confirm-controls";
  scales.className = "upload-confirm-scales";
  [
    { label: "100%", scale: 1 },
    { label: "75%", scale: 0.75 },
    { label: "50%", scale: 0.5 },
  ].forEach(({ label, scale }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.previewScale = String(scale);
    scales.append(button);
  });
  controls.append(scales);
  return controls;
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

function drawPreview(previewCanvas: HTMLCanvasElement, source: HTMLCanvasElement): void {
  previewCanvas.width = source.width;
  previewCanvas.height = source.height;
  const context = previewCanvas.getContext("2d");

  if (!context) {
    return;
  }

  // WHY: 预览绘制失败不应阻塞 Apply 的纯结果契约；取舍是测试/无 Canvas 环境下只验证 DOM 与裁剪结果。
  try {
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.drawImage(source, 0, 0);
  } catch {
    return;
  }
}

function renderPreviewScale(
  previewCanvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  previewScale: number,
): void {
  const width = source.width * previewScale;
  const height = source.height * previewScale;
  previewCanvas.style.width = `${width}px`;
  previewCanvas.style.height = `${height}px`;

  if (previewCanvas.parentElement) {
    previewCanvas.parentElement.style.width = `${width}px`;
    previewCanvas.parentElement.style.height = `${height}px`;
  }
}

function installCropDrag(
  root: HTMLElement,
  previewCanvas: HTMLCanvasElement,
  getSource: () => HTMLCanvasElement,
  getCrop: () => CropRect,
  getPreviewScale: () => number,
  setCrop: (crop: CropRect) => void,
): RemoveListeners {
  const cropBox = getRequiredElement<HTMLElement>(root, "[data-crop-box]");
  const resizeHandle = getRequiredElement<HTMLElement>(root, "[data-crop-resize='se']");
  let drag: CropDragState | null = null;
  let capturedPointerId: number | null = null;

  const startDrag = (event: PointerEvent, mode: CropPointerMode): void => {
    event.preventDefault();
    event.stopPropagation();
    const sourcePixelsPerClientPixel = getSourcePixelsPerClientPixel(
      previewCanvas,
      getSource(),
      getPreviewScale(),
    );
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cropStart: getCrop(),
      sourcePixelsPerClientX: sourcePixelsPerClientPixel.x,
      sourcePixelsPerClientY: sourcePixelsPerClientPixel.y,
      mode,
    };

    if (typeof cropBox.setPointerCapture === "function") {
      cropBox.setPointerCapture(event.pointerId);
      capturedPointerId = event.pointerId;
    }
  };
  const onMove = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = (event.clientX - drag.startX) * drag.sourcePixelsPerClientX;
    const deltaY = (event.clientY - drag.startY) * drag.sourcePixelsPerClientY;
    const source = getSource();
    const nextCrop = drag.mode === "move"
      ? moveCrop(drag.cropStart, deltaX, deltaY, source)
      : resizeCrop(drag.cropStart, deltaX, deltaY, source);
    setCrop(nextCrop);
  };
  const finishDrag = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    drag = null;
    releaseCapture(cropBox, event.pointerId);
    capturedPointerId = null;
  };
  const onMoveStart = (event: PointerEvent): void => startDrag(event, "move");
  const onResizeStart = (event: PointerEvent): void => startDrag(event, "resize-se");

  cropBox.addEventListener("pointerdown", onMoveStart);
  resizeHandle.addEventListener("pointerdown", onResizeStart);
  cropBox.addEventListener("lostpointercapture", finishDrag);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);

  return () => {
    if (capturedPointerId !== null) {
      releaseCapture(cropBox, capturedPointerId);
      capturedPointerId = null;
    }

    drag = null;
    cropBox.removeEventListener("pointerdown", onMoveStart);
    resizeHandle.removeEventListener("pointerdown", onResizeStart);
    cropBox.removeEventListener("lostpointercapture", finishDrag);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
  };
}

function moveCrop(crop: CropRect, deltaX: number, deltaY: number, source: HTMLCanvasElement): CropRect {
  const sourceWidth = Math.max(1, source.width);
  const sourceHeight = Math.max(1, source.height);
  const width = clamp(Math.round(crop.width), 1, sourceWidth);
  const height = clamp(Math.round(crop.height), 1, sourceHeight);

  // WHY: 移动裁剪框只表达位置变化；在边界处保持已选面积尺寸，避免拖动时意外改变用户已经确认的裁剪大小。
  return {
    x: clamp(Math.round(crop.x + deltaX), 0, sourceWidth - width),
    y: clamp(Math.round(crop.y + deltaY), 0, sourceHeight - height),
    width,
    height,
  };
}

function resizeCrop(crop: CropRect, deltaX: number, deltaY: number, source: HTMLCanvasElement): CropRect {
  const x = clamp(Math.round(crop.x), 0, Math.max(0, source.width - 1));
  const y = clamp(Math.round(crop.y), 0, Math.max(0, source.height - 1));

  // WHY: 东南角缩放只表达右/下边界变化；保留左上角能让用户从任意位置精确扩展到源图边缘。
  return {
    x,
    y,
    width: clamp(Math.round(crop.width + deltaX), 1, Math.max(1, source.width - x)),
    height: clamp(Math.round(crop.height + deltaY), 1, Math.max(1, source.height - y)),
  };
}

function renderCropOverlay(
  root: HTMLElement,
  crop: CropRect,
  source: HTMLCanvasElement,
  previewScale: number,
): void {
  const cropBox = getRequiredElement<HTMLElement>(root, "[data-crop-box]");
  const sizeLabel = getRequiredElement<HTMLElement>(root, "[data-crop-size]");

  cropBox.style.left = `${crop.x * previewScale}px`;
  cropBox.style.top = `${crop.y * previewScale}px`;
  cropBox.style.width = `${crop.width * previewScale}px`;
  cropBox.style.height = `${crop.height * previewScale}px`;
  cropBox.style.maxWidth = `${source.width * previewScale}px`;
  cropBox.style.maxHeight = `${source.height * previewScale}px`;
  sizeLabel.textContent = `${crop.width} x ${crop.height}`;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getSourcePixelsPerClientPixel(
  previewCanvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  previewScale: number,
): { x: number; y: number } {
  const rect = previewCanvas.getBoundingClientRect();

  if (rect.width > 0 && rect.height > 0) {
    return {
      x: source.width / rect.width,
      y: source.height / rect.height,
    };
  }

  const scale = previewScale > 0 ? previewScale : 1;
  return { x: 1 / scale, y: 1 / scale };
}

function getFittedPreviewScale(source: HTMLCanvasElement, requestedScale: number): number {
  const viewportWidth = typeof window === "undefined" ? source.width : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? source.height : window.innerHeight;
  const maxWidth = Math.max(1, viewportWidth * 0.76);
  const maxHeight = Math.max(1, viewportHeight * 0.62);
  const fitScale = Math.min(1, maxWidth / source.width, maxHeight / source.height);

  // WHY: modal 里的预览必须完整落在视口内，避免裁剪区产生横向/纵向滚动条导致误选区域。
  // TRADE-OFF: 大图的 100% 按钮会被视口上限钳制，但导出的裁剪仍然使用源图像素。
  return Math.max(0.05, Math.min(requestedScale, fitScale));
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

function releaseCapture(cropBox: HTMLElement, pointerId: number): void {
  if (
    typeof cropBox.hasPointerCapture === "function"
    && typeof cropBox.releasePointerCapture === "function"
    && cropBox.hasPointerCapture(pointerId)
  ) {
    cropBox.releasePointerCapture(pointerId);
  }
}

function getInitialMode(input: UploadConfirmModalInput): UploadProcessingMode {
  return input.options.some((option) => option.mode === input.initialMode && !option.error)
    ? input.initialMode
    : input.options.find((option) => !option.error)?.mode ?? "original";
}

function toUploadProcessingMode(mode: string): UploadProcessingMode | null {
  if (mode === "line-art" || mode === "original") {
    return mode;
  }

  return null;
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
