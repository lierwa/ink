import { radiansToDegrees } from "./editorTransform";
import { meshResolutionLimits } from "./domain/sphereMesh";
import { meshResolution, stageSize } from "./sphereConfig";
import type { TattooTransform } from "./domain/types";

export function createCanvasMarkup(): string {
  return `
    <div class="viewport-surface" id="viewportSurface">
      <div class="stage-stack" id="stageStack">
        <div class="pixi-layer" id="pixiLayer"></div>
        <canvas id="fabricLayer" width="${stageSize.width}" height="${stageSize.height}" aria-label="Fabric tattoo editor layer"></canvas>
      </div>
    </div>
  `;
}

export function createAppMarkup(initialTransform: TattooTransform): string {
  return `
    <main class="studio-shell">
      <section class="preview-panel" aria-label="Pixi preview">
        <div class="preview-toolbar">
          <div>
            <p class="eyebrow">PixiJS Sphere Mesh</p>
            <h1>Sphere tattoo preview</h1>
          </div>
          <div class="status-pill" id="status">default linework</div>
        </div>
        <div class="canvas-frame" id="canvasFrame"></div>
      </section>

      <aside class="control-panel" aria-label="Tattoo controls">
        <div class="control-group">
          <label class="file-drop">
            <span>Upload tattoo PNG/JPG</span>
            <input id="tattooUpload" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <input id="removeWhite" type="checkbox" checked hidden />
          <label class="toggle-line">
            <input id="debugMesh" type="checkbox" />
            <span>Show sphere mesh</span>
          </label>
        </div>

        <div class="control-group">
          <label>
            <span>Opacity</span>
            <input id="opacity" type="range" min="0.25" max="1" step="0.01" value="${initialTransform.opacity}" />
          </label>
        </div>

        <div class="control-group param-grid">
          <label>
            <span>X</span>
            <input id="paramX" type="number" step="1" value="${Math.round(initialTransform.x)}" />
          </label>
          <label>
            <span>Y</span>
            <input id="paramY" type="number" step="1" value="${Math.round(initialTransform.y)}" />
          </label>
          <label>
            <span>Scale</span>
            <input id="paramScale" type="number" min="0.1" max="2.4" step="0.01" value="${initialTransform.scale}" />
          </label>
          <label>
            <span>Rotation</span>
            <input id="paramRotation" type="number" step="1" value="${Math.round(radiansToDegrees(initialTransform.rotation))}" />
          </label>
          <label>
            <span>Opacity</span>
            <input id="paramOpacity" type="number" min="0.25" max="1" step="0.01" value="${initialTransform.opacity}" />
          </label>
        </div>

        <div class="control-group surface-grid-group">
          <div>
            <span class="control-heading">Surface Grid</span>
            <p class="control-help">Tattoo projection is calculated per pixel. Grid density affects debug lines and surface boundary precision.</p>
          </div>
          <label>
            <span>Radial Lines</span>
            <input id="radialSegments" type="number" min="${meshResolutionLimits.radialSegments.min}" max="${meshResolutionLimits.radialSegments.max}" step="1" value="${meshResolution.radialSegments}" />
          </label>
          <label>
            <span>Angular Lines</span>
            <input id="angularSegments" type="number" min="${meshResolutionLimits.angularSegments.min}" max="${meshResolutionLimits.angularSegments.max}" step="1" value="${meshResolution.angularSegments}" />
          </label>
        </div>

        <button id="reset" type="button">Reset transform</button>
      </aside>
    </main>
  `;
}
