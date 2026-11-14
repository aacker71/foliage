import Image from "next/image";
import Link from "next/link";
import { SiteShell, LinkArrow } from "@/components/site/site-shell";
import { surfaces } from "@/components/prototypes/catalog";

export const metadata = { robots: { index: false, follow: false } };

export default function Prototypes() {
  return <SiteShell><main id="main" className="prototype-gallery">
    <header className="prototype-gallery-opening">
      <div>
        <h1>Different views. One work record.</h1>
        <p className="record-lede">Explore how the same underlying work could be read by its owner and by people they choose to share it with.</p>
        <p className="prototype-gallery-caveat">The linked views below are interface previews without a connected account.</p>
      </div>
      <figure><Image src="/product/work-source.jpg" alt="Private Foliage Work screen with selected Git source records and a draft ready to review." width={1280} height={900} sizes="(max-width: 760px) 100vw, 48vw" unoptimized priority /><figcaption>Private Work · selected Git source records · unpublished</figcaption></figure>
    </header>
    {([["personal", "For your work"], ["business", "For invited readers and teams"]] as const).map(([audience, heading]) => <section className="prototype-gallery-group" key={audience}>
      <h2>{heading}</h2>
      <ul>{Object.entries(surfaces).filter(([, app]) => app.audience === audience).map(([slug, app]) => <li key={slug}>
        <div><h3>{app.name}</h3><p>{app.description}</p></div>
        <Link href={`/prototypes/${slug}`}>View preview <LinkArrow /></Link>
      </li>)}</ul>
    </section>)}
  </main></SiteShell>;
}
