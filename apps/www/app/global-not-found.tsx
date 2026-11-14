import type { Metadata } from "next";
import NotFound from "./(site)/not-found";
import { icons } from "@/lib/metadata";
import "./globals.css";

export const metadata: Metadata = { title: "Page not found · Foliage", icons };

// Separate day and night root layouts need a global fallback for unmatched URLs.
export default function GlobalNotFound() {
  return <html lang="en" data-face="day" className="h-full antialiased">
    <body className="min-h-full flex flex-col"><NotFound /></body>
  </html>;
}
