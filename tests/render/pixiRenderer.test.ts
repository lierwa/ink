import { describe, expect, test } from "vitest";
import {
  tattooBlendMode,
  createTattooShaderResources,
  tattooProjectionFragmentHeader,
  tattooProjectionFragmentMain,
} from "../../src/render/pixiRenderer";

describe("createTattooShaderResources", () => {
  test("wraps tattoo and sphere uniforms in a Pixi uniform group", () => {
    const resources = createTattooShaderResources({
      sphere: { cx: 450, cy: 310, r: 205 },
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
    expect("uSphere" in resources).toBe(false);
    expect(resources.tattooUniforms.uniforms.uSphere).toEqual(new Float32Array([450, 310, 205]));
    expect(resources.tattooUniforms.uniforms.uTattooSize).toEqual(new Float32Array([100, 80]));
    expect(resources.tattooUniforms.uniforms.uTattooTransform).toEqual(new Float32Array([450, 310, 1, 0]));
    expect(resources.tattooUniforms.uniforms.uTattooOpacity).toBe(0.84);
    expect(resources.tattooUniforms.isUniformGroup).toBe(true);
  });
});

describe("tattoo projection shader", () => {
  test("uses normal blending so rendering does not darken tattoo source pixels", () => {
    expect(tattooBlendMode).toBe("normal");
  });

  test("applies opacity to alpha only so line art RGB is not darkened", () => {
    expect(tattooProjectionFragmentMain).toContain("vec4 tattooColor = texture(uTexture, tattooUv)");
    expect(tattooProjectionFragmentMain).toContain("vec4(tattooColor.rgb, tattooColor.a * uTattooOpacity)");
    expect(tattooProjectionFragmentMain).not.toContain("texture(uTexture, tattooUv) * uTattooOpacity");
  });

  test("uses radial off-sphere clamping in shader normal reconstruction", () => {
    expect(tattooProjectionFragmentHeader).toContain("float xyLength = length(rawXy)");
    expect(tattooProjectionFragmentHeader).toContain(
      "vec2 xy = xyLength > 1.0 ? rawXy / xyLength : rawXy",
    );
  });

  test("keeps shader projection center pinned to the real silhouette when dragged outside", () => {
    expect(tattooProjectionFragmentHeader).toContain("projectionCenterToNormal");
    expect(tattooProjectionFragmentHeader).toContain("clampProjectionCenterXy");
    expect(tattooProjectionFragmentMain).toContain("projectionCenterToNormal(uTattooTransform.xy)");
  });

  test("uses adaptive screen-axis tangent basis in shader projection", () => {
    expect(tattooProjectionFragmentMain).toContain("vec3 projectedRight");
    expect(tattooProjectionFragmentMain).toContain("vec3 projectedDown");
    expect(tattooProjectionFragmentMain).toContain("rightLength >= downLength");
    expect(tattooProjectionFragmentMain).toContain("cross(centerNormal, unrotatedU)");
    expect(tattooProjectionFragmentMain).toContain("cross(unrotatedV, centerNormal)");
  });
});
