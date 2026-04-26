# snipr agent guide

This file is the source of truth for product context, product intent, UX rules,
and styling aesthetics for `snipr`.

Plane is the source of truth for roadmap phases, milestones, work items,
dependencies, and execution status. This file explains how to interpret the
product while doing that work.

## Canonical sources

- Product and design context: this file
- Roadmap and sequencing: Plane project `snipr`
- Project identifier in Plane: `SNIP`
- Project id in Plane: `d68e0431-e8b0-4cc8-9b92-72b5f0e59c93`
- Local orientation doc: [.agents/roadmap.md](/Users/adi/Projects/snipr/.agents/roadmap.md)

## Current product purpose

`snipr` is an extension-first, agent-ready visual evidence tool.

The product should help a user capture the browser context they are already in,
shape the important visual evidence, and turn it into a compact bundle an agent
can understand and act on.

The Chrome extension is the primary product surface. The hosted/web editor is
still valuable, but mostly as the full-screen editing and export workspace the
extension launches into.

The first target context is X/Twitter: when a user is on a post with a video,
they should be able to click the extension, have Snipr detect the post, source
URL, and video context, then launch the storyboarding flow without manually
pasting a URL into a standalone tool.

The near-term purpose is narrower than "capture everything", but broader than
"tweet video downloader":

> Capture the current browser moment and turn it into an agent-readable visual
> artifact: annotated image, storyboard package, or recorded clip.

That is the MVP wedge. The first proof is X video storyboarding from the active
tab. The adjacent MVP modes are screenshot capture with fast annotation/copy,
and browser/tab recording that can either download as video or become a
storyboard. Future agent workflows should build on those capture primitives
instead of turning `snipr` into a pile of unrelated tools.

## Product thesis

Agents still struggle with raw visual context. Long recordings are too dense,
screenshots lose sequence, and downloaded media usually has no useful metadata
or explanation attached.

`snipr` should compress visual evidence into something usable:

- key moments, not whole undifferentiated video
- timestamps and metadata, not anonymous image files
- a storyboard or contact sheet, not a folder of random frames
- copy/export surfaces designed for agents, not only for human playback

The current X video storyboard flow is not a side quest. It is the first proof
of the product thesis and should move into an extension-native launch flow.

## MVP definition

The starting version should be extension-first:

1. Detect the active browser context from the extension.
2. On an X/Twitter post with video, launch the existing storyboard editor with
   the detected post/video context already loaded.
3. Generate a useful storyboard from the video.
4. Let the user add, remove, and reorder important frames.
5. Export or copy an agent-ready package with frames, timestamps, source
   metadata, and a readable summary.
6. Preserve the current visual identity and make the extension launch into the
   same editor experience.

The two adjacent MVP capture modes are:

- Screenshot capture: capture the current visible page or selected region, allow
  quick annotation, then copy/download the image.
- Screen/tab recording: record the browser tab or screen, then either download
  the video or convert it into a storyboard.

The MVP should not include:

- general-purpose screenshot annotation
- full desktop recording beyond browser-supported screen/tab capture
- Jam-style replay/debug telemetry
- saved cloud sessions
- share links
- multi-user collaboration
- a broad template marketplace

Those are possible roadmap items, not proof that the initial product works.

## Roadmap stance

The current Plane roadmap is directionally useful but should become more
extension-first. It correctly names the larger wedge as "agent-ready context
bundles", but the MVP should not start by building a generic artifact platform.

The better sequence is:

1. Extension launch wedge: detect the active page, identify supported contexts,
   and launch the full editor with context already loaded.
2. X video storyboard MVP: make the existing X/direct/upload video path
   excellent, reliable, and agent-ready from the extension.
3. Screenshot annotate/copy: capture the current browser view or region, mark it
   up quickly, and copy/download it.
4. Browser recording: capture tab/screen video, then download it or turn it into
   a storyboard.
5. Agent bundle export: package frames, screenshots, recordings, timestamps,
   source URL, notes, and markdown in one clean copy/export flow.
6. Expand intelligence: OCR, prompt templates, saved sessions, replay/debug
   context, and richer handoff surfaces after the capture modes are solid.

When debating or reshaping Plane, prefer moving broad items later over deleting
the strategic direction entirely.

## Product rules

1. Agent handoff is the main product surface.
2. The MVP is extension launch to storyboard/image/recording handoff.
3. Do not add a new capture mode until the current video storyboard loop is
   obviously useful.
4. The browser editor is the primary experience. Do not split capabilities into
   a weaker parallel editor unless the task explicitly requires it.
5. The extension must launch the same editor experience and visual language as
   the web app.
6. Export, copy, and share-adjacent handoff flows are core product work.
7. If a feature does not reduce the distance between "I need to show this" and
   "an agent can act on this", challenge it.

## UX principles

1. Fast to start. The first screen should get users into a source quickly.
2. Clear status. Resolving, loading, scanning, copying, and exporting must never
   feel silent.
3. Storyboard first. The rail of selected moments is the product's spine.
4. Rich but legible. The UI can be loud and tactile, but controls must remain
   obvious.
5. Same artifact, many uses. A session should support preview, frame selection,
   contact sheet copy, ZIP export, and metadata without making the user rebuild
   context.

## Visual and aesthetic source of truth

The current web editor aesthetic is the reference. Preserve it closely unless a
task explicitly says to evolve it.

The style is 90s-to-early-2000s skeuomorphic software: not a nostalgia poster,
not vaporwave, not generic retro pixels. It should feel like a real plastic
object pretending to be software. Think old media editors, toy-like desktop
utilities, chrome browser skins, physical AV gear, chunky shareware controls,
and glossy translucent computer UI that wants every surface to have weight,
depth, highlight, and touch.

The visual language is:

- glossy skeuomorphism with physical material behavior
- candy-plastic chrome surfaces that look molded, beveled, and touchable
- hot-pink metallic title bars with bloom, glare, and layered shine
- icy blue, sky, and lavender body panels that feel like translucent plastic
- deep navy or near-black media viewports that read as recessed screens
- heavy inset and outset shadows that make panels feel carved into the object
- gel buttons, capsule controls, and bead-like titlebar caps
- chrome bezels, recessed grooves, rails, sliders, and hardware-like seams
- frosted-glass panels with gloss overlays, not flat translucent rectangles
- bright specular highlights, halation, and rim light instead of muted shadows
- subtle noise, scanline texture, and layered gradients to avoid sterile flats
- playful retro-computing energy rather than minimalist SaaS polish

Use this vocabulary when extending the UI:

- **Bezel**: outer chrome frame around a tool, viewport, or editor surface.
- **Inset**: dark or light recessed area that holds media, inputs, or status.
- **Gel**: rounded glossy control with a bright top highlight and darker lower
  body.
- **Chrome**: metallic plastic frame with bevels, edge highlights, and depth.
- **Halation**: soft glow around bright pink, blue, or amber active elements.
- **Groove**: physical track for timelines, sliders, scrollbars, or progress.
- **Cap**: small bead-like indicator/control, especially in titlebars.
- **Contact sheet**: storyboard output should feel like a physical strip of
  selected evidence, not a generic grid.

Material rules:

1. Every major surface should answer "what is this made of?" Use plastic,
   chrome, glass, rubber, screen, or paper-like contact sheet metaphors.
2. Buttons should have states that feel physically pressed: raised at rest,
   brighter on hover, compressed on active.
3. Timeline, storyboard, scrollbar, and range controls should feel like grooves
   with draggable gel pieces, not flat web controls.
4. The media viewport should remain visually calm, dark, and recessed so the
   captured content stays dominant.
5. Highlights should come from believable lighting: top-left shine, rim glow,
   inner bevels, and reflected streaks.
6. Decorative shine must support material structure. Random sparkles, blobs, or
   modern gradients are not the brand.

Avoid:

- flat monochrome surfaces
- generic dark-mode cards
- neutral gray product UI
- modern SaaS minimalism
- Tailwind-default form controls with no material treatment
- glassmorphism that looks like a contemporary dashboard
- vaporwave decoration that is only aesthetic and not functional UI material
- trendy purple gradients that are not grounded in the existing palette
- replacing the current chunky editor with clean Apple-like restraint

## Typography direction

The current type treatment is part of the brand.

- `VT323` carries most body and UI text
- `Silkscreen` is used for micro-labels, titlebar text, and retro display
  moments
- labels can be tiny, spaced out, and game-console-like, but they must stay
  readable
- copy can feel playful and irreverent, but controls must still be obvious

Do not replace the current type system with generic sans-serif UI fonts unless
there is a strong product reason.

## Component styling rules

When building or editing UI:

1. Prefer the existing skeuomorphic primitives and class patterns over inventing
   a flatter parallel style.
2. New controls should feel like they belong beside the current buttons, window
   shells, title bars, and selects.
3. Use bevels, gloss, and inset depth intentionally. Do not add random shine
   with no structural meaning.
4. Media areas should stay visually calm and dark so the content remains the
   focus.
5. Panels can be expressive, but the hierarchy must stay obvious: viewport
   first, storyboard and controls second, status and metadata last.

## Interaction rules

1. Keep the main click-extension-to-capture-to-export path short.
2. Default actions should be obvious and prominent.
3. Background processing must explain itself with status text instead of silent
   waiting.
4. Storyboard and annotation edits should feel immediate and reversible.
5. Keep the storyboard rail visible. Do not hide the main evidence trail behind
   a tray or secondary mental model.

## How agents should use Plane

Plane is the source of truth for what to build next, but agents should read this
file before accepting roadmap scope at face value.

Required workflow:

1. Retrieve the `snipr` project in Plane.
2. Read current milestones, modules, open work items, and dependencies.
3. Prefer assigned work first.
4. If nothing is assigned, pick from `Todo`.
5. If `Todo` is empty, pull the smallest coherent item from `Backlog`.
6. Before implementing broad capture or platform work, check whether it serves
   the video storyboard MVP.
7. Move the selected work item to `In Progress` before editing code.
8. When implementation is complete and verified, move it to `Done`.
9. If a task is intentionally dropped or superseded, move it to `Cancelled`.

State meaning:

- `Backlog`: valid idea, not yet ready to pull
- `Todo`: ready for active work
- `In Progress`: currently being worked on
- `Done`: implemented and verified
- `Cancelled`: intentionally not moving forward

## Definition of done

A task is not done just because code exists.

A work item is `Done` only when:

1. the change is implemented
2. the primary path is verified
3. the output still supports the MVP handoff loop
4. any important follow-up is captured back in Plane
5. the Plane status is updated before ending the task

## Guardrails

- Do not treat local markdown docs as the planning system when Plane already
  contains the roadmap and work items.
- Do not ship a flat modern UI that breaks the current product identity.
- Do not create a weaker extension-only interface when the full web editor can
  be reused.
- Do not optimize only for media export; optimize for agent comprehension.
- Do not expand into every capture workflow before the video storyboard MVP is
  genuinely strong.
