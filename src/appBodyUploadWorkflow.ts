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
  bodyUploadStatus?: HTMLElement;
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
    options: { recenterTattoo: boolean },
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
      input.renderBodySurface();
      const nextTransform = options.recenterTattoo
        ? createBodyMeshCenteredTattooTransform(
          input.state.bodySurfaceState.mesh,
          input.state.tattooTransform.opacity,
          input.initialTransform,
        )
        : { ...input.state.tattooTransform };

      // WHY: Pixi 必须先绑定最新 body/mask，再用同一份最新 mesh 重建 tattoo warp；编辑 body 时保留用户当前 tattoo 位置。
      // TRADE-OFF: 新上传 body 会自动落到 mesh 中心，编辑旧 body 不再替用户移动 tattoo。
      input.setTransform(nextTransform, "body-apply");
      // WHY: Pixi 会按 canvas resource 缓存 Texture，同 canvas 编辑可能返回仍在使用的同一实例。
      // TRADE-OFF: 只跳过同一对象的销毁；真正替换出的旧 texture 仍按既有顺序在 rebind 后释放。
      if (previousBodyTexture !== input.state.bodySurfaceState.texture) {
        destroyTextureAfterPixiRebind(previousBodyTexture);
      }
      setUploadStatus(input.elements.bodyUploadStatus, `Current: ${fileName}`);
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
          { recenterTattoo: true },
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
      { recenterTattoo: false },
    );
  });

  input.elements.removeBodyButton.addEventListener("click", () => {
    // WHY: Remove 代表用户显式放弃当前 body 编辑流，必须让仍打开的 modal 结果失效。
    // TRADE-OFF: 用户若误点 Remove，需要重新打开编辑；避免旧异步结果覆盖 placeholder。
    invalidatePendingBodyRequest();
    input.resetBodySurface();
    setUploadStatus(input.elements.bodyUploadStatus, "No body uploaded");
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

function createBodyMeshCenteredTattooTransform(
  mesh: SkinMeshData,
  opacity: number,
  initialTransform: TattooTransform,
): TattooTransform {
  const bounds = getMeshBounds(mesh);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    scale: initialTransform.scale,
    rotation: initialTransform.rotation,
    opacity,
  };
}

function getMeshBounds(mesh: SkinMeshData): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < mesh.positions.length; index += 2) {
    minX = Math.min(minX, mesh.positions[index]);
    minY = Math.min(minY, mesh.positions[index + 1]);
    maxX = Math.max(maxX, mesh.positions[index]);
    maxY = Math.max(maxY, mesh.positions[index + 1]);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
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

function setUploadStatus(element: HTMLElement | undefined, text: string): void {
  if (element) {
    element.textContent = text;
  }
}
