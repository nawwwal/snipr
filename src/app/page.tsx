import { parseFrameExtractorLaunch } from "@/lib/frame-extractor-launch";
import { FrameExtractorShell } from "@/components/frame-extractor-shell";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const launch = parseFrameExtractorLaunch(await searchParams);

  return <FrameExtractorShell launch={launch} />;
}
