export type SourceType = "x-url" | "direct-url" | "upload";

export type StoryboardMode = "Highlights" | "Scenes" | "Every 1s";

export type VideoVariant = {
  id: string;
  label: string;
  bitrate: string;
  resolution: string;
  contentType: string;
  url?: string;
  recommended?: boolean;
};

export type StoryboardFrame = {
  id: string;
  timestamp: number;
  label: string;
  note: string;
  color: string;
  kind: "scene" | "highlight" | "interval";
};

export type ResolveSourceResponse = {
  sourceType: SourceType;
  normalizedInput: string;
  title: string;
  subtitle: string;
  duration: number;
  statusId?: string;
  variants: VideoVariant[];
  storyboard: StoryboardFrame[];
  videoUrl: string | null;
  previewMode: "local" | "server";
  complianceNote: string;
};

const X_STATUS_PATTERN =
  /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/status|[^/]+\/status)\/(\d+)/i;

const DIRECT_VIDEO_PATTERN =
  /^https?:\/\/.+\.(?:mp4|webm|mov|m3u8)(?:\?.*)?$/i;

const FRAME_COLORS = [
  "#ff8f57",
  "#ffc24d",
  "#73f0c8",
  "#5cb8ff",
  "#8e87ff",
  "#ff7cbc",
];

export function normalizeSourceInput(input: string): string {
  return input.trim();
}

export function detectSourceType(input: string): SourceType {
  const normalized = normalizeSourceInput(input);

  if (X_STATUS_PATTERN.test(normalized)) {
    return "x-url";
  }

  if (DIRECT_VIDEO_PATTERN.test(normalized)) {
    return "direct-url";
  }

  return "upload";
}

export function extractStatusId(input: string): string | null {
  const match = input.match(X_STATUS_PATTERN);
  return match?.[1] ?? null;
}

export function formatTimestamp(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.round((totalSeconds % 1) * 1000);
  const hours = Math.floor(minutes / 60);
  const displayMinutes = minutes % 60;

  return [hours, displayMinutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":")
    .concat(`.${milliseconds.toString().padStart(3, "0")}`);
}

export function buildStoryboard(
  duration: number,
  mode: StoryboardMode,
): StoryboardFrame[] {
  const safeDuration = Math.max(duration, 12);
  const count =
    mode === "Highlights" ? 8 : mode === "Scenes" ? 10 : Math.min(14, Math.ceil(safeDuration));
  const step = safeDuration / (count + 1);

  return Array.from({ length: count }, (_, index) => {
    const timestamp =
      mode === "Every 1s"
        ? Math.min(index + 1, Math.max(1, safeDuration - 0.25))
        : Number(((index + 1) * step).toFixed(3));

    return {
      id: `${mode.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`,
      timestamp,
      label:
        mode === "Highlights"
          ? `Highlight ${index + 1}`
          : mode === "Scenes"
            ? `Scene ${index + 1}`
            : `Every 1s · ${index + 1}`,
      note:
        mode === "Highlights"
          ? "High-signal frame chosen for scanning the clip quickly."
          : mode === "Scenes"
            ? "Likely boundary frame for reviewing shot changes."
            : "Even interval sample for exhaustive browsing.",
      color: FRAME_COLORS[index % FRAME_COLORS.length],
      kind:
        mode === "Highlights"
          ? "highlight"
          : mode === "Scenes"
            ? "scene"
            : "interval",
    };
  });
}

export function buildStoryboardFromTimestamps(
  timestamps: number[],
  mode: StoryboardMode,
): StoryboardFrame[] {
  return timestamps.map((timestamp, index) => ({
    id: `${mode.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`,
    timestamp: Number(timestamp.toFixed(3)),
    label:
      mode === "Highlights"
        ? `Highlight ${index + 1}`
        : mode === "Scenes"
          ? `Scene ${index + 1}`
          : `Every 1s · ${index + 1}`,
    note:
      mode === "Highlights"
        ? "High-signal frame chosen from moments with the strongest visual change."
        : mode === "Scenes"
          ? "Scene boundary inferred from a measured on-screen change."
          : "Even interval sample for exhaustive browsing.",
    color: FRAME_COLORS[index % FRAME_COLORS.length],
    kind:
      mode === "Highlights"
        ? "highlight"
        : mode === "Scenes"
          ? "scene"
          : "interval",
  }));
}

export function createVariantCatalog(): VideoVariant[] {
  return [
    {
      id: "1080p-mp4",
      label: "1080p MP4",
      bitrate: "6.2 Mbps",
      resolution: "1920×1080",
      contentType: "video/mp4",
      recommended: true,
    },
    {
      id: "720p-mp4",
      label: "720p MP4",
      bitrate: "3.4 Mbps",
      resolution: "1280×720",
      contentType: "video/mp4",
    },
    {
      id: "hls-master",
      label: "HLS master",
      bitrate: "Adaptive",
      resolution: "Adaptive",
      contentType: "application/x-mpegURL",
    },
  ];
}

export function createPlaceholderFrameDataUrl(
  timestamp: number,
  label: string,
  accent: string,
): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="wash" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.88" />
          <stop offset="100%" stop-color="#101522" stop-opacity="1" />
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#wash)" rx="36" />
      <rect x="48" y="48" width="1184" height="624" rx="28" fill="rgba(10,14,24,0.42)" stroke="rgba(255,255,255,0.24)" />
      <text x="80" y="130" fill="#f7f0e8" font-size="36" font-family="Space Grotesk, sans-serif">snipr preview</text>
      <text x="80" y="188" fill="#fff6d8" font-size="112" font-weight="700" font-family="Space Grotesk, sans-serif">${formatTimestamp(
        timestamp,
      )}</text>
      <text x="80" y="256" fill="#d9deeb" font-size="32" font-family="IBM Plex Mono, monospace">${label}</text>
      <circle cx="1044" cy="208" r="118" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" />
      <path d="M1008 152 L1120 208 L1008 264 Z" fill="#f7f0e8" opacity="0.9" />
      <rect x="80" y="588" width="1120" height="18" rx="9" fill="rgba(255,255,255,0.12)" />
      <rect x="80" y="588" width="${Math.max(
        140,
        Math.round(((timestamp % 18) / 18) * 1120),
      )}" height="18" rx="9" fill="#f7f0e8" />
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function slugifyTimestamp(timestamp: number): string {
  return formatTimestamp(timestamp).replaceAll(":", "-").replace(".", "-");
}
