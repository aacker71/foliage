import { escapeManage as esc, renderManageShell } from "./renderManage.ts";
import { digest, type Finding } from "./ladybugAssessment.ts";
import type { Workspace } from "./ladybugWorkspace.ts";
import type { AssessmentPublication, AssessmentInventory } from "./assessmentPublication.ts";
import { ui } from "@foliage/ui";
import type { AssessmentPacket } from "./ladybugAssessment.ts";

function findingsHtml(findings: readonly Finding[], selectable: boolean): string {
  return findings.map(f => `<section class="cell ladybug-finding">
    <h2>${selectable ? `<label><input type="checkbox" name="finding" value="${esc(f.dimension)}"> Release ${esc(f.dimension)} finding</label>` : esc(f.dimension)}</h2>
    <p>${esc(f.observation)}</p><p class="ladybug-caveat"><strong>Limits and uncertainty:</strong> ${esc(f.caveat)}</p>
    <details><summary>Excerpts</summary>${f.citations.map(c => `<blockquote><p>${esc(c.quote)}</p><cite>${esc(c.source)} · user-supplied</cite></blockquote>`).join("")}</details>
  </section>`).join("");
}
const hidden = (name: string, value: string): string => `<input type="hidden" name="${name}" value="${esc(value)}">`;
/** Reading order only: the submitted/redacted packet remains the authority and export bytes. */
function readableEvidence(packet: AssessmentPacket): string {
  const blocks = packet.evidence.replace(/\r\n/g, "\n").split("\n\n");
  const wording = packet.evidence.startsWith("Imported private workflow packet.")
    ? blocks.find(block => block.startsWith("Saved wording: "))?.slice("Saved wording: ".length) : undefined;
  const commits = wording ? blocks.filter(block => /^git [a-f0-9]{40,64}\n/.test(block)) : [];
  let title = wording ?? packet.subject;
  let body = `<p class="assessment-evidence-text">${esc(packet.evidence)}</p>`;
  if (wording) body = `<ul class="assessment-source-list">${commits.map(block => {
    const split = block.indexOf("\n");
    return `<li><p>${esc(block.slice(split + 1))}</p><code>${esc(block.slice(4, split))}</code></li>`;
  }).join("")}</ul>`;
  else if (packet.target) {
    try {
      const stored = JSON.parse(packet.evidence) as { title?: unknown; body?: { text?: unknown }[] };
      if (typeof stored.title === "string" && Array.isArray(stored.body)) {
        title = stored.title;
        const text = stored.body.filter(element => typeof element.text === "string");
        body = text.length ? text.map(element => `<p class="assessment-evidence-text">${esc(element.text as string)}</p>`).join("") : "<p>No body.</p>";
      }
    } catch { /* Free-form evidence stays readable as submitted text. */ }
  }
  return `<section class="assessment-work"><h2>${esc(title)}</h2>${body}<details><summary>Evidence</summary><pre class="ladybug-packet">${esc(packet.evidence)}</pre></details></section>`;
}
export function renderAssessmentWorkspace(workspace: Workspace | null, publication: AssessmentPublication | null, csrf: string, ready: boolean, model: string | null, publicOrigin: string, message = "", draft?: URLSearchParams): string {
  const packet = workspace?.packet;
  const saveDraft = draft?.has("evidence") ? draft : undefined;
  const importDraft = draft?.has("transfer") ? draft : undefined;
  const fields = hidden("csrf", csrf) + hidden("workspaceDigest", draft?.get("workspaceDigest") ?? digest(workspace));
  const confirm = `<label>Type portfolio id <code>${esc(packet?.id)}</code><input class="field" name="confirm" required autocomplete="off"></label>`;
  const entry = (name: string, label: string, max: number, required = false): string => `<label for="packet-${name}">${label}</label><textarea class="field" id="packet-${name}" name="${name}" maxlength="${max}" rows="${name === "evidence" ? 8 : 4}" ${required ? "required" : ""}>${esc(saveDraft?.get(name) ?? packet?.[name as "evidence" | "knownWork" | "market" | "correction"] ?? "")}</textarea>`;
  return renderManageShell(`<main class="wrap manage-main ladybug-workspace">
    <nav class="assessment-navigation"><a class="link" href="/ladybug/releases">Released</a></nav>
    <section class="manage-hero"><div><h1>Private assessment</h1></div>
    <aside class="manage-state"><span class="rel rel--internal">${workspace?.status === "assessed" ? "Ready" : "Private"}</span></aside></section>
    ${message ? `<aside class="manage-notice" role="${draft ? "alert" : "status"}"${draft ? ' tabindex="-1" autofocus' : ""}>${esc(message)}${draft ? '<a href="/ladybug">Refresh</a>' : ""}</aside>` : ""}
    ${packet && !importDraft && !saveDraft ? readableEvidence(packet) : ""}
    <details class="ladybug-intro"${importDraft ? " open" : ""}><summary>Import</summary>
    <form class="ladybug-form" action="/ladybug/import" method="post">${fields}
    ${ui.label("Workflow transfer", { htmlFor: "workflow-import" })}${ui.textarea({ id: "workflow-import", name: "transfer", rows: 8, maxLength: 64000, required: true, defaultValue: importDraft?.get("transfer") ?? "" })}
    ${ui.label("Portfolio id", { htmlFor: "import-id" })}${ui.input({ id: "import-id", name: "id", defaultValue: importDraft?.get("id") ?? packet?.id ?? "", maxLength: 80, required: true, readOnly: !!workspace })}
    ${ui.label("Name", { htmlFor: "import-subject" })}${ui.input({ id: "import-subject", name: "subject", defaultValue: importDraft?.get("subject") ?? packet?.subject ?? "", maxLength: 200, required: true })}
    ${ui.button("Preview", { type: "submit" })}</form></details>
    <details class="assessment-correction"${saveDraft ? " open" : ""}><summary>Evidence</summary><form class="cell ladybug-form" action="/ladybug/save" method="post">${fields}${saveDraft?.has("target") ? hidden("target", saveDraft.get("target")!) : packet?.target ? hidden("target", JSON.stringify(packet.target)) : ""}
      <label for="packet-id">Portfolio id</label><input class="field" id="packet-id" name="id" pattern="[a-z0-9](?:[a-z0-9]|-){0,79}" maxlength="80" value="${esc(saveDraft?.get("id") ?? packet?.id ?? "")}" ${workspace ? "readonly" : ""} required>
      <label for="packet-subject">Name</label><input class="field" id="packet-subject" name="subject" maxlength="200" value="${esc(saveDraft?.get("subject") ?? packet?.subject ?? "")}" required>
      ${entry("evidence", "Your work", 12_000, true)}
      <details class="assessment-context"><summary>Correction (optional)</summary>
      ${entry("knownWork", "Related work (optional)", 8_000)}
      ${entry("market", "Market demand (optional)", 8_000)}
      ${entry("correction", "Correction (optional)", 2_000)}
      </details><p>Redaction cannot catch every sensitive fact.</p>
      <button class="btn" type="submit">Save</button>
    </form></details>
    ${workspace ? `<section class="cell ladybug-intro"><h2>Review before sending</h2><p>Exactly what will be sent:</p><details><summary>Saved packet</summary><pre class="ladybug-packet">${esc(JSON.stringify(workspace.packet, null, 2))}</pre></details><p>Provider: Fireworks · Model: <code>${esc(model ?? "not configured")}</code></p>
      <p>${ready ? "Provider settings operator-declared, not attested." : "Not configured — no cloud call will be made."}</p>
      ${workspace.status === "running" ? `<p role="status">Running.</p><a class="link" href="/ladybug">Refresh</a>` : ""}
      ${workspace.failure ? `<p role="alert">${esc(workspace.failure)}</p>` : ""}
      <form class="ladybug-form" action="/ladybug/assess" method="post">${fields}${hidden("model", model ?? "")}${confirm}<label><input type="checkbox" name="consent" value="send" required> I reviewed this packet and authorize sending it to Fireworks for a private assessment.</label><button class="btn manage-primary" type="submit" ${ready ? "" : "disabled"}>Send</button></form></section>` : ""}
    ${workspace?.assessment && packet?.target ? `<section class="cell ladybug-intro"><h2>Return a revision</h2>
      <form class="ladybug-form" method="post" action="/ladybug/suggestion">${fields}${ui.label("Proposed wording", { htmlFor: "return-wording" })}${ui.textarea({ id: "return-wording", name: "title", maxLength: 600, required: true, rows: 3 })}${ui.button("Download suggestion", { type: "submit" })}</form></section>` : ""}
    ${workspace?.assessment ? `<form class="ladybug-form" action="/ladybug/release" method="post">${fields}${hidden("publicDigest", digest(publication))}<h2>Release</h2><p>Released with: uncertainty, excerpts, your name, model, date</p><p>Model: <code>${esc(workspace.assessment.model)}</code> · <time>${esc(workspace.assessment.assessedAt)}</time></p>${findingsHtml(workspace.assessment.findings, true)}${confirm}<button class="btn" type="submit">${publication?.release ? "Replace release" : "Release selected"}</button></form>` : ""}
    ${publication?.release && packet ? `<section class="cell ladybug-intro"><h2>Released</h2><a class="link" href="${esc(new URL(`/assessment/${packet.id}`, publicOrigin).href)}">Open</a><form class="ladybug-form" action="/ladybug/withdraw" method="post">${hidden("csrf", csrf)}${hidden("id", packet.id)}${hidden("publicDigest", digest(publication))}${confirm}<button class="btn btn-ghost" type="submit">Withdraw</button></form><p>Copies already delivered cannot be recalled.</p></section>` : ""}
  </main>`);
}
export function renderWorkflowImportPreview(packet: AssessmentPacket, csrf: string, expected: string, replacing: boolean): string {
  return renderManageShell(`<main class="wrap manage-main ladybug-workspace"><h1>Imported evidence</h1>
    ${replacing ? "<p>Saving replaces the current packet and its assessment.</p>" : ""}
    <section class="cell ladybug-intro"><h2>${esc(packet.subject)}</h2><p>Portfolio id: <code>${esc(packet.id)}</code></p>
    <h3>Evidence</h3><pre class="ladybug-packet">${esc(packet.evidence)}</pre></section>
    <form class="ladybug-form" action="/ladybug/save" method="post">${hidden("csrf", csrf)}${hidden("workspaceDigest", expected)}
    ${Object.entries(packet).map(([key, value]) => hidden(key, typeof value === "string" ? value : JSON.stringify(value))).join("")}
    ${ui.button(replacing ? "Replace" : "Save", { type: "submit" })}</form>
    <p>${ui.link("Cancel", { href: "/ladybug" })}</p></main>`);
}
export function renderAssessmentReleases(inventory: AssessmentInventory, csrf: string, publicOrigin: string): string {
  const { items, unreadable } = inventory;
  return renderManageShell(`<main class="wrap manage-main ladybug-workspace"><a class="link" href="/ladybug">Back</a><h1>Released findings</h1>${unreadable.length ? `<aside role="alert">Unreadable, not served: ${unreadable.map(esc).join(", ")}</aside>` : ""}${items.length === 0 ? "<p>Nothing released</p>" : items.map(item => `<section class="cell ladybug-intro"><h2>${esc(item.release?.subject)}</h2><a class="link" href="${esc(new URL(`/assessment/${item.id}`, publicOrigin).href)}">Open</a><form class="ladybug-form" action="/ladybug/withdraw" method="post">${hidden("csrf", csrf)}${hidden("id", item.id)}${hidden("publicDigest", digest(item))}<label>Type portfolio id <code>${esc(item.id)}</code><input class="field" name="confirm" required autocomplete="off"></label><button class="btn btn-ghost" type="submit">Withdraw</button></form></section>`).join("")}</main>`);
}
export function renderReleasedAssessment(publication: AssessmentPublication | null): string {
  const release = publication?.release;
  return `<!doctype html><html lang="en" data-face="day"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${release ? esc(release.subject) : "Assessment unavailable"} · Ladybug</title><link rel="stylesheet" href="/canopy-base.css"><link rel="stylesheet" href="/manage.css"><link rel="icon" href="/mark-icon.svg"></head><body class="manage"><main class="wrap manage-main ladybug-workspace">${release ? `<p class="lab">Ladybug · released by the owner</p><h1>${esc(release.subject)}</h1><p class="lede">AI interpretation · not authorship proof</p><p>Model: <code>${esc(release.model)}</code> · <time>${esc(release.assessedAt)}</time></p>${findingsHtml(release.findings, false)}` : `<h1>Assessment unavailable.</h1>`}</main></body></html>`;
}
