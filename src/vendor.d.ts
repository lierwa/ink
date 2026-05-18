declare module "cdt2d" {
  type Triangle = [number, number, number];

  interface Cdt2dOptions {
    delaunay?: boolean;
    interior?: boolean;
    exterior?: boolean;
    infinity?: boolean;
  }

  export default function cdt2d(
    points: Array<[number, number]>,
    edges?: Array<[number, number]>,
    options?: Cdt2dOptions,
  ): Triangle[];
}

declare module "poisson-disk-sampling" {
  interface PoissonOptions {
    shape: [number, number];
    minDistance: number;
    maxDistance: number;
    tries?: number;
  }

  export default class PoissonDiskSampling {
    constructor(options: PoissonOptions);
    fill(): Array<[number, number]>;
  }
}
