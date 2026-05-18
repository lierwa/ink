import { Graphics } from "pixi.js";
import type { Size } from "../domain/types";

export function createBackdrop(stageSize: Size): Graphics {
  const graphics = new Graphics();
  graphics.rect(0, 0, stageSize.width, stageSize.height);
  graphics.fill({ color: 0xe7ece8 });

  // WHY: 主画布统一使用网点背景，去掉白灰分层与 viewport 语义，让用户聚焦 body+tatoo 单一坐标系统。
  // TRADE-OFF: 相比纯色底纹绘制多一些像素点，但可显著提升透明区域与边界可读性。
  for (let y = 10; y < stageSize.height; y += 16) {
    for (let x = 10; x < stageSize.width; x += 16) {
      graphics.circle(x, y, 1.2);
    }
  }
  graphics.fill({ color: 0xcad3cd, alpha: 0.55 });

  return graphics;
}
