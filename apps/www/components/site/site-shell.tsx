import Link from "next/link";
import type { ReactNode } from "react";
import mark from "@foliage/tokens/mark-icon.svg";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/photosynthesis", label: "Photosynthesis" },
  { href: "/canopy", label: "Canopy" },
  { href: "/why-foliage", label: "Why Foliage" },
];
export function Brand() {
  return (
    <Link className="record-brand" href="/" aria-label="Foliage home">
      <span aria-hidden="true" style={{ maskImage: `url(${mark.src})` }} />
      Foliage
    </Link>
  );
}
export function SiteShell({
  children,
  current,
}: {
  children: ReactNode;
  current?: string;
}) {
  return (
    <div className="record-site">
      <Link className="record-skip" href="#main">
        Skip to content
      </Link>
      <header className="record-header">
        <Brand />
        <nav className="record-nav" aria-label="Main navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {current !== "/start" && <Button variant="outline" asChild className="record-start">
          <Link href="/start">Get Foliage</Link>
        </Button>}
        <details className="record-mobile-menu">
          <summary>Menu</summary>
          <nav aria-label="Mobile navigation">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current === link.href ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
            {current !== "/start" && <Link href="/start">Get Foliage</Link>}
          </nav>
        </details>
      </header>
      {children}
      <footer className="record-footer">
        <div>
          <Brand />
          <p>Your work deserves a record.</p>
        </div>
        <nav aria-label="Product">
          <h2>Build your record</h2>
          <Link href="/photosynthesis">Photosynthesis</Link>
          <Link href="/canopy">Canopy</Link>
          <Link href="/start">Getting started</Link>
        </nav>
        <nav aria-label="About Foliage">
          <h2>Understand Foliage</h2>
          <Link href="/why-foliage">The product thesis</Link>
          <Link href="/why-foliage#evidence">Evidence &amp; attribution</Link>
          <Link href="/privacy">Your work &amp; privacy</Link>
          <Link href="/start#scenes">App screenshots</Link>
        </nav>
        <p className="record-footer-note">
          Your record. Your context. Your choice of what to share.
        </p>
      </footer>
    </div>
  );
}
export function Closing({
  title = "Begin with something that mattered.",
  text = "A decision. A discovery. A piece of work you don’t want to lose.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <section className="record-closing">
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      <Button asChild>
        <Link href="/start">Get Foliage</Link>
      </Button>
    </section>
  );
}
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link className="record-text-link" href={href}>
      {children}
      <LinkArrow />
    </Link>
  );
}

export function LinkArrow() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M4 12h15m-5-5 5 5-5 5" />
    </svg>
  );
}
