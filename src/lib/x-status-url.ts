/**
 * Returns true for public X/Twitter post URLs that include a numeric status id.
 * Matches paths like /user/status/123 and /i/status/123.
 */
export function isXStatusUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "x.com" && host !== "twitter.com") {
      return false;
    }
    return /\/(?:i\/)?status\/\d{5,}/i.test(url.pathname);
  } catch {
    return false;
  }
}
