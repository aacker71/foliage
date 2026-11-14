import { ProductScenes } from "@/components/site/product-scenes";
import Image from "next/image";
import type { Metadata } from "next";
import { SiteShell, TextLink } from "@/components/site/site-shell";
import { ReflectionPrompts } from "@/components/site/record-explorer";
export const metadata: Metadata = { title: "Photosynthesis · Foliage", description: "Keep the decisions, discoveries and evidence behind your work." };
export default function Photosynthesis() {
 return <SiteShell current="/photosynthesis"><main id="main">
  <section className="product-opening product-opening-private"><div className="product-opening-copy"><h1>Keep the thinking behind the work.</h1><p className="record-lede">Projects, decisions and discoveries stay connected to their evidence.</p><TextLink href="/start">Get Foliage</TextLink></div><figure className="product-opening-scene"><picture><source media="(max-width: 640px)" srcSet="/product/import-mobile.jpg" width="375" height="812" /><Image src="/product/import-source.jpg" alt="October 2026 private Foliage import preview of the Positioning section from PRODUCT.md, before adding it to review." width={1280} height={800} sizes="(max-width: 760px) 100vw, 52vw" priority unoptimized /></picture><figcaption>Private import preview · local capture, October 2026</figcaption></figure></section>
  <section className="product-editorial" aria-label="How Photosynthesis works"><div><h2>Start with what already exists.</h2><p>Bring selected sources into private review. Keep the origin and context with each record.</p></div><figure><Image src="/brand/living-leaf.png" alt="Compound leaves growing around a ladybug" width={1024} height={1024} sizes="(max-width: 760px) 100vw, 32vw" /><figcaption>Work gathers into a larger record.</figcaption></figure></section>
  <ProductScenes initial="work" single />
  <section className="record-reflection record-section"><div><h2>Pause. Look back.</h2><p>Three questions for your next reflection.</p></div><ReflectionPrompts /></section>
 </main></SiteShell>;
}
