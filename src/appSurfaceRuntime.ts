import { Texture } from "pixi.js";

export interface LiveSurfaceRefreshScheduler {
  schedule(): void;
  cancel(): void;
}

export function createLiveSurfaceRefreshScheduler(refresh: () => void): LiveSurfaceRefreshScheduler {
  let timerId: number | null = null;
  let lastRunAt = 0;
  const minIntervalMs = 80;

  const run = (): void => {
    timerId = null;
    lastRunAt = performance.now();
    refresh();
  };

  return {
    schedule() {
      if (timerId !== null) {
        return;
      }
      const elapsed = performance.now() - lastRunAt;
      const delay = Math.max(0, minIntervalMs - elapsed);
      // WHY: Fabric 拖动事件频率远高于 GPU 纹理/mesh 可承受的刷新频率。
      // TRADE-OFF: live 贴合反馈最多延迟约 80ms，但能避免拖动中反复创建纹理导致 WebGL context lost。
      timerId = window.setTimeout(() => {
        const frame = window.requestAnimationFrame ?? ((callback: FrameRequestCallback): number => {
          return window.setTimeout(() => callback(performance.now()), 0);
        });
        frame(run);
      }, delay);
    },
    cancel() {
      if (timerId === null) {
        return;
      }
      window.clearTimeout(timerId);
      timerId = null;
    },
  };
}

export function replaceTextureBindingBeforeDestroy(
  previousTexture: Texture | null,
  nextTexture: Texture | null,
  bindTexture: (texture: Texture | null) => void,
): void {
  bindTexture(nextTexture);
  if (previousTexture && previousTexture !== nextTexture) {
    // WHY: Pixi BindGroup 会监听 TextureSource destroy，并在资源销毁时把内部 resources 置空。
    // TRADE-OFF: 替换路径必须多接收一个绑定回调，但能保证旧资源销毁前 shader 已经解绑。
    previousTexture.destroy?.(true);
  }
}
