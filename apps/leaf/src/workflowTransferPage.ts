import { ui } from "@foliage/ui";
import { esc, page } from "./render.ts";
import type { WorkflowTransfer } from "./workflowTransfer.ts";

export function renderWorkflowTransfer(transfer: WorkflowTransfer | null, revision: string, why?: string, companionConnected = false): string {
  const back = "/review";
  const evidenceItems = (entries: WorkflowTransfer["evidence"]): string => entries.map(e => `<li><p data-verbatim="commit-subject">${esc(e.title)}</p><code class="fol-metric">${esc(e.sha)}</code></li>`).join("");
  return page({ title: "Foliage — Export evidence", surface: "scarlet", nav: "review", face: "night", state: "transfer", empty: !transfer,
    body: `<div class="transfer-review"><header>
    <h1>${transfer ? "Export evidence" : "Nothing to export"}</h1>
    ${ui.link("Back", { href: back })}</header>
    ${why ? ui.alert(why) : ""}
    ${transfer ? `<section aria-labelledby="transfer-wording"><h2 id="transfer-wording">Title</h2>
    <p class="transfer-title" data-authored="title">${esc(transfer.title)}</p></section>
    <section aria-labelledby="transfer-evidence"><h2 id="transfer-evidence">Evidence</h2>
    <p><span class="fol-metric">${transfer.evidence.length}</span> ${transfer.evidence.length === 1 ? "commit" : "commits"}</p>
    <ul class="transfer-evidence">${evidenceItems(transfer.evidence.slice(0, 3))}</ul>
    ${transfer.evidence.length > 3 ? `<details class="transfer-payload"><summary><span class="fol-metric">${transfer.evidence.length - 3}</span> more</summary><ul class="transfer-evidence">${evidenceItems(transfer.evidence.slice(3))}</ul></details>` : ""}
    <p>${transfer.omitted ? `<span class="fol-metric">${transfer.omitted}</span> omitted · ` : ""}Collected ${transfer.capturedAt ? `<time class="fol-metric" datetime="${esc(transfer.capturedAt)}">${esc(transfer.capturedAt)}</time>` : "—"} · Saved <time class="fol-metric" datetime="${esc(transfer.savedAt)}">${esc(transfer.savedAt)}</time></p></section>
    <section aria-labelledby="transfer-sharing"><h2 id="transfer-sharing">File</h2>
    <p>Check titles for private details.</p>
    <details class="transfer-payload"><summary>Exact file</summary>
    ${ui.label("Portable evidence packet", { htmlFor: "workflow-transfer" })}
    ${ui.textarea({ id: "workflow-transfer", rows: 18, readOnly: true, defaultValue: JSON.stringify(transfer, null, 2) })}
    </details>
    ${companionConnected ? `<form method="post" action="/sources/assessment">
    <input type="hidden" name="packet" value="${esc(transfer.packetId)}"><input type="hidden" name="revision" value="${esc(revision)}">
    <p>Sends this packet to your local companion.</p>
    ${ui.button("Continue with Scarlet", { type: "submit" })}</form>` : `<p>${ui.link("Connect Scarlet", { href: "/workflow#sources" })}</p>`}
    <p>${ui.link("Download", { href: `/workflow/export.json?packet=${encodeURIComponent(transfer.packetId)}&revision=${encodeURIComponent(revision)}` })}</p></section>` : ""}</div>` });
}
