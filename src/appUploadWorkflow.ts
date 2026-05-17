import { Texture } from "pixi.js";
import { createFabricUpdateQueue, getDefaultCommitTransform, getUploadCommitTransform, type RunCurrentFabricUpdate } from "./appUploadQueue";
import { type FabricTattooController } from "./editor/fabricController";
import { openUploadConfirmModal, type ProcessedTattooOption, type UploadProcessingMode } from "./editor/uploadConfirmModal";
import type { Size, TattooTransform } from "./domain/types";
import { cleanupLineArtBackground } from "./image/lineArtCleanup";
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

type IsCurrentRequest = (requestId: number) => boolean;

interface ProcessedUploadOptions {
  options: ProcessedTattooOption[];
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

async function updateUploadedTattoo(
  uploadedFile: File,
  input: UploadWorkflowInput,
  requestId: number,
  isCurrentRequest: IsCurrentRequest,
  runCurrentFabricUpdate: RunCurrentFabricUpdate,
): Promise<void> {
  try {
    const startTransformRevision = input.state.transformRevision;
    input.elements.statusLabel.textContent = "processing upload...";
    const processedOptions = await createProcessedOptions(uploadedFile);

    if (!isCurrentRequest(requestId)) {
      return;
    }

    const confirmed = await openUploadConfirmModal({
      fileName: uploadedFile.name,
      initialMode: getInitialUploadMode(processedOptions.options),
      options: processedOptions.options,
    });

    if (!isCurrentRequest(requestId)) {
      return;
    }

    if (!confirmed) {
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

async function updateDefaultTattoo(
  input: UploadWorkflowInput,
  requestId: number,
  isCurrentRequest: IsCurrentRequest,
  runCurrentFabricUpdate: RunCurrentFabricUpdate,
): Promise<void> {
  try {
    const startTransformRevision = input.state.transformRevision;
    const canvas = await input.createDefaultTattooCanvas();
    const dataUrl = canvas.toDataURL("image/png");
    let committedTransform: TattooTransform | null = null;

    if (!isCurrentRequest(requestId)) {
      return;
    }

    const didUpdateFabric = await runCurrentFabricUpdate(
      requestId,
      (shouldCommit) => input.fabric.setImage(
        dataUrl,
        getDefaultCommitTransform(input.state, startTransformRevision, input.initialTransform),
        shouldCommit,
        () => {
          const nextTransform = getDefaultCommitTransform(input.state, startTransformRevision, input.initialTransform);
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
    input.elements.statusLabel.textContent = "default linework";
    input.syncPanelFromTransform();
    input.renderTattoo();
  } catch (error) {
    if (!isCurrentRequest(requestId)) {
      return;
    }

    input.elements.statusLabel.textContent = `upload failed: ${getErrorMessage(error)}`;
  }
}

async function createProcessedOptions(
  file: File,
): Promise<ProcessedUploadOptions> {
  const originalCanvas = await fileToCanvas(file);
  const options: ProcessedTattooOption[] = [
    {
      mode: "line-art",
      label: "Line Art Cleanup",
      canvas: createLineArtCanvas(originalCanvas),
    },
  ];

  return { options };
}

function getInitialUploadMode(options: ProcessedTattooOption[]): UploadProcessingMode {
  const preferred = options.find((option) => !option.error && option.mode !== "original");
  return preferred?.mode ?? "original";
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const image = await fileToImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = requiredContext(canvas);

  // WHY: 裁剪模态框必须看到完整源图尺寸；预览缩放属于模态框显示层，不能提前替换源像素。
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

  // WHY: 上传流程现在固定走线稿清理；算法只改 alpha 不改 RGB，避免贴图笔触被二次加深。
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
