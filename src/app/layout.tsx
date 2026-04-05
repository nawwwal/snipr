import type { Metadata, Viewport } from "next";
import { Agentation } from "agentation";
import { InterfaceKit } from "interface-kit/react";
import { Silkscreen, VT323 } from "next/font/google";

import "./globals.css";

const silkscreen = Silkscreen({
  variable: "--font-silkscreen",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const vt323 = VT323({
  variable: "--font-vt323",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "snipr | rip the video. keep the gold.",
  description:
    "Rip the video. Keep the gold. Storyboard posts, export frames, glossy 2000s chaos.",
};

export const viewport: Viewport = {
  themeColor: "#2b59c3",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${silkscreen.variable} ${vt323.variable} h-full overflow-hidden`}
    >
      <body className="flex h-dvh max-h-dvh flex-col overflow-hidden antialiased">
        <div className="skeu-noise" aria-hidden />
        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
          {process.env.NODE_ENV === "development" ? <InterfaceKit /> : null}
        </div>
        {process.env.NODE_ENV === "development" && <Agentation />}
      </body>
    </html>
  );
}
