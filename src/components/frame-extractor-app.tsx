"use client";

import JSZip from "jszip";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { SkeuSelect } from "@/components/skeu-select";
import { isAllowedMediaProxyUrl } from "@/lib/media-hosts";
import {
  buildStoryboard,
  buildStoryboardFromTimestamps,
  createPlaceholderFrameDataUrl,
  formatTimestamp,
  slugifyTimestamp,
  type ResolveSourceResponse,
  type StoryboardFrame,
  type StoryboardMode,
} from "@/lib/frame-extractor";

type CapturedStoryboardFrame = StoryboardFrame & {
  filename: string;
  imageDataUrl: string;
};

type ExportFormat = "png" | "jpeg" | "webp";
type QualityMode = "Fast" | "Balanced" | "Best";

type SceneSample = {
  adaptiveRatio: number;
  boundaryStrength: number;
  brightness: number;
  contentScore: number;
  edgeEnergy: number;
  localMotion: number;
  sharpness: number;
  timestamp: number;
  zScore: number;
};

type SceneDetectionConfig = {
  adaptiveThreshold: number;
  analysisWidth: number;
  minContentFloor: number;
  minSpacing: number;
  sampleStep: number;
  targetCount: number;
  windowRadius: number;
  zThreshold: number;
};

type FrameSignature = {
  brightness: number;
  edgeEnergy: number;
  edges: Float32Array;
  height: number;
  histogram: Float32Array;
  luma: Uint8Array;
  sharpness: number;
  width: number;
};

const TIMELINE_ZOOM_MIN = 1;
const TIMELINE_ZOOM_MAX = 16;

const TICK_INTERVALS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function pickTickInterval(totalSeconds: number, zoom: number): number {
  const visibleSeconds = Math.max(0.001, totalSeconds / zoom);
  const maxTicks = 72;
  const minTicks = 4;
  const idealOneSecond = Math.ceil(visibleSeconds);
  const targetTickCount = Math.max(minTicks, Math.min(maxTicks, idealOneSecond));
  const rawInterval = visibleSeconds / targetTickCount;
  return TICK_INTERVALS.find((iv) => iv >= rawInterval) ?? 600;
}

function formatRulerLabel(seconds: number, interval: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (interval < 1) {
    const fixed = s.toFixed(1);
    return `${m}:${fixed.length < 4 ? "0" : ""}${fixed}`;
  }
  return `${m}:${Math.floor(s).toString().padStart(2, "0")}`;
}

function isKeyboardTargetEditable(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) {
    return false;
  }
  if (el.isContentEditable) {
    return true;
  }
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.closest(".skeu-select-menu")) {
    return true;
  }
  if (el.closest('[role="listbox"]')) {
    return true;
  }
  return false;
}

function isHlsContentType(contentType: string | undefined) {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return normalized.includes("mpegurl") || normalized.includes("m3u8");
}

function supportsNativeHlsPlayback() {
  if (typeof document === "undefined") {
    return false;
  }

  const video = document.createElement("video");
  return (
    video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
    video.canPlayType("application/x-mpegURL") !== ""
  );
}

function createPreviewUrl(url: string | null) {
  if (!url) {
    return null;
  }

  if (url.startsWith("blob:") || url.startsWith("data:")) {
    return url;
  }

  try {
    const parsedUrl = new URL(url);

    if (isAllowedMediaProxyUrl(parsedUrl)) {
      return `/api/media-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }

  return url;
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function encodeWavAudioBuffer(buffer: AudioBuffer) {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;

  if (channels === 2) {
    const wavInterleaved = new Float32Array(buffer.length * 2);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    for (let index = 0; index < buffer.length; index += 1) {
      wavInterleaved[index * 2] = left[index];
      wavInterleaved[index * 2 + 1] = right[index];
    }

    return encodeWavPcm16(wavInterleaved, sampleRate, channels);
  }

  return encodeWavPcm16(buffer.getChannelData(0), sampleRate, channels);
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number, channels: number) {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to prepare the frame image."));
    image.src = dataUrl;
  });
}

async function waitForVideoReady(video: HTMLVideoElement) {
  if (video.readyState >= 1) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Unable to load video metadata for storyboard previews."));
    };

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function waitForVideoSeek(video: HTMLVideoElement, timestamp: number) {
  if (Math.abs(video.currentTime - timestamp) < 0.05) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Unable to seek video for storyboard previews."));
    };

    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = timestamp;
  });
}

async function generateStoryboardPreviewMap(
  videoUrl: string,
  frames: StoryboardFrame[],
): Promise<Record<string, string>> {
  const video = document.createElement("video");
  video.src = videoUrl;
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await waitForVideoReady(video);

  const canvas = document.createElement("canvas");
  const width = Math.max(320, Math.min(video.videoWidth || 320, 640));
  const sourceAspect = (video.videoWidth || 16) / (video.videoHeight || 9);
  const height = Math.max(180, Math.round(width / sourceAspect));
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas export is unavailable for storyboard previews.");
  }

  const previews: Record<string, string> = {};

  for (const frame of frames) {
    await waitForVideoSeek(video, frame.timestamp);
    context.drawImage(video, 0, 0, width, height);
    previews[frame.id] = canvas.toDataURL("image/jpeg", 0.82);
  }

  video.pause();
  video.removeAttribute("src");
  video.load();

  return previews;
}

function getSceneDetectionConfig(mode: StoryboardMode, qualityMode: QualityMode, dedupeEnabled: boolean) {
  const sampleStep =
    qualityMode === "Best" ? 0.16 : qualityMode === "Balanced" ? 0.24 : 0.38;
  const analysisWidth =
    qualityMode === "Best" ? 128 : qualityMode === "Balanced" ? 96 : 72;

  if (mode === "Highlights") {
    return {
      adaptiveThreshold: 1.55,
      analysisWidth,
      minContentFloor: 0.09,
      minSpacing: dedupeEnabled ? 1.9 : 1.45,
      sampleStep,
      targetCount: 6,
      windowRadius: qualityMode === "Best" ? 3 : 2,
      zThreshold: 1.15,
    };
  }

  return {
    adaptiveThreshold: 1.28,
    analysisWidth,
    minContentFloor: 0.05,
    minSpacing: dedupeEnabled ? 0.85 : 0.58,
    sampleStep,
    targetCount: 10,
    windowRadius: qualityMode === "Best" ? 3 : 2,
    zThreshold: 0.7,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function percentile(values: number[], ratio: number) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function mean(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeBhattacharyyaDistance(current: Float32Array, previous: Float32Array) {
  let coefficient = 0;

  for (let index = 0; index < current.length; index += 1) {
    coefficient += Math.sqrt(current[index] * previous[index]);
  }

  return Math.sqrt(Math.max(0, 1 - coefficient));
}

function computeGlobalSsimDissimilarity(current: Uint8Array, previous: Uint8Array) {
  const length = current.length;

  if (!length || length !== previous.length) {
    return 0;
  }

  let sumCurrent = 0;
  let sumPrevious = 0;

  for (let index = 0; index < length; index += 1) {
    sumCurrent += current[index];
    sumPrevious += previous[index];
  }

  const meanCurrent = sumCurrent / length;
  const meanPrevious = sumPrevious / length;
  let varianceCurrent = 0;
  let variancePrevious = 0;
  let covariance = 0;

  for (let index = 0; index < length; index += 1) {
    const deltaCurrent = current[index] - meanCurrent;
    const deltaPrevious = previous[index] - meanPrevious;
    varianceCurrent += deltaCurrent * deltaCurrent;
    variancePrevious += deltaPrevious * deltaPrevious;
    covariance += deltaCurrent * deltaPrevious;
  }

  varianceCurrent /= length;
  variancePrevious /= length;
  covariance /= length;

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const numerator =
    (2 * meanCurrent * meanPrevious + c1) * (2 * covariance + c2);
  const denominator =
    (meanCurrent * meanCurrent + meanPrevious * meanPrevious + c1) *
    (varianceCurrent + variancePrevious + c2);

  if (!denominator) {
    return 0;
  }

  const ssim = clamp(numerator / denominator, -1, 1);
  return clamp((1 - ssim) / 2, 0, 1);
}

function computeDHashDistance(current: FrameSignature, previous: FrameSignature) {
  if (!current.luma.length || current.luma.length !== previous.luma.length) {
    return 0;
  }

  const rows = 8;
  const cols = 8;
  let mismatches = 0;

  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(current.height - 1, Math.floor(((row + 0.5) / rows) * current.height));

    for (let col = 0; col < cols; col += 1) {
      const x = Math.min(current.width - 2, Math.floor((col / (cols + 1)) * (current.width - 1)));
      const index = y * current.width + x;
      const currentBit = current.luma[index] > current.luma[index + 1];
      const previousBit = previous.luma[index] > previous.luma[index + 1];

      if (currentBit !== previousBit) {
        mismatches += 1;
      }
    }
  }

  return mismatches / (rows * cols);
}

function buildFrameSignature(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
): FrameSignature {
  const pixelCount = width * height;
  const luma = new Uint8Array(pixelCount);
  const edges = new Float32Array(pixelCount);
  const histogramBins = 32;
  const histogram = new Float32Array(histogramBins);
  let brightnessSum = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const red = imageData[offset];
    const green = imageData[offset + 1];
    const blue = imageData[offset + 2];
    const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);

    luma[pixelIndex] = luminance;
    histogram[Math.min(histogramBins - 1, Math.floor((luminance / 256) * histogramBins))] += 1;
    brightnessSum += luminance;
  }

  for (let index = 0; index < histogram.length; index += 1) {
    histogram[index] /= pixelCount;
  }

  let edgeSum = 0;
  let laplacianSum = 0;
  let laplacianSquaredSum = 0;
  const sobelNormalizer = 1443;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const topLeft = luma[index - width - 1];
      const top = luma[index - width];
      const topRight = luma[index - width + 1];
      const left = luma[index - 1];
      const center = luma[index];
      const right = luma[index + 1];
      const bottomLeft = luma[index + width - 1];
      const bottom = luma[index + width];
      const bottomRight = luma[index + width + 1];

      const gradientX =
        -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
      const gradientY =
        -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      const magnitude = clamp(
        Math.sqrt(gradientX * gradientX + gradientY * gradientY) / sobelNormalizer,
        0,
        1,
      );
      edges[index] = magnitude;
      edgeSum += magnitude;

      const laplacian = 4 * center - left - right - top - bottom;
      laplacianSum += laplacian;
      laplacianSquaredSum += laplacian * laplacian;
    }
  }

  const innerPixelCount = Math.max(1, (width - 2) * (height - 2));
  const laplacianMean = laplacianSum / innerPixelCount;

  return {
    brightness: brightnessSum / pixelCount / 255,
    edgeEnergy: edgeSum / innerPixelCount,
    edges,
    height,
    histogram,
    luma,
    sharpness:
      laplacianSquaredSum / innerPixelCount - laplacianMean * laplacianMean,
    width,
  };
}

function computeContentScore(current: FrameSignature, previous: FrameSignature) {
  let lumaDelta = 0;
  let edgeDelta = 0;

  for (let index = 0; index < current.luma.length; index += 1) {
    lumaDelta += Math.abs(current.luma[index] - previous.luma[index]);
    edgeDelta += Math.abs(current.edges[index] - previous.edges[index]);
  }

  lumaDelta /= current.luma.length * 255;
  edgeDelta /= current.edges.length;

  const ssimDissimilarity = computeGlobalSsimDissimilarity(current.luma, previous.luma);
  const histogramDistance = computeBhattacharyyaDistance(current.histogram, previous.histogram);
  const hashDistance = computeDHashDistance(current, previous);
  let score =
    lumaDelta * 0.24 +
    edgeDelta * 0.3 +
    ssimDissimilarity * 0.24 +
    histogramDistance * 0.14 +
    hashDistance * 0.08;

  const brightnessSwing = Math.abs(current.brightness - previous.brightness);

  if (brightnessSwing > 0.12 && edgeDelta < 0.035 && ssimDissimilarity < 0.05) {
    score *= 0.65;
  }

  return clamp(score, 0, 1);
}

function annotateAdaptiveSceneSamples(
  rawSamples: Omit<SceneSample, "adaptiveRatio" | "boundaryStrength" | "localMotion" | "zScore">[],
  config: SceneDetectionConfig,
) {
  if (!rawSamples.length) {
    return [];
  }

  const scores = rawSamples.map((sample) => sample.contentScore);
  const globalMean = mean(scores);
  const absoluteFloor = Math.max(
    config.minContentFloor,
    percentile(scores, config.targetCount <= 6 ? 0.72 : 0.6) * 0.88,
  );

  return rawSamples.map((sample, index) => {
    const left = Math.max(0, index - config.windowRadius);
    const right = Math.min(rawSamples.length - 1, index + config.windowRadius);
    const neighbors: number[] = [];

    for (let cursor = left; cursor <= right; cursor += 1) {
      if (cursor !== index) {
        neighbors.push(rawSamples[cursor].contentScore);
      }
    }

    const localMean = neighbors.length ? mean(neighbors) : globalMean;
    const localVariance = neighbors.length
      ? neighbors.reduce((sum, value) => sum + (value - localMean) ** 2, 0) / neighbors.length
      : 0;
    const localDeviation = Math.sqrt(localVariance);
    const adaptiveRatio = sample.contentScore / Math.max(localMean, 0.0001);
    const zScore = (sample.contentScore - localMean) / Math.max(localDeviation, 0.0001);
    const localMotion = mean(
      [
        rawSamples[index - 1]?.contentScore,
        sample.contentScore,
        rawSamples[index + 1]?.contentScore,
      ].filter((value): value is number => typeof value === "number"),
    );
    const strength =
      sample.contentScore * 0.5 +
      clamp((adaptiveRatio - config.adaptiveThreshold) / config.adaptiveThreshold, 0, 2) * 0.3 +
      clamp(zScore / 2.5, 0, 2) * 0.2;

    return {
      ...sample,
      adaptiveRatio,
      boundaryStrength:
        sample.contentScore >= absoluteFloor &&
        (adaptiveRatio >= config.adaptiveThreshold || zScore >= config.zThreshold)
          ? strength
          : 0,
      localMotion,
      zScore,
    };
  });
}

function pickBoundaryCandidates(samples: SceneSample[], config: SceneDetectionConfig) {
  const peaks = samples.filter((sample, index) => {
    const previous = samples[index - 1];
    const next = samples[index + 1];

    return (
      sample.boundaryStrength > 0 &&
      (!previous || sample.contentScore >= previous.contentScore) &&
      (!next || sample.contentScore >= next.contentScore)
    );
  });

  const selected: SceneSample[] = [];

  for (const candidate of [...peaks].sort((left, right) => right.boundaryStrength - left.boundaryStrength)) {
    if (
      selected.every(
        (sample) => Math.abs(sample.timestamp - candidate.timestamp) >= config.minSpacing,
      )
    ) {
      selected.push(candidate);
    }

    if (selected.length >= config.targetCount - 1) {
      break;
    }
  }

  return selected.sort((left, right) => left.timestamp - right.timestamp);
}

function fillBoundaryCoverage(
  boundaries: number[],
  duration: number,
  desiredBoundaries: number,
  minSpacing: number,
) {
  const next = [...boundaries].sort((left, right) => left - right);

  while (next.length < desiredBoundaries) {
    const anchors = [0, ...next, duration];
    let longestIndex = -1;
    let longestLength = 0;

    for (let index = 0; index < anchors.length - 1; index += 1) {
      const length = anchors[index + 1] - anchors[index];

      if (length > longestLength) {
        longestLength = length;
        longestIndex = index;
      }
    }

    if (longestIndex === -1 || longestLength < Math.max(minSpacing * 1.7, 0.8)) {
      break;
    }

    const midpoint = Number(
      ((anchors[longestIndex] + anchors[longestIndex + 1]) / 2).toFixed(3),
    );

    if (next.every((timestamp) => Math.abs(timestamp - midpoint) >= minSpacing * 0.75)) {
      next.push(midpoint);
      next.sort((left, right) => left - right);
      continue;
    }

    break;
  }

  return next;
}

function pickRepresentativeTimestamps(
  samples: SceneSample[],
  boundaries: number[],
  duration: number,
  config: SceneDetectionConfig,
) {
  if (!samples.length) {
    return [];
  }

  const segments = [0, ...boundaries, duration];
  const maxSharpness = Math.max(...samples.map((sample) => sample.sharpness), 1);
  const maxEdgeEnergy = Math.max(...samples.map((sample) => sample.edgeEnergy), 1);
  const motionScale = Math.max(
    percentile(samples.map((sample) => sample.localMotion), 0.8),
    0.0001,
  );
  const timestamps: number[] = [];

  for (let index = 0; index < segments.length - 1; index += 1) {
    const start = segments[index];
    const end = segments[index + 1];
    const segmentLength = Math.max(end - start, config.sampleStep);
    const guard = Math.min(segmentLength * 0.18, config.sampleStep * 1.5);
    const center = (start + end) / 2;
    const candidates = samples.filter(
      (sample) => sample.timestamp >= start + guard && sample.timestamp <= end - guard,
    );
    const pool = candidates.length
      ? candidates
      : samples.filter((sample) => sample.timestamp >= start && sample.timestamp <= end);

    if (!pool.length) {
      timestamps.push(Number(clamp(center, 0.1, Math.max(0.1, duration - 0.1)).toFixed(3)));
      continue;
    }

    let best = pool[0];
    let bestScore = -Infinity;

    for (const candidate of pool) {
      const clarity = Math.sqrt(candidate.sharpness / maxSharpness);
      const structure = candidate.edgeEnergy / maxEdgeEnergy;
      const stability = 1 - clamp(candidate.localMotion / motionScale, 0, 1);
      const centerBias =
        1 -
        clamp(
          Math.abs(candidate.timestamp - center) / (segmentLength / 2 + config.sampleStep),
          0,
          1,
        );
      const exposureBalance = 1 - Math.abs(candidate.brightness - 0.5) * 1.6;
      const score =
        clarity * 0.42 +
        structure * 0.2 +
        stability * 0.23 +
        centerBias * 0.1 +
        exposureBalance * 0.05;

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    timestamps.push(
      Number(clamp(best.timestamp, 0.1, Math.max(0.1, duration - 0.1)).toFixed(3)),
    );
  }

  return timestamps;
}

async function detectStoryboardFramesFromVideo(
  videoUrl: string,
  duration: number,
  mode: StoryboardMode,
  qualityMode: QualityMode,
  dedupeEnabled: boolean,
) {
  if (mode === "Every 1s") {
    return buildStoryboard(duration, mode);
  }

  const config = getSceneDetectionConfig(
    mode,
    qualityMode,
    dedupeEnabled,
  );

  const video = document.createElement("video");
  video.src = videoUrl;
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await waitForVideoReady(video);

  const canvas = document.createElement("canvas");
  const width = config.analysisWidth;
  const height = Math.max(
    40,
    Math.round(width / ((video.videoWidth || 16) / (video.videoHeight || 9))),
  );
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas export is unavailable for scene detection.");
  }

  let previousSignature: FrameSignature | null = null;
  const rawSamples: Omit<
    SceneSample,
    "adaptiveRatio" | "boundaryStrength" | "localMotion" | "zScore"
  >[] = [];
  const maxTimestamp = Math.max(config.sampleStep, duration - 0.1);

  for (
    let timestamp = Math.min(0.15, maxTimestamp);
    timestamp <= maxTimestamp;
    timestamp += config.sampleStep
  ) {
    await waitForVideoSeek(video, Number(timestamp.toFixed(3)));
    context.drawImage(video, 0, 0, width, height);
    const currentPixels = context.getImageData(0, 0, width, height).data;
    const currentSignature = buildFrameSignature(currentPixels, width, height);

    if (previousSignature) {
      rawSamples.push({
        brightness: currentSignature.brightness,
        contentScore: computeContentScore(currentSignature, previousSignature),
        edgeEnergy: currentSignature.edgeEnergy,
        sharpness: currentSignature.sharpness,
        timestamp: Number(timestamp.toFixed(3)),
      });
    }

    previousSignature = currentSignature;
  }

  video.pause();
  video.removeAttribute("src");
  video.load();

  const samples = annotateAdaptiveSceneSamples(rawSamples, config);
  const pickedBoundaries = pickBoundaryCandidates(samples, config).map(
    (sample) => sample.timestamp,
  );
  const boundaries = fillBoundaryCoverage(
    pickedBoundaries,
    duration,
    Math.max(0, config.targetCount - 1),
    config.minSpacing,
  );
  const timestamps = pickRepresentativeTimestamps(samples, boundaries, duration, config)
    .sort((left, right) => left - right)
    .slice(0, config.targetCount);

  if (!timestamps.length) {
    return buildStoryboard(duration, mode);
  }

  return buildStoryboardFromTimestamps(timestamps, mode);
}

async function convertDataUrl(dataUrl: string, format: ExportFormat) {
  const mimeType =
    format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";

  if (dataUrl.startsWith(`data:${mimeType}`)) {
    return dataUrl;
  }

  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas export is unavailable in this browser.");
  }

  if (format === "jpeg") {
    context.fillStyle = "#fff6ed";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(mimeType, format === "jpeg" ? 0.92 : undefined);
}

async function createContactSheetDataUrl(frames: CapturedStoryboardFrame[]) {
  const images = await Promise.all(
    frames.map(async (frame) => ({
      frame,
      image: await loadImage(frame.imageDataUrl),
    })),
  );

  const columns = frames.length <= 4 ? 2 : 3;
  const baseThumbWidth =
    frames.length <= 2 ? 1400 : frames.length <= 4 ? 1100 : frames.length <= 6 ? 860 : 720;
  const thumbWidth = Math.min(
    baseThumbWidth,
    Math.max(...images.map(({ image }) => image.naturalWidth || image.width || baseThumbWidth)),
  );
  const horizontalPadding = 28;
  const verticalPadding = 28;
  const captionHeight = 96;
  const thumbHeight = Math.round((thumbWidth * 9) / 16);
  const cellWidth = thumbWidth + horizontalPadding * 2;
  const cellHeight = thumbHeight + captionHeight;
  const rows = Math.ceil(images.length / columns);
  const canvas = document.createElement("canvas");
  const canvasWidth = columns * cellWidth + 24;
  const canvasHeight = rows * cellHeight + 24;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas export is unavailable in this browser.");
  }

  context.fillStyle = "#f6f3ec";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '600 32px "IBM Plex Sans", "Segoe UI", sans-serif';
  context.textBaseline = "top";

  images.forEach(({ frame, image }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const originX = 12 + column * cellWidth;
    const originY = 12 + row * cellHeight;
    const drawWidth = thumbWidth;
    const drawHeight = Math.round(
      drawWidth / ((image.naturalWidth || image.width || 16) / (image.naturalHeight || image.height || 9)),
    );
    const fittedHeight = Math.min(thumbHeight, drawHeight);
    const imageY = originY + verticalPadding + Math.max(0, (thumbHeight - fittedHeight) / 2);

    context.fillStyle = "#ffffff";
    context.strokeStyle = "rgba(15, 23, 42, 0.12)";
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(originX, originY, thumbWidth + horizontalPadding * 2, thumbHeight + 56, 22);
    context.fill();
    context.stroke();

    context.drawImage(image, originX + horizontalPadding, imageY, drawWidth, fittedHeight);

    context.fillStyle = "#0f172a";
    context.fillText(frame.label, originX + horizontalPadding, originY + thumbHeight + 10);
    context.fillStyle = "#475569";
    context.font = '400 26px "IBM Plex Sans", "Segoe UI", sans-serif';
    context.fillText(
      formatTimestamp(frame.timestamp),
      originX + horizontalPadding,
      originY + thumbHeight + 46,
    );
    context.font = '600 32px "IBM Plex Sans", "Segoe UI", sans-serif';
  });

  return canvas.toDataURL("image/png");
}

export function FrameExtractorApp() {
  const [sourceInput, setSourceInput] = useState("");
  const [session, setSession] = useState<ResolveSourceResponse | null>(null);
  const [appState, setAppState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duration, setDuration] = useState(34.667);
  const [currentTime, setCurrentTime] = useState(12.345);
  const [storyboardMode, setStoryboardMode] = useState<StoryboardMode>("Scenes");
  const [storyboardFrames, setStoryboardFrames] = useState<StoryboardFrame[]>(
    buildStoryboard(34.667, "Scenes"),
  );
  const [selectedVariant, setSelectedVariant] = useState("");
  const [qualityMode, setQualityMode] = useState<QualityMode>("Balanced");
  const [dedupeEnabled, setDedupeEnabled] = useState(true);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [statusNote, setStatusNote] = useState("Ready for the first source.");
  const [isExporting, setIsExporting] = useState(false);
  const [isCopyingSelection, setIsCopyingSelection] = useState(false);
  const [isDownloadingAudio, setIsDownloadingAudio] = useState(false);
  const [isAutoStoryboarding, setIsAutoStoryboarding] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [storyboardPreviewUrls, setStoryboardPreviewUrls] = useState<Record<string, string>>({});
  const [timelineZoom, setTimelineZoom] = useState(TIMELINE_ZOOM_MIN);

  const isAutoStoryboardingRef = useRef(false);
  /** Prevents duplicate full-video scan right after openSource (effect also watches URL). */
  const skipNextStoryboardEffectRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineTrackRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const storyCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const keyboardSnapshotRef = useRef({
    currentTime: 0,
    duration: 0,
    activeFrameId: null as string | null,
    storyboardFrames: [] as StoryboardFrame[],
  });
  const keyboardActionsRef = useRef({
    togglePlayback: async () => {},
    addCurrentFrame: async () => {},
    stepByFrames: (() => {}) as (count: number) => void,
    stepBySeconds: (() => {}) as (count: number) => void,
    scrubTo: (() => {}) as (time: number) => void,
    autoStoryboardSelection: async () => {},
    exportSelection: async () => {},
    copySelectionToClipboard: async () => {},
    removeFrame: (() => {}) as (id: string) => void,
    scrollFilmstripToFrame: (() => {}) as (id: string) => void,
    goToNewTweet: () => {},
  });

  const activeVariant =
    session?.variants.find((variant) => variant.id === selectedVariant) ?? session?.variants[0] ?? null;
  const fallbackPreviewVariant =
    session?.variants.find((variant) => variant.contentType === "video/mp4") ?? session?.variants[0] ?? null;
  const previewVariant =
    activeVariant && (!isHlsContentType(activeVariant.contentType) || supportsNativeHlsPlayback())
      ? activeVariant
      : fallbackPreviewVariant;
  const activeVideoUrl = createPreviewUrl(previewVariant?.url ?? session?.videoUrl ?? null);
  const storyboardCount = storyboardFrames.length;
  const storyboardFramesSorted = [...storyboardFrames].sort((left, right) => left.timestamp - right.timestamp);
  const storyboardMaxTimestamp = useMemo(() => {
    if (storyboardFrames.length === 0) {
      return 0;
    }
    return Math.max(...storyboardFrames.map((f) => f.timestamp));
  }, [storyboardFrames]);

  /** Span for ruler/story markers: avoids syndication vs probe duration mismatch orphaning dots off the groove. */
  const timelineSpan = Math.max(duration || 0, storyboardMaxTimestamp, 0.001);

  const isPreviewFallback =
    activeVariant !== null && previewVariant !== null && activeVariant.id !== previewVariant.id;

  const activeFrameId = (() => {
    if (storyboardFrames.length === 0) return null;
    const closest = storyboardFrames.reduce((a, b) =>
      Math.abs(b.timestamp - currentTime) < Math.abs(a.timestamp - currentTime) ? b : a,
    );
    const snapThreshold = Math.max(0.15, timelineSpan * 0.008);
    return Math.abs(closest.timestamp - currentTime) <= snapThreshold ? closest.id : null;
  })();

  keyboardSnapshotRef.current = {
    currentTime,
    duration,
    activeFrameId,
    storyboardFrames,
  };

  function getStoryboardPreview(frame: StoryboardFrame) {
    return (
      storyboardPreviewUrls[frame.id] ??
      createPlaceholderFrameDataUrl(frame.timestamp, frame.label, frame.color)
    );
  }

  const runStoryboardDetection = useCallback(
    async (overrides?: { url?: string | null; duration?: number }) => {
      const url = overrides?.url !== undefined ? overrides.url : activeVideoUrl;
      const dur =
        overrides?.duration !== undefined ? overrides.duration : Number(duration) || 0;

      if (!url || !(dur > 0)) {
        setStoryboardFrames(buildStoryboard(dur || 12, storyboardMode));
        return;
      }

      if (isAutoStoryboardingRef.current) {
        return;
      }

      isAutoStoryboardingRef.current = true;
      setIsAutoStoryboarding(true);
      setStoryboardFrames([]);
      setStoryboardPreviewUrls({});
      setStatusNote("Analyzing the whole video and rebuilding the storyboard...");

      try {
        const slots = await detectStoryboardFramesFromVideo(
          url,
          dur,
          storyboardMode,
          qualityMode,
          dedupeEnabled,
        );

        setStoryboardFrames(slots);
        setStatusNote(
          slots.length === 0
            ? "No storyboard moments were detected."
            : `Storyboard rebuilt with ${slots.length} frames from the full video.`,
        );
      } catch {
        const fallback = buildStoryboard(dur, storyboardMode);
        setStoryboardFrames(fallback);
        setStatusNote(`Storyboard rebuilt with ${fallback.length} fallback frames.`);
      } finally {
        isAutoStoryboardingRef.current = false;
        setIsAutoStoryboarding(false);
      }
    },
    [activeVideoUrl, duration, storyboardMode, qualityMode, dedupeEnabled],
  );

  useEffect(() => {
    if (skipNextStoryboardEffectRef.current) {
      skipNextStoryboardEffectRef.current = false;
      return;
    }
    void runStoryboardDetection();
  }, [runStoryboardDetection]);

  useEffect(() => {
    let cancelled = false;

    async function generatePreviews() {
      if (!activeVideoUrl || !storyboardFrames.length) {
        setStoryboardPreviewUrls({});
        return;
      }

      try {
        const previews = await generateStoryboardPreviewMap(activeVideoUrl, storyboardFrames);

        if (!cancelled) {
          setStoryboardPreviewUrls(previews);
        }
      } catch {
        if (!cancelled) {
          setStoryboardPreviewUrls({});
        }
      }
    }

    void generatePreviews();

    return () => {
      cancelled = true;
    };
  }, [activeVideoUrl, storyboardFrames]);

  function scrubTo(nextTime: number) {
    const safeTime = Math.min(Math.max(nextTime, 0), duration || 0);
    setCurrentTime(safeTime);
    const video = videoRef.current;

    if (video && Number.isFinite(video.duration || safeTime)) {
      video.currentTime = safeTime;
    }
  }

  const scrollTimelineToPlayhead = useCallback(() => {
    const container = timelineScrollRef.current;
    const track = timelineTrackRef.current;
    const total = timelineSpan;

    if (!container || !track || total <= 0) {
      return;
    }

    const t = Math.min(Math.max(currentTime, 0), total);
    const ratio = t / total;
    const playheadPx = ratio * track.clientWidth;
    const viewWidth = container.clientWidth;
    const maxScroll = Math.max(0, container.scrollWidth - viewWidth);
    const target = playheadPx - viewWidth / 2;
    const nextLeft = Math.min(maxScroll, Math.max(0, target));

    if (Math.abs(container.scrollLeft - nextLeft) > 0.5) {
      container.scrollLeft = nextLeft;
    }
  }, [currentTime, timelineSpan]);

  const scrollFilmstripToFrame = useCallback((frameId: string) => {
    requestAnimationFrame(() => {
      const strip = filmstripRef.current;
      const card = storyCardRefs.current[frameId];

      if (!strip || !card) {
        return;
      }

      const cardLeft = card.offsetLeft;
      const cardWidth = card.offsetWidth;
      const viewWidth = strip.clientWidth;
      const maxScroll = Math.max(0, strip.scrollWidth - viewWidth);
      const target = cardLeft - viewWidth / 2 + cardWidth / 2;
      strip.scrollLeft = Math.min(maxScroll, Math.max(0, target));
    });
  }, []);

  useLayoutEffect(() => {
    scrollTimelineToPlayhead();
  }, [scrollTimelineToPlayhead, timelineZoom]);

  useLayoutEffect(() => {
    const el = timelineScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver(() => {
      scrollTimelineToPlayhead();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [scrollTimelineToPlayhead, appState, session]);

  useEffect(() => {
    if (appState !== "ready") {
      return;
    }

    const el = timelineScrollRef.current;

    if (!el) {
      return;
    }

    function onWheelNative(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1 / 1.15 : 1.15;
      setTimelineZoom((z) => {
        const next = z * factor;
        const clamped = Math.min(TIMELINE_ZOOM_MAX, Math.max(TIMELINE_ZOOM_MIN, next));
        return Math.round(clamped * 100) / 100;
      });
    }

    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheelNative);
    };
  }, [appState]);

  function stepByFrames(frameCount: number) {
    scrubTo(currentTime + frameCount / 30);
  }

  function stepBySeconds(secondCount: number) {
    scrubTo(currentTime + secondCount);
  }

  async function seekVideo(timestamp: number) {
    const video = videoRef.current;

    if (!video || Number.isNaN(video.duration)) {
      return;
    }

    const safeTime = Math.min(Math.max(timestamp, 0), video.duration || duration);

    if (Math.abs(video.currentTime - safeTime) < 0.05) {
      return;
    }

    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        resolve();
      };

      video.addEventListener("seeked", onSeeked, { once: true });
      video.currentTime = safeTime;
    });

    setCurrentTime(safeTime);
  }

  async function captureFrame(frame: StoryboardFrame) {
    const video = videoRef.current;

    if (video && activeVideoUrl) {
      try {
        await seekVideo(frame.timestamp);

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;

        const context = canvas.getContext("2d");

        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL("image/png");
        }
      } catch {
        setStatusNote("Canvas capture fell back to placeholders because the source blocked pixel export.");
      }
    }

    return createPlaceholderFrameDataUrl(frame.timestamp, frame.label, frame.color);
  }

  async function captureStoryboardFrames(frames: StoryboardFrame[]) {
    const captures: CapturedStoryboardFrame[] = [];

    for (const frame of frames) {
      const imageDataUrl = await captureFrame(frame);
      captures.push({
        ...frame,
        filename: `frame-${slugifyTimestamp(frame.timestamp)}`,
        imageDataUrl,
      });
    }

    return captures;
  }

  async function addFrame(frame: StoryboardFrame) {
    const duplicate = storyboardFrames.some(
      (storyboardFrame) => Math.abs(storyboardFrame.timestamp - frame.timestamp) < 0.05,
    );

    if (duplicate) {
      setStatusNote(`Frame ${formatTimestamp(frame.timestamp)} is already on the storyboard.`);
      return;
    }

    setStoryboardFrames((current) => {
      if (current.some((f) => f.id === frame.id)) {
        return current;
      }
      return [...current, frame].sort((a, b) => a.timestamp - b.timestamp);
    });
    setStatusNote(`Added ${frame.label} to the storyboard at ${formatTimestamp(frame.timestamp)}.`);
  }

  function removeFrame(frameId: string) {
    setStoryboardFrames((current) => current.filter((f) => f.id !== frameId));
    setStoryboardPreviewUrls((current) => {
      const next = { ...current };
      delete next[frameId];
      return next;
    });
  }

  /** Clears the storyboard rail while keeping the current source loaded. */
  function clearStoryboard() {
    setStoryboardFrames([]);
    setStoryboardPreviewUrls({});
    setStatusNote("Cleared the storyboard. Run Auto storyboard to analyze the full video again.");
  }

  function goToNewTweet() {
    setSession(null);
    setAppState("idle");
    setErrorMessage(null);
    setIsPlaying(false);
  }

  async function addCurrentFrame() {
    const manualFrame: StoryboardFrame = {
      id: `manual-${Date.now()}`,
      timestamp: currentTime,
      label: "Manual capture",
      note: "Captured from the preview player.",
      color: "#ffd779",
      kind: "highlight",
    };

    await addFrame(manualFrame);
  }

  async function togglePlayback() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (video.paused) {
      await video.play();
      return;
    }

    video.pause();
  }

  async function autoStoryboardSelection() {
    if (!activeVideoUrl || !(duration > 0)) {
      setStatusNote("Load a video first.");
      return;
    }
    await runStoryboardDetection();
  }

  async function exportSelection() {
    if (!storyboardFrames.length) {
      setStatusNote("Add storyboard frames before exporting.");
      return;
    }

    setIsExporting(true);

    try {
      const capturedFrames = await captureStoryboardFrames(storyboardFramesSorted);
      const zip = new JSZip();
      const projectName = session?.title || "snipr-export";

      const metadata = capturedFrames.map((frame, index) => ({
        id: frame.id,
        index: index + 1,
        label: frame.label,
        timestamp: frame.timestamp,
        timestampLabel: formatTimestamp(frame.timestamp),
        filename: `${frame.filename}.${exportFormat === "jpeg" ? "jpg" : exportFormat}`,
        note: frame.note,
      }));

      const csv = [
        "index,label,timestamp,timestampLabel,filename,note",
        ...metadata.map((frame) =>
          [
            frame.index,
            `"${frame.label}"`,
            frame.timestamp.toFixed(3),
            frame.timestampLabel,
            frame.filename,
            `"${frame.note}"`,
          ].join(","),
        ),
      ].join("\n");

      zip.file(
        "metadata.json",
        JSON.stringify(
          {
            projectName,
            sourceType: session?.sourceType ?? "x-url",
            normalizedInput: session?.normalizedInput ?? sourceInput,
            exportedAt: new Date().toISOString(),
            format: exportFormat,
            frames: metadata,
          },
          null,
          2,
        ),
      );
      zip.file("captions.csv", csv);

      const frameFolder = zip.folder("frames");

      for (const frame of capturedFrames) {
        const converted = await convertDataUrl(frame.imageDataUrl, exportFormat);
        const base64 = converted.split(",")[1];
        frameFolder?.file(
          `${frame.filename}.${exportFormat === "jpeg" ? "jpg" : exportFormat}`,
          base64,
          { base64: true },
        );
      }

      const archive = await zip.generateAsync({ type: "blob" });
      downloadBlob(archive, `${projectName}-frames.zip`);
      setStatusNote(`Exported ${capturedFrames.length} storyboard frames as a ZIP package.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Export failed while packaging frames.";
      setStatusNote(message);
    } finally {
      setIsExporting(false);
    }
  }

  async function copySelectionToClipboard() {
    if (!storyboardFrames.length) {
      setStatusNote("Add storyboard frames before copying.");
      return;
    }

    if (!("clipboard" in navigator) || typeof window.ClipboardItem === "undefined") {
      setStatusNote("Clipboard image copy is not available in this browser.");
      return;
    }

    setIsCopyingSelection(true);

    try {
      const capturedFrames = await captureStoryboardFrames(storyboardFramesSorted);
      const contactSheet = await createContactSheetDataUrl(capturedFrames);
      const blob = await dataUrlToBlob(contactSheet);

      await navigator.clipboard.write([
        new window.ClipboardItem({
          [blob.type]: blob,
        }),
      ]);

      setStatusNote(
        `Copied ${capturedFrames.length} storyboard frames as one contact sheet image.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to copy storyboard frames to the clipboard.";
      setStatusNote(message);
    } finally {
      setIsCopyingSelection(false);
    }
  }

  async function downloadAudioTrack() {
    if (!activeVideoUrl) {
      setStatusNote("No playable source is available for audio extraction.");
      return;
    }

    const win = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    if (typeof window.AudioContext === "undefined" && typeof win.webkitAudioContext === "undefined") {
      setStatusNote("Audio extraction is not supported in this browser.");
      return;
    }

    setIsDownloadingAudio(true);

    try {
      const response = await fetch(activeVideoUrl);

      if (!response.ok) {
        throw new Error("Unable to fetch media for audio extraction.");
      }

      const arrayBuffer = await response.arrayBuffer();
      const AudioContextCtor = window.AudioContext ?? win.webkitAudioContext;

      if (!AudioContextCtor) {
        throw new Error("Audio extraction is not supported in this browser.");
      }

      const audioContext = new AudioContextCtor();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const wavBlob = encodeWavAudioBuffer(audioBuffer);
      const baseName = (session?.title || "audio-track").replace(/[^\w-]+/g, "-").replace(/-+/g, "-");
      downloadBlob(wavBlob, `${baseName || "audio-track"}.wav`);
      setStatusNote("Downloaded audio track as WAV.");
      await audioContext.close();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to extract audio from the current source.";
      setStatusNote(message);
    } finally {
      setIsDownloadingAudio(false);
    }
  }

  async function openSource() {
    setErrorMessage(null);

    if (!sourceInput.trim()) {
      setAppState("error");
      setErrorMessage("Enter a source URL first.");
      return;
    }

    setAppState("loading");
    setStatusNote("Resolving public X metadata and playable variants...");

    try {
      const response = await fetch("/api/resolve-source", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: sourceInput,
        }),
      });

      const payload = (await response.json()) as ResolveSourceResponse & { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Unable to resolve that source.");
      }

      const nextVariant = payload.variants[0] ?? null;
      const previewUrl = createPreviewUrl(nextVariant?.url ?? payload.videoUrl ?? null);

      flushSync(() => {
        setSession(payload);
        setDuration(payload.duration);
        setCurrentTime(Math.min(12.345, payload.duration));
        setSelectedVariant(nextVariant?.id ?? "");
        setIsPlaying(false);
        setTimelineZoom(TIMELINE_ZOOM_MIN);
      });

      skipNextStoryboardEffectRef.current = true;
      await runStoryboardDetection({
        url: previewUrl,
        duration: payload.duration,
      });

      setAppState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to prepare the source.";
      setAppState("error");
      setErrorMessage(message);
    }
  }

  keyboardActionsRef.current = {
    togglePlayback,
    addCurrentFrame,
    stepByFrames,
    stepBySeconds,
    scrubTo,
    autoStoryboardSelection,
    exportSelection,
    copySelectionToClipboard,
    removeFrame,
    scrollFilmstripToFrame,
    goToNewTweet,
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isKeyboardTargetEditable(event.target)) {
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        if (event.shiftKey && event.key.toLowerCase() === "e") {
          event.preventDefault();
          void keyboardActionsRef.current.exportSelection();
          return;
        }
        if (event.shiftKey && event.key.toLowerCase() === "c") {
          event.preventDefault();
          void keyboardActionsRef.current.copySelectionToClipboard();
          return;
        }
        return;
      }

      if (appState !== "ready" || !session) {
        return;
      }

      const snap = keyboardSnapshotRef.current;
      const a = keyboardActionsRef.current;
      const key = event.key;

      switch (key) {
        case " ":
          event.preventDefault();
          void a.togglePlayback();
          break;
        case "Escape":
          event.preventDefault();
          videoRef.current?.pause();
          break;
        case "k":
        case "K":
          event.preventDefault();
          videoRef.current?.pause();
          break;
        case "f":
        case "F":
          event.preventDefault();
          void a.addCurrentFrame();
          break;
        case "a":
        case "A":
          if (event.altKey) {
            return;
          }
          if (isAutoStoryboardingRef.current) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          void a.autoStoryboardSelection();
          break;
        case "n":
        case "N":
          if (!event.shiftKey) {
            return;
          }
          event.preventDefault();
          a.goToNewTweet();
          break;
        case "e":
        case "E":
          if (event.shiftKey || event.altKey) {
            return;
          }
          event.preventDefault();
          void a.exportSelection();
          break;
        case "d":
        case "D":
          if (event.shiftKey || event.altKey) {
            return;
          }
          if (snap.activeFrameId) {
            event.preventDefault();
            a.removeFrame(snap.activeFrameId);
          }
          break;
        case "Home":
          event.preventDefault();
          a.scrubTo(0);
          break;
        case "End": {
          event.preventDefault();
          const d = snap.duration || 0;
          if (d > 0) {
            a.scrubTo(d);
          }
          break;
        }
        case "ArrowLeft":
          event.preventDefault();
          if (event.shiftKey) {
            a.stepBySeconds(-1);
          } else {
            a.stepByFrames(-1);
          }
          break;
        case "ArrowRight":
          event.preventDefault();
          if (event.shiftKey) {
            a.stepBySeconds(1);
          } else {
            a.stepByFrames(1);
          }
          break;
        case "j":
        case "J":
          event.preventDefault();
          a.stepByFrames(-1);
          break;
        case "l":
        case "L":
          event.preventDefault();
          a.stepByFrames(1);
          break;
        case ",":
          event.preventDefault();
          a.stepByFrames(-1);
          break;
        case ".":
          event.preventDefault();
          a.stepByFrames(1);
          break;
        case "[":
          event.preventDefault();
          setTimelineZoom((z) =>
            Math.max(TIMELINE_ZOOM_MIN, Math.round((z - 1) * 100) / 100),
          );
          break;
        case "]":
          event.preventDefault();
          setTimelineZoom((z) =>
            Math.min(TIMELINE_ZOOM_MAX, Math.round((z + 1) * 100) / 100),
          );
          break;
        case "=":
        case "+":
          event.preventDefault();
          setTimelineZoom((z) =>
            Math.min(TIMELINE_ZOOM_MAX, Math.round((z + 1) * 100) / 100),
          );
          break;
        case "-":
        case "_":
          event.preventDefault();
          setTimelineZoom((z) =>
            Math.max(TIMELINE_ZOOM_MIN, Math.round((z - 1) * 100) / 100),
          );
          break;
        case "Backspace":
        case "Delete":
          if (snap.activeFrameId) {
            event.preventDefault();
            a.removeFrame(snap.activeFrameId);
          }
          break;
        case "?":
          event.preventDefault();
          setStatusNote(
            "Space: play/pause | Esc/K: pause | F: add frame | ←/→: ±1 frame, Shift±1s | J/L or ,/.: ±1 frame | Home/End: start/end | [/] or +/-: timeline zoom | A: auto storyboard | E: export ZIP | ⇧⌘C / Ctrl+Shift+C: copy contact sheet | D or Del: remove frame at playhead | ⇧N: new tweet | 1-9: jump to storyboard slot",
          );
          break;
        default: {
          if (/^[1-9]$/.test(key)) {
            const index = Number(key) - 1;
            const sorted = [...snap.storyboardFrames].sort((x, y) => x.timestamp - y.timestamp);
            const frame = sorted[index];
            if (frame) {
              event.preventDefault();
              a.scrubTo(frame.timestamp);
              a.scrollFilmstripToFrame(frame.id);
            }
          }
          break;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [appState, session]);

  if (!session || appState !== "ready") {
    return (
      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-stretch overflow-hidden px-3 py-3 sm:px-6 sm:py-5">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <section className="skeu-window flex w-full max-w-3xl shrink-0 flex-col overflow-hidden sm:max-w-4xl">
            <div className="skeu-titlebar shrink-0 text-left">
              <div className="skeu-titlebar__caps mr-1 shrink-0 pl-0.5" aria-hidden>
                <span className="skeu-titlecap skeu-titlecap--blue" />
                <span className="skeu-titlecap skeu-titlecap--purple" />
                <span className="skeu-titlecap skeu-titlecap--red" />
              </div>
              <div className="skeu-titlebar__lead flex min-h-0 min-w-0 flex-1 items-center px-2 py-1.5">
                <p className="min-w-0 truncate whitespace-nowrap text-left text-xs leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] sm:text-sm">
                  <span className="font-display font-bold tracking-wide text-[#ffe082] drop-shadow-[0_1px_0_rgba(90,40,0,0.35)]">
                    snipr
                  </span>
                  <span className="mx-1.5 opacity-90 sm:mx-2" aria-hidden>
                    |
                  </span>
                  <span className="font-normal tracking-normal">rip the video.</span>{" "}
                  <span className="font-normal tracking-normal text-[#ffe082] drop-shadow-[0_1px_0_rgba(90,40,0,0.35)]">
                    keep the gold.
                  </span>
                </p>
              </div>
            </div>
            <div className="skeu-frame-body flex min-h-0 flex-1 flex-col items-stretch overflow-hidden px-3 py-3 sm:px-5 sm:py-4">
              <div className="skeu-inset skeu-inset--light flex w-full max-w-2xl flex-col items-center gap-4 self-center px-6 py-6 text-center sm:gap-5 sm:px-9 sm:py-8">
                <h1 className="font-display text-xl font-bold leading-tight tracking-wide text-[#0b1224] sm:text-3xl">
                  Paste a tweet. Start pulling frames.
                </h1>

                <div className="skeu-divider-h !my-0 w-full max-w-lg shrink-0" />

                <div className="skeu-inset w-full max-w-2xl px-3 py-3 sm:px-4 sm:py-3.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                    <input
                      value={sourceInput}
                      onChange={(event) => {
                        setSourceInput(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void openSource();
                        }
                      }}
                      disabled={appState === "loading"}
                      className="skeu-input h-11 min-w-0 flex-1 disabled:pointer-events-none disabled:opacity-60 sm:h-12"
                      placeholder="https://x.com/.../status/..."
                      type="url"
                    />
                    <button
                      type="button"
                      onClick={() => void openSource()}
                      disabled={appState === "loading"}
                      className="skeu-btn skeu-btn--primary h-11 shrink-0 px-5 disabled:pointer-events-none disabled:opacity-75 sm:h-12 sm:px-7"
                    >
                      {appState === "loading" && !isAutoStoryboarding
                        ? "Resolving..."
                        : appState === "loading" && isAutoStoryboarding
                          ? "Storyboarding..."
                          : "storyboard it"}
                    </button>
                  </div>
                </div>

                {appState === "loading" ? (
                  <div
                    className="skeu-inset skeu-inset--light w-full max-w-2xl px-4 py-3 text-left shadow-md sm:px-4 sm:py-3.5"
                    role="status"
                    aria-busy="true"
                    aria-live="polite"
                    aria-label={
                      isAutoStoryboarding
                        ? "Scanning video for storyboard"
                        : "Resolving post from X"
                    }
                  >
                    <div className="mb-2 flex items-center gap-2.5">
                      <span className="skeu-spinner" aria-hidden />
                      <span className="font-display text-sm font-bold tracking-wide text-[#0b1224] sm:text-base">
                        {isAutoStoryboarding
                          ? "Step 2 of 2: Scanning the video"
                          : "Step 1 of 2: Resolving the post"}
                      </span>
                    </div>
                    <div className="skeu-busy-rail mb-2.5">
                      <div className="skeu-busy-rail__fill" />
                    </div>
                    <p className="font-mono text-xs leading-relaxed text-[#33415f] sm:text-sm">
                      {isAutoStoryboarding
                        ? "Looking for scene changes across the whole file. Count on seconds for short clips, up to a minute for long ones. This line keeps moving while work is happening."
                        : "Grabbing playback URLs from X syndication. Usually a few seconds."}
                    </p>
                  </div>
                ) : null}

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceInput("https://x.com/carterfmotion/status/2040579649722302896");
                    }}
                    disabled={appState === "loading"}
                    className="skeu-btn skeu-btn--ghost skeu-btn--sm disabled:pointer-events-none disabled:opacity-55"
                  >
                    Use test tweet
                  </button>
                </div>

                {errorMessage ? (
                  <div className="skeu-error w-full max-w-2xl text-left text-sm leading-snug sm:text-base">
                    {errorMessage}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2 overflow-hidden px-3 py-1 sm:px-4 lg:px-6">
      <section className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden sm:gap-2">
        <div className="flex min-h-0 flex-[3] basis-0 flex-col gap-2 overflow-hidden lg:flex-row">
          <div className="skeu-window flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col p-2">
              <div className="skeu-inset relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.35rem] border-[3px] p-1">
                <div className="relative min-h-0 min-w-0 flex-1 bg-black">
                  {activeVideoUrl ? (
                    <video
                      ref={videoRef}
                      src={activeVideoUrl}
                      crossOrigin="anonymous"
                      playsInline
                      className="absolute inset-0 z-0 h-full w-full object-contain"
                      onLoadedMetadata={(event) => {
                        const nextDuration = Number(event.currentTarget.duration.toFixed(3));
                        if (Number.isFinite(nextDuration) && nextDuration > 0) {
                          setDuration(nextDuration);
                        }
                      }}
                onTimeUpdate={(event) => {
                  setCurrentTime(event.currentTarget.currentTime);
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={() => {
                  setIsPlaying(false);
                  setStatusNote(
                    "The selected source could not be previewed in this browser. Try an MP4 variant for playback.",
                  );
                }}
              />
                  ) : (
                    <div
                      className="absolute inset-0 z-0 bg-cover bg-center"
                      style={{
                        backgroundImage: `url(${createPlaceholderFrameDataUrl(
                          currentTime,
                          "Open a source to begin",
                          "#ff8f57",
                        )})`,
                      }}
                    />
                  )}
                  <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between">
                    <div className="pointer-events-auto flex flex-wrap items-start justify-between gap-2 p-2 sm:p-3">
                      <div className="min-w-0 max-w-[min(100%,340px)]">
                        <button
                          type="button"
                          onClick={goToNewTweet}
                          className="skeu-btn skeu-btn--ghost skeu-btn--sm mb-1.5"
                        >
                          New tweet
                        </button>
                        <div className="line-clamp-1 font-display text-xs tracking-wide text-white text-shadow-[0_1px_2px_rgba(0,0,0,0.85)] sm:text-sm">
                          {session.title}
                        </div>
                        <div className="line-clamp-1 text-[0.65rem] leading-snug text-[#c5e1ff] text-shadow-[0_1px_2px_rgba(0,0,0,0.75)] sm:text-xs">
                          {session.subtitle}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-start justify-end gap-1.5">
                        <span className="skeu-pill px-2 py-1 text-xs shadow-md sm:px-2.5 sm:text-sm">
                          {storyboardCount} storyboard frames
                        </span>
                        <span className="skeu-pill skeu-pill--inverse max-w-[calc(100%-0.5rem)] truncate px-2 py-1 font-mono text-xs shadow-md sm:px-2.5 sm:text-sm">
                          <span>{formatTimestamp(currentTime)}</span>
                          <span className="mx-1 opacity-60">/</span>
                          <span>{formatTimestamp(duration)}</span>
                        </span>
                      </div>
                    </div>
                    <div className="pointer-events-auto flex justify-start p-2 sm:p-3">
                      <div className="skeu-glass relative flex max-w-full flex-wrap items-center gap-2 px-2.5 py-2 sm:gap-2.5 sm:px-3 sm:py-2.5">
                        <button
                          type="button"
                          onClick={() => void togglePlayback()}
                          className="skeu-btn skeu-btn--icon skeu-btn--sm !text-base sm:!text-lg"
                          aria-label={isPlaying ? "Pause" : "Play"}
                        >
                          {isPlaying ? "❚❚" : "▶"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void addCurrentFrame()}
                          className="skeu-btn skeu-btn--dark skeu-btn--sm"
                        >
                          Add frame
                        </button>
                        <button
                          type="button"
                          onClick={() => void autoStoryboardSelection()}
                          disabled={isAutoStoryboarding}
                          aria-busy={isAutoStoryboarding}
                          className="skeu-btn skeu-btn--warn skeu-btn--sm disabled:pointer-events-none disabled:opacity-70"
                        >
                          {isAutoStoryboarding ? "Scanning video..." : "Auto storyboard"}
                        </button>
                        {isAutoStoryboarding ? (
                          <span
                            className="skeu-chip skeu-chip--amber !animate-pulse !px-2 !py-1 !text-xs sm:!text-sm"
                            role="status"
                            aria-live="polite"
                          >
                            Finding the juicy bits in your timeline
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {isAutoStoryboarding ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pb-3 pt-12 sm:px-4 sm:pb-4 sm:pt-16"
                      role="status"
                      aria-live="polite"
                      aria-busy="true"
                      aria-label="Video storyboard analysis in progress"
                    >
                      <div className="skeu-inset skeu-inset--light mx-auto max-w-md px-3 py-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.35)] sm:max-w-lg sm:px-3.5 sm:py-3">
                        <div className="mb-2 flex items-center justify-center gap-2">
                          <span className="skeu-spinner" aria-hidden />
                          <span className="font-display text-xs font-bold tracking-wide text-[#0b1224] sm:text-sm">
                            Storyboard pass in progress
                          </span>
                        </div>
                        <div className="skeu-busy-rail">
                          <div className="skeu-busy-rail__fill" />
                        </div>
                        <p className="mt-2 text-center font-mono text-[0.65rem] leading-snug text-[#33415f] sm:text-xs">
                          The bar slides while the app reads the file. Long clips take longer.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 w-full min-w-0 flex-col gap-2 overflow-hidden lg:w-[min(300px,32vw)] lg:shrink-0 lg:self-stretch">
            <section className="skeu-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="skeu-panel__inner min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain !px-3 !py-2 sm:space-y-2 sm:!px-3.5 sm:!py-2.5">
                <div>
                <label className="skeu-label mb-0.5 block sm:mb-1" htmlFor="playable-variant">
                  Playable variant
                </label>
                <SkeuSelect
                  id="playable-variant"
                  className="skeu-select--field w-full"
                  value={selectedVariant}
                  onChange={setSelectedVariant}
                  options={(session.variants || []).map((variant) => {
                    const meta =
                      `${variant.label} ${variant.bitrate} ${variant.contentType} ${variant.url ?? ""}`.toLowerCase();
                    const adaptive =
                      meta.includes("hls") ||
                      meta.includes("m3u8") ||
                      meta.includes("adaptive") ||
                      meta.includes("master");
                    return {
                      value: variant.id,
                      label: `${variant.label} · ${variant.bitrate}`,
                      ...(adaptive ? { accent: "adaptive" as const } : {}),
                    };
                  })}
                />
                {isPreviewFallback ? (
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    HLS is selected, but this browser cannot preview it directly. The editor is
                    using the best MP4 variant for playback and frame capture.
                  </p>
                ) : null}
              </div>

              <div>
                <label className="skeu-label mb-0.5 block sm:mb-1">Storyboard mode</label>
                <div className="flex flex-wrap gap-1.5">
                  {(["Highlights", "Scenes", "Every 1s"] as StoryboardMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setStoryboardMode(mode)}
                      className={`skeu-chip !px-2.5 !py-1.5 !text-sm ${storyboardMode === mode ? "skeu-chip--active" : ""}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="skeu-label mb-0.5 block sm:mb-1">Quality</label>
                <div className="flex flex-wrap gap-1.5">
                  {(["Fast", "Balanced", "Best"] as QualityMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setQualityMode(mode)}
                      className={`skeu-chip !px-2.5 !py-1.5 !text-sm ${
                        qualityMode === mode ? "skeu-chip--amber" : ""
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="skeu-label mb-0.5 block sm:mb-1">Export format</label>
                <div className="flex flex-wrap gap-1.5">
                  {(["png", "jpeg", "webp"] as ExportFormat[]).map((format) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => setExportFormat(format)}
                      className={`skeu-chip !px-2.5 !py-1.5 !text-sm ${exportFormat === format ? "skeu-chip--active" : ""}`}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <label className="skeu-inset skeu-inset--light flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-[#1e2a4a] sm:px-3 sm:text-sm">
                Remove near-duplicates
                <input
                  type="checkbox"
                  checked={dedupeEnabled}
                  onChange={(event) => setDedupeEnabled(event.target.checked)}
                  className="skeu-check rounded border-[#0b1224]/30"
                />
              </label>

              <div className="grid gap-1.5">
                <button
                  type="button"
                  onClick={exportSelection}
                  disabled={isExporting}
                  className="skeu-btn skeu-btn--primary w-full py-2 disabled:pointer-events-none sm:py-2.5"
                >
                  {isExporting ? "Packaging..." : "Download ZIP"}
                </button>
                <button
                  type="button"
                  onClick={copySelectionToClipboard}
                  disabled={isCopyingSelection}
                  className="skeu-btn skeu-btn--ghost w-full py-2 disabled:pointer-events-none sm:py-2.5"
                >
                  {isCopyingSelection ? "Copying..." : "Copy storyboard"}
                </button>
                <button
                  type="button"
                  onClick={() => void downloadAudioTrack()}
                  disabled={isDownloadingAudio}
                  className="skeu-btn skeu-btn--ghost w-full py-2 disabled:pointer-events-none sm:py-2.5"
                >
                  {isDownloadingAudio ? "Extracting audio..." : "Download audio"}
                </button>
                <button
                  type="button"
                  onClick={clearStoryboard}
                  className="skeu-btn skeu-btn--ghost w-full py-2 sm:py-2.5"
                >
                  Clear storyboard
                </button>
              </div>
              {statusNote.trim() ? (
                <div className="skeu-inset skeu-inset--light px-2.5 py-2 text-xs leading-5 text-[#33415f] sm:px-3 sm:text-sm">
                  {statusNote}
                </div>
              ) : null}
              </div>
            </section>
          </aside>
        </div>

        <div className="skeu-panel flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden lg:max-h-[min(320px,36dvh)]">
          <div className="skeu-panel__inner flex min-h-0 flex-1 flex-col gap-2 overflow-hidden !px-3 !py-2 sm:!px-3.5 sm:!py-2.5">
            <div className="skeu-inset skeu-inset--light flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-2 sm:px-3.5 sm:py-2.5">
              <div className="flex min-w-0 shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div
                  ref={timelineScrollRef}
                  className="skeu-timeline-scroll min-h-[3.75rem] min-w-0 w-full flex-1 basis-0"
                >
                  <div
                    ref={timelineTrackRef}
                    className="skeu-timeline-track relative min-w-full shrink-0"
                    style={{
                      width: `${timelineZoom * 100}%`,
                      minWidth: timelineZoom <= TIMELINE_ZOOM_MIN ? "100%" : undefined,
                    }}
                  >
                    <div className="skeu-timeline-lane">
                      <div className="skeu-timeline-line" />
                      <input
                        type="range"
                        min={0}
                        max={duration || 1}
                        step={0.001}
                        value={Math.min(currentTime, duration || 0)}
                        onChange={(event) => scrubTo(Number(event.target.value))}
                        aria-label="Scrub timeline"
                        className="skeu-range--timeline w-full"
                      />
                  {storyboardFramesSorted.map((frame) => {
                        const isDotActive = frame.id === activeFrameId;
                        return (
                          <button
                            key={frame.id}
                            type="button"
                            onClick={() => {
                              scrubTo(frame.timestamp);
                              scrollFilmstripToFrame(frame.id);
                            }}
                            className={`absolute top-1/2 z-[4] -translate-x-1/2 -translate-y-1/2 rounded-full transition-all ${
                              isDotActive
                                ? "h-4 w-4 border-[2.5px] border-white shadow-[0_0_0_2px_rgba(80,144,255,0.7),0_2px_0_rgba(0,0,0,0.35)]"
                                : "h-3 w-3 border-2 border-white/80 shadow-[0_2px_0_rgba(0,0,0,0.35)]"
                            }`}
                            style={{
                              left: `${(frame.timestamp / timelineSpan) * 100}%`,
                              backgroundColor: frame.color,
                            }}
                            aria-label={`Jump to ${frame.label}`}
                          />
                        );
                      })}
                    </div>

                    {timelineSpan > 0 && (() => {
                      const interval = pickTickInterval(timelineSpan, timelineZoom);
                      const precision = interval < 1 ? 2 : 0;
                      const ticks: { time: number; pct: number }[] = [];
                      const count = Math.floor(timelineSpan / interval);
                      for (let i = 0; i <= count; i++) {
                        const t = parseFloat((i * interval).toFixed(precision));
                        ticks.push({ time: t, pct: (t / timelineSpan) * 100 });
                      }
                      const lastT = ticks[ticks.length - 1]?.time ?? 0;
                      if (timelineSpan - lastT > interval * 0.3) {
                        ticks.push({ time: parseFloat(timelineSpan.toFixed(precision)), pct: 100 });
                      }
                      return (
                        <div className="skeu-timeline-ruler" aria-hidden>
                          {ticks.map((tick) => (
                            <div
                              key={tick.time}
                              className="skeu-timeline-ruler__tick"
                              style={{ left: `${tick.pct}%` }}
                            >
                              <div className="skeu-timeline-ruler__line" />
                              <span className="skeu-timeline-ruler__label">
                                {formatRulerLabel(tick.time, interval)}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center justify-start gap-1 sm:justify-end sm:gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setTimelineZoom((z) =>
                        Math.max(TIMELINE_ZOOM_MIN, Math.round((z - 1) * 100) / 100),
                      )
                    }
                    disabled={timelineZoom <= TIMELINE_ZOOM_MIN}
                    className="skeu-chip !px-1.5 !py-1.5 disabled:pointer-events-none disabled:opacity-45"
                    aria-label="Zoom timeline out"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="7" cy="7" r="4.5" />
                      <path d="M10.2 10.2 14 14" />
                      <path d="M5 7h4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setTimelineZoom((z) =>
                        Math.min(TIMELINE_ZOOM_MAX, Math.round((z + 1) * 100) / 100),
                      )
                    }
                    disabled={timelineZoom >= TIMELINE_ZOOM_MAX}
                    className="skeu-chip !px-1.5 !py-1.5 disabled:pointer-events-none disabled:opacity-45"
                    aria-label="Zoom timeline in"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="7" cy="7" r="4.5" />
                      <path d="M10.2 10.2 14 14" />
                      <path d="M5 7h4" />
                      <path d="M7 5v4" />
                    </svg>
                  </button>
                  <div className="hidden h-6 w-px shrink-0 rounded-full bg-[#0b1224]/20 sm:mx-0.5 sm:block" aria-hidden />
                  <button type="button" onClick={() => stepByFrames(-1)} className="skeu-chip !px-2 !py-1.5 !text-sm">
                    -1f
                  </button>
                  <button type="button" onClick={() => stepByFrames(1)} className="skeu-chip !px-2 !py-1.5 !text-sm">
                    +1f
                  </button>
                  <button type="button" onClick={() => stepBySeconds(-1)} className="skeu-chip !px-2 !py-1.5 !text-sm">
                    -1s
                  </button>
                  <button type="button" onClick={() => stepBySeconds(1)} className="skeu-chip !px-2 !py-1.5 !text-sm">
                    +1s
                  </button>
                </div>
              </div>

              <div
                ref={filmstripRef}
                className="skeu-scroll mt-2 flex min-h-0 flex-1 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-0.5 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5"
              >
                {storyboardFramesSorted.map((frame) => {
                  const isActive = frame.id === activeFrameId;
                  return (
                    <article
                      key={frame.id}
                      ref={(node) => {
                        storyCardRefs.current[frame.id] = node;
                      }}
                      className={`skeu-story-card relative w-[96px] shrink-0 sm:w-[108px] ${isActive ? "skeu-story-card--active" : ""}`}
                    >
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => scrubTo(frame.timestamp)}
                          className="block w-full text-left"
                        >
                          <div
                            className="skeu-thumb aspect-video bg-cover bg-center"
                            style={{
                              backgroundImage: `url(${getStoryboardPreview(frame)})`,
                            }}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFrame(frame.id)}
                          className="skeu-btn skeu-btn--icon skeu-btn--sm absolute right-1.5 bottom-1.5 !h-7 !w-7 !text-xs opacity-0 transition-opacity hover:!opacity-100 focus-visible:!opacity-100 [article:hover_&]:opacity-80"
                          aria-label={`Remove ${frame.label}`}
                        >
                          ×
                        </button>
                      </div>
                      <div className="mt-1 px-0.5">
                        <div className="truncate text-xs font-medium sm:text-sm">{frame.label}</div>
                        <div
                          className={`truncate text-[0.65rem] sm:text-xs ${isActive ? "text-[#c5e1ff]" : "text-[#475569]"}`}
                        >
                          {formatTimestamp(frame.timestamp)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
