import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" },
    ] }];
  },
  // The local previews use the loopback address as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // Route groups have distinct day/night root layouts; unmatched URLs need the shared fallback.
  experimental: { globalNotFound: true },
};

export default nextConfig;
