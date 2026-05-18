import type { BodyMeshPipelineParams, SkinMask, SkinMeshData } from "../domain/types";
import { defaultBodyMeshPipelineParams } from "../domain/skinMeshPipeline";

export type BodyPreviewMode = "original" | "mask" | "mesh";

export interface BodyMeshPreview {
  mask: SkinMask;
  mesh: SkinMeshData;
  warning?: string;
}

export interface BodyUploadModalInput {
  fileName: string;
  sourceCanvas: HTMLCanvasElement;
  initialParams?: BodyMeshPipelineParams;
  buildPreview(
    sourceCanvas: HTMLCanvasElement,
    params: BodyMeshPipelineParams,
  ): Promise<BodyMeshPreview>;
}

export interface BodyUploadModalResult {
  sourceCanvas: HTMLCanvasElement;
  params: BodyMeshPipelineParams;
  preview: BodyMeshPreview;
}

interface NumberFieldDescriptor {
  key: Exclude<keyof BodyMeshPipelineParams, "useConstraintEdges" | "allowLooseFallback">;
  labelEn: string;
  labelZh: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

const commonFieldDescriptors: NumberFieldDescriptor[] = [
  {
    key: "threshold",
    labelEn: "Threshold",
    labelZh: "阈值",
    min: 0.05,
    max: 0.95,
    step: 0.01,
    defaultValue: defaultBodyMeshPipelineParams.threshold,
  },
  {
    key: "morphStrength",
    labelEn: "Morph Strength",
    labelZh: "形态学强度",
    min: 0,
    max: 3,
    step: 1,
    defaultValue: defaultBodyMeshPipelineParams.morphStrength,
  },
  {
    key: "boundaryDensity",
    labelEn: "Boundary Density",
    labelZh: "边界密度",
    min: 0.5,
    max: 2,
    step: 0.1,
    defaultValue: defaultBodyMeshPipelineParams.boundaryDensity,
  },
];

const advancedFieldDescriptors: NumberFieldDescriptor[] = [
  {
    key: "contourSimplify",
    labelEn: "Contour Simplify",
    labelZh: "轮廓简化",
    min: 0,
    max: 8,
    step: 0.1,
    defaultValue: defaultBodyMeshPipelineParams.contourSimplify,
  },
  {
    key: "resampleMin",
    labelEn: "Resample Min",
    labelZh: "重采样最小步长",
    min: 1,
    max: 24,
    step: 0.5,
    defaultValue: defaultBodyMeshPipelineParams.resampleMin,
  },
  {
    key: "resampleMax",
    labelEn: "Resample Max",
    labelZh: "重采样最大步长",
    min: 2,
    max: 36,
    step: 0.5,
    defaultValue: defaultBodyMeshPipelineParams.resampleMax,
  },
  {
    key: "samplingInnerRadius",
    labelEn: "Sampling Inner Radius",
    labelZh: "内部采样半径",
    min: 2,
    max: 64,
    step: 1,
    defaultValue: defaultBodyMeshPipelineParams.samplingInnerRadius,
  },
  {
    key: "samplingBandRadius",
    labelEn: "Sampling Band Radius",
    labelZh: "边界带采样半径",
    min: 1,
    max: 96,
    step: 1,
    defaultValue: defaultBodyMeshPipelineParams.samplingBandRadius,
  },
  {
    key: "samplingBoundaryRadius",
    labelEn: "Sampling Boundary Radius",
    labelZh: "边界点采样半径",
    min: 1,
    max: 48,
    step: 1,
    defaultValue: defaultBodyMeshPipelineParams.samplingBoundaryRadius,
  },
  {
    key: "minTriangleArea",
    labelEn: "CDT Min Area",
    labelZh: "CDT 最小三角面积",
    min: 0,
    max: 8,
    step: 0.0001,
    defaultValue: defaultBodyMeshPipelineParams.minTriangleArea,
  },
];

const bodyPreviewViewportSize = {
  width: 720,
  height: 560,
} as const;

export async function openBodyUploadModal(
  input: BodyUploadModalInput,
): Promise<BodyUploadModalResult | null> {
  const overlay = createModal(input.fileName);
  const previewCanvas = getRequiredElement<HTMLCanvasElement>(overlay, "[data-body-preview-canvas]");
  const status = getRequiredElement<HTMLElement>(overlay, "[data-body-modal-status]");
  let params = mergeBodyPipelineParams(input.initialParams);
  let mode: BodyPreviewMode = "original";
  let latestBuildToken = 0;
  let lastPreview: BodyMeshPreview | null = null;
  let settled = false;
  let rebuildTimer: number | null = null;

  return new Promise<BodyUploadModalResult | null>((resolve) => {
    document.body.appendChild(overlay);
    syncModalParams(overlay, params);
    renderModeButtons(overlay, mode);
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || settled) {
        return;
      }

      close(null);
    };

    const close = (result: BodyUploadModalResult | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (rebuildTimer !== null) {
        window.clearTimeout(rebuildTimer);
        rebuildTimer = null;
      }
      window.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve(result);
    };

    const refreshPreview = async (): Promise<void> => {
      const buildToken = latestBuildToken + 1;
      latestBuildToken = buildToken;
      status.textContent = "rebuilding mesh...";

      try {
        const preview = await input.buildPreview(input.sourceCanvas, params);
        if (buildToken !== latestBuildToken || settled) {
          return;
        }

        lastPreview = preview;
        status.textContent = preview.warning ?? "mesh preview ready";
        drawPreview(previewCanvas, input.sourceCanvas, preview, mode);
      } catch (error) {
        if (buildToken !== latestBuildToken || settled) {
          return;
        }

        status.textContent = `mesh rebuild failed: ${getErrorMessage(error)}`;
      }
    };

    const rebuildNow = (): void => {
      if (rebuildTimer !== null) {
        window.clearTimeout(rebuildTimer);
        rebuildTimer = null;
      }

      params = readParamsFromModal(overlay, params);
      void refreshPreview();
    };

    const schedulePreviewRebuild = (): void => {
      if (settled) {
        return;
      }

      if (rebuildTimer !== null) {
        window.clearTimeout(rebuildTimer);
      }

      // WHY: 参数拖动时用 120ms 防抖，把高频 input 合并成一次重算，保证预览实时且不卡顿。
      // TRADE-OFF: 预览存在极短延迟，但换来连续拖拽时更稳定的交互帧率。
      rebuildTimer = window.setTimeout(() => {
        rebuildTimer = null;
        params = readParamsFromModal(overlay, params);
        void refreshPreview();
      }, 120);
    };

    bindParamInputs(overlay, schedulePreviewRebuild);

    getRequiredElement<HTMLButtonElement>(overlay, "[data-body-modal-action='cancel']")
      .addEventListener("click", () => close(null));

    getRequiredElement<HTMLButtonElement>(overlay, "[data-body-modal-action='apply']")
      .addEventListener("click", () => {
        if (!lastPreview) {
          return;
        }

        close({
          sourceCanvas: input.sourceCanvas,
          params,
          preview: lastPreview,
        });
      });

    getRequiredElement<HTMLButtonElement>(overlay, "[data-body-modal-action='rebuild']")
      .addEventListener("click", () => {
        rebuildNow();
      });

    getRequiredElement<HTMLButtonElement>(overlay, "[data-body-modal-action='reset']")
      .addEventListener("click", () => {
        params = mergeBodyPipelineParams();
        syncModalParams(overlay, params);
        rebuildNow();
      });

    for (const button of overlay.querySelectorAll<HTMLButtonElement>("[data-body-preview-mode]")) {
      button.addEventListener("click", () => {
        mode = parseMode(button.dataset.bodyPreviewMode);
        renderModeButtons(overlay, mode);
        if (lastPreview) {
          drawPreview(previewCanvas, input.sourceCanvas, lastPreview, mode);
        }
      });
    }

    window.addEventListener("keydown", onKeydown);

    void refreshPreview();
  });
}

function createModal(fileName: string): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "body-upload-overlay";

  const dialog = document.createElement("div");
  dialog.className = "body-upload-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Edit Body Mesh");

  dialog.innerHTML = `
    <header class="body-upload-header">
      <div>
        <h2>Body Mesh Editor</h2>
        <p>Review body segmentation before Apply Body</p>
      </div>
      <small>${escapeHtml(fileName)}</small>
    </header>
    <section class="body-upload-main">
      <div class="body-upload-preview-panel">
        <div class="body-upload-preview-toolbar">
          <div class="body-upload-modes">
            <button type="button" data-body-preview-mode="original">Original</button>
            <button type="button" data-body-preview-mode="mask">Skin Mask</button>
            <button type="button" data-body-preview-mode="mesh">Mesh Overlay</button>
          </div>
          <div class="status-pill" data-body-modal-status>rebuilding mesh...</div>
        </div>
        <div class="body-upload-preview">
          <canvas data-body-preview-canvas></canvas>
        </div>
      </div>
      <div class="body-upload-controls">
        <section class="body-upload-group">
          <h3>Common</h3>
          ${commonFieldDescriptors.map((descriptor) => createNumberField(descriptor)).join("")}
        </section>
        <details class="body-upload-advanced">
          <summary>Advanced</summary>
          <section class="body-upload-group">
            ${advancedFieldDescriptors.map((descriptor) => createNumberField(descriptor)).join("")}
            ${createToggleField("useConstraintEdges", "Enable CDT Constraints", "启用 CDT 约束边")}
            ${createToggleField("allowLooseFallback", "Enable Loose Fallback", "允许宽松回退")}
          </section>
        </details>
        <div class="body-upload-actions-inline">
          <button type="button" data-body-modal-action="rebuild">Rebuild Mesh</button>
          <button type="button" data-body-modal-action="reset">Reset Params</button>
        </div>
      </div>
    </section>
    <footer class="body-upload-footer">
      <button type="button" data-body-modal-action="cancel">Cancel</button>
      <button type="button" data-body-modal-action="apply">Apply Body</button>
    </footer>
  `;

  overlay.append(dialog);
  return overlay;
}

function createNumberField(descriptor: NumberFieldDescriptor): string {
  const label = formatBilingualLabel(descriptor.labelEn, descriptor.labelZh);
  return `
    <label class="body-upload-number-field">
      <span>${label}</span>
      <div class="body-upload-number-controls">
        <input data-body-param-range="${String(descriptor.key)}" type="range" />
        <input data-body-param-number="${String(descriptor.key)}" type="number" />
      </div>
    </label>
  `;
}

function createToggleField(
  key: keyof BodyMeshPipelineParams,
  labelEn: string,
  labelZh: string,
): string {
  return `
    <label class="toggle-line">
      <input data-body-param="${String(key)}" type="checkbox" />
      <span>${formatBilingualLabel(labelEn, labelZh)}</span>
    </label>
  `;
}

function mergeBodyPipelineParams(overrides?: Partial<BodyMeshPipelineParams>): BodyMeshPipelineParams {
  return {
    ...defaultBodyMeshPipelineParams,
    ...(overrides ?? {}),
  };
}

function syncModalParams(root: HTMLElement, params: BodyMeshPipelineParams): void {
  for (const descriptor of [...commonFieldDescriptors, ...advancedFieldDescriptors]) {
    const rangeInput = getRequiredElement<HTMLInputElement>(
      root,
      `[data-body-param-range='${String(descriptor.key)}']`,
    );
    const numberInput = getRequiredElement<HTMLInputElement>(
      root,
      `[data-body-param-number='${String(descriptor.key)}']`,
    );
    const value = clampNumberParamValue(params[descriptor.key], descriptor);

    rangeInput.min = String(descriptor.min);
    rangeInput.max = String(descriptor.max);
    rangeInput.step = String(descriptor.step);
    rangeInput.value = String(value);

    numberInput.min = String(descriptor.min);
    numberInput.max = String(descriptor.max);
    numberInput.step = String(descriptor.step);
    numberInput.value = String(value);
  }

  const constraints = getRequiredElement<HTMLInputElement>(root, "[data-body-param='useConstraintEdges']");
  const fallback = getRequiredElement<HTMLInputElement>(root, "[data-body-param='allowLooseFallback']");
  constraints.checked = params.useConstraintEdges;
  fallback.checked = params.allowLooseFallback;
}

function readParamsFromModal(
  root: HTMLElement,
  previous: BodyMeshPipelineParams,
): BodyMeshPipelineParams {
  const next: BodyMeshPipelineParams = { ...previous };

  for (const descriptor of [...commonFieldDescriptors, ...advancedFieldDescriptors]) {
    const numberInput = getRequiredElement<HTMLInputElement>(
      root,
      `[data-body-param-number='${String(descriptor.key)}']`,
    );
    const parsed = Number(numberInput.value);

    next[descriptor.key] = clampNumberParamValue(
      Number.isFinite(parsed) ? parsed : descriptor.defaultValue,
      descriptor,
    );
  }

  next.useConstraintEdges = getRequiredElement<HTMLInputElement>(
    root,
    "[data-body-param='useConstraintEdges']",
  ).checked;
  next.allowLooseFallback = getRequiredElement<HTMLInputElement>(
    root,
    "[data-body-param='allowLooseFallback']",
  ).checked;

  return next;
}

function renderModeButtons(root: HTMLElement, mode: BodyPreviewMode): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-body-preview-mode]")) {
    const isCurrent = parseMode(button.dataset.bodyPreviewMode) === mode;
    button.classList.toggle("is-active", isCurrent);
  }
}

function bindParamInputs(root: HTMLElement, schedulePreviewRebuild: () => void): void {
  for (const descriptor of [...commonFieldDescriptors, ...advancedFieldDescriptors]) {
    const rangeInput = getRequiredElement<HTMLInputElement>(
      root,
      `[data-body-param-range='${String(descriptor.key)}']`,
    );
    const numberInput = getRequiredElement<HTMLInputElement>(
      root,
      `[data-body-param-number='${String(descriptor.key)}']`,
    );

    const syncFromRange = (): void => {
      numberInput.value = rangeInput.value;
      schedulePreviewRebuild();
    };

    const syncFromNumber = (): void => {
      const parsed = Number(numberInput.value);
      if (!Number.isFinite(parsed)) {
        return;
      }

      const clamped = clampNumberParamValue(parsed, descriptor);
      const normalized = String(clamped);
      numberInput.value = normalized;
      rangeInput.value = normalized;
      schedulePreviewRebuild();
    };

    rangeInput.addEventListener("input", syncFromRange);
    rangeInput.addEventListener("change", syncFromRange);
    numberInput.addEventListener("input", syncFromNumber);
    numberInput.addEventListener("change", syncFromNumber);
  }

  getRequiredElement<HTMLInputElement>(root, "[data-body-param='useConstraintEdges']")
    .addEventListener("change", schedulePreviewRebuild);
  getRequiredElement<HTMLInputElement>(root, "[data-body-param='allowLooseFallback']")
    .addEventListener("change", schedulePreviewRebuild);
}

function clampNumberParamValue(value: number, descriptor: NumberFieldDescriptor): number {
  return clamp(value, descriptor.min, descriptor.max);
}

function formatBilingualLabel(labelEn: string, labelZh: string): string {
  return `${labelEn}（${labelZh}）`;
}

function parseMode(rawMode: string | undefined): BodyPreviewMode {
  if (rawMode === "mask" || rawMode === "mesh") {
    return rawMode;
  }

  return "original";
}

function drawPreview(
  previewCanvas: HTMLCanvasElement,
  sourceCanvas: HTMLCanvasElement,
  preview: BodyMeshPreview,
  mode: BodyPreviewMode,
): void {
  const previewSize = computeContainPreviewSize(
    { width: sourceCanvas.width, height: sourceCanvas.height },
    bodyPreviewViewportSize,
  );

  previewCanvas.width = previewSize.width;
  previewCanvas.height = previewSize.height;
  const context = previewCanvas.getContext("2d");

  if (!context) {
    return;
  }

  context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

  if (mode === "original") {
    context.drawImage(sourceCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
    return;
  }

  if (mode === "mask") {
    drawMaskView(context, preview.mask, previewCanvas.width, previewCanvas.height);
    return;
  }

  context.drawImage(sourceCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
  drawMeshOverlay(context, preview.mesh, {
    x: previewCanvas.width / sourceCanvas.width,
    y: previewCanvas.height / sourceCanvas.height,
  });
}

function computeContainPreviewSize(sourceSize: { width: number; height: number }, viewportSize: { width: number; height: number }): { width: number; height: number } {
  if (sourceSize.width <= 0 || sourceSize.height <= 0) {
    return { ...viewportSize };
  }

  const scale = Math.min(1, viewportSize.width / sourceSize.width, viewportSize.height / sourceSize.height);

  // WHY: 预览 canvas 使用视口 contain 尺寸，避免原图像素反向撑大弹窗；源图像素仍只作为算法输入。
  // TRADE-OFF: 编辑预览不是 1:1 像素查看，但首屏可读性和弹窗稳定性更重要。
  return {
    width: Math.max(1, Math.round(sourceSize.width * scale)),
    height: Math.max(1, Math.round(sourceSize.height * scale)),
  };
}

function drawMaskView(
  context: CanvasRenderingContext2D,
  mask: SkinMask,
  outputWidth: number,
  outputHeight: number,
): void {
  const imageData = context.createImageData(mask.width, mask.height);

  for (let i = 0; i < mask.probabilities.length; i += 1) {
    const alpha = Math.round(clamp(mask.probabilities[i], 0, 1) * 255);
    imageData.data[i * 4] = alpha;
    imageData.data[i * 4 + 1] = alpha;
    imageData.data[i * 4 + 2] = alpha;
    imageData.data[i * 4 + 3] = 255;
  }

  const workingCanvas = document.createElement("canvas");
  workingCanvas.width = mask.width;
  workingCanvas.height = mask.height;
  const workingContext = workingCanvas.getContext("2d");
  if (!workingContext) {
    return;
  }

  workingContext.putImageData(imageData, 0, 0);
  context.drawImage(workingCanvas, 0, 0, outputWidth, outputHeight);
}

function drawMeshOverlay(
  context: CanvasRenderingContext2D,
  mesh: SkinMeshData,
  sourceToPreviewScale: { x: number; y: number },
): void {
  context.strokeStyle = "rgba(208, 79, 36, 0.74)";
  context.lineWidth = 1;
  context.beginPath();

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 2;
    const b = mesh.indices[i + 1] * 2;
    const c = mesh.indices[i + 2] * 2;

    context.moveTo(mesh.positions[a] * sourceToPreviewScale.x, mesh.positions[a + 1] * sourceToPreviewScale.y);
    context.lineTo(mesh.positions[b] * sourceToPreviewScale.x, mesh.positions[b + 1] * sourceToPreviewScale.y);
    context.lineTo(mesh.positions[c] * sourceToPreviewScale.x, mesh.positions[c + 1] * sourceToPreviewScale.y);
    context.lineTo(mesh.positions[a] * sourceToPreviewScale.x, mesh.positions[a + 1] * sourceToPreviewScale.y);
  }

  context.stroke();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getRequiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element as T;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
