"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import "./journey.css";

function portfolioUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const url = new URL(trimmed);
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Readers arrive with a link from its owner; this preview has no candidate directory. */
export function RecruiterJourney() {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  function openPortfolio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = portfolioUrl(link);
    if (!url) {
      setError("Enter a full http or https URL without login details.");
      return;
    }

    setError("");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="business-journey business-reader" aria-labelledby="recruiter-title">
      <div className="business-reader-layout">
        <div className="business-reader-content">
          <div className="business-intro">
            <h1 id="recruiter-title">Read work someone chose to share</h1>
            <p>Open their portfolio to see the work they published and the evidence they chose to include.</p>
          </div>
          <form className="business-action" onSubmit={openPortfolio} noValidate>
            <Label htmlFor="portfolio-url">Portfolio URL</Label>
            <div className="business-link-row">
              <Input
                id="portfolio-url"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoComplete="url"
                spellCheck={false}
                placeholder="https://"
                value={link}
                onChange={event => { setLink(event.target.value); setError(""); }}
                aria-describedby={error ? "portfolio-url-error" : "portfolio-url-note"}
                aria-invalid={Boolean(error)}
              />
              <Button type="submit" className="business-primary">Open portfolio</Button>
            </div>
            {error
              ? <p className="business-error" id="portfolio-url-error" role="alert">{error}</p>
              : <p className="business-note" id="portfolio-url-note">This preview checks the URL format only. It does not verify or save the portfolio.</p>}
          </form>
        </div>
        <figure className="business-reader-shot">
          <figcaption>Local reader rehearsal · 5 Oct 2026 · pending attribution</figcaption>
          <Image src="/product/reader-source.jpg" width={1280} height={800} sizes="(max-width: 900px) 100vw, 48vw" loading="eager" alt="Local Foliage reader rehearsal showing two Git-derived Leaflets with pending attribution and evidence controls." />
        </figure>
      </div>
    </section>
  );
}

type Structure = { company: string; organization: string; team: string };

/** Organization names here are a local sketch, with no membership or release data. */
export function OrganizationJourney() {
  const [company, setCompany] = useState("");
  const [organization, setOrganization] = useState("");
  const [team, setTeam] = useState("");
  const [preview, setPreview] = useState<Structure | null>(null);
  const [error, setError] = useState("");

  function showStructure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const structure = { company: company.trim(), organization: organization.trim(), team: team.trim() };
    if (!structure.company || !structure.organization || !structure.team) {
      setError("Enter all three names to preview the structure.");
      return;
    }
    setError("");
    setPreview(structure);
  }

  return (
    <section className="business-journey" aria-labelledby="organization-title">
      <div className="business-intro">
        <h1 id="organization-title">Map your company structure</h1>
        <p>Enter a company, an organization and a team to see their relationship.</p>
      </div>
      <div className="business-organization-stage">
        <form className="business-action" onSubmit={showStructure} noValidate>
          <div className="business-structure-fields">
            <div><Label htmlFor="org-company">Company</Label><Input id="org-company" value={company} onChange={event => { setCompany(event.target.value); setError(""); setPreview(null); }} aria-describedby={error ? "structure-error" : undefined} aria-invalid={Boolean(error && !company.trim())} /></div>
            <div><Label htmlFor="org-organization">Organization</Label><Input id="org-organization" value={organization} onChange={event => { setOrganization(event.target.value); setError(""); setPreview(null); }} aria-describedby={error ? "structure-error" : undefined} aria-invalid={Boolean(error && !organization.trim())} /></div>
            <div><Label htmlFor="org-team">Team</Label><Input id="org-team" value={team} onChange={event => { setTeam(event.target.value); setError(""); setPreview(null); }} aria-describedby={error ? "structure-error" : undefined} aria-invalid={Boolean(error && !team.trim())} /></div>
          </div>
          {error && <p className="business-error" id="structure-error" role="alert">{error}</p>}
          <div className="business-action-footer">
            <Button type="submit" className="business-primary">Preview structure</Button>
            <p className="business-note">Not saved. No members or release requests are connected.</p>
          </div>
        </form>
        <div className="business-diagram" role="status" aria-label="Structure preview">
          <h2>Structure preview</h2>
          <ol>
            <li><span>Company</span>{preview && <strong>{preview.company}</strong>}</li>
            <li><span>Organization</span>{preview && <strong>{preview.organization}</strong>}</li>
            <li><span>Team</span>{preview && <strong>{preview.team}</strong>}</li>
          </ol>
          {!preview && <p>Names appear here after you preview.</p>}
        </div>
      </div>
    </section>
  );
}
