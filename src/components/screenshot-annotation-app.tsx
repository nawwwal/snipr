"use client";

import { useEffect, useRef, useState } from "react";

import {
  SNIPR_ARTIFACT_SCHEMA_VERSION,
  type SniprActiveTabContext,
  type SniprAnnotationDocument,
} from "@/lib/snipr-artifact";

type ScreenshotAnnotationAppProps = {
  imageDataUrl: string;
  source: SniprActiveTabContext;
};

type Rect = SniprAnnotationDocument["annotations"][number];

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function filenameFromSource(source: SniprActiveTabContext) {
  try {
    return `${new URL(source.url).hostname.replace(/[^a-z0-9-]+/gi, "-")}-snipr.png`;
  } catch {
    return "snipr-screenshot.png";
  }
}

export function ScreenshotAnnotationApp({ imageDataUrl, source }: ScreenshotAnnotationAppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageSize, setImageSize] = useState({ width: 1280, height: 720 });
  const [annotations, setAnnotations] = useState<Rect[]>([]);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState("Drag on the screenshot to draw a highlight box.");
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = imageDataUrl;
  }, [imageDataUrl]);

  function drawCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Screenshot canvas is not available.");
    }

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Screenshot canvas could not be prepared.");
    }

    const image = new Image();
    return new Promise<string>((resolve, reject) => {
      image.onload = () => {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        context.drawImage(image, 0, 0);
        for (const annotation of annotations) {
          context.save();
          context.strokeStyle = annotation.color ?? "#ff3fab";
          context.fillStyle = annotation.kind === "highlight" ? "rgba(255, 235, 92, 0.28)" : "rgba(255, 63, 171, 0.12)";
          context.lineWidth = Math.max(8, Math.round(image.naturalWidth / 220));
          context.setLineDash(annotation.kind === "highlight" ? [] : [18, 10]);
          context.fillRect(annotation.x, annotation.y, annotation.width ?? 0, annotation.height ?? 0);
          context.strokeRect(annotation.x, annotation.y, annotation.width ?? 0, annotation.height ?? 0);
          context.restore();
        }
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => reject(new Error("Screenshot image could not be loaded."));
      image.src = imageDataUrl;
    });
  }

  function pointFromEvent(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = imageSize.width / rect.width;
    const scaleY = imageSize.height / rect.height;
    return {
      x: Math.round((event.clientX - rect.left) * scaleX),
      y: Math.round((event.clientY - rect.top) * scaleY),
    };
  }

  async function copyOutput() {
    try {
      const dataUrl = await drawCanvas();
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setStatus("Copied annotated screenshot to clipboard.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to copy screenshot.");
    }
  }

  async function downloadOutput() {
    try {
      downloadDataUrl(await drawCanvas(), filenameFromSource(source));
      setStatus("Downloaded annotated screenshot.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to download screenshot.");
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("Screen recording is not available in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const nextRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recordingChunksRef.current = [];
      nextRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      nextRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordingChunksRef.current, { type: "video/webm" });
        setRecordedUrl(URL.createObjectURL(blob));
        setRecorder(null);
        setStatus("Recording captured. Download it or make a quick storyboard contact sheet.");
      };
      nextRecorder.start();
      setRecorder(nextRecorder);
      setStatus("Recording browser evidence. Stop when the important moment is captured.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to start recording.");
    }
  }

  function stopRecording() {
    recorder?.stop();
  }

  function downloadRecording() {
    if (!recordedUrl) {
      setStatus("Record a clip first.");
      return;
    }
    downloadDataUrl(recordedUrl, "snipr-recording.webm");
  }

  async function downloadRecordingStoryboard() {
    if (!recordedUrl) {
      setStatus("Record a clip first.");
      return;
    }

    const video = document.createElement("video");
    video.src = recordedUrl;
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Recorded clip could not be read."));
    });

    const canvas = document.createElement("canvas");
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const cols = 3;
    const rows = 2;
    canvas.width = width * cols;
    canvas.height = height * rows;
    const context = canvas.getContext("2d");
    if (!context) {
      setStatus("Could not build recording storyboard.");
      return;
    }

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 6;
    for (let index = 0; index < cols * rows; index += 1) {
      video.currentTime = Math.min(duration - 0.1, (duration / (cols * rows + 1)) * (index + 1));
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      });
      context.drawImage(video, (index % cols) * width, Math.floor(index / cols) * height, width, height);
    }

    downloadDataUrl(canvas.toDataURL("image/png"), "snipr-recording-storyboard.png");
    setStatus("Downloaded a quick storyboard contact sheet from the recording.");
  }

  return (
    <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-3 py-3 sm:px-6 sm:py-5">
      <section className="skeu-window flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="skeu-titlebar shrink-0">
          <div className="skeu-titlebar__caps mr-1 shrink-0 pl-0.5" aria-hidden>
            <span className="skeu-titlecap skeu-titlecap--blue" />
            <span className="skeu-titlecap skeu-titlecap--purple" />
            <span className="skeu-titlecap skeu-titlecap--red" />
          </div>
          <div className="skeu-titlebar__lead min-w-0 flex-1 px-2 py-1.5 text-sm text-white">
            screenshot annotation deck
          </div>
        </div>
        <div className="skeu-frame-body grid min-h-0 flex-1 gap-3 overflow-hidden p-3 lg:grid-cols-[1fr_280px]">
          <div className="skeu-inset flex min-h-0 items-center justify-center overflow-auto bg-[#07101f] p-3">
            <div
              className="relative max-h-full max-w-full cursor-crosshair overflow-hidden rounded-[18px] shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
              onPointerDown={(event) => setDragStart(pointFromEvent(event))}
              onPointerUp={(event) => {
                if (!dragStart) {
                  return;
                }
                const point = pointFromEvent(event);
                const rect = {
                  id: `annotation-${Date.now()}`,
                  kind: "highlight" as const,
                  x: Math.min(dragStart.x, point.x),
                  y: Math.min(dragStart.y, point.y),
                  width: Math.abs(point.x - dragStart.x),
                  height: Math.abs(point.y - dragStart.y),
                  color: "#ff3fab",
                  opacity: 0.8,
                  zIndex: annotations.length + 1,
                };
                setDragStart(null);
                if ((rect.width ?? 0) > 12 && (rect.height ?? 0) > 12) {
                  setAnnotations((current) => [...current, rect]);
                  setStatus("Added highlight box. Drag again or export the marked screenshot.");
                }
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- extension-local screenshot data URL */}
              <img src={imageDataUrl} alt="Captured browser tab" className="block max-h-[72dvh] max-w-full select-none" draggable={false} />
              {annotations.map((annotation) => (
                <div
                  key={annotation.id}
                  className="pointer-events-none absolute border-4 border-[#ff3fab]/90 bg-[#fff46b]/25 shadow-[0_0_22px_rgba(255,63,171,0.55)]"
                  style={{
                    left: `${(annotation.x / imageSize.width) * 100}%`,
                    top: `${(annotation.y / imageSize.height) * 100}%`,
                    width: `${((annotation.width ?? 0) / imageSize.width) * 100}%`,
                    height: `${((annotation.height ?? 0) / imageSize.height) * 100}%`,
                  }}
                />
              ))}
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <aside className="skeu-panel min-h-0 overflow-hidden">
            <div className="skeu-panel__inner flex h-full flex-col gap-3 p-3">
              <div className="skeu-inset skeu-inset--light px-3 py-2 text-sm text-[#1e2a4a]">
                <p className="font-display text-base text-[#121a33]">source</p>
                <p className="break-words">{source.title ?? source.url}</p>
              </div>
              <button className="skeu-btn skeu-btn--ghost w-full py-2" type="button" onClick={() => setAnnotations((current) => current.slice(0, -1))}>
                Undo mark
              </button>
              <button className="skeu-btn skeu-btn--ghost w-full py-2" type="button" onClick={() => setAnnotations([])}>
                Clear marks
              </button>
              <button className="skeu-btn skeu-btn--primary w-full py-2" type="button" onClick={() => void copyOutput()}>
                Copy image
              </button>
              <button className="skeu-btn skeu-btn--ghost w-full py-2" type="button" onClick={() => void downloadOutput()}>
                Download PNG
              </button>
              <div className="skeu-inset skeu-inset--light px-3 py-2 text-sm text-[#1e2a4a]">
                <p className="font-display text-base text-[#121a33]">recording</p>
                <p>Capture a browser-supported tab or screen clip, then download it or sample a contact sheet.</p>
              </div>
              <button className="skeu-btn skeu-btn--ghost w-full py-2" type="button" onClick={() => void startRecording()} disabled={Boolean(recorder)}>
                {recorder ? "Recording..." : "Start recording"}
              </button>
              <button className="skeu-btn skeu-btn--warn w-full py-2" type="button" onClick={stopRecording} disabled={!recorder}>
                Stop recording
              </button>
              <button className="skeu-btn skeu-btn--ghost w-full py-2" type="button" onClick={downloadRecording} disabled={!recordedUrl}>
                Download recording
              </button>
              <button className="skeu-btn skeu-btn--ghost w-full py-2" type="button" onClick={() => void downloadRecordingStoryboard()} disabled={!recordedUrl}>
                Download recording storyboard
              </button>
              <div className="skeu-inset skeu-inset--light mt-auto px-3 py-2 text-sm leading-5 text-[#33415f]">
                {status}
              </div>
              <script
                type="application/json"
                suppressHydrationWarning
                dangerouslySetInnerHTML={{
                  __html: JSON.stringify({
                    schemaVersion: SNIPR_ARTIFACT_SCHEMA_VERSION,
                    source,
                    canvas: imageSize,
                    annotations,
                    updatedAt: new Date().toISOString(),
                  } satisfies SniprAnnotationDocument),
                }}
              />
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
