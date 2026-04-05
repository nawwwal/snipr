"use client";

import JSZip from "jszip";
import { useEffect, useRef, useState } from "react";

import { SkeuSelect } from "@/components/skeu-select";
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

type SelectedFrame = StoryboardFrame & {
  filename: string;
  imageDataUrl: string;
};

type ExportFormat = "png" | "jpeg" | "webp";
type QualityMode = "Fast" | "Balanced" | "Best";
const AUTO_STORYBOARD_LIMIT = 8;

type SceneSample = {
  score: number;
  timestamp: number;
};

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

  return `/api/media-proxy?url=${encodeURIComponent(url)}`;
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

function scoreFrameDelta(currentPixels: Uint8ClampedArray, previousPixels: Uint8ClampedArray) {
  let totalDelta = 0;

  for (let index = 0; index < currentPixels.length; index += 4) {
    totalDelta += Math.abs(currentPixels[index] - previousPixels[index]);
    totalDelta += Math.abs(currentPixels[index + 1] - previousPixels[index + 1]);
    totalDelta += Math.abs(currentPixels[index + 2] - previousPixels[index + 2]);
  }

  return totalDelta / ((currentPixels.length / 4) * 255 * 3);
}

function getSceneDetectionConfig(mode: StoryboardMode, qualityMode: QualityMode, dedupeEnabled: boolean) {
  const sampleStep =
    qualityMode === "Best" ? 0.2 : qualityMode === "Balanced" ? 0.35 : 0.5;
  const targetCount = mode === "Highlights" ? 8 : 10;
  const minSpacing = mode === "Highlights" ? 1.1 : dedupeEnabled ? 0.8 : 0.5;
  const sensitivityFloor = mode === "Highlights" ? 0.09 : 0.07;

  return { minSpacing, sampleStep, sensitivityFloor, targetCount };
}

function pickSceneTimestamps(
  samples: SceneSample[],
  duration: number,
  targetCount: number,
  minSpacing: number,
  sensitivityFloor: number,
) {
  if (!samples.length) {
    return [];
  }

  const scores = samples.map((sample) => sample.score);
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance =
    scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
  const standardDeviation = Math.sqrt(variance);
  const threshold = Math.max(sensitivityFloor, mean + standardDeviation * 0.65);

  const localPeaks = samples.filter((sample, index) => {
    const previous = samples[index - 1];
    const next = samples[index + 1];

    return (
      sample.score >= threshold &&
      (!previous || sample.score >= previous.score) &&
      (!next || sample.score >= next.score)
    );
  });

  const rankedCandidates = [...localPeaks, ...samples]
    .sort((left, right) => right.score - left.score)
    .filter(
      (sample, index, collection) =>
        collection.findIndex((candidate) => candidate.timestamp === sample.timestamp) === index,
    );

  const picked: number[] = [Math.min(0.15, Math.max(0, duration - 0.1))];

  for (const candidate of rankedCandidates) {
    if (picked.length >= targetCount) {
      break;
    }

    if (picked.every((timestamp) => Math.abs(timestamp - candidate.timestamp) >= minSpacing)) {
      picked.push(candidate.timestamp);
    }
  }

  if (picked.length < targetCount) {
    const fallback = buildStoryboard(duration, targetCount <= 8 ? "Highlights" : "Scenes")
      .map((frame) => frame.timestamp)
      .filter((timestamp) => picked.every((current) => Math.abs(current - timestamp) >= minSpacing / 2));

    for (const timestamp of fallback) {
      if (picked.length >= targetCount) {
        break;
      }

      picked.push(timestamp);
    }
  }

  return picked
    .sort((left, right) => left - right)
    .slice(0, targetCount)
    .map((timestamp) => Number(Math.min(timestamp, Math.max(0.1, duration - 0.1)).toFixed(3)));
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

  const { minSpacing, sampleStep, sensitivityFloor, targetCount } = getSceneDetectionConfig(
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
  const width = 64;
  const height = Math.max(36, Math.round(width / ((video.videoWidth || 16) / (video.videoHeight || 9))));
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas export is unavailable for scene detection.");
  }

  let previousPixels: Uint8ClampedArray | null = null;
  const samples: SceneSample[] = [];
  const maxTimestamp = Math.max(sampleStep, duration - 0.1);

  for (
    let timestamp = Math.min(0.15, maxTimestamp);
    timestamp <= maxTimestamp;
    timestamp += sampleStep
  ) {
    await waitForVideoSeek(video, Number(timestamp.toFixed(3)));
    context.drawImage(video, 0, 0, width, height);
    const currentPixels = context.getImageData(0, 0, width, height).data;

    if (previousPixels) {
      samples.push({
        score: scoreFrameDelta(currentPixels, previousPixels),
        timestamp: Number(timestamp.toFixed(3)),
      });
    }

    previousPixels = new Uint8ClampedArray(currentPixels);
  }

  video.pause();
  video.removeAttribute("src");
  video.load();

  const timestamps = pickSceneTimestamps(
    samples,
    duration,
    targetCount,
    minSpacing,
    sensitivityFloor,
  );

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
  const [selectedFrames, setSelectedFrames] = useState<SelectedFrame[]>([]);
  const [selectedVariant, setSelectedVariant] = useState("");
  const [qualityMode, setQualityMode] = useState<QualityMode>("Balanced");
  const [dedupeEnabled, setDedupeEnabled] = useState(true);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [statusNote, setStatusNote] = useState("Ready for the first source.");
  const [isExporting, setIsExporting] = useState(false);
  const [isCopyingSelection, setIsCopyingSelection] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [storyboardPreviewUrls, setStoryboardPreviewUrls] = useState<Record<string, string>>({});

  const videoRef = useRef<HTMLVideoElement>(null);

  const activeVariant =
    session?.variants.find((variant) => variant.id === selectedVariant) ?? session?.variants[0] ?? null;
  const fallbackPreviewVariant =
    session?.variants.find((variant) => variant.contentType === "video/mp4") ?? session?.variants[0] ?? null;
  const previewVariant =
    activeVariant && (!isHlsContentType(activeVariant.contentType) || supportsNativeHlsPlayback())
      ? activeVariant
      : fallbackPreviewVariant;
  const activeVideoUrl = createPreviewUrl(previewVariant?.url ?? session?.videoUrl ?? null);
  const selectedCount = selectedFrames.length;
  const selectedFramesSorted = [...selectedFrames].sort((left, right) => left.timestamp - right.timestamp);
  const isPreviewFallback =
    activeVariant !== null && previewVariant !== null && activeVariant.id !== previewVariant.id;

  function getStoryboardPreview(frame: StoryboardFrame) {
    return (
      storyboardPreviewUrls[frame.id] ??
      createPlaceholderFrameDataUrl(frame.timestamp, frame.label, frame.color)
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function generateStoryboard() {
      if (!activeVideoUrl || !duration) {
        setStoryboardFrames(buildStoryboard(duration || 12, storyboardMode));
        return;
      }

      try {
        const nextFrames = await detectStoryboardFramesFromVideo(
          activeVideoUrl,
          duration,
          storyboardMode,
          qualityMode,
          dedupeEnabled,
        );

        if (!cancelled) {
          setStoryboardFrames(nextFrames);
        }
      } catch {
        if (!cancelled) {
          setStoryboardFrames(buildStoryboard(duration, storyboardMode));
        }
      }
    }

    void generateStoryboard();

    return () => {
      cancelled = true;
    };
  }, [activeVideoUrl, dedupeEnabled, duration, qualityMode, storyboardMode]);

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

  async function addFrame(frame: StoryboardFrame) {
    const duplicate = selectedFrames.some(
      (selectedFrame) => Math.abs(selectedFrame.timestamp - frame.timestamp) < 0.05,
    );

    if (duplicate) {
      setStatusNote(`Frame ${formatTimestamp(frame.timestamp)} is already in the tray.`);
      return;
    }

    const imageDataUrl = await captureFrame(frame);
    const nextFrame: SelectedFrame = {
      ...frame,
      filename: `frame-${slugifyTimestamp(frame.timestamp)}`,
      imageDataUrl,
    };

    setSelectedFrames((current) => [...current, nextFrame]);
    setStatusNote(`Added ${frame.label} at ${formatTimestamp(frame.timestamp)} to the selection tray.`);
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
    const framesToAdd = storyboardFrames.slice(0, AUTO_STORYBOARD_LIMIT);
    const nextFrames: SelectedFrame[] = [];

    for (const frame of framesToAdd) {
      // Capture sequentially so the video seek state stays deterministic.
      const imageDataUrl = await captureFrame(frame);
      nextFrames.push({
        ...frame,
        filename: `frame-${slugifyTimestamp(frame.timestamp)}`,
        imageDataUrl,
      });
    }

    setSelectedFrames(nextFrames);

    setStatusNote(`Auto storyboard selected ${framesToAdd.length} frames.`);
  }

  async function exportSelection() {
    if (!selectedFrames.length) {
      setStatusNote("Select at least one frame before exporting.");
      return;
    }

    setIsExporting(true);

    try {
      const zip = new JSZip();
      const projectName = session?.title || "frame-extractor-session";

      const metadata = selectedFramesSorted.map((frame, index) => ({
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

      for (const frame of selectedFramesSorted) {
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
      setStatusNote(`Exported ${selectedFrames.length} selected frames as a ZIP package.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Export failed while packaging frames.";
      setStatusNote(message);
    } finally {
      setIsExporting(false);
    }
  }

  async function copySelectionToClipboard() {
    if (!selectedFrames.length) {
      setStatusNote("Select at least one frame before copying.");
      return;
    }

    if (!("clipboard" in navigator) || typeof window.ClipboardItem === "undefined") {
      setStatusNote("Clipboard image copy is not available in this browser.");
      return;
    }

    setIsCopyingSelection(true);

    try {
      const pngItems = await Promise.all(
        selectedFramesSorted.map(async (frame) => {
          const converted = await convertDataUrl(frame.imageDataUrl, "png");
          const blob = await dataUrlToBlob(converted);

          return new window.ClipboardItem({
            [blob.type]: blob,
          });
        }),
      );

      try {
        await navigator.clipboard.write(pngItems);
        setStatusNote(`Copied ${selectedFrames.length} selected frames to the clipboard.`);
        return;
      } catch {
        const html = selectedFramesSorted
          .map(
            (frame) => `
              <figure style="margin:0 0 16px 0;">
                <img src="${frame.imageDataUrl}" alt="${frame.label}" style="max-width:100%;display:block;border-radius:12px;" />
                <figcaption style="margin-top:6px;font:12px sans-serif;color:#334155;">
                  ${frame.label} · ${formatTimestamp(frame.timestamp)}
                </figcaption>
              </figure>
            `,
          )
          .join("");
        const plainText = selectedFramesSorted
          .map((frame) => `${frame.label} — ${formatTimestamp(frame.timestamp)}`)
          .join("\n");

        await navigator.clipboard.write([
          new window.ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]);

        setStatusNote(
          `Copied ${selectedFrames.length} selected frames as rich clipboard content.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to copy selected frames to the clipboard.";
      setStatusNote(message);
    } finally {
      setIsCopyingSelection(false);
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

      setSession(payload);
      setDuration(payload.duration);
      setCurrentTime(Math.min(12.345, payload.duration));
      setSelectedVariant(payload.variants[0]?.id ?? "");
      setSelectedFrames([]);
      setIsPlaying(false);
      setAppState("ready");
      setStatusNote("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to prepare the source.";
      setAppState("error");
      setErrorMessage(message);
    }
  }

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
                  <span className="font-display font-bold tracking-wide">Frame Extractor</span>
                  <span className="mx-1.5 opacity-90 sm:mx-2" aria-hidden>
                    —
                  </span>
                  <span className="font-normal tracking-normal">Storyboard-first frame extraction</span>
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
                      className="skeu-input h-11 min-w-0 flex-1 sm:h-12"
                      placeholder="https://x.com/.../status/..."
                      type="url"
                    />
                    <button
                      type="button"
                      onClick={openSource}
                      className="skeu-btn skeu-btn--primary h-11 shrink-0 px-5 sm:h-12 sm:px-7"
                    >
                      {appState === "loading" ? "Resolving..." : "storyboard it"}
                    </button>
                  </div>
                </div>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceInput("https://x.com/carterfmotion/status/2040579649722302896");
                    }}
                    className="skeu-btn skeu-btn--ghost skeu-btn--sm"
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
                          onClick={() => {
                            setSession(null);
                            setAppState("idle");
                            setSelectedFrames([]);
                            setErrorMessage(null);
                            setIsPlaying(false);
                          }}
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
                          {selectedCount} selected
                        </span>
                        <span className="skeu-pill skeu-pill--inverse max-w-[calc(100%-0.5rem)] truncate px-2 py-1 font-mono text-xs shadow-md sm:px-2.5 sm:text-sm">
                          <span>{formatTimestamp(currentTime)}</span>
                          <span className="mx-1 opacity-60">/</span>
                          <span>{formatTimestamp(duration)}</span>
                        </span>
                      </div>
                    </div>
                    <div className="pointer-events-auto flex justify-start p-2 sm:p-3">
                      <div className="skeu-inset flex max-w-full flex-wrap items-center gap-2 px-2.5 py-2 shadow-md sm:gap-2.5 sm:px-3 sm:py-2.5">
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
                          className="skeu-btn skeu-btn--warn skeu-btn--sm"
                        >
                          Auto storyboard
                        </button>
                      </div>
                    </div>
                  </div>
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
                  {isCopyingSelection ? "Copying..." : "Copy all selected"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFrames([])}
                  className="skeu-btn skeu-btn--ghost w-full py-2 sm:py-2.5"
                >
                  Clear selected frames
                </button>
              </div>
              <div className="skeu-inset skeu-inset--light px-2.5 py-2 text-xs leading-5 text-[#33415f] sm:px-3 sm:text-sm">
                {statusNote}
              </div>
              </div>
            </section>
          </aside>
        </div>

        <div className="skeu-panel flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden lg:max-h-[min(320px,36dvh)]">
          <div className="skeu-panel__inner flex min-h-0 flex-1 flex-col gap-2 overflow-hidden !px-3 !py-2 sm:!px-3.5 sm:!py-2.5">
            <div className="skeu-inset skeu-inset--light flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-2 sm:px-3.5 sm:py-2.5">
              <div className="flex min-w-0 shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="skeu-timeline-track relative min-w-0 flex-1 shrink-0">
                  <div className="skeu-timeline-lane">
                    <div className="skeu-timeline-line" />
                    {selectedFramesSorted.map((frame) => (
                      <div
                        key={`selected-${frame.id}`}
                        className="absolute top-1/2 z-[1] h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/30 bg-[#0b1224] shadow-[0_2px_0_rgba(0,0,0,0.25)]"
                        style={{ left: `${duration ? (frame.timestamp / duration) * 100 : 0}%` }}
                      />
                    ))}
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
                    {storyboardFrames.map((frame) => (
                      <button
                        key={frame.id}
                        type="button"
                        onClick={() => scrubTo(frame.timestamp)}
                        className="absolute top-1/2 z-[4] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_2px_0_rgba(0,0,0,0.35)]"
                        style={{
                          left: `${duration ? (frame.timestamp / duration) * 100 : 0}%`,
                          backgroundColor: frame.color,
                        }}
                        aria-label={`Jump to ${frame.label}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap justify-start gap-1 sm:justify-end sm:gap-1.5">
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

              <div className="skeu-scroll mt-2 flex min-h-0 flex-1 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-0.5 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5">
                {storyboardFrames.map((frame) => {
                  const isSelected = selectedFramesSorted.some(
                    (selectedFrame) => selectedFrame.id === frame.id,
                  );

                  return (
                    <article
                      key={frame.id}
                      className={`skeu-story-card relative w-[96px] shrink-0 sm:w-[108px] ${
                        isSelected ? "skeu-story-card--active" : ""
                      }`}
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
                          onClick={() => void addFrame(frame)}
                          className={`skeu-btn skeu-btn--icon skeu-btn--sm absolute right-1.5 bottom-1.5 !h-8 !w-8 !text-sm ${
                            isSelected ? "!bg-white !text-[#0b1224]" : ""
                          }`}
                          aria-label={isSelected ? `${frame.label} added` : `Add ${frame.label}`}
                        >
                          {isSelected ? "✓" : "+"}
                        </button>
                      </div>
                      <div className="mt-1 px-0.5">
                        <div className="truncate text-xs font-medium sm:text-sm">{frame.label}</div>
                        <div
                          className={`truncate text-[0.65rem] sm:text-xs ${isSelected ? "text-[#c5e1ff]" : "text-[#475569]"}`}
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
