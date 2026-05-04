import { createRoot } from "react-dom/client";

import "@/app/globals.css";

const params = new URLSearchParams(window.location.search);
const reason = params.get("reason") ?? "unknown";

const messages: Record<string, string> = {
  "not-status":
    "Open a post URL first (…/status/123…), then click the snipr icon. Home, profile, and search pages are not supported for one-click launch.",
  unknown: "This page cannot be opened with snipr from here.",
};

const body = messages[reason] ?? messages.unknown;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("snipr unsupported root missing");
}

createRoot(rootEl).render(
  <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-stretch overflow-hidden px-3 py-3 sm:px-6 sm:py-5">
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
      <section className="skeu-window flex w-full max-w-3xl shrink-0 flex-col overflow-hidden sm:max-w-4xl">
        <div className="skeu-titlebar shrink-0 text-left">
          <div className="skeu-titlebar__caps mr-1 shrink-0 pl-0.5" aria-hidden>
            <span className="skeu-titlecap skeu-titlecap--blue" />
            <span className="skeu-titlecap skeu-titlecap--purple" />
            <span className="skeu-titlecap skeu-titlecap--red" />
          </div>
          <div className="skeu-titlebar__lead flex min-h-0 min-w-0 flex-1 items-center px-2 py-1.5">
            <p className="min-w-0 truncate whitespace-nowrap text-left text-xs leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] sm:text-sm">
              <span className="font-display font-bold tracking-wide text-[#ffe082] drop-shadow-[0_1px_0_rgba(90,40,0,0.35)]">
                snipr
              </span>
              <span className="mx-1.5 opacity-90 sm:mx-2" aria-hidden>
                |
              </span>
              <span className="font-normal tracking-normal">needs a status page</span>
            </p>
          </div>
        </div>
        <div className="skeu-frame-body flex min-h-0 flex-1 flex-col items-stretch overflow-hidden px-3 py-3 sm:px-5 sm:py-4">
          <div className="skeu-inset skeu-inset--light flex w-full max-w-2xl flex-col items-center gap-4 self-center px-6 py-6 text-center sm:gap-5 sm:px-9 sm:py-8">
            <p className="max-w-lg text-base leading-relaxed text-[#0b1224] sm:text-lg">{body}</p>
          </div>
        </div>
      </section>
    </div>
  </main>,
);
