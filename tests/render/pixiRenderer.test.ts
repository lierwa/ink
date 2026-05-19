import { describe, expect, test, vi } from "vitest";
import {
  applyTattooState,
  clearTattooState,
  configureBodyMaskForMasking,
  createMeshGeometry,
  mapSphereMeshToSkinMesh,
  resolveProjectionMesh,
  resolveSurfaceWarpEnabled,
  applySurfaceNormalTextureState,
  applyTattooSpriteState,
  clearTattooSpriteState,
  applyTattooMeshVisibilityState,
  createSkinMaskAlphaPixels,
  createTattooShaderResources,
  createSkinWireframeSegments,
  createBodyAnalysisDebugSegments,
  hiddenMaskRenderableFlag,
  hiddenMaskRenderableVisible,
  tattooBlendMode,
  tattooProjectionFragmentHeader,
  tattooProjectionFragmentMain,
} from "../../src/render/pixiRenderer";
import { activeDebugMeshStrokeStyle, drawActiveDebugMesh, syncDebugMeshWireframe } from "../../src/render/pixiDebugGeometry";
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
      surfaceDepth: 0.68,
    });

    expect("uTattooSize" in resources).toBe(false);
    expect(resources.tattooUniforms.uniforms.uTattooSize).toEqual(new Float32Array([100, 80]));
    expect(resources.tattooUniforms.uniforms.uTattooTransform).toEqual(new Float32Array([450, 310, 1, 0]));
    expect(resources.tattooUniforms.uniforms.uTattooOpacity).toBe(0.84);
    expect(resources.tattooUniforms.uniforms.uSurfaceEnabled).toBe(0);
    expect(resources.tattooUniforms.uniforms.uSurfaceDepth).toBe(0.68);
    expect("uSurfaceIntensity" in resources.tattooUniforms.uniforms).toBe(false);
    expect(resources.tattooUniforms.uniforms.uMaxWarpPx).toBe(56);
    expect(resources.tattooUniforms.isUniformGroup).toBe(true);
  });
});

describe("skin mask clipping texture", () => {
  test("encodes skin probabilities into alpha while keeping mask color opaque", () => {
    const pixels = createSkinMaskAlphaPixels({
      width: 2,
      height: 2,
      probabilities: new Float32Array([0, 0.25, 0.5, 1]),
    });

    expect(Array.from(pixels)).toEqual([
      255, 255, 255, 0,
      255, 255, 255, 64,
      255, 255, 255, 128,
      255, 255, 255, 255,
    ]);
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
      surfaceDepth: 0.68,
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

  test("setTattoo path restores vector uniforms after Pixi clears cached arrays", () => {
    const resources = createTattooShaderResources({
      tattooSize: { width: 12, height: 9 },
      transform: {
        x: 450,
        y: 310,
        scale: 1,
        rotation: 0,
        opacity: 0.84,
      },
      surfaceDepth: 0.68,
    });
    resources.tattooUniforms.uniforms.uTattooSize = null as unknown as Float32Array;
    resources.tattooUniforms.uniforms.uTattooTransform = null as unknown as Float32Array;
    const source = { id: "next-texture" } as unknown as Texture["source"];
    const shader = { resources: { uTexture: Texture.WHITE.source } };

    applyTattooState(resources, shader, {
      texture: { source } as unknown as Texture,
      tattooSize: { width: 320, height: 140 },
      transform: {
        x: 420,
        y: 260,
        scale: 0.74,
        rotation: 0.15,
        opacity: 0.72,
      },
    });

    expect(resources.tattooUniforms.uniforms.uTattooSize).toEqual(new Float32Array([320, 140]));
    expect(resources.tattooUniforms.uniforms.uTattooTransform).toEqual(new Float32Array([420, 260, 0.74, 0.15]));
    expect(resources.tattooUniforms.uniforms.uTattooOpacity).toBe(0.72);
    expect(shader.resources.uTexture).toBe(source);
  });

  test("clearTattoo path clears opacity and rebinds a real fallback texture", () => {
    const resources = createTattooShaderResources({
      tattooSize: { width: 12, height: 9 },
      transform: {
        x: 450,
        y: 310,
        scale: 1,
        rotation: 0,
        opacity: 0.84,
      },
      surfaceDepth: 0.68,
    });
    const source = { id: "next-texture" } as unknown as Texture["source"];
    const shader = { resources: { uTexture: source } };

    clearTattooState(resources, shader);
    expect(resources.tattooUniforms.uniforms.uTattooOpacity).toBe(0);
    expect(shader.resources.uTexture).toBe(Texture.WHITE.source);
  });
});

describe("tattoo sprite visibility fallback", () => {
  test("setTattoo path makes the shader mesh visible from tattoo opacity", () => {
    const mesh = { visible: false };

    applyTattooMeshVisibilityState(mesh, 0.67);
    expect(mesh.visible).toBe(true);

    applyTattooMeshVisibilityState(mesh, 0);
    expect(mesh.visible).toBe(false);
  });

  test("setTattoo path also updates a plain visible Pixi sprite", () => {
    const source = { id: "tattoo-texture" } as unknown as Texture["source"];
    const texture = { source } as unknown as Texture;
    const sprite = {
      texture: Texture.EMPTY,
      anchor: { set: vi.fn() },
      scale: { set: vi.fn() },
      x: 0,
      y: 0,
      rotation: 0,
      alpha: 0,
      visible: false,
    };

    applyTattooSpriteState(sprite as never, {
      texture,
      tattooSize: { width: 220, height: 180 },
      transform: {
        x: 402,
        y: 198,
        scale: 0.52,
        rotation: 0.27,
        opacity: 0.67,
      },
    });

    expect(sprite.texture).toBe(texture);
    expect(sprite.anchor.set).toHaveBeenCalledWith(0.5);
    expect(sprite.scale.set).toHaveBeenCalledWith(0.52);
    expect(sprite.x).toBe(402);
    expect(sprite.y).toBe(198);
    expect(sprite.rotation).toBe(0.27);
    expect(sprite.alpha).toBe(0.67);
    expect(sprite.visible).toBe(true);
  });

  test("plain sprite fallback is hidden while surface warp is active so it cannot cover the shader mesh", () => {
    const source = { id: "tattoo-texture" } as unknown as Texture["source"];
    const texture = { source } as unknown as Texture;
    const sprite = {
      texture: Texture.EMPTY,
      anchor: { set: vi.fn() },
      scale: { set: vi.fn() },
      x: 0,
      y: 0,
      rotation: 0,
      alpha: 0,
      visible: true,
    };

    applyTattooSpriteState(sprite as never, {
      texture,
      tattooSize: { width: 220, height: 180 },
      transform: {
        x: 402,
        y: 198,
        scale: 0.52,
        rotation: 0.27,
        opacity: 0.67,
      },
    }, { surfaceWarpEnabled: true });

    expect(sprite.visible).toBe(false);
  });

  test("clearTattoo path hides the plain sprite fallback", () => {
    const sprite = {
      texture: Texture.WHITE,
      alpha: 1,
      visible: true,
    };

    clearTattooSpriteState(sprite as never);

    expect(sprite.texture).toBe(Texture.EMPTY);
    expect(sprite.alpha).toBe(0);
    expect(sprite.visible).toBe(false);
  });
});

describe("tattoo projection shader", () => {
  test("samples tattoo through bounded normal offset and clamps warp distance", () => {
    expect(tattooProjectionFragmentMain).toContain("vec2 localPoint = (vSurfacePoint - uTattooTransform.xy) / safeScale");
    expect(tattooProjectionFragmentMain).toContain("vec4 encodedNormal = texture(uSurfaceNormalTex, vSurfaceUv)");
    expect(tattooProjectionFragmentMain).toContain("if (encodedNormal.a > 0.0)");
    expect(tattooProjectionFragmentMain).not.toContain("uSurfaceIntensity");
    expect(tattooProjectionFragmentMain).toContain("float fitStrength = clamp(uSurfaceDepth * 0.72, 0.0, 1.0)");
    expect(tattooProjectionFragmentMain).toContain("float surfaceLight = 1.0");
    expect(tattooProjectionFragmentMain).toContain("surfaceLight = clamp(dot(surfaceNormal, normalize(vec3(-0.35, -0.25, 0.9))) * 0.38 + 0.72, 0.72, 1.12)");
    expect(tattooProjectionFragmentMain).toContain("vec2 warpOffsetPx = surfaceNormal.xy * warpScalePx");
    expect(tattooProjectionFragmentMain).toContain("float appliedWarpLimit = min(64.0, uMaxWarpPx)");
    expect(tattooProjectionFragmentMain).toContain("if (warpLength > appliedWarpLimit)");
    expect(tattooProjectionFragmentMain).toContain("warpedPoint = localPoint + warpOffsetPx");
    expect(tattooProjectionFragmentMain).toContain("vec4 tattooColor = texture(uTexture, tattooUv)");
    expect(tattooProjectionFragmentMain).toContain("vec4(tattooColor.rgb * surfaceLight, tattooColor.a * uTattooOpacity)");
    expect(tattooProjectionFragmentMain).not.toContain("1.0 / forward");
    expect(tattooProjectionFragmentMain).not.toContain("surfaceNormal.xy * normalizedPoint");
    expect(tattooProjectionFragmentMain).not.toContain("vec2 radial = vec2(localPoint.x * abs(localPoint.x), localPoint.y * abs(localPoint.y))");
  });

  test("does not depend on sphere uniforms in the main projection path", () => {
    expect(tattooProjectionFragmentHeader).toContain("in vec2 vSurfacePoint;");
    expect(tattooProjectionFragmentHeader).toContain("in vec2 vSurfaceUv;");
    expect(tattooProjectionFragmentHeader).not.toContain("uniform vec3 uSphere;");
    expect(tattooProjectionFragmentHeader).toContain("uniform sampler2D uSurfaceNormalTex;");
    expect(tattooProjectionFragmentHeader).not.toContain("uSurfaceIntensity");
    expect(tattooProjectionFragmentHeader).toContain("uniform float uMaxWarpPx;");
  });
});

describe("surface warp enable guard", () => {
  test("disables warp when debug switch is enabled", () => {
    const enabled = resolveSurfaceWarpEnabled({
      disableSurfaceWarp: true,
      surfaceNormalTexture: Texture.WHITE,
    });
    expect(enabled).toBe(false);
  });

  test("keeps warp enabled when normal texture exists even with invalid explicit uv", () => {
    const enabled = resolveSurfaceWarpEnabled({
      disableSurfaceWarp: false,
      surfaceNormalTexture: Texture.WHITE,
    });
    expect(enabled).toBe(true);
  });

  test("enables warp when normal texture exists and mesh data is finite", () => {
    const enabled = resolveSurfaceWarpEnabled({
      disableSurfaceWarp: false,
      surfaceNormalTexture: Texture.WHITE,
    });
    expect(enabled).toBe(true);
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

  test("draws body mesh wireframe with the same subtle orange style as body editor", () => {
    const graphics = {
      clear: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: (style: unknown) => {
        strokes.push(style);
      },
    };
    const strokes: unknown[] = [];
    const mesh: SkinMeshData = {
      positions: new Float32Array([
        0, 0,
        1, 0,
        0, 1,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    };

    drawActiveDebugMesh(graphics as never, mesh);

    expect(createSkinWireframeSegments(mesh).length).toBeGreaterThan(0);
    expect(strokes).toEqual([activeDebugMeshStrokeStyle]);
    expect(activeDebugMeshStrokeStyle).toEqual({ color: 0xd04f24, width: 1, alpha: 0.74 });
  });

  test("syncs debug mesh visibility by redrawing the current body mesh", () => {
    const strokes: unknown[] = [];
    const moves: Array<[number, number]> = [];
    const graphics = {
      visible: false,
      clear: vi.fn(),
      moveTo: (x: number, y: number) => moves.push([x, y]),
      lineTo: vi.fn(),
      stroke: (style: unknown) => strokes.push(style),
    };
    const mesh: SkinMeshData = {
      positions: new Float32Array([
        4, 5,
        14, 5,
        4, 15,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    };

    syncDebugMeshWireframe(graphics as never, true, mesh);

    expect(graphics.visible).toBe(true);
    expect(graphics.clear).toHaveBeenCalled();
    expect(moves[0]).toEqual([4, 5]);
    expect(strokes).toEqual([activeDebugMeshStrokeStyle]);

    syncDebugMeshWireframe(graphics as never, false, mesh);

    expect(graphics.visible).toBe(false);
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
    expect(mesh.uvs).toEqual(sphereMesh.sphereUv);
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

  test("prefers mesh uvs when provided", () => {
    const mesh: SkinMeshData = {
      positions: new Float32Array([10, 20, 120, 20, 10, 100]),
      uvs: new Float32Array([0.1, 0.2, 0.8, 0.2, 0.1, 0.9]),
      indices: new Uint32Array([0, 1, 2]),
    };

    const geometry = createMeshGeometry(mesh, { width: 900, height: 620 });
    expect(geometry.getBuffer("aUV").data).toEqual(mesh.uvs);
  });

  test("falls back to stage uv mapping when mesh uv values are invalid", () => {
    const mesh: SkinMeshData = {
      positions: new Float32Array([10, 20, 120, 20, 10, 100]),
      uvs: new Float32Array([0.1, 0.2, Number.NaN, 0.2, 0.1, 0.9]),
      indices: new Uint32Array([0, 1, 2]),
    };

    const geometry = createMeshGeometry(mesh, { width: 900, height: 620 });
    expect(geometry.getBuffer("aUV").data).toEqual(
      new Float32Array([10 / 900, 20 / 620, 120 / 900, 20 / 620, 10 / 900, 100 / 620]),
    );
  });
});

describe("surface normal texture binding", () => {
  test("updates only surface normal uniforms and resource binding", () => {
    const resources = createTattooShaderResources({
      tattooSize: { width: 12, height: 9 },
      transform: {
        x: 450,
        y: 310,
        scale: 1,
        rotation: 0,
        opacity: 0.84,
      },
      surfaceDepth: 0.68,
    });
    const shader = { resources: { uSurfaceNormalTex: Texture.EMPTY.source } };

    applySurfaceNormalTextureState(resources, shader, Texture.WHITE);

    expect(resources.uSurfaceNormalTex).toBe(Texture.WHITE.source);
    expect(shader.resources.uSurfaceNormalTex).toBe(Texture.WHITE.source);
    expect(resources.tattooUniforms.uniforms.uSurfaceEnabled).toBe(1);

    applySurfaceNormalTextureState(resources, shader, null);

    expect(resources.uSurfaceNormalTex).toBe(Texture.WHITE.source);
    expect(shader.resources.uSurfaceNormalTex).toBe(Texture.WHITE.source);
    expect(resources.tattooUniforms.uniforms.uSurfaceEnabled).toBe(0);
  });
});

describe("body analysis debug geometry", () => {
  test("emits only the selected local surface axis segment", () => {
    const segments = createBodyAnalysisDebugSegments({
      source: "local-mesh",
      confidence: 0.42,
      patchBounds: { x: 40, y: 50, width: 80, height: 120 },
      axis: {
        origin: { x: 80, y: 110 },
        direction: { x: 0, y: 1 },
        length: 120,
      },
    });

    expect(Array.from(segments)).toEqual([80, 110, 80, 230]);
  });
});
