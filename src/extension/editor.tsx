import { createRoot } from "react-dom/client";

import { FrameExtractorApp } from "@/components/frame-extractor-app";
import { ScreenshotAnnotationApp } from "@/components/screenshot-annotation-app";
import "@/app/globals.css";
import extensionConfig from "@/config/extension-config.mjs";
import { parseFrameExtractorLaunch } from "@/lib/frame-extractor-launch";
import type { SniprActiveTabContext } from "@/lib/snipr-artifact";

const apiOrigin =
  import.meta.env.VITE_SNIPR_API_ORIGIN?.trim() || extensionConfig.defaultApiOrigin;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("snipr editor root missing");
}
const rootContainer = rootEl;

type StoredScreenshot = {
  imageDataUrl: string;
  source: SniprActiveTabContext;
};

async function readStoredScreenshot(key: string) {
  const result = await chrome.storage.local.get(key);
  return result[key] as StoredScreenshot | undefined;
}

async function renderEditor() {
  const params = new URLSearchParams(window.location.search);
  const screenshotKey = params.get("screenshotKey");
  const root = createRoot(rootContainer);

  if (screenshotKey) {
    const screenshot = await readStoredScreenshot(screenshotKey);
    if (screenshot) {
      void chrome.storage.local.remove(screenshotKey);
      root.render(
        <ScreenshotAnnotationApp
          imageDataUrl={screenshot.imageDataUrl}
          source={screenshot.source}
        />,
      );
      return;
    }
  }

  root.render(
    <FrameExtractorApp
      apiOrigin={apiOrigin}
      launch={parseFrameExtractorLaunch(params)}
      showTestTweetButton={false}
    />,
  );
}

void renderEditor();
