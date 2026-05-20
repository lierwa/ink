import { GeneralGcpTransformer } from "@allmaps/transform";
import type { Point } from "./types";

export interface TpsControlPoint {
  source: Point;
  destination: Point;
}

export interface ThinPlateSplineTransformer {
  transform(point: Point): Point;
}

export function createThinPlateSplineTransformer(controlPoints: TpsControlPoint[]): ThinPlateSplineTransformer {
  if (controlPoints.length < 3) {
    throw new Error("Thin plate spline tattoo warp needs at least 3 control points.");
  }

  // WHY: 将 Allmaps 的数组坐标和算法命名限制在适配层，业务代码只依赖 tattoo 域内的 Point。
  // TRADE-OFF: 这里保留一个很薄的封装，不暴露更多 Allmaps 选项，避免后续渲染链路被第三方 API 形状绑死。
  const transformer = new GeneralGcpTransformer(
    controlPoints.map((point) => ({
      source: [point.source.x, point.source.y],
      destination: [point.destination.x, point.destination.y],
    })),
    "thinPlateSpline",
    { differentHandedness: false },
  );

  return {
    transform(point) {
      const transformed = transformer.transformForward([point.x, point.y]);
      return { x: transformed[0], y: transformed[1] };
    },
  };
}
