import {
  applyRateLimit,
  createSecurityHeaders,
  enforceSameOriginBrowserRequest,
  jsonError,
} from "@/lib/api-security";
import { isAllowedMediaProxyUrl } from "@/lib/media-hosts";

export const maxDuration = 25;

function getUpstreamUrl(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");

  if (!rawUrl) {
    return null;
  }

  try {
    const upstreamUrl = new URL(rawUrl);

    if (!isAllowedMediaProxyUrl(upstreamUrl)) {
      return null;
    }

    return upstreamUrl;
  } catch {
    return null;
  }
}

async function proxyRequest(request: Request, method: "GET" | "HEAD") {
  const blockedOrigin = enforceSameOriginBrowserRequest(request);

  if (blockedOrigin) {
    return blockedOrigin;
  }

  const rateLimit = applyRateLimit(request, {
    bucket: "media-proxy",
    limit: 180,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return jsonError("Too many proxy requests. Try again in a minute.", 429, rateLimit.headers);
  }

  const upstreamUrl = getUpstreamUrl(request);

  if (!upstreamUrl) {
    return jsonError(
      "Only approved X/Twitter media hosts can be proxied here.",
      403,
      rateLimit.headers,
    );
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");

  if (range) {
    upstreamHeaders.set("range", range);
  }

  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Upstream media request timed out."
        : "Upstream media request failed.";
    return jsonError(message, 504, rateLimit.headers);
  }

  if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
    return jsonError(
      `Upstream media request failed with ${upstreamResponse.status}.`,
      upstreamResponse.status,
      rateLimit.headers,
    );
  }

  const responseHeaders = createSecurityHeaders(rateLimit.headers);
  const passthroughHeaders = [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ];

  for (const headerName of passthroughHeaders) {
    const headerValue = upstreamResponse.headers.get(headerName);

    if (headerValue) {
      responseHeaders.set(headerName, headerValue);
    }
  }

  responseHeaders.set("cross-origin-resource-policy", "same-origin");

  return new Response(method === "HEAD" ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export async function GET(request: Request) {
  return proxyRequest(request, "GET");
}

export async function HEAD(request: Request) {
  return proxyRequest(request, "HEAD");
}
