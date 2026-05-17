export interface LineArtCleanupOptions {
  whitePoint: number;
  opaqueAlphaThreshold: number;
  neutralChromaLimit: number;
  backgroundTolerance: number;
  inkBlackPoint: number;
  alphaGamma: number;
}

export const defaultLineArtCleanupOptions: LineArtCleanupOptions = {
  whitePoint: 245,
  opaqueAlphaThreshold: 180,
  neutralChromaLimit: 34,
  backgroundTolerance: 18,
  inkBlackPoint: 28,
  alphaGamma: 0.88,
};

export function cleanupLineArtBackground(
  imageData: ImageData,
  options: LineArtCleanupOptions = defaultLineArtCleanupOptions,
): ImageData {
  const paperLuminance = estimatePaperLuminance(
    imageData.data,
    imageData.width,
    imageData.height,
    options,
  );
  cleanupLineArtBackgroundFromPixels(imageData.data, options, paperLuminance);
  return imageData;
}

export function cleanupLineArtBackgroundFromPixels(
  pixels: Uint8ClampedArray,
  options: LineArtCleanupOptions = defaultLineArtCleanupOptions,
  paperLuminance = options.whitePoint,
): Uint8ClampedArray {
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    const alpha = pixels[i + 3];

    if (alpha < options.opaqueAlphaThreshold) {
      continue;
    }

    const brightness = getLuminance(red, green, blue);
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    const isNeutralPaper = chroma <= options.neutralChromaLimit;

    if (isNeutralPaper && brightness >= paperLuminance - options.backgroundTolerance) {
      pixels[i + 3] = 0;
      continue;
    }

    if (isNeutralPaper) {
      // WHY: 线稿的白边来自“半透明边缘仍携带纸白 RGB”。这里采用 GIMP Color to Alpha 的思路：
      // 把纸色从 RGB 转移到 alpha，贴到有底色的球面时就不会出现白色描边。
      // TRADE-OFF: 中性灰线稿会被规范为黑色墨线 + 不同 alpha，优先解决纹身贴图的纸边污染。
      const inkStrength = getInkStrength(brightness, paperLuminance, options);
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      pixels[i + 3] = Math.round(alpha * inkStrength);
    }
  }

  return pixels;
}

function getInkStrength(
  brightness: number,
  paperLuminance: number,
  options: LineArtCleanupOptions,
): number {
  const denominator = Math.max(1, paperLuminance - options.inkBlackPoint);
  const linearInk = clamp((paperLuminance - brightness) / denominator, 0, 1);
  return Math.pow(linearInk, options.alphaGamma);
}

function estimatePaperLuminance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: LineArtCleanupOptions,
): number {
  const samples: number[] = [];
  const maxX = Math.max(0, width - 1);
  const maxY = Math.max(0, height - 1);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));

  for (let x = 0; x < width; x += step) {
    pushNeutralSample(samples, pixels, width, x, 0, options);
    pushNeutralSample(samples, pixels, width, x, maxY, options);
  }

  for (let y = 0; y < height; y += step) {
    pushNeutralSample(samples, pixels, width, 0, y, options);
    pushNeutralSample(samples, pixels, width, maxX, y, options);
  }

  if (samples.length === 0) {
    return options.whitePoint;
  }

  samples.sort((a, b) => a - b);
  return Math.max(options.inkBlackPoint + 1, samples[Math.floor(samples.length * 0.82)]);
}

function pushNeutralSample(
  samples: number[],
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  options: LineArtCleanupOptions,
): void {
  const index = (y * width + x) * 4;
  const alpha = pixels[index + 3];

  if (alpha < options.opaqueAlphaThreshold) {
    return;
  }

  const red = pixels[index];
  const green = pixels[index + 1];
  const blue = pixels[index + 2];
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);

  if (chroma <= options.neutralChromaLimit) {
    samples.push(getLuminance(red, green, blue));
  }
}

function getLuminance(red: number, green: number, blue: number): number {
  return red * 0.299 + green * 0.587 + blue * 0.114;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
