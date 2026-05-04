"use client";

import dynamic from "next/dynamic";

import type { FrameExtractorLaunchConfig } from "@/lib/frame-extractor-launch";

const FrameExtractorApp = dynamic(
  () => import("@/components/frame-extractor-app").then((module) => module.FrameExtractorApp),
  { ssr: false },
);

export function FrameExtractorShell({ launch = null }: { launch?: FrameExtractorLaunchConfig | null }) {
  return <FrameExtractorApp launch={launch} />;
}
