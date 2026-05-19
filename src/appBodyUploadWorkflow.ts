import { Texture } from "pixi.js";
import { openBodyUploadModal } from "./editor/bodyUploadModal";
import { createBodyMeshPreviewBuilder, computeContainPlacementRect, mapSkinMeshToPlacementRect } from "./appBodyMeshPreview";
import { stageSize } from "./sphereConfig";
import type { PixiTattooRenderer } from "./render/pixiRenderer";
import type {
  BodyMeshPipelineParams,
  BodySurfaceAnalysisDebugState,
  Rect,
  Size,
  SkinMask,
  SkinMeshData,
  TattooTransform,
} from "./domain/types";

interface BodySurfaceState {
  texture: Texture;
  sourceCanvas: HTMLCanvasElement;
  fileName: string;
  surfaceNormalTexture: Texture | null;
  placementRect: Rect;
  sourceSize: Size;
  mask: SkinMask;
  mesh: SkinMeshData;
  pipelineParams: BodyMeshPipelineParams;
  analysisDebug: BodySurfaceAnalysisDebugState | null;
  revision: number;
}

interface BodyUploadState {
  tattooTransform: TattooTransform;
  bodySurfaceState: BodySurfaceState;
}

interface BodyUploadElements {
  bodyUploadInput: HTMLInputElement;
  editBodyButton: HTMLButtonElement;
  removeBodyButton: HTMLButtonElement;
  statusLabel: HTMLDivElement;
}

interface BodySurfaceApplyResult {
  status: string;
}

type SetTattooTransform = (transform: TattooTransform, source: "fabric" | "panel" | "body-apply") => void;

export interface BodyUploadWorkflowInput {
  state: BodyUploadState;
  elements: BodyUploadElements;
  pixi: PixiTattooRenderer;
  initialTransform: TattooTransform;
  setTransform: SetTattooTransform;
  renderBodySurface: () => void;
  resetBodySurface: () => void;
}

export function installBodyUploadWorkflow(input: BodyUploadWorkflowInput): void {
  let latestRequestToken = 0;

  const invalidatePendingBodyRequest = (): void => {
    latestRequestToken += 1;
  };

  const openBodyEditorFromCanvas = async (
    fileName: string,
    sourceCanvas: HTMLCanvasElement,
    initialParams: BodyMeshPipelineParams,
  ): Promise<void> => {
    const requestToken = latestRequestToken + 1;
    latestRequestToken = requestToken;
    const isCurrentRequest = (): boolean => requestToken === latestRequestToken;

    try {
      input.elements.statusLabel.textContent = "processing body upload...";
      const modalResult = await openBodyUploadModal({
        fileName,
        sourceCanvas,
        initialParams,
        buildPreview: createBodyMeshPreviewBuilder(),
      });

      if (!isCurrentRequest()) {
        return;
      }

      if (!modalResult) {
        input.elements.statusLabel.textContent = "body upload cancelled";
        return;
      }

      const previousBodyTexture = input.state.bodySurfaceState.texture;
      const surfaceSummary = applyBodySurfaceResult(input.state, input.pixi, {
        fileName,
        sourceCanvas: modalResult.sourceCanvas,
        params: modalResult.params,
        preview: modalResult.preview,
      });
      const centeredTransform = createBodyCenteredTattooTransform(
        input.state.bodySurfaceState.placementRect,
        input.state.tattooTransform.opacity,
        input.initialTransform,
      );

      // WHY: Apply Body 后重置贴图中心，避免旧 body 的位置语义遗留到新 body 导致“贴图飞离人体”的错觉。
      // TRADE-OFF: 用户需再次微调位置，但获得稳定且可预测的初始贴附点。
      input.setTransform(centeredTransform, "body-apply");
      input.renderBodySurface();
      destroyTextureAfterPixiRebind(previousBodyTexture);
      input.elements.statusLabel.textContent = surfaceSummary.status;
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }

      input.elements.statusLabel.textContent = `body upload failed: ${getErrorMessage(error)}`;
    }
  };

  input.elements.bodyUploadInput.addEventListener("change", () => {
    const file = input.elements.bodyUploadInput.files?.[0] ?? null;

    if (!file) {
      return;
    }

    // WHY: 浏览器 file input 选择同一文件不会触发 change，读取 File 后立即清空可支持 same-file retry。
    // TRADE-OFF: UI 不再保留文件路径文本，但当前状态标签已经承载上传反馈。
    input.elements.bodyUploadInput.value = "";

    const requestToken = latestRequestToken + 1;
    latestRequestToken = requestToken;
    const isCurrentRequest = (): boolean => requestToken === latestRequestToken;

    void (async () => {
      try {
        input.elements.statusLabel.textContent = "processing body upload...";
        const sourceCanvas = await fileToCanvas(file);

        if (!isCurrentRequest()) {
          return;
        }

        await openBodyEditorFromCanvas(
          file.name,
          sourceCanvas,
          input.state.bodySurfaceState.pipelineParams,
        );
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }

        input.elements.statusLabel.textContent = `body upload failed: ${getErrorMessage(error)}`;
      }
    })();
  });

  input.elements.editBodyButton.addEventListener("click", () => {
    // WHY: 编辑 body mesh 必须复用原始 canvas 和当前参数，否则用户每次微调都会回到默认 pipeline。
    // TRADE-OFF: 只保留单份 source canvas，符合当前单 body 状态模型，避免新增历史版本复杂度。
    void openBodyEditorFromCanvas(
      input.state.bodySurfaceState.fileName,
      input.state.bodySurfaceState.sourceCanvas,
      input.state.bodySurfaceState.pipelineParams,
    );
  });

  input.elements.removeBodyButton.addEventListener("click", () => {
    // WHY: Remove 代表用户显式放弃当前 body 编辑流，必须让仍打开的 modal 结果失效。
    // TRADE-OFF: 用户若误点 Remove，需要重新打开编辑；避免旧异步结果覆盖 placeholder。
    invalidatePendingBodyRequest();
    input.resetBodySurface();
  });
}

function applyBodySurfaceResult(
  state: BodyUploadState,
  pixi: PixiTattooRenderer,
  result: {
    fileName: string;
    sourceCanvas: HTMLCanvasElement;
    params: BodyMeshPipelineParams;
    preview: {
      mask: SkinMask;
      mesh: SkinMeshData;
    };
  },
): BodySurfaceApplyResult {
  const previousNormalTexture = state.bodySurfaceState.surfaceNormalTexture;
  if (previousNormalTexture) {
    // WHY: Pixi shader resources may still reference the old normal texture until the next render tick.
    // TRADE-OFF: 先绑定空 normal 会多一次轻量状态更新，但避免销毁仍被 WebGL 采样器引用的资源。
    pixi.setSurfaceNormalTexture(null);
    previousNormalTexture.destroy(true);
  }
  const placementRect = computeContainPlacementRect(
    { width: result.sourceCanvas.width, height: result.sourceCanvas.height },
    stageSize,
  );
  const mappedMesh = mapSkinMeshToPlacementRect(
    result.preview.mesh,
    { width: result.sourceCanvas.width, height: result.sourceCanvas.height },
    placementRect,
  );

  state.bodySurfaceState = {
    texture: Texture.from(result.sourceCanvas),
    sourceCanvas: result.sourceCanvas,
    fileName: result.fileName,
    surfaceNormalTexture: null,
    placementRect,
    sourceSize: { width: result.sourceCanvas.width, height: result.sourceCanvas.height },
    mask: result.preview.mask,
    mesh: mappedMesh,
    pipelineParams: { ...result.params },
    analysisDebug: null,
    revision: state.bodySurfaceState.revision + 1,
  };

  pixi.setBodyAnalysisDebug(state.bodySurfaceState.analysisDebug);
  return {
    status: "Body mesh ready. Move tattoo to inspect local surface.",
  };
}

function createBodyCenteredTattooTransform(
  placementRect: Rect,
  opacity: number,
  initialTransform: TattooTransform,
): TattooTransform {
  return {
    x: placementRect.x + placementRect.width / 2,
    y: placementRect.y + placementRect.height / 2,
    scale: initialTransform.scale,
    rotation: initialTransform.rotation,
    opacity,
  };
}

function destroyTextureAfterPixiRebind(texture: Texture): void {
  // WHY: body sprite/mask 在 renderBodySurface 后已绑定新 texture，此时释放旧 texture 才不会留下悬挂采样引用。
  // TRADE-OFF: 测试替身可能只实现 Texture 的局部形状，因此保留运行时 guard，不把资源清理绑死到 mock 完整性。
  const maybeDestroyable = texture as Texture & { destroy?: (destroySource?: boolean) => void };
  maybeDestroyable.destroy?.(true);
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const image = await fileToImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }
  context.drawImage(image, 0, 0);
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
