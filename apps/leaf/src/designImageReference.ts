/** An owner-entered public shot link. This never fetches Dribbble or proves authorship. */
export function dribbbleShotReference(value: unknown): string | null {
  if (value === "" || value === null) return null;
  if (typeof value !== "string" || value.length > 300) throw new Error("Use one Dribbble shot URL or leave the reference empty.");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["dribbble.com", "www.dribbble.com"].includes(url.hostname) ||
        url.username || url.password || url.port || url.search || url.hash || !/^\/shots\/[A-Za-z0-9-]+\/?$/.test(url.pathname)) throw new Error();
    if (url.href !== value) throw new Error();
    return url.href;
  } catch { throw new Error("Use one HTTPS Dribbble shot URL or leave the reference empty."); }
}
