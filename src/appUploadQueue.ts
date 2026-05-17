import type { TattooTransform } from "./domain/types";

const transformEpsilon = 0.000001;

export type FabricImageUpdate = (shouldCommit: () => boolean) => Promise<boolean>;
export type RunCurrentFabricUpdate = (requestId: number, update: FabricImageUpdate) => Promise<boolean>;

export interface UploadTransformState {
  tattooTransform: TattooTransform;
  transformRevision: number;
}

export function createFabricUpdateQueue(
  isCurrentRequest: (requestId: number) => boolean,
): RunCurrentFabricUpdate {
  let pendingUpdate = Promise.resolve();

  return (requestId, update) => {
    const queuedUpdate = pendingUpdate.then(async () => {
      if (!isCurrentRequest(requestId)) {
        return false;
      }

      return update(() => isCurrentRequest(requestId));
    });
    pendingUpdate = queuedUpdate.then(noop, noop);
    return queuedUpdate;
  };
}

export function getUploadCommitTransform(
  state: UploadTransformState,
  startTransformRevision: number,
): TattooTransform {
  const latestTransform = { ...state.tattooTransform };
  return state.transformRevision === startTransformRevision
    ? { ...latestTransform, scale: 1 }
    : latestTransform;
}

export function getDefaultCommitTransform(
  state: UploadTransformState,
  startTransformRevision: number,
  initialTransform: TattooTransform,
): TattooTransform {
  return state.transformRevision === startTransformRevision
    ? { ...initialTransform }
    : { ...state.tattooTransform };
}

export function isSameTattooTransform(first: TattooTransform, second: TattooTransform): boolean {
  return (
    isNearlyEqual(first.x, second.x) &&
    isNearlyEqual(first.y, second.y) &&
    isNearlyEqual(first.scale, second.scale) &&
    isNearlyEqual(first.rotation, second.rotation) &&
    isNearlyEqual(first.opacity, second.opacity)
  );
}

function isNearlyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= transformEpsilon;
}

function noop(): void {
}
