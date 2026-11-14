/** External destinations are operator-selected; the bundled local download is checksum-pinned. */
import { bundledLocalRelease } from "./bundledLocalRelease.ts";

export function siteConfig(env: Record<string, string | undefined>) {
  const https = (name: string, originOnly = false) => {
    const value = env[name]?.trim();
    if (!value) return undefined;
    let url: URL;
    try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute HTTPS URL.`); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (originOnly && (url.pathname !== "/" || url.search))) {
      throw new Error(`${name} must be an HTTPS ${originOnly ? "origin" : "URL"} without credentials or fragments.`);
    }
    return originOnly ? url.origin : url.href;
  };
  const site = https("FOLIAGE_SITE_ORIGIN", true);
  const hostedOrigin = https("FOLIAGE_HOSTED_ORIGIN", true);
  const hostedAccepted = env.FOLIAGE_HOSTED_ACCEPTED === "1";
  if (hostedAccepted && !hostedOrigin) throw new Error("FOLIAGE_HOSTED_ACCEPTED requires FOLIAGE_HOSTED_ORIGIN.");
  const app = hostedAccepted ? hostedOrigin : undefined;
  const preview = https("FOLIAGE_PREVIEW_ORIGIN", true);
  const download = https("FOLIAGE_DOWNLOAD_URL");
  const checksum = env.FOLIAGE_DOWNLOAD_SHA256?.trim();
  const version = env.FOLIAGE_RELEASE_VERSION?.trim();
  if ((download || checksum || version) && (!download || !checksum || !/^[a-f0-9]{64}$/.test(checksum) || !version || !/^[a-zA-Z0-9][a-zA-Z0-9.+-]{0,63}$/.test(version))) {
    throw new Error("A download requires FOLIAGE_DOWNLOAD_URL, a SHA-256 digest and a release version together.");
  }
  return { site, app, ...(preview ? { preview } : {}), release: download && checksum && version
    ? { url: download, checksum, version, platform: undefined }
    : bundledLocalRelease };
}
