import { radiansToDegrees } from "./editorTransform";
import { stageSize } from "./sphereConfig";
import type { TattooTransform } from "./domain/types";

export function createCanvasMarkup(): string {
  return `
    <div class="stage-shell">
      <div class="stage-stack" id="stageStack">
        <div class="pixi-layer" id="pixiLayer"></div>
        <canvas id="fabricLayer" width="${stageSize.width}" height="${stageSize.height}" aria-label="Fabric tattoo editor layer"></canvas>
      </div>
    </div>
  `;
}

export function createAppMarkup(
  initialTransform: TattooTransform,
): string {
  return `
    <main class="studio-shell">
      <section class="preview-panel" aria-label="Body tattoo preview">
        <div class="preview-toolbar">
          <div>
            <p class="eyebrow">Body Upload Pipeline</p>
            <h1>Body + Tattoo Editor</h1>
          </div>
          <div class="status-pill" id="status">Upload tattoo to enable transform controls</div>
        </div>
        <div class="canvas-frame" id="canvasFrame"></div>
      </section>

      <aside class="control-panel" aria-label="Tattoo controls">
        <div class="control-group">
          <label class="file-drop">
            <span>Upload body photo</span>
            <input id="bodyUpload" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <div class="upload-status" id="bodyUploadStatus">No body uploaded</div>
          <div class="action-row">
            <button id="editBody" type="button">Edit mesh</button>
            <button id="removeBody" type="button">Remove</button>
          </div>
          <label class="file-drop">
            <span>Upload tattoo</span>
            <input id="tattooUpload" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <div class="upload-status" id="tattooUploadStatus">No tattoo uploaded</div>
          <div class="action-row">
            <button id="editTattoo" type="button" disabled>Edit crop</button>
            <button id="removeTattoo" type="button" disabled>Remove</button>
          </div>
          <label class="toggle-line">
            <input id="debugMesh" type="checkbox" />
            <span>Show body mesh</span>
          </label>
        </div>

        <div id="tattooTransformPanel" data-tattoo-transform-panel hidden>
          <div class="control-group">
            <label>
              <span>Opacity</span>
              <input id="opacity" type="range" min="0.25" max="1" step="0.01" value="${initialTransform.opacity}" />
            </label>
            <label class="toggle-line">
              <input id="shadingGeometryAssist" type="checkbox" />
              <span>光影曲面辅助</span>
            </label>
            <label>
              <span>Warp strength <output id="warpStrengthValue">1.00</output></span>
              <input id="warpStrength" type="range" min="0" max="2" step="0.01" value="1" />
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

          <button id="reset" type="button">Reset transform</button>
        </div>
      </aside>
    </main>
  `;
}
