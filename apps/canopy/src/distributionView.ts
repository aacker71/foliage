import { distributionMarkdown, distributionProjection, type PublishedLeafDocument } from "@foliage/canopy";
import { ACHIEVEMENT_CLAIM_LABELS } from "@foliage/leaf";
import { ui } from "@foliage/ui";
import { esc } from "./renderPublished.ts";
/** The same admitted projection for humans, print and ATS/agent readers. No private lookup. */
export function renderDistributionResume(document: PublishedLeafDocument, origin: string): string {
  const view = distributionProjection(document, origin);
  const published = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(view.publishedAt));
  const achievements = view.achievements.map(a => `<section class="resume-achievement" aria-labelledby="resume-${esc(a.id)}">
    <h3 id="resume-${esc(a.id)}">${esc(a.title)}</h3>
    ${a.claims.map(c => `<div class="resume-claim">
      <p class="resume-label">${esc(ACHIEVEMENT_CLAIM_LABELS[c.kind])}</p>
      <p class="resume-statement">${esc(c.text)}</p>
      <a class="resume-evidence" href="${esc(c.url)}">Read this statement in the portfolio<span aria-hidden="true"> ↗</span></a>
      ${c.citations.length ? `<details class="resume-citations"><summary>Supporting evidence (${c.citations.length})</summary>
        <ul>${c.citations.map((citation, index) => `<li><a href="${esc(citation.url)}">Evidence ${index + 1}</a><span>${esc(citation.source)}</span><code title="${esc(citation.ref)}">${esc(citation.ref)}</code></li>`).join("")}</ul></details>` : '<p class="resume-note">No supporting evidence attached.</p>'}
    </div>`).join("")}</section>`).join("");
  return `<!doctype html>
<html lang="en" data-face="day"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(view.subject.name)} · Résumé</title>
<link rel="canonical" href="${esc(view.resumeUrl)}">
<link rel="alternate" type="application/json" title="Résumé for agents" href="${esc(view.resumeUrl)}.json">
<link rel="stylesheet" href="/foliage-tokens.css"><link rel="stylesheet" href="/roles.css">
<link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/resume.css">
<script type="module" src="/resume.mjs"></script></head>
<body class="resume-page"><a class="resume-skip" href="#resume">Skip to résumé</a>
<div class="resume-tools"><a class="resume-back" href="${esc(view.url)}">← Portfolio</a>
<div class="resume-actions">${ui.button("Print / Save PDF", { type: "button", variant: "default", "data-resume-print": "", hidden: true })}
${ui.link("Download Word (.docx)", { href: `${view.resumeUrl}.docx`, download: `${view.subject.id}-resume.docx` })}
${ui.link("Download Markdown", { href: `${view.resumeUrl}.md`, download: `${view.subject.id}-resume.md` })}</div></div>
<main id="resume" class="resume-document">
<header class="resume-heading"><p class="resume-label">Résumé · published work</p><h1>${esc(view.subject.name)}</h1>
${view.headline ? `<p class="resume-headline">${esc(view.headline)}</p>` : ""}
<p class="resume-portfolio"><span>Portfolio &amp; evidence</span><a href="${esc(view.url)}">${esc(view.url)}</a></p>
${view.bio ? `<p class="resume-bio">${esc(view.bio)}</p>` : ""}${view.direction ? `<p class="resume-bio">${esc(view.direction)}</p>` : ""}
</header><section class="resume-work" aria-labelledby="resume-work-heading"><h2 id="resume-work-heading">Selected work</h2>
${achievements || '<p class="resume-empty">No achievement statements have been published yet. The portfolio may contain other shared work.</p>'}</section>
<footer class="resume-footer"><p>Published <time datetime="${esc(view.publishedAt)}" title="${esc(view.publishedAt)}">${esc(published)}</time></p>
<p>${esc(view.limitation)}</p><p>A downloaded résumé is a snapshot. Follow the portfolio links for current work and availability.</p></footer>
</main><aside class="resume-help" aria-label="Using this résumé"><h2>Take the evidence with you</h2>
<p>For an application, download Word or save a PDF and attach the format the application accepts. Add the portfolio URL to the website field when one is available.</p>
<p>Agents can read the <a href="${esc(view.resumeUrl)}.json">structured résumé</a> and follow its claim and evidence links. An ATS may not follow links automatically.</p>
<noscript><p>Use your browser’s Print command to save a PDF. The résumé and evidence links work without JavaScript.</p></noscript>
<p id="resume-print-status" role="status"></p></aside></body></html>`;
}
export function publicResumeBytes(document: PublishedLeafDocument, origin: string) {
  return distributionMarkdown(distributionProjection(document, origin));
}
