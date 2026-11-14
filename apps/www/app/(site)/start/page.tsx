import Image from "next/image";
import type { Metadata } from "next";
import { siteConfig } from "@/src/siteConfig";
import { SiteShell } from "@/components/site/site-shell";
import { ProductScenes } from "@/components/site/product-scenes";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Start with your work · Foliage",
  description: "Bring the work you already have into a private record. See what mattered and choose what to share.",
};

/**
 * The download has no Node in it. Node 26 becomes nodejs.org's LTS download on 2026-10-28 and
 * Foliage's installer refuses 25 and newer, so this names v24's own page, not the default download.
 * The major-only page (/archive/v24) offered a macOS installer link that returned 404 when checked
 * on 2026-10-16, so this pins 24.22.0, whose page lists the .pkg for macOS ARM64.
 */
const NODE_24_MACOS = "https://nodejs.org/en/download/archive/v24.22.0";

export default function Start() {
  const config = siteConfig(process.env);
  const downloadName = config.release.url.startsWith("/") ? config.release.url.split("/").at(-1) : undefined;

  return <SiteShell current="/start"><main id="main" className="record-start-page">
    <header className="record-start-hero">
      <div className="record-start-copy">
        <h1>Your work deserves a record.</h1>
        <p className="record-lede">The things you built, changed, learned and nearly forgot belong together. Start with the work you already have.</p>
        <div className="record-start-actions">
          <Button asChild><a href={config.release.url} download={downloadName}>{config.release.platform ? "Download macOS archive" : "Download Foliage"}</a></Button>
          <Button variant="outline" asChild><a href="#scenes">View app screenshots</a></Button>
        </div>
        <p className="record-start-requirements">{config.release.platform ? `${config.release.platform} · Requires Node 22.18–24 · ` : ""}v{config.release.version}</p>
        {config.release.platform && <p className="record-start-requirements">No Node? Install <a href={NODE_24_MACOS} rel="noreferrer">Node 24 (LTS) for Apple silicon from nodejs.org</a>.<br />Don&apos;t use Node 25 or newer yet: Foliage refuses them.<br />Check with <code>node --version</code>.</p>}
      </div>
      <figure className="record-start-scene">
        <picture>
          <source media="(max-width: 640px)" srcSet="/product/record-mobile.jpg" width="375" height="812" />
          <Image src="/product/record-source.jpg" alt="Private Foliage Work screen with selected records from this project's Git history and a draft ready to review." width={1280} height={900} sizes="(max-width: 760px) 100vw, 52vw" priority unoptimized />
        </picture>
        <figcaption>Private Work · selected Git source records · unpublished</figcaption>
      </figure>
    </header>

    <details className="release-details"><summary>{config.release.platform ? "Install & verify" : "Verify download"}</summary>{config.release.platform && <p>One download holds Foliage and its local brain, which runs on this Mac only. Check that <code>shasum -a 256 ~/Downloads/{downloadName}</code> prints the SHA-256 below. Then extract it into a new folder and follow START-HERE.md in its runtime folder: <code>mkdir ~/foliage-download &amp;&amp; tar -xzf ~/Downloads/{downloadName} -C ~/foliage-download &amp;&amp; cd ~/foliage-download/runtime</code>. Double-clicking the download instead puts its runtime and vendor folders in a folder named after it.</p>}<code className="release-checksum">SHA-256 {config.release.checksum}</code></details>

    <div id="scenes"><ProductScenes initial="review" /></div>

    {config.app && <section className="record-start-sharing" id="sharing"><div><h2>Canopy</h2><p>Publish and manage your view</p></div><Button variant="outline" asChild><a href={`${config.app}/auth/sign-in`}>Sign in to Canopy</a></Button></section>}
  </main></SiteShell>;
}
