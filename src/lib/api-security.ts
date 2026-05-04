import { NextResponse } from "next/server";
import extensionConfig from "@/config/extension-config.mjs";

type RateLimitOptions = {
  bucket: string;
  limit: number;
  windowMs: number;
};

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitRecord>();
let lastRateLimitSweepAt = 0;

function sweepRateLimits(now: number) {
  if (now - lastRateLimitSweepAt < 60_000) {
    return;
  }

  for (const [key, record] of rateLimitStore) {
    if (record.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }

  lastRateLimitSweepAt = now;
}

export function createSecurityHeaders(init?: HeadersInit) {
  const headers = new Headers(init);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "same-origin");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

function normalizeExtensionOrigin(origin: string) {
  return origin.trim().replace(/\/$/, "");
}

function getAllowedChromeExtensionOrigins() {
  const configuredOrigins =
    process.env.SNIPR_EXTENSION_ORIGINS
      ?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];

  return new Set(
    [...extensionConfig.defaultAllowedExtensionOrigins, ...configuredOrigins].map(
      normalizeExtensionOrigin,
    ),
  );
}

function isAllowedChromeExtensionOrigin(origin: string) {
  return getAllowedChromeExtensionOrigins().has(normalizeExtensionOrigin(origin));
}

/** CORS for the snipr Chrome extension origin(s) we explicitly trust. */
export function corsHeadersForChromeExtension(request: Request): HeadersInit {
  const origin = request.headers.get("origin");

  if (!origin?.startsWith("chrome-extension://") || !isAllowedChromeExtensionOrigin(origin)) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, HEAD, OPTIONS",
    "access-control-allow-headers": "Content-Type, Range",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export function mergeSecurityHeaders(base: Headers, request: Request) {
  const extra = corsHeadersForChromeExtension(request);
  for (const [key, value] of Object.entries(extra)) {
    base.set(key, value);
  }
}

export function jsonError(message: string, status: number, headers?: HeadersInit, request?: Request) {
  const merged = createSecurityHeaders(headers);
  if (request) {
    mergeSecurityHeaders(merged, request);
  }
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: merged,
    },
  );
}

function getClientAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function getClientKey(request: Request, bucket: string) {
  const clientAddress = getClientAddress(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 120) ?? "unknown";
  return `${bucket}:${clientAddress}:${userAgent}`;
}

export function applyRateLimit(request: Request, options: RateLimitOptions) {
  const now = Date.now();
  sweepRateLimits(now);

  const key = getClientKey(request, options.bucket);
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + options.windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });

    return {
      allowed: true,
      headers: {
        "x-ratelimit-limit": String(options.limit),
        "x-ratelimit-remaining": String(Math.max(0, options.limit - 1)),
        "x-ratelimit-reset": String(Math.ceil(resetAt / 1000)),
      },
    };
  }

  existing.count += 1;
  rateLimitStore.set(key, existing);

  const remaining = Math.max(0, options.limit - existing.count);
  const headers = {
    "retry-after": String(Math.max(1, Math.ceil((existing.resetAt - now) / 1000))),
    "x-ratelimit-limit": String(options.limit),
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(Math.ceil(existing.resetAt / 1000)),
  };

  if (existing.count > options.limit) {
    return {
      allowed: false,
      headers,
    };
  }

  return {
    allowed: true,
    headers,
  };
}

export function enforceSameOriginBrowserRequest(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return null;
  }

  const normalizedRawOrigin = normalizeExtensionOrigin(origin);

  if (normalizedRawOrigin.startsWith("chrome-extension://")) {
    return isAllowedChromeExtensionOrigin(normalizedRawOrigin)
      ? null
      : jsonError("Cross-origin browser requests are blocked.", 403, undefined, request);
  }

  try {
    const requestOrigin = new URL(origin).origin;
    const allowedOrigins = new Set<string>([new URL(request.url).origin]);
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = request.headers.get("host")?.split(",")[0]?.trim();

    if (forwardedProto && forwardedHost) {
      allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);
    }

    if (host) {
      allowedOrigins.add(`${forwardedProto ?? new URL(request.url).protocol.replace(":", "")}://${host}`);
    }

    if (!allowedOrigins.has(requestOrigin)) {
      return jsonError("Cross-origin browser requests are blocked.", 403, undefined, request);
    }
  } catch {
    return jsonError("Origin validation failed.", 403, undefined, request);
  }

  return null;
}

export function getJsonBodySize(request: Request) {
  const rawLength = request.headers.get("content-length");

  if (!rawLength) {
    return null;
  }

  const parsed = Number(rawLength);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
