import { ProductScenes } from "@/components/site/product-scenes";
import Image from "next/image";
import type { Metadata } from "next";
import { SiteShell, TextLink } from "@/components/site/site-shell";
export const metadata: Metadata = { title: "Canopy · Foliage", description: "Share a selected view of your work. Keep the deeper record private." };
export default function Canopy() {
 return <SiteShell current="/canopy"><main id="main">
  <section className="product-opening product-opening-public"><div className="product-opening-copy"><h1>Let the work speak for you.</h1><p className="record-lede">Share a selected view. Keep the deeper record private.</p><TextLink href="/start">Start with your work</TextLink></div><figure className="product-opening-scene"><picture><source media="(max-width: 640px)" srcSet="/product/reader-mobile.jpg" width="375" height="1100" /><Image src="/product/reader-source.jpg" alt="October 2026 local Canopy publication rehearsal showing two Git-derived records, evidence controls and pending attribution." width={1280} height={800} sizes="(max-width: 760px) 100vw, 52vw" priority unoptimized /></picture><figcaption>Local publication rehearsal · October 2026</figcaption></figure></section>
  <section className="product-canopy-note"><h2>Private truth. Public view.</h2><p>The selected view carries its own evidence and attribution state. The underlying record stays with its owner.</p></section>
  <figure className="record-canopy-image"><Image src="/brand/canopy-daylight.png" alt="Compound leaves reaching into a sunlit canopy" width={2171} height={724} sizes="100vw" /></figure>
  <ProductScenes initial="presentation" single />
 </main></SiteShell>;
}
