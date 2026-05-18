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

declare module "simplify-js" {
  export default function simplify<T extends { x: number; y: number }>(
    points: T[],
    tolerance?: number,
    highQuality?: boolean,
  ): T[];
}

declare module "onnxruntime-web" {
  export const env: {
    wasm?: {
      wasmPaths?: {
        wasm?: string | URL;
        mjs?: string | URL;
      } | string;
    };
  };

  export const InferenceSession: {
    create(
      modelUrl: string,
      options?: {
        executionProviders?: string[];
      },
    ): Promise<{
      inputNames: string[];
      outputNames: string[];
      inputMetadata?: Record<string, { dimensions?: Array<number | string | null | undefined> }>;
      run(feeds: Record<string, unknown>): Promise<Record<string, {
        dims: readonly number[];
        data: Float32Array | number[] | Float64Array;
      }>>;
    }>;
  };

  export const Tensor: new (type: string, data: Float32Array, dims: readonly number[]) => unknown;
}

declare module "@mediapipe/tasks-vision" {
  export const FilesetResolver: {
    forVisionTasks(wasmPath: string): Promise<unknown>;
  };

  export const ImageSegmenter: {
    createFromOptions(fileset: never, options: unknown): Promise<any>;
  };

  export const PoseLandmarker: {
    createFromOptions(fileset: never, options: unknown): Promise<any>;
  };
}
