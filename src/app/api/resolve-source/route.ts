import { NextResponse } from "next/server";

import {
  buildStoryboard,
  detectSourceType,
  extractStatusId,
  normalizeSourceInput,
  type ResolveSourceResponse,
  type VideoVariant,
} from "@/lib/frame-extractor";

type RequestBody = {
  input?: string;
  sourceType?: "x-url" | "direct-url";
};

type SyndicationVariant = {
  bitrate?: number;
  content_type?: string;
  type?: string;
  url?: string;
  src?: string;
};

type SyndicationMedia = {
  type?: string;
  expanded_url?: string;
  media_url_https?: string;
  video_info?: {
    duration_millis?: number;
    variants?: SyndicationVariant[];
  };
  original_info?: {
    width?: number;
    height?: number;
  };
};

type SyndicationTweet = {
  id_str?: string;
  text?: string;
  user?: {
    name?: string;
    screen_name?: string;
  };
  mediaDetails?: SyndicationMedia[];
  quoted_tweet?: SyndicationTweet;
};

function formatBitrate(bitrate?: number) {
  if (!bitrate) {
    return "Adaptive";
  }

  if (bitrate >= 1_000_000) {
    return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
  }

  return `${Math.round(bitrate / 1_000)} kbps`;
}

function getVariantUrl(variant: SyndicationVariant) {
  return variant.url ?? variant.src ?? null;
}

function getVariantContentType(variant: SyndicationVariant) {
  return variant.content_type ?? variant.type ?? "application/octet-stream";
}

function getResolutionLabel(url: string, fallback?: { width?: number; height?: number }) {
  const urlMatch = url.match(/\/(\d{2,5})x(\d{2,5})\//i);

  if (urlMatch) {
    return `${urlMatch[1]}×${urlMatch[2]}`;
  }

  if (fallback?.width && fallback?.height) {
    return `${fallback.width}×${fallback.height}`;
  }

  return "Adaptive";
}

function getVariantLabel(contentType: string, resolution: string) {
  if (contentType === "application/x-mpegURL") {
    return "HLS master";
  }

  if (contentType === "video/mp4") {
    return `${resolution} MP4`;
  }

  return `${resolution} ${contentType}`;
}

function createVariantId(contentType: string, resolution: string, index: number) {
  return `${contentType}-${resolution}-${index}`
    .toLowerCase()
    .replaceAll("/", "-")
    .replaceAll(".", "-")
    .replaceAll("×", "x")
    .replace(/[^a-z0-9-]+/g, "-");
}

function findPlayableTweet(tweet: SyndicationTweet | undefined): SyndicationTweet | null {
  if (!tweet) {
    return null;
  }

  const hasDirectVideo = tweet.mediaDetails?.some(
    (media) =>
      (media.type === "video" || media.type === "animated_gif") &&
      Boolean(media.video_info?.variants?.length),
  );

  if (hasDirectVideo) {
    return tweet;
  }

  return findPlayableTweet(tweet.quoted_tweet);
}

function mapVariants(
  variants: SyndicationVariant[] | undefined,
  fallbackResolution?: { width?: number; height?: number },
) {
  const mappedVariants = (variants ?? []).reduce<Array<{ data: VideoVariant; rawBitrate: number }>>(
    (collection, variant, index) => {
      const url = getVariantUrl(variant);

      if (!url) {
        return collection;
      }

      const contentType = getVariantContentType(variant);
      const resolution = getResolutionLabel(url, fallbackResolution);

      collection.push({
        data: {
          id: createVariantId(contentType, resolution, index),
          label: getVariantLabel(contentType, resolution),
          bitrate: formatBitrate(variant.bitrate),
          resolution,
          contentType,
          url,
          recommended: false,
        } satisfies VideoVariant,
        rawBitrate: variant.bitrate ?? 0,
      });

      return collection;
    },
    [],
  )
    .sort((left, right) => {
      const leftIsMp4 = left.data.contentType === "video/mp4";
      const rightIsMp4 = right.data.contentType === "video/mp4";

      if (leftIsMp4 !== rightIsMp4) {
        return leftIsMp4 ? -1 : 1;
      }

      return right.rawBitrate - left.rawBitrate;
    })
    .map((variant) => variant.data);

  if (mappedVariants[0]) {
    mappedVariants[0].recommended = true;
  }

  return mappedVariants;
}

function findPlayableMedia(tweet: SyndicationTweet | undefined): SyndicationMedia | null {
  const playableTweet = findPlayableTweet(tweet);

  if (!playableTweet) {
    return null;
  }

  const directMatch =
    playableTweet.mediaDetails?.find(
      (media) => media.type === "video" || media.type === "animated_gif",
    ) ??
    null;
  return directMatch;
}

function getTweetContext(tweet: SyndicationTweet | undefined) {
  const activeTweet = findPlayableTweet(tweet) ?? tweet;

  return {
    authorName: activeTweet?.user?.name ?? tweet?.user?.name ?? "X",
    authorHandle: activeTweet?.user?.screen_name ?? tweet?.user?.screen_name ?? "unknown",
    text: activeTweet?.text ?? tweet?.text ?? "",
    statusId: activeTweet?.id_str ?? tweet?.id_str ?? undefined,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as RequestBody;
  const normalizedInput = normalizeSourceInput(body.input ?? "");

  if (!normalizedInput) {
    return NextResponse.json(
      { error: "Enter an X URL or a direct MP4/WebM URL first." },
      { status: 400 },
    );
  }

  const inferredSourceType = body.sourceType ?? detectSourceType(normalizedInput);

  if (inferredSourceType === "upload") {
    return NextResponse.json(
      { error: "Uploads are handled directly in the browser for the MVP." },
      { status: 400 },
    );
  }

  if (inferredSourceType === "x-url") {
    const statusId = extractStatusId(normalizedInput);

    if (!statusId) {
      return NextResponse.json(
        { error: "That does not look like a valid X status URL." },
        { status: 400 },
      );
    }

    const syndicationResponse = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${statusId}&token=x`,
      {
        headers: {
          accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!syndicationResponse.ok) {
      return NextResponse.json(
        {
          error:
            syndicationResponse.status === 404
              ? "That X post could not be found."
              : "X metadata lookup failed. This unofficial resolver may be temporarily blocked.",
        },
        { status: syndicationResponse.status === 404 ? 404 : 502 },
      );
    }

    const tweet = (await syndicationResponse.json()) as SyndicationTweet;
    const media = findPlayableMedia(tweet);

    if (!media) {
      return NextResponse.json(
        {
          error:
            "No playable video was found for that post. Protected posts, deleted posts, and image-only tweets will not resolve here.",
        },
        { status: 422 },
      );
    }

    const variants = mapVariants(media.video_info?.variants, media.original_info);
    const preferredVariant =
      variants.find((variant) => variant.contentType === "video/mp4") ?? variants[0] ?? null;

    if (!preferredVariant) {
      return NextResponse.json(
        {
          error: "The post resolved, but no downloadable playback variants were exposed.",
        },
        { status: 422 },
      );
    }

    const context = getTweetContext(tweet);
    const duration = Number(((media.video_info?.duration_millis ?? 15_000) / 1000).toFixed(3));
    const title = `${context.authorName} on X`;
    const subtitleText = context.text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    const response: ResolveSourceResponse = {
      sourceType: "x-url",
      normalizedInput,
      title,
      subtitle: subtitleText
        ? `@${context.authorHandle} · ${subtitleText}`
        : `Resolved public playback variants for status ${context.statusId ?? statusId}.`,
      duration,
      statusId: context.statusId ?? statusId,
      variants,
      storyboard: buildStoryboard(duration, "Scenes"),
      videoUrl: preferredVariant.url ?? null,
      previewMode: "local",
      complianceNote:
        "Resolved through X's public syndication metadata, not the official developer API. This is fine for personal use, but it can break without notice.",
    };

    return NextResponse.json(response);
  }

  const response: ResolveSourceResponse = {
    sourceType: "direct-url",
    normalizedInput,
    title: "Direct video session",
    subtitle: "Remote preview is available when the host allows streaming and canvas extraction.",
    duration: 42.18,
    variants: [
      {
        id: "remote-original",
        label: "Original file",
        bitrate: "Source",
        resolution: "Remote",
        contentType: normalizedInput.endsWith(".webm") ? "video/webm" : "video/mp4",
        url: normalizedInput,
        recommended: true,
      },
    ],
    storyboard: buildStoryboard(42.18, "Highlights"),
    videoUrl: normalizedInput,
    previewMode: "local",
    complianceNote:
      "Direct URLs may still fail in-browser if the host blocks cross-origin video drawing. Keep upload mode available as the reliable fallback.",
  };

  return NextResponse.json(response);
}
