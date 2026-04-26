import { isXStatusUrl } from "@/lib/x-status-url";
import {
  SNIPR_ARTIFACT_SCHEMA_VERSION,
  type SniprActiveTabContext,
  type SniprLaunchConfig,
  type SniprLaunchSource,
  type SniprSourceType,
  type SniprSupportedContext,
} from "@/lib/snipr-artifact";

export type FrameExtractorLaunchConfig = SniprLaunchConfig;

function parseLaunchSource(value: string | null): SniprLaunchSource | undefined {
  return value === "chrome-extension" ? "chrome-extension" : undefined;
}

function firstValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function inferSupportedContext(sourceUrl: string): SniprSupportedContext {
  return isXStatusUrl(sourceUrl) ? "x-status" : "generic-page";
}

function inferSourceType(sourceUrl: string): SniprSourceType {
  return isXStatusUrl(sourceUrl) ? "x-url" : "direct-url";
}

export function parseFrameExtractorLaunch(
  searchParams:
    | URLSearchParams
    | { get(name: string): string | null }
    | Record<string, string | string[] | undefined>,
): FrameExtractorLaunchConfig | null {
  let sourceUrl: string | null = null;
  let autoload: string | null = null;
  let source: string | null = null;
  let activeTabUrl: string | null = null;
  let activeTabTitle: string | null = null;
  let capturedAt: string | null = null;
  let viewportWidth: string | null = null;
  let viewportHeight: string | null = null;
  let supportedContext: string | null = null;

  if ("get" in searchParams && typeof searchParams.get === "function") {
    sourceUrl = searchParams.get("sourceUrl");
    autoload = searchParams.get("autoload");
    source = searchParams.get("source");
    activeTabUrl = searchParams.get("activeTabUrl");
    activeTabTitle = searchParams.get("activeTabTitle");
    capturedAt = searchParams.get("capturedAt");
    viewportWidth = searchParams.get("viewportWidth");
    viewportHeight = searchParams.get("viewportHeight");
    supportedContext = searchParams.get("supportedContext");
  } else {
    const recordSearchParams = searchParams as Record<string, string | string[] | undefined>;
    sourceUrl = firstValue(recordSearchParams.sourceUrl);
    autoload = firstValue(recordSearchParams.autoload);
    source = firstValue(recordSearchParams.source);
    activeTabUrl = firstValue(recordSearchParams.activeTabUrl);
    activeTabTitle = firstValue(recordSearchParams.activeTabTitle);
    capturedAt = firstValue(recordSearchParams.capturedAt);
    viewportWidth = firstValue(recordSearchParams.viewportWidth);
    viewportHeight = firstValue(recordSearchParams.viewportHeight);
    supportedContext = firstValue(recordSearchParams.supportedContext);
  }

  const normalizedSourceUrl = sourceUrl?.trim() ?? "";
  if (autoload !== "true" || !normalizedSourceUrl || !isXStatusUrl(normalizedSourceUrl)) {
    return null;
  }

  const launchSource = parseLaunchSource(source) ?? "web";
  const normalizedActiveTabUrl = activeTabUrl?.trim() || normalizedSourceUrl;
  const activeTab: SniprActiveTabContext = {
    url: normalizedActiveTabUrl,
    title: activeTabTitle?.trim() || undefined,
    sourceType: inferSourceType(normalizedSourceUrl),
    launchSource,
    capturedAt: capturedAt?.trim() || new Date().toISOString(),
    viewport: {
      width: parsePositiveInteger(viewportWidth),
      height: parsePositiveInteger(viewportHeight),
    },
    supportedContext:
      supportedContext === "x-status" ||
      supportedContext === "direct-video" ||
      supportedContext === "generic-page"
        ? supportedContext
        : inferSupportedContext(normalizedSourceUrl),
  };

  return {
    schemaVersion: SNIPR_ARTIFACT_SCHEMA_VERSION,
    sourceUrl: normalizedSourceUrl,
    autoload: true,
    mode: "storyboard",
    source: launchSource,
    activeTab,
  };
}

export function buildFrameExtractorLaunchUrl(
  appOrigin: string,
  launch: Pick<FrameExtractorLaunchConfig, "sourceUrl" | "activeTab" | "source">,
) {
  const url = new URL("/", appOrigin.replace(/\/$/, ""));
  url.searchParams.set("sourceUrl", launch.sourceUrl);
  url.searchParams.set("autoload", "true");
  url.searchParams.set("source", launch.source ?? "web");

  if (launch.activeTab) {
    url.searchParams.set("activeTabUrl", launch.activeTab.url);
    url.searchParams.set("capturedAt", launch.activeTab.capturedAt);
    url.searchParams.set("supportedContext", launch.activeTab.supportedContext);
    if (launch.activeTab.title) {
      url.searchParams.set("activeTabTitle", launch.activeTab.title);
    }
    if (launch.activeTab.viewport?.width) {
      url.searchParams.set("viewportWidth", String(launch.activeTab.viewport.width));
    }
    if (launch.activeTab.viewport?.height) {
      url.searchParams.set("viewportHeight", String(launch.activeTab.viewport.height));
    }
  }

  return url.toString();
}
