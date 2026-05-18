import { readdir, stat } from "node:fs/promises";
import { extname, join, posix, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";

interface DepthModelCatalogItem {
  url: string;
  sizeBytes: number;
}

const depthModelCatalogEndpoint = "/__depth-models";
const supportedModelExt = ".onnx";

function depthModelCatalogPlugin(): Plugin {
  const registerCatalogMiddleware = (server: { middlewares: { use: (path: string, fn: (_req: unknown, res: any) => Promise<void>) => void }; config: { root: string } }): void => {
    server.middlewares.use(depthModelCatalogEndpoint, async (_req, res) => {
      try {
        // WHY: 前端运行在浏览器无法直接遍历 public 目录，改由 dev middleware 暴露只读模型索引。
        // TRADE-OFF: 该索引仅在 dev server 存在，但不引入额外后端依赖，保持工程最小复杂度。
        const models = await listDepthModelFiles(join(server.config.root, "public"));
        const payload = JSON.stringify({ models });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ models: [], error: message }));
      }
    });
  };

  return {
    name: "depth-model-catalog",
    configureServer(server) {
      registerCatalogMiddleware(server);
    },
    configurePreviewServer(server) {
      registerCatalogMiddleware(server);
    },
  };
}

async function listDepthModelFiles(publicRoot: string): Promise<DepthModelCatalogItem[]> {
  const modelsRoot = join(publicRoot, "models");
  const files = await walkDirectory(modelsRoot);
  const models = files
    .filter((file) => extname(file.absolutePath).toLowerCase() === supportedModelExt)
    .map((file) => ({
      url: toModelsPublicUrl(relative(modelsRoot, file.absolutePath)),
      sizeBytes: file.sizeBytes,
    }))
    .sort((left, right) => left.url.localeCompare(right.url));

  return models;
}

async function walkDirectory(root: string): Promise<Array<{ absolutePath: string; sizeBytes: number }>> {
  const stack = [root];
  const files: Array<{ absolutePath: string; sizeBytes: number }> = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (isMissingDirectory(error)) {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const metadata = await stat(absolutePath);
      files.push({ absolutePath, sizeBytes: metadata.size });
    }
  }

  return files;
}

function toModelsPublicUrl(relativePath: string): string {
  const normalized = relativePath.split("\\").join("/");
  return `/models/${posix.normalize(normalized)}`;
}

function isMissingDirectory(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "ENOENT",
  );
}

export default defineConfig({
  plugins: [depthModelCatalogPlugin()],
});
