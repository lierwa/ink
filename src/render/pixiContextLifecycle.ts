export interface PixiContextLifecycleInput {
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export function installContextLifecycleHandlers(
  canvas: HTMLCanvasElement,
  input: PixiContextLifecycleInput,
): void {
  canvas.addEventListener("webglcontextlost", (event) => {
    // WHY: 浏览器默认可能让 WebGL 永久丢失；阻止默认行为让 Pixi 有机会恢复上下文。
    // TRADE-OFF: 恢复仍依赖浏览器/GPU 状态，但至少避免拖动中一次丢失后画布永久空白。
    event.preventDefault();
    input.onContextLost?.();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    input.onContextRestored?.();
  });
}
