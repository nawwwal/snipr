import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import extensionConfig from "../src/config/extension-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(projectRoot, "extension", "manifest.json");
function normalizeApiOrigin(rawOrigin, fallbackOrigin) {
  const fallback = fallbackOrigin.trim();
  const candidate = rawOrigin?.trim() || fallback;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(
      `Invalid extension API origin: "${candidate}". Set VITE_SNIPR_API_ORIGIN to a valid http(s) origin.`,
    );
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `Unsupported extension API origin protocol: "${parsed.protocol}". Use http or https.`,
    );
  }

  return parsed.origin;
}

async function writeManifest() {
  const apiOrigin = normalizeApiOrigin(
    process.env.VITE_SNIPR_API_ORIGIN,
    extensionConfig.defaultApiOrigin,
  );
  const manifest = {
    manifest_version: 3,
    name: "snipr",
    version: "0.2.0",
    description: "Full snipr editor from X/Twitter status pages — rip the video, keep the gold.",
    key: extensionConfig.manifestKey,
    icons: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
    background: {
      service_worker: "background.js",
      type: "module",
    },
    action: {
      default_title: "Open snipr for this post",
      default_icon: {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
      },
    },
    permissions: ["tabs", "activeTab", "downloads", "storage"],
    host_permissions: [
      "https://x.com/*",
      "https://twitter.com/*",
      "https://cdn.syndication.twimg.com/*",
      "https://video.twimg.com/*",
      "https://pbs.twimg.com/*",
      "https://video-ft.twimg.com/*",
      `${apiOrigin}/*`,
    ],
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

await writeManifest();
