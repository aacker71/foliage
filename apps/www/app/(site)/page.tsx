import { ProductScenes } from "@/components/site/product-scenes";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteShell, TextLink } from "@/components/site/site-shell";

export default function Home() {
  return <SiteShell><main id="main" className="journey-home">
    <section className="journey-opening">
      <div className="journey-opening-copy">
        <h1>You’ve done more than you remember.</h1>
        <p className="journey-promise">Your work deserves a record.</p>
        <p className="journey-opening-detail">Keep what you built, what you learned, and the evidence behind it. Choose the part you share.</p>
        <div className="journey-opening-actions"><Button asChild><Link href="/start">Get Foliage</Link></Button><TextLink href="#scenes">See the app</TextLink></div>
      </div>
      <figure className="journey-work">
        <picture>
          <source media="(max-width: 640px)" srcSet="/product/work-mobile.jpg" width="375" height="812" />
          <Image src="/product/work-source.jpg" alt="Private Foliage Work screen with three selected Git source records and one unreviewed draft." width={1280} height={900} sizes="(max-width: 760px) 100vw, 58vw" priority unoptimized />
        </picture>
        <figcaption><span>Private Work · unpublished</span><span>Selected Git source records · October 2026</span></figcaption>
      </figure>
    </section>
    <section className="journey-thesis" aria-label="How your record becomes a view"><p>One record holds the context.</p><p>You decide which view leaves it.</p></section>
    <div id="scenes"><ProductScenes /></div>
    <section className="journey-paths" aria-label="Your work, kept and shared">
      <article><h2>Keep the whole story.</h2><p>The decisions, discoveries and work that rarely make the highlight reel.</p><TextLink href="/photosynthesis">Meet Photosynthesis</TextLink></article>
      <article><h2>Share the right part.</h2><p>A portfolio for an opportunity. A deeper record for you.</p><TextLink href="/canopy">Explore Canopy</TextLink></article>
    </section>
  </main></SiteShell>;
}
