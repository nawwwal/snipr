const statusField = document.getElementById("statusNote");
const tweetField = document.getElementById("tweetUrl");
const resolveButton = document.getElementById("resolveButton");
const useCurrentTabButton = document.getElementById("useCurrentTab");
const resultPanel = document.getElementById("resultPanel");
const resultTitle = document.getElementById("resultTitle");
const resultSubtitle = document.getElementById("resultSubtitle");
const poster = document.getElementById("poster");
const variantList = document.getElementById("variantList");

function setStatus(message, isError = false) {
  statusField.textContent = message;
  statusField.style.color = isError ? "#a12424" : "#546074";
}

function extractStatusId(input) {
  const match = input.match(
    /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/status|[^/]+\/status)\/(\d+)/i,
  );

  return match ? match[1] : null;
}

function getVariantUrl(variant) {
  return variant.url || variant.src || null;
}

function getVariantContentType(variant) {
  return variant.content_type || variant.type || "application/octet-stream";
}

function formatBitrate(bitrate) {
  if (!bitrate) {
    return "Adaptive";
  }

  if (bitrate >= 1_000_000) {
    return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
  }

  return `${Math.round(bitrate / 1_000)} kbps`;
}

function getResolutionLabel(url, fallback) {
  const match = url.match(/\/(\d{2,5})x(\d{2,5})\//i);

  if (match) {
    return `${match[1]}×${match[2]}`;
  }

  if (fallback?.width && fallback?.height) {
    return `${fallback.width}×${fallback.height}`;
  }

  return "Adaptive";
}

function getVariantLabel(contentType, resolution) {
  if (contentType === "application/x-mpegURL") {
    return "HLS master";
  }

  if (contentType === "video/mp4") {
    return `${resolution} MP4`;
  }

  return `${resolution} ${contentType}`;
}

function findPlayableTweet(tweet) {
  if (!tweet) {
    return null;
  }

  const hasDirectVideo = (tweet.mediaDetails || []).some(
    (media) =>
      (media.type === "video" || media.type === "animated_gif") &&
      media.video_info &&
      Array.isArray(media.video_info.variants) &&
      media.video_info.variants.length > 0,
  );

  if (hasDirectVideo) {
    return tweet;
  }

  return findPlayableTweet(tweet.quoted_tweet);
}

function mapVariants(media) {
  return (media.video_info?.variants || [])
    .map((variant, index) => {
      const url = getVariantUrl(variant);

      if (!url) {
        return null;
      }

      const contentType = getVariantContentType(variant);
      const resolution = getResolutionLabel(url, media.original_info);

      return {
        id: `${contentType}-${resolution}-${index}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
        label: getVariantLabel(contentType, resolution),
        bitrate: formatBitrate(variant.bitrate),
        resolution,
        contentType,
        url,
        recommended: false,
        rawBitrate: variant.bitrate || 0,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftIsMp4 = left.contentType === "video/mp4";
      const rightIsMp4 = right.contentType === "video/mp4";

      if (leftIsMp4 !== rightIsMp4) {
        return leftIsMp4 ? -1 : 1;
      }

      return right.rawBitrate - left.rawBitrate;
    })
    .map((variant, index) => ({
      ...variant,
      recommended: index === 0,
    }));
}

function renderVariants(variants) {
  variantList.replaceChildren();

  for (const variant of variants) {
    const card = document.createElement("article");
    card.className = "variant-card";

    const meta = document.createElement("div");
    const title = document.createElement("p");
    title.className = "variant-title";
    title.textContent = variant.label;

    const detail = document.createElement("p");
    detail.className = "variant-meta";
    detail.textContent = `${variant.resolution} · ${variant.bitrate} · ${variant.contentType}`;

    meta.append(title, detail);

    if (variant.recommended) {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = "Recommended";
      meta.append(pill);
    }

    const actions = document.createElement("div");
    actions.className = "variant-actions";

    const primaryAction = document.createElement("button");
    const isDownloadable = variant.contentType === "video/mp4";
    primaryAction.className = isDownloadable ? "primary" : "secondary";
    primaryAction.textContent = isDownloadable ? "Download" : "Open";
    primaryAction.addEventListener("click", async () => {
      if (isDownloadable) {
        const filename = `x-video-${variant.resolution.replace("×", "x")}.mp4`;
        await chrome.downloads.download({
          url: variant.url,
          filename,
          saveAs: true,
        });
        setStatus(`Started download for ${variant.label}.`);
        return;
      }

      await chrome.tabs.create({ url: variant.url });
      setStatus(`Opened ${variant.label} in a new tab.`);
    });

    const copyAction = document.createElement("button");
    copyAction.className = "secondary";
    copyAction.textContent = "Copy URL";
    copyAction.addEventListener("click", async () => {
      await navigator.clipboard.writeText(variant.url);
      setStatus(`Copied ${variant.label} URL.`);
    });

    actions.append(primaryAction, copyAction);
    card.append(meta, actions);
    variantList.append(card);
  }
}

async function resolveTweet() {
  const input = tweetField.value.trim();
  const statusId = extractStatusId(input);

  if (!statusId) {
    resultPanel.classList.add("hidden");
    setStatus("Enter a valid X or Twitter status URL.", true);
    return;
  }

  setStatus("Resolving public X metadata...");

  try {
    const response = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${statusId}&token=x`,
    );

    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "That post could not be found."
          : "X metadata lookup failed.",
      );
    }

    const tweet = await response.json();
    const playableTweet = findPlayableTweet(tweet);
    const media = playableTweet?.mediaDetails?.find(
      (item) =>
        (item.type === "video" || item.type === "animated_gif") &&
        item.video_info &&
        Array.isArray(item.video_info.variants) &&
        item.video_info.variants.length > 0,
    );

    if (!playableTweet || !media) {
      throw new Error("No playable video variants were found for that post.");
    }

    const variants = mapVariants(media);

    if (!variants.length) {
      throw new Error("The post resolved, but no direct variants were exposed.");
    }

    resultTitle.textContent = `${playableTweet.user?.name || "X"} on X`;
    resultSubtitle.textContent = `@${playableTweet.user?.screen_name || "unknown"} · ${
      (playableTweet.text || "").replace(/\s+/g, " ").trim() || `Status ${playableTweet.id_str}`
    }`;

    if (media.media_url_https) {
      poster.src = media.media_url_https;
      poster.alt = resultTitle.textContent;
      poster.classList.remove("hidden");
    } else {
      poster.classList.add("hidden");
      poster.removeAttribute("src");
    }

    renderVariants(variants);
    resultPanel.classList.remove("hidden");
    setStatus("Resolved playable variants from public X metadata.");
  } catch (error) {
    resultPanel.classList.add("hidden");
    setStatus(error instanceof Error ? error.message : "Unable to resolve that tweet.", true);
  }
}

async function prefillFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  if (extractStatusId(url)) {
    tweetField.value = url;
    setStatus("Loaded the current X status from your active tab.");
    return true;
  }

  setStatus("Current tab is not an X status page. Paste a tweet URL to continue.");
  return false;
}

resolveButton.addEventListener("click", resolveTweet);
useCurrentTabButton.addEventListener("click", prefillFromActiveTab);

prefillFromActiveTab();
