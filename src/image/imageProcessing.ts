export function removeWhiteBackgroundFromPixels(
  pixels: Uint8ClampedArray,
  threshold = 235,
  opaqueAlphaThreshold = 220,
): Uint8ClampedArray {
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];

    if (alpha < opaqueAlphaThreshold) {
      continue;
    }

    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    const brightness = (red + green + blue) / 3;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);

    if (brightness >= threshold && chroma <= 20) {
      pixels[i + 3] = 0;
    }
  }

  return pixels;
}

export function removeWhiteBackground(imageData: ImageData, threshold = 235): ImageData {
  removeWhiteBackgroundFromPixels(imageData.data, threshold);
  return imageData;
}

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TattooImageProcessingOptions {
  removeWhite: boolean;
  maxContentSize: number;
  createCanvas?: () => HTMLCanvasElement;
}

export interface TattooImageResult {
  canvas: HTMLCanvasElement;
  sourceWidth: number;
  sourceHeight: number;
  contentBounds: ContentBounds;
  hadTransparency: boolean;
}

export async function imageFileToCanvas(
  file: File,
  removeWhite: boolean,
  options: Partial<Omit<TattooImageProcessingOptions, "removeWhite">> = {},
): Promise<TattooImageResult> {
  const image = await readFileAsImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

  return processTattooImageData(imageData, {
    removeWhite,
    maxContentSize: options.maxContentSize ?? 256,
    createCanvas: options.createCanvas,
  });
}

export function processTattooImageData(
  imageData: ImageData,
  options: TattooImageProcessingOptions,
): TattooImageResult {
  if (options.removeWhite) {
    removeWhiteBackground(imageData);
  }

  const bounds = findContentBounds(imageData);

  if (!bounds) {
    throw new Error("Uploaded image has no visible pixels.");
  }

  const createCanvas = options.createCanvas ?? (() => document.createElement("canvas"));
  const sourceCanvas = createCanvas();
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  const sourceContext = required2dContext(sourceCanvas);
  sourceContext.putImageData(imageData, 0, 0);

  const scale = Math.min(1, options.maxContentSize / Math.max(bounds.width, bounds.height));
  const outputWidth = Math.max(1, Math.round(bounds.width * scale));
  const outputHeight = Math.max(1, Math.round(bounds.height * scale));
  const outputCanvas = createCanvas();
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputContext = required2dContext(outputCanvas);
  outputContext.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  return {
    canvas: outputCanvas,
    sourceWidth: imageData.width,
    sourceHeight: imageData.height,
    contentBounds: bounds,
    hadTransparency: hasTransparency(imageData.data),
  };
}

function readFileAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not read ${file.name}: unsupported file data.`));
        return;
      }

      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not decode ${file.name} as PNG, JPG, or WebP.`));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function findContentBounds(imageData: ImageData): ContentBounds | null {
  let minX = imageData.width;
  let minY = imageData.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];

      if (alpha > 8) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function hasTransparency(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) {
      return true;
    }
  }

  return false;
}

function required2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }

  return context;
}
