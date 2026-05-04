import { isXStatusUrl } from "@/lib/x-status-url";
import extensionConfig from "@/config/extension-config.mjs";
import { buildFrameExtractorLaunchUrl } from "@/lib/frame-extractor-launch";
import type { SniprActiveTabContext } from "@/lib/snipr-artifact";

const UNSUPPORTED_REASON = "not-status" as const;
const appOrigin =
  import.meta.env.VITE_SNIPR_APP_ORIGIN?.trim() || extensionConfig.defaultAppOrigin;

function unsupportedPageUrl(reason: string): string {
  const base = chrome.runtime.getURL("unsupported.html");
  return `${base}?reason=${encodeURIComponent(reason)}`;
}

function createActiveTabContext(tab: chrome.tabs.Tab, sourceUrl: string): SniprActiveTabContext {
  return {
    url: tab.url ?? sourceUrl,
    title: tab.title,
    sourceType: "x-url",
    launchSource: "chrome-extension",
    capturedAt: new Date().toISOString(),
    viewport: {
      width: tab.width,
      height: tab.height,
    },
    supportedContext: "x-status",
  };
}

function isEditorTabUrl(url: string | undefined, appBase: string) {
  if (!url) {
    return false;
  }

  try {
    return new URL(url).origin === new URL(appBase).origin;
  } catch {
    return false;
  }
}

async function openOrFocusEditor(tab: chrome.tabs.Tab, sourceUrl: string): Promise<void> {
  const base = appOrigin.replace(/\/$/, "");
  const fullUrl = buildFrameExtractorLaunchUrl(base, {
    sourceUrl,
    source: "chrome-extension",
    activeTab: createActiveTabContext(tab, sourceUrl),
  });
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((candidate) => isEditorTabUrl(candidate.url, base));

  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { url: fullUrl, active: true });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: fullUrl });
}

async function openScreenshotEditor(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.windowId === undefined || !tab.url) {
    await chrome.tabs.create({ url: unsupportedPageUrl(UNSUPPORTED_REASON) });
    return;
  }

  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const key = `snipr-screenshot-${Date.now()}`;
  const source: SniprActiveTabContext = {
    url: tab.url,
    title: tab.title,
    sourceType: "upload",
    launchSource: "chrome-extension",
    capturedAt: new Date().toISOString(),
    viewport: {
      width: tab.width,
      height: tab.height,
    },
    supportedContext: "generic-page",
  };

  await chrome.storage.local.set({
    [key]: {
      imageDataUrl,
      source,
    },
  });

  await chrome.tabs.create({
    url: `${chrome.runtime.getURL("editor.html")}?screenshotKey=${encodeURIComponent(key)}`,
  });
}

chrome.action.onClicked.addListener((tab) => {
  const url = tab.url;

  if (!url || !isXStatusUrl(url)) {
    void openScreenshotEditor(tab).catch(() => {
      void chrome.tabs.create({ url: unsupportedPageUrl(UNSUPPORTED_REASON) });
    });
    return;
  }

  void openOrFocusEditor(tab, url);
});
