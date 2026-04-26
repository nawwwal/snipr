export const SNIPR_ARTIFACT_SCHEMA_VERSION = 1;

export type SniprArtifactSchemaVersion = typeof SNIPR_ARTIFACT_SCHEMA_VERSION;

export type SniprSourceType = "x-url" | "direct-url" | "upload";

export type SniprLaunchSource = "web" | "chrome-extension";

export type SniprCaptureMode = "storyboard" | "screenshot" | "recording";

export type SniprSupportedContext = "x-status" | "direct-video" | "generic-page";

export type SniprExportFormat = "png" | "jpeg" | "webp";

export type SniprStoryboardMode = "Highlights" | "Scenes" | "Every 1s";

export type SniprActiveTabContext = {
  url: string;
  title?: string;
  sourceType: SniprSourceType;
  launchSource: SniprLaunchSource;
  capturedAt: string;
  viewport?: {
    width?: number;
    height?: number;
  };
  supportedContext: SniprSupportedContext;
};

export type SniprVideoVariant = {
  id: string;
  label: string;
  bitrate: string;
  resolution: string;
  contentType: string;
  url?: string;
  recommended?: boolean;
};

export type SniprStoryboardFrame = {
  id: string;
  timestamp: number;
  label: string;
  note: string;
  color: string;
  kind: "scene" | "highlight" | "interval";
};

export type SniprResolvedSource = {
  schemaVersion: SniprArtifactSchemaVersion;
  sourceType: SniprSourceType;
  normalizedInput: string;
  activeTab?: SniprActiveTabContext;
  title: string;
  subtitle: string;
  duration: number;
  statusId?: string;
  variants: SniprVideoVariant[];
  storyboard: SniprStoryboardFrame[];
  videoUrl: string | null;
  previewMode: "local" | "server";
  complianceNote: string;
};

export type SniprLaunchConfig = {
  schemaVersion: SniprArtifactSchemaVersion;
  sourceUrl: string;
  autoload: boolean;
  mode: SniprCaptureMode;
  source?: SniprLaunchSource;
  activeTab?: SniprActiveTabContext;
};

export type SniprEditorSession = {
  schemaVersion: SniprArtifactSchemaVersion;
  resolvedSource: SniprResolvedSource;
  selectedVariantId: string | null;
  storyboardMode: SniprStoryboardMode;
  storyboardFrames: SniprStoryboardFrame[];
  updatedAt: string;
};

export type SniprExportFrame = {
  id: string;
  index: number;
  label: string;
  timestamp: number;
  timestampLabel: string;
  filename: string;
  note: string;
};

export type SniprExportMetadata = {
  schemaVersion: SniprArtifactSchemaVersion;
  projectName: string;
  sourceType: SniprSourceType;
  normalizedInput: string;
  exportedAt: string;
  format: SniprExportFormat;
  title?: string;
  subtitle?: string;
  duration?: number;
  statusId?: string;
  selectedVariantId?: string | null;
  launchSource?: SniprLaunchSource;
  activeTab?: SniprActiveTabContext;
  frames: SniprExportFrame[];
};

export type SniprStoryboardAgentBundle = {
  schemaVersion: SniprArtifactSchemaVersion;
  exportedAt: string;
  source: {
    type: SniprSourceType;
    url: string;
    title?: string;
    subtitle?: string;
    duration?: number;
    statusId?: string;
  };
  selectedVariantId?: string | null;
  launchSource?: SniprLaunchSource;
  activeTab?: SniprActiveTabContext;
  assets: {
    metadata: "metadata.json";
    captions: "captions.csv";
    framesDirectory: "frames/";
    markdownSummary: "summary.md";
  };
  frames: SniprExportFrame[];
};

export type SniprAnnotationKind = "rectangle" | "arrow" | "text" | "highlight" | "blur";

export type SniprAnnotationDocument = {
  schemaVersion: SniprArtifactSchemaVersion;
  source: SniprActiveTabContext;
  canvas: {
    width: number;
    height: number;
  };
  annotations: Array<{
    id: string;
    kind: SniprAnnotationKind;
    x: number;
    y: number;
    width?: number;
    height?: number;
    endX?: number;
    endY?: number;
    text?: string;
    color?: string;
    opacity?: number;
    zIndex: number;
  }>;
  updatedAt: string;
};

export type SniprRecordingArtifact = {
  schemaVersion: SniprArtifactSchemaVersion;
  source: SniprActiveTabContext;
  startedAt: string;
  stoppedAt?: string;
  duration?: number;
  mimeType: string;
  filename?: string;
  canStoryboard: boolean;
};

export type SniprApiError = {
  error: string;
};

export function createSniprExportMetadata(input: Omit<SniprExportMetadata, "schemaVersion">) {
  return {
    schemaVersion: SNIPR_ARTIFACT_SCHEMA_VERSION,
    ...input,
  } satisfies SniprExportMetadata;
}

export function createStoryboardAgentBundle(
  input: Omit<SniprStoryboardAgentBundle, "schemaVersion" | "assets">,
) {
  return {
    schemaVersion: SNIPR_ARTIFACT_SCHEMA_VERSION,
    assets: {
      metadata: "metadata.json",
      captions: "captions.csv",
      framesDirectory: "frames/",
      markdownSummary: "summary.md",
    },
    ...input,
  } satisfies SniprStoryboardAgentBundle;
}

export function renderStoryboardMarkdownSummary(bundle: SniprStoryboardAgentBundle) {
  const lines = [
    `# ${bundle.source.title ?? "snipr storyboard"}`,
    "",
    `Source: ${bundle.source.url}`,
    `Type: ${bundle.source.type}`,
    bundle.source.subtitle ? `Context: ${bundle.source.subtitle}` : null,
    bundle.source.duration !== undefined ? `Duration: ${bundle.source.duration.toFixed(3)}s` : null,
    bundle.source.statusId ? `Status ID: ${bundle.source.statusId}` : null,
    bundle.launchSource ? `Launch source: ${bundle.launchSource}` : null,
    "",
    "## Selected Frames",
    "",
    ...bundle.frames.flatMap((frame) => [
      `${frame.index}. ${frame.label} (${frame.timestampLabel})`,
      `   - File: ${frame.filename}`,
      frame.note ? `   - Note: ${frame.note}` : null,
    ]),
    "",
    "## Bundle Files",
    "",
    `- ${bundle.assets.metadata}`,
    `- ${bundle.assets.captions}`,
    `- ${bundle.assets.framesDirectory}`,
  ].filter((line): line is string => line !== null);

  return `${lines.join("\n")}\n`;
}
