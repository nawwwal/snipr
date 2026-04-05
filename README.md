# Frame Extractor MVP

Next.js MVP built from the PRD in `/Users/adi/Downloads/deep-research-report (1).md`.

## What ships now

- Source intake for X URLs, direct video URLs, and local uploads
- Storyboard-first editor with scrubbing, frame stepping, in/out markers, and capture tray
- Client-side frame capture for uploaded videos
- ZIP export with selected frames, `metadata.json`, and `captions.csv`
- Server boundary for the X URL resolution path via `POST /api/resolve-source`

## Current product boundary

The upload flow is still the most reliable MVP path today.

The X URL flow now does a best-effort server-side resolve for public posts by reading X's public syndication metadata and extracting the exposed `video.twimg.com` variants. This avoids the official X API, but it is intentionally unstable and may break if X changes or removes that metadata surface.

The production backend boundary is still useful for:

- stronger media resolution guarantees
- server-side FFmpeg extraction and storyboard generation
- support for protected or login-gated posts
- compliance checks and deletion handling

## Key files

- `src/components/frame-extractor-app.tsx`: main interactive app surface
- `src/lib/frame-extractor.ts`: shared types, parsing helpers, and storyboard utilities
- `src/app/api/resolve-source/route.ts`: API seam for X URL and direct URL source resolution

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Chrome extension

There is also a plain unpacked Chrome extension in [`extension/manifest.json`](/Users/adi/Projects/x-frame-extractor/extension/manifest.json).

To install it:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the repo's [`extension`](/Users/adi/Projects/x-frame-extractor/extension) folder

The extension reads the current X status URL from your active tab or accepts a pasted tweet URL, resolves public playback variants through X's syndication metadata, and downloads MP4 variants directly with Chrome's downloads API.

## Next implementation steps

1. Add an FFmpeg worker for storyboard generation, exact timestamp capture, and quality controls.
2. Persist projects and exports so the shareable-link flow from the PRD becomes real.
3. Decide whether to keep the public X resolver or replace it with a more durable authenticated path later.
