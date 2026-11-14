"use client";

import Image from "next/image";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./product-scenes.css";

const scenes = [
  { id: "work", label: "Work", title: "See the work in context.", caption: "Selected Git source records sit beside an unreviewed draft in the private Work screen.", image: "work", extension: "jpg", width: 1280, height: 900, mobileWidth: 375, mobileHeight: 812, alt: "Private Foliage Work screen with three selected Git source records and one unreviewed draft." },
  { id: "review", label: "Review", title: "Decide what belongs.", caption: "A Git-derived draft keeps its source beside the review decision. Nothing here has been approved or published.", image: "review", extension: "jpg", width: 1280, height: 900, mobileWidth: 375, mobileHeight: 812, alt: "Private Foliage Review screen with one unreviewed Git-derived draft, its cited commit and approval controls." },
  { id: "import", label: "Bring it in", title: "Your work is already somewhere.", caption: "Preview a section of a real Foliage document before adding it to private review.", image: "import", extension: "jpg", width: 1280, height: 800, mobileWidth: 375, mobileHeight: 812, alt: "October 2026 Foliage import preview showing the Positioning section of PRODUCT.md and a Create record and add to review action." },
  { id: "presentation", label: "Make it yours", title: "Give the work its own story.", caption: "September capture of an unpublished installer account and its résumé wording.", image: "presentation", extension: "png", width: 1200, height: 820, mobileWidth: 390, mobileHeight: 844, alt: "September 2026 Foliage portfolio editor showing a saved, unpublished local installer account and its résumé statement." },
  { id: "reader", label: "Reader", title: "See the selected view.", caption: "Local publication rehearsal: two Git records with evidence and pending attribution.", image: "reader", extension: "jpg", width: 1280, height: 800, mobileWidth: 375, mobileHeight: 1100, alt: "October 2026 local Canopy publication rehearsal for Alex A, showing two Git-derived records, evidence controls, Pending attribution and Read leaflet actions." },
] as const;

export function ProductScenes({ initial = "work", single = false }: { initial?: typeof scenes[number]["id"]; single?: boolean }) {
  const visible = single ? scenes.filter(scene => scene.id === initial) : scenes;
  return <section className="product-scenes" aria-label="See Foliage in use">
    <Tabs defaultValue={initial}>
      {!single && <div className="product-scenes-heading"><h2>See the work take shape.</h2><TabsList aria-label="Product scenes" className="product-scene-tabs">{scenes.map(scene => <TabsTrigger key={scene.id} value={scene.id}>{scene.label}</TabsTrigger>)}</TabsList></div>}
      {visible.map(scene => <TabsContent value={scene.id} key={scene.id} className="product-scene-panel" data-scene={scene.id}>
        <div className="product-scene-caption"><div><h3>{scene.title}</h3><p>{scene.caption}</p></div>{["source", "mobile"].map(layout => <a key={layout} className={`product-scene-full-${layout}`} href={`/product/${scene.image}-${layout}.${scene.extension}`} target="_blank" rel="noopener noreferrer" aria-label={`View full screenshot: ${scene.label}`}>View full screenshot<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 18 18 6M6 6h12v12" /></svg></a>)}</div>
        <figure><picture><source media="(max-width: 640px)" srcSet={`/product/${scene.image}-mobile.${scene.extension}`} width={scene.mobileWidth} height={scene.mobileHeight} /><Image src={`/product/${scene.image}-source.${scene.extension}`} alt={scene.alt} width={scene.width} height={scene.height} sizes="100vw" unoptimized /></picture></figure>
      </TabsContent>)}
    </Tabs>
    <p className="product-scene-note">Local app captures · September–October 2026</p>
  </section>;
}
