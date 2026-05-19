import { Texture } from "pixi.js";
import {
  createFabricUpdateQueue,
  getUploadCommitTransform,
  type RunCurrentFabricUpdate,
} from "./appUploadQueue";
import { type FabricTattooController } from "./editor/fabricController";
import {
  openUploadConfirmModal,
  type ProcessedTattooOption,
  type UploadProcessingMode,
} from "./editor/uploadConfirmModal";
import type { CropRect } from "./image/cropCanvas";
import type { Size, TattooTransform } from "./domain/types";
import { cleanupLineArtBackground } from "./image/lineArtCleanup";
import { defaultTattooSize } from "./defaultTattoo";

export interface UploadWorkflowState {
  tattooTransform: TattooTransform;
  tattooAsset: {
    texture: Texture;
    size: Size;
    dataUrl: string;
    sourceCanvas: HTMLCanvasElement;
    fileName: string;
    selectedMode: UploadProcessingMode;
    cropRect: CropRect;
  } | null;
  transformRevision: number;
}

export interface UploadWorkflowElements {
  tattooUploadInput: HTMLInputElement;
  statusLabel: HTMLElement;
  editTattooButton: HTMLButtonElement;
  removeTattooButton: HTMLButtonElement;
}

export interface UploadWorkflowInput {
  state: UploadWorkflowState;
  elements: UploadWorkflowElements;
  fabric: FabricTattooController;
  initialTransform: TattooTransform;
  renderTattoo(): void;
  syncPanelFromTransform(): void;
}

type IsCurrentRequest = (requestId: number) => boolean;

interface ProcessedUploadOptions {
  options: ProcessedTattooOption[];
}

interface UpdateTattooFromSourceOptions {
  initialMode?: UploadProcessingMode;
  initialCropRect?: CropRect;
  preserveTransform?: boolean;
}

const tattooUploadMaxEdge = Math.max(defaultTattooSize.width, defaultTattooSize.height);

export function installUploadWorkflow(input: UploadWorkflowInput): void {
  let uploadedFile: File | null = null;
  let latestUploadRequestId = 0;
  const isCurrentRequest = (requestId: number): boolean => requestId === latestUploadRequestId;
  const runCurrentFabricUpdate = createFabricUpdateQueue(isCurrentRequest);

  const refresh = async (): Promise<void> => {
    const requestId = latestUploadRequestId + 1;
    latestUploadRequestId = requestId;

    if (!uploadedFile) {
      clearCurrentTattoo(input, requestId, isCurrentRequest);
      return;
    }

    await updateUploadedTattoo(uploadedFile, input, requestId, isCurrentRequest, runCurrentFabricUpdate);
  };

  input.elements.tattooUploadInput.addEventListener("change", () => {
    uploadedFile = input.elements.tattooUploadInput.files?.[0] ?? null;
    input.elements.tattooUploadInput.value = "";
    void refresh();
  });

  input.elements.editTattooButton.addEventListener("click", () => {
    if (!input.state.tattooAsset) {
      return;
    }

    const asset = input.state.tattooAsset;
    const requestId = latestUploadRequestId + 1;
    latestUploadRequestId = requestId;
    // WHY: 编辑裁剪复用原始 source canvas，但必须进入同一请求序列，避免旧上传结果覆盖用户刚提交的编辑。
    // TRADE-OFF: 每次编辑都会使仍在处理的上传失效，这是单一 tattoo 资产模型下更可预测的行为。
    void updateTattooFromSource(
      asset.fileName,
      asset.sourceCanvas,
      input,
      requestId,
      isCurrentRequest,
      runCurrentFabricUpdate,
      {
        initialMode: asset.selectedMode,
        initialCropRect: asset.cropRect,
        preserveTransform: true,
      },
    );
  });

  input.elements.removeTattooButton.addEventListener("click", () => {
    clearCurrentTattoo(input, latestUploadRequestId + 1, () => true);
    latestUploadRequestId += 1;
    input.elements.tattooUploadInput.value = "";
  });
}

async function updateUploadedTattoo(
  uploadedFile: File,
  input: UploadWorkflowInput,
  requestId: number,
  isCurrentRequest: IsCurrentRequest,
  runCurrentFabricUpdate: RunCurrentFabricUpdate,
): Promise<void> {
  try {
    const originalCanvas = await fileToCanvas(uploadedFile);
    const normalizedCanvas = normalizeTattooCanvas(originalCanvas, tattooUploadMaxEdge);
    await updateTattooFromSource(
      uploadedFile.name,
      normalizedCanvas,
      input,
      requestId,
      isCurrentRequest,
      runCurrentFabricUpdate,
    );
  } catch (error) {
    if (!isCurrentRequest(requestId)) {
      return;
    }

    input.elements.statusLabel.textContent = `tattoo upload failed: ${getErrorMessage(error)}`;
  }
}

async function updateTattooFromSource(
  fileName: string,
  sourceCanvas: HTMLCanvasElement,
  input: UploadWorkflowInput,
  requestId: number,
  isCurrentRequest: IsCurrentRequest,
  runCurrentFabricUpdate: RunCurrentFabricUpdate,
  options: UpdateTattooFromSourceOptions = {},
): Promise<void> {
  try {
    const startTransformRevision = input.state.transformRevision;
    input.elements.statusLabel.textContent = "processing tattoo upload...";
    const processedOptions = createProcessedOptionsFromCanvas(sourceCanvas);
    const confirmed = await openUploadConfirmModal({
      fileName,
      initialMode: options.initialMode ?? getInitialUploadMode(processedOptions.options),
      initialCropRect: options.initialCropRect,
      options: processedOptions.options,
    });

    if (!isCurrentRequest(requestId)) {
      return;
    }

    if (!confirmed) {
      input.elements.statusLabel.textContent = "tattoo upload cancelled";
      return;
    }

    const canvas = confirmed.canvas;
    const dataUrl = canvas.toDataURL("image/png");
    let committedTransform: TattooTransform | null = null;
    const getCommitTransform = (): TattooTransform => {
      if (options.preserveTransform) {
        // WHY: 编辑裁剪只替换纹理与裁剪元数据，不能复用新上传的默认缩放归一逻辑。
        // TRADE-OFF: 若用户在编辑 modal 打开期间调整 transform，提交时会保留最新 transform，而不是打开 modal 时的快照。
        return { ...input.state.tattooTransform };
      }

      return getUploadCommitTransform(input.state, startTransformRevision);
    };

    const didUpdateFabric = await runCurrentFabricUpdate(
      requestId,
      (shouldCommit) => input.fabric.setImage(
        dataUrl,
        getCommitTransform(),
        shouldCommit,
        () => {
          const nextTransform = getCommitTransform();
          committedTransform = nextTransform;
          return nextTransform;
        },
      ),
    );

    if (!didUpdateFabric || !committedTransform) {
      return;
    }

    input.state.tattooAsset = {
      texture: Texture.from(canvas),
      dataUrl,
      size: { width: canvas.width, height: canvas.height },
      sourceCanvas,
      fileName,
      selectedMode: confirmed.mode,
      cropRect: confirmed.cropRect,
    };
    input.state.tattooTransform = committedTransform;

    if (!isCurrentRequest(requestId)) {
      return;
    }

    input.elements.statusLabel.textContent = confirmed.fallbackFrom
      ? `applied tattoo (${confirmed.fallbackFrom} -> ${confirmed.mode} fallback)`
      : `applied tattoo (${confirmed.mode})`;
    input.syncPanelFromTransform();
    input.renderTattoo();
  } catch (error) {
    if (!isCurrentRequest(requestId)) {
      return;
    }

    input.elements.statusLabel.textContent = `tattoo upload failed: ${getErrorMessage(error)}`;
  }
}

function clearCurrentTattoo(
  input: UploadWorkflowInput,
  requestId: number,
  isCurrentRequest: IsCurrentRequest,
): void {
  if (!isCurrentRequest(requestId)) {
    return;
  }

  // WHY: 空文件态代表尚无 tattoo 资产，不能回填默认线稿，否则 Fabric 会过早创建可编辑框。
  // TRADE-OFF: 首屏少一个示例贴图，但交互状态和用户上传生命周期保持一致。
  input.fabric.clearTattoo();
  input.state.tattooAsset = null;
  input.state.tattooTransform = { ...input.initialTransform };
  input.elements.statusLabel.textContent = "Upload tattoo to enable transform controls";
  input.syncPanelFromTransform();
  input.renderTattoo();
}

function createProcessedOptionsFromCanvas(normalizedCanvas: HTMLCanvasElement): ProcessedUploadOptions {
  return {
    options: [
      { mode: "original", label: "Original", canvas: normalizedCanvas },
      { mode: "line-art", label: "Line Art Cleanup", canvas: createLineArtCanvas(normalizedCanvas) },
    ],
  };
}

function getInitialUploadMode(options: ProcessedTattooOption[]): UploadProcessingMode {
  // WHY: 产品侧要求默认展示 line-art，用户可在 modal 左上角与 original 对比后再 Apply。
  // TRADE-OFF: line-art 在极端输入上可能接近透明，因此由 Apply 阶段自动回退兜底可见性。
  const preferred = options.find((option) => option.mode === "line-art" && !option.error);
  if (preferred) {
    return preferred.mode;
  }

  const firstAvailable = options.find((option) => !option.error);
  return firstAvailable?.mode ?? "original";
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const image = await fileToImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
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

  // WHY: 贴图上传链路只做纹理清理，保证不会误触发 body mesh 重建导致主流程语义混乱。
  // TRADE-OFF: 失去“上传即自动贴附”捷径，但能保持 Body 与 Tattoo 职责解耦。
  cleanupLineArtBackground(imageData);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function normalizeTattooCanvas(source: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const longEdge = Math.max(source.width, source.height);
  if (longEdge <= maxEdge) {
    return source;
  }

  const scale = maxEdge / longEdge;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = requiredContext(canvas);

  // WHY: 上传图统一归一到成熟基准尺寸，避免超大原图在球面投影里只采样到中心极小区域导致“看不见”。
  // TRADE-OFF: 牺牲部分原始分辨率，但换来稳定可见的默认贴附效果与更可控的交互缩放。
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
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
