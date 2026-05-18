export interface DepthModelCatalogItem {
  url: string;
  sizeBytes: number;
}

export interface DepthModelOption {
  id: string;
  url: string;
  label: string;
}

interface DepthModelCatalogResponse {
  models?: Array<Partial<DepthModelCatalogItem>>;
}

interface DepthModelCatalogInput {
  endpoint?: string;
  fetcher?: typeof fetch;
}

const defaultCatalogEndpoint = "/__depth-models";
const fallbackModelUrls = [
  "/models/depth-anything-v2-small.onnx",
  "/models/depth-anything-v2-small-q4f16.onnx",
];

export async function discoverDepthModelOptions(
  input?: DepthModelCatalogInput,
): Promise<DepthModelOption[]> {
  const endpoint = input?.endpoint ?? defaultCatalogEndpoint;
  const fetcher = input?.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return createFallbackOptions(null);
  }

  try {
    const response = await fetcher(endpoint, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`catalog request failed: ${response.status}`);
    }

    const payload = (await response.json()) as DepthModelCatalogResponse;
    const options = toDepthModelOptions(payload.models ?? []);
    if (options.length > 0) {
      return options;
    }
  } catch {
    // WHY: 目录接口不可用时回退到常见路径，确保本地调试流程不中断。
    // TRADE-OFF: 回退列表可能包含不存在文件，但至少能让用户继续手动切换与排查。
  }

  return createFallbackOptions(fetcher);
}

export function resolvePreferredDepthModel(options: DepthModelOption[]): DepthModelOption | null {
  if (options.length === 0) {
    return null;
  }

  const preferredUrlSuffixes = [
    "/models/depth-anything-v2-small.onnx",
    "/models/depth-anything-v2-small-q4f16.onnx",
  ];

  for (const suffix of preferredUrlSuffixes) {
    const match = options.find((option) => option.url === suffix);
    if (match) {
      return match;
    }
  }

  return options[0];
}

async function createFallbackOptions(fetcher: typeof fetch | null): Promise<DepthModelOption[]> {
  const availableUrls: string[] = [];
  if (fetcher) {
    for (const url of fallbackModelUrls) {
      if (await isLikelyReachableModel(url, fetcher)) {
        availableUrls.push(url);
      }
    }
  }

  if (availableUrls.length === 0) {
    availableUrls.push(fallbackModelUrls[0]);
  }

  return availableUrls.map((url, index) => ({
    id: `fallback-${index}`,
    url,
    label: createModelLabel(url, null),
  }));
}

function toDepthModelOptions(items: Array<Partial<DepthModelCatalogItem>>): DepthModelOption[] {
  const deduped = new Map<string, number | null>();
  for (const item of items) {
    const normalizedUrl = normalizePublicUrl(item.url);
    if (!normalizedUrl) {
      continue;
    }

    const sizeBytes = Number.isFinite(item.sizeBytes) ? Number(item.sizeBytes) : null;
    deduped.set(normalizedUrl, sizeBytes);
  }

  return Array.from(deduped.entries())
    .sort(([leftUrl], [rightUrl]) => leftUrl.localeCompare(rightUrl))
    .map(([url, sizeBytes], index) => ({
      id: `depth-model-${index}`,
      url,
      label: createModelLabel(url, sizeBytes),
    }));
}

function normalizePublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.endsWith(".onnx")) {
    return null;
  }
  if (!trimmed.startsWith("/models/")) {
    return null;
  }
  if (trimmed.includes("..")) {
    return null;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function createModelLabel(url: string, sizeBytes: number | null): string {
  const name = decodeURIComponent(url.split("/").at(-1) ?? url);
  if (!sizeBytes || sizeBytes <= 0) {
    return name;
  }

  const sizeMb = sizeBytes / (1024 * 1024);
  const rounded = sizeMb >= 100 ? sizeMb.toFixed(0) : sizeMb.toFixed(1);
  return `${name} (${rounded} MB)`;
}

async function isLikelyReachableModel(url: string, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(url, {
      method: "HEAD",
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
