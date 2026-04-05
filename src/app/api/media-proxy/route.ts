import { NextResponse } from "next/server";

function getUpstreamUrl(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");

  if (!rawUrl) {
    return null;
  }

  try {
    const upstreamUrl = new URL(rawUrl);

    if (!["http:", "https:"].includes(upstreamUrl.protocol)) {
      return null;
    }

    return upstreamUrl;
  } catch {
    return null;
  }
}

async function proxyRequest(request: Request, method: "GET" | "HEAD") {
  const upstreamUrl = getUpstreamUrl(request);

  if (!upstreamUrl) {
    return NextResponse.json({ error: "Enter a valid upstream media URL." }, { status: 400 });
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");

  if (range) {
    upstreamHeaders.set("range", range);
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers: upstreamHeaders,
    cache: "no-store",
    redirect: "follow",
  });

  if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
    return NextResponse.json(
      {
        error: `Upstream media request failed with ${upstreamResponse.status}.`,
      },
      { status: upstreamResponse.status },
    );
  }

  const responseHeaders = new Headers();
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
