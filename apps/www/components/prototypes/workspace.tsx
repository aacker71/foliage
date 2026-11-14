"use client";

import Link from "next/link";
import { audienceOf, surfaces, type Surface } from "./catalog";
import { PersonalJourney } from "./personal";
import { OrganizationJourney, RecruiterJourney } from "./business";
import { MemberJourney } from "./member";
import "./workspace.css";

export function Workspace({ surface }: { surface: Surface }) {
  const app = surfaces[surface];
  const day = surface === "recruiter";
  const peers = Object.entries(surfaces).filter(([key]) => audienceOf(key as Surface) === audienceOf(surface));

  return (
    <div className="prototype-shell" data-surface={surface} data-face={day ? "day" : "night"} data-foliage-theme>
      <a className="prototype-skip" href="#workspace-main">Skip to workspace</a>
      <header className="prototype-topbar">
        <Link href="/prototypes" className="prototype-wordmark">Foliage<span> / {app.name}</span></Link>
        {peers.length > 1 && <nav className="prototype-app-switcher" aria-label="Foliage applications">{peers.map(([key, value]) => <Link key={key} href={`/prototypes/${key}`} aria-current={key === surface ? "page" : undefined}>{value.name}</Link>)}</nav>}
        {surface === "individual" && <span className="personal-preview-label">Browser preview</span>}
      </header>
      <div className="prototype-grid">
        <main id="workspace-main" className="prototype-main">
          {surface === "individual" ? <PersonalJourney /> : surface === "recruiter" ? <RecruiterJourney /> : surface === "organization" ? <OrganizationJourney /> : <MemberJourney />}

        </main>
      </div>
      <footer className="prototype-footer">Foliage / {app.name}<span>{surface === "individual" ? "Private browser preview · nothing published" : "Prototype, not a live service"}</span></footer>
    </div>
  );
}
