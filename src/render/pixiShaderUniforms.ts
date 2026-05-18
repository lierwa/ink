import type { TattooShaderResources } from "./pixiRenderer";

type TattooVectorUniformKey = "uTattooSize" | "uTattooTransform";

export function ensureTattooSizeUniform(resources: TattooShaderResources): Float32Array {
  return ensureVectorUniform(resources, "uTattooSize", 2);
}

export function ensureTattooTransformUniform(resources: TattooShaderResources): Float32Array {
  return ensureVectorUniform(resources, "uTattooTransform", 4);
}

function ensureVectorUniform(
  resources: TattooShaderResources,
  key: TattooVectorUniformKey,
  length: number,
): Float32Array {
  const current = resources.tattooUniforms.uniforms[key];
  if (current instanceof Float32Array && current.length >= length) {
    return current;
  }

  // WHY: WebGL context 恢复/热更新后 Pixi 可能保留 UniformGroup 但把数组 uniform 置空；拖拽时必须能自愈。
  // TRADE-OFF: 只在异常态重新分配数组，正常帧仍复用原数组避免频繁 GC。
  const restored = new Float32Array(length);
  resources.tattooUniforms.uniforms[key] = restored;
  resources.tattooUniforms.uniformStructures[key].value = restored;
  return restored;
}
