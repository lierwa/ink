import { fitAspectRect } from "../domain/canvasViewport";
import type { Size } from "../domain/types";

export interface StageFitController {
  disconnect(): void;
}

export function installStageFitController(
  container: HTMLElement,
  stageStack: HTMLElement,
  aspectSize: Size,
): StageFitController {
  const applySize = (size: Size): void => {
    const fitted = fitAspectRect(size, aspectSize);
    stageStack.style.setProperty("--stage-display-width", `${fitted.width}px`);
    stageStack.style.setProperty("--stage-display-height", `${fitted.height}px`);
  };

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      // WHY: 主舞台只改变 CSS 显示尺寸，Pixi/Fabric 仍保留 900x620 逻辑坐标，避免重写交互与投影计算。
      // TRADE-OFF: CSS 缩放会让像素密度依赖浏览器插值，但比动态重建渲染器风险低。
      applySize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container);
    return { disconnect: () => observer.disconnect() };
  }

  const rect = container.getBoundingClientRect();
  applySize({ width: rect.width, height: rect.height });
  return { disconnect: () => undefined };
}
