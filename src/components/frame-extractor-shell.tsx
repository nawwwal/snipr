"use client";

import dynamic from "next/dynamic";

const FrameExtractorApp = dynamic(
  () => import("@/components/frame-extractor-app").then((module) => module.FrameExtractorApp),
  { ssr: false },
);

export function FrameExtractorShell() {
  return <FrameExtractorApp />;
}
