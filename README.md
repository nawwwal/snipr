# snipr

**Rip the video. Keep the gold.** (The second line is non negotiable if you like the yellow bits on the pink chrome bar.)

## Ship it on Vercel

This repo is a stock Next.js App Router app: `npm run build` is what you need. Import the GitHub repo in Vercel, leave defaults, add no env vars unless you fork in secrets later. API routes (`/api/resolve-source`, `/api/media-proxy`) run as serverless fetches. The deployment now has basic rate limiting, same-origin browser checks, upstream timeouts, and the media proxy is restricted to approved X/Twitter media hosts, so the main remaining caveat is that the unofficial X resolver can break without warning.

This is a Next.js app that looks like it time traveled from 2004, then robbed a candy factory, then decided to help you steal frames from video. Paste a post URL. Get a storyboard. Export a ZIP. Feel like a digital raccoon with a master’s degree.

## What actually works

- You feed it an X URL (or other sources the resolver knows about). It argues with syndication metadata until video variants fall out.
- You scrub a timeline that thinks it is a physical object. You add frames. You remove frames. You pretend you are an editor even if your only credential is vibe.
- Auto storyboard watches the whole clip like a judgmental friend and drops markers where things change. It may take a moment. The app now admits this instead of staring at you in silence.
- ZIP export brings home images plus `metadata.json` and `captions.csv` so your future self knows what you were doing.

## What to expect when things get weird

The public X path is best effort. If X moves a comma in their HTML, we might all cry together. HLS might need an MP4 sidekick for preview in some browsers. Uploads are still the dependable golden retriever of this project.

There is also a Chrome extension in `extension/` that opens the full editor from X/Twitter status pages.

## Run it

```bash
npm install
npm run dev
npm run build:extension
```

Open `http://localhost:3000`. Squint until the glossy plastic looks intentional.
Then load `extension/` as an unpacked Chrome extension.

If the extension should talk to a deployed backend instead of local dev, build it with `VITE_SNIPR_API_ORIGIN=https://your-snipr-host`.

## Where the bodies are buried

- `src/components/frame-extractor-app.tsx` is the haunted amusement park
- `src/lib/frame-extractor.ts` is types and storyboard math
- `src/app/api/resolve-source/route.ts` talks to the outside world so you do not have to

## Future you might build

- Heavier server-side video brain (think FFmpeg shaped like a friend)
- Saved projects so your clips survive a refresh
- Whatever replaces “hope” as a strategy for public scraping

If you ship something cool with snipr, the app cannot legally take credit, but it would like to.
