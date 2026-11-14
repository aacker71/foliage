import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteConfig } from "@/src/siteConfig";
import { icons } from "@/lib/metadata";
import "../globals.css";

export const metadata: Metadata = {
  icons,
  robots: siteConfig(process.env).site ? undefined : { index: false, follow: false },
  metadataBase: siteConfig(process.env).site ? new URL(siteConfig(process.env).site!) : undefined,
  openGraph: { title: "Foliage — Your work deserves a record", description: "Understand what mattered. Recognize your value. Find what comes next.", type: "website", images: siteConfig(process.env).site ? [{ url: `${siteConfig(process.env).site}/brand/canopy-daylight.png`, width: 2171, height: 724, alt: "Foliage compound leaves in a sunlit canopy" }] : [] },
  twitter: { card: "summary_large_image" },
  // The product's own sentence, not a tagline written for the occasion.
  title: "Foliage — Your work deserves a record",
  description:
    "The living system of record for your work. Understand what mattered, what you learned, and the evidence behind it. Share the right view.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    /*
     * `data-face="day"` ON <html>, and both halves of that matter.
     *
     * A marketing page is a PUBLISHED surface, and in Foliage "day" is not a light theme — it is
     * what a published leaf looks like to somebody reading it. Night is the person's private
     * workspace. Setting it here means the landing page and the leaf an employer opens are the
     * same face, drawn from the same tokens.
     *
     * It must be on <html> and nowhere else: the theme bridge declares its mappings on `:root`,
     * and a custom property substitutes its `var()` where it is DECLARED — so a face set on a
     * wrapper would resolve every mapping against night values once and hand descendants an
     * already-resolved colour. `roles.css` records a sibling lineage shipping exactly that: a cream
     * wordmark on paper, with no error anywhere. `:root` and `html[data-face]` are one element.
     *
     * The Geist fonts the scaffold imported are gone. `@foliage/tokens` ships the product's own
     * faces — Fraunces, Instrument Sans, JetBrains Mono — with their own @font-face rules, and a
     * second font system is the same drift as a second palette.
     */
    <html lang="en" data-face="day" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
