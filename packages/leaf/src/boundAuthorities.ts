/**
 * The `Host` values a local server answers to, derived from the socket it actually bound.
 *
 * DNS rebinding: a page on `evil.example` whose name is re-resolved to 127.0.0.1 sends
 * `Host: evil.example:<port>` and a matching `Origin`, so every Origin-vs-Host check agrees and the
 * browser lets the page read the reply. The one value in that exchange a remote page cannot forge is
 * the address this process bound, so the allow-list comes from `server.address()` — never from
 * `HOST`, which is `process.env["HOST"]` and as steerable as the header it would be validating.
 *
 * Shared by the Leaf, Enterprise and Canopy reader servers, which each refuse anything else with 421
 * before routing. Pure: the caller passes `server.address()`.
 */

const WILDCARD_BINDS = new Set(["0.0.0.0", "::", "::ffff:0.0.0.0"]);

/**
 * The authorities a socket bound at `bound` answers to, lowercase, in the exact wire form a `Host`
 * header takes. Compare against the request's `Host` lowercased: the name is case-insensitive.
 *
 * `fallbackPort` is used only before the socket is listening (`bound` is null) or for a pipe.
 */
export function boundAuthorities(
  bound: string | { readonly address: string; readonly port: number } | null,
  fallbackPort: number,
): readonly string[] {
  const socket = bound !== null && typeof bound === "object" ? bound : null;
  const port = socket?.port ?? fallbackPort;
  // Loopback always, because that is what a browser on this machine types. The bound address
  // itself is added only when it identifies one interface — a wildcard identifies none.
  const names = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (socket !== null && !WILDCARD_BINDS.has(socket.address)) {
    const a = socket.address.toLowerCase();
    names.add(a.includes(":") ? `[${a}]` : a);
  }
  // Every browser elides `:80` from Host, so on port 80 both forms are the same endpoint.
  return [...names].flatMap((n) => (port === 80 ? [n, `${n}:80`] : [`${n}:${port}`]));
}
