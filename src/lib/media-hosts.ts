const ALLOWED_MEDIA_PROXY_HOSTS = new Set([
  "pbs.twimg.com",
  "video-ft.twimg.com",
  "video.twimg.com",
]);

export function isAllowedMediaProxyUrl(url: URL) {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    ALLOWED_MEDIA_PROXY_HOSTS.has(url.hostname)
  );
}
