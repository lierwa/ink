import { describe, expect, test } from "vitest";
import {
  applyTattooState,
  clearTattooState,
  configureBodyMaskForMasking,
  createMeshGeometry,
  mapSphereMeshToSkinMesh,
  resolveProjectionMesh,
  createTattooShaderResources,
  createSkinWireframeSegments,
  hiddenMaskRenderableFlag,
  hiddenMaskRenderableVisible,
  tattooBlendMode,
  tattooProjectionFragmentHeader,
  tattooProjectionFragmentMain,
} from "../../src/render/pixiRenderer";
import type { SkinMeshData } from "../../src/domain/types";
import { Texture } from "pixi.js";
import { buildSphereMesh } from "../../src/domain/sphereMesh";

describe("createTattooShaderResources", () => {
  test("wraps tattoo uniforms in a Pixi uniform group", () => {
    const resources = createTattooShaderResources({
      tattooSize: { width: 100, height: 80 },
      transform: {
        x: 450,
        y: 310,
        scale: 1,
        rotation: 0,
        opacity: 0.84,
      },
    });

    expect("uTattooSize" in resources).toBe(false);
    expect(resources.tattooUniforms.uniforms.uTattooSize).toEqual(new Float32Array([100, 80]));
    expect(resources.tattooUniforms.uniforms.uTattooTransform).toEqual(new Float32Array([450, 310, 1, 0]));
    expect(resources.tattooUniforms.uniforms.uTattooOpacity).toBe(0.84);
    expect(resources.tattooUniforms.isUniformGroup).toBe(true);
  });
});

describe("tattoo renderer constants", () => {
  test("uses normal blending so rendering does not darken tattoo source pixels", () => {
    expect(tattooBlendMode).toBe("normal");
  });

  test("keeps mask active for clipping without drawing it as a second body layer", () => {
    const mask = { visible: false, renderable: true } as any;
    configureBodyMaskForMasking(mask);
    expect(mask.visible).toBe(hiddenMaskRenderableVisible);
    expect(mask.renderable).toBe(hiddenMaskRenderableFlag);
  });
});

describe("tattoo shader state binding", () => {
  test("setTattoo path updates uniforms and texture binding in one pass", () => {
    const resources = createTattooShaderResources({
      tattooSize: { width: 12, height: 9 },
      transform: {
        x: 450,
        y: 310,
        scale: 1,
        rotation: 0,
        opacity: 0.84,
      },
    });
    const source = { id: "next-texture" } as unknown as Texture["source"];
    const shader = { resources: { uTexture: Texture.EMPTY.source } };

    applyTattooState(resources, shader, {
      texture: { source } as unknown as Texture,
      tattooSize: { width: 220, height: 180 },
      transform: {
        x: 402,
        y: 198,
        scale: 0.52,
        rotation: 0.27,
        opacity: 0.67,
      },
    });

    expect(shader.resources.uTexture).toBe(source);
    expect(resources.tattooUniforms.uniforms.uTattooSize).toEqual(new Float32Array([220, 180]));
    expect(resources.tattooUniforms.uniforms.uTattooTransform).toEqual(new Float32Array([402, 198, 0.52, 0.27]));
    expect(resources.tattooUniforms.uniforms.uTattooOpacity).toBe(0.67);
  });

  test("clearTattoo path clears opacity and rebinds empty texture", () => {
    const resources = createTattooShaderResources({
      tattooSize: { width: 12, height: 9 },
      transform: {
        x: 450,
        y: 310,
        scale: 1,
        rotation: 0,
        opacity: 0.84,
      },
    });
    const source = { id: "next-texture" } as unknown as Texture["source"];
    const shader = { resources: { uTexture: source } };

    clearTattooState(resources, shader);
    expect(resources.tattooUniforms.uniforms.uTattooOpacity).toBe(0);
    expect(shader.resources.uTexture).toBe(Texture.EMPTY.source);
  });
});

describe("tattoo projection shader", () => {
  test("samples tattoo through mesh-domain 2D projection instead of sphere normal projection", () => {
    expect(tattooProjectionFragmentMain).toContain("vec2 localPoint = (vSurfacePoint - uTattooTransform.xy) / safeScale");
    expect(tattooProjectionFragmentMain).toContain("vec2 rotatedPoint = vec2(");
    expect(tattooProjectionFragmentMain).toContain("vec4 tattooColor = texture(uTexture, tattooUv)");
    expect(tattooProjectionFragmentMain).toContain("vec4(tattooColor.rgb, tattooColor.a * uTattooOpacity)");
  });

  test("does not depend on sphere uniforms in the main projection path", () => {
    expect(tattooProjectionFragmentHeader).toContain("in vec2 vSurfacePoint;");
    expect(tattooProjectionFragmentHeader).not.toContain("uniform vec3 uSphere;");
  });
});

describe("createSkinWireframeSegments", () => {
  test("deduplicates triangle edges into a stable line-segment buffer", () => {
    const mesh: SkinMeshData = {
      positions: new Float32Array([
        0, 0,
        1, 0,
        0, 1,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    };

    const segments = createSkinWireframeSegments(mesh);
    expect(segments.length).toBe(12);
  });
});

describe("projection mesh fallback", () => {
  test("falls back to default projection mesh when body mesh is unavailable or invalid", () => {
    const fallback: SkinMeshData = {
      positions: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const invalidMesh: SkinMeshData = {
      positions: new Float32Array([0, 0, 1, 0]),
      indices: new Uint32Array([0, 1]),
    };

    expect(resolveProjectionMesh(null, fallback)).toBe(fallback);
    expect(resolveProjectionMesh(invalidMesh, fallback)).toBe(fallback);
  });

  test("uses body mesh as active projection mesh when triangles are valid", () => {
    const fallback: SkinMeshData = {
      positions: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const bodyMesh: SkinMeshData = {
      positions: new Float32Array([10, 20, 120, 20, 12, 130]),
      indices: new Uint32Array([0, 1, 2]),
    };

    expect(resolveProjectionMesh(bodyMesh, fallback)).toBe(bodyMesh);
  });
});

describe("projection mesh geometry", () => {
  test("maps sphere mesh into default skin mesh shape for renderer fallback", () => {
    const sphereMesh = buildSphereMesh({
      sphere: { cx: 450, cy: 310, r: 205 },
      resolution: { radialSegments: 4, angularSegments: 12 },
    });
    const mesh = mapSphereMeshToSkinMesh(sphereMesh);

    expect(mesh.positions).toEqual(sphereMesh.positions);
    expect(mesh.indices).toEqual(sphereMesh.indices);
  });

  test("builds geometry from active projection mesh positions and indices", () => {
    const mesh: SkinMeshData = {
      positions: new Float32Array([10, 20, 120, 20, 10, 100]),
      indices: new Uint32Array([0, 1, 2]),
    };

    const geometry = createMeshGeometry(mesh, { width: 900, height: 620 });
    const attributes = geometry.getBuffer("aUV").data;

    expect(geometry.getBuffer("aPosition").data).toEqual(mesh.positions);
    expect(geometry.indexBuffer.data).toEqual(mesh.indices);
    expect(attributes).toEqual(new Float32Array([10 / 900, 20 / 620, 120 / 900, 20 / 620, 10 / 900, 100 / 620]));
  });
});
