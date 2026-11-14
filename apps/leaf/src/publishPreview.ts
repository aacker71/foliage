/**
 * The Publish preview — GET `/publish`, the OFFLINE answer to what is shared by link and what
 * the static export would include. Those are different sets: unlisted work has a link but is
 * absent from the public index, and export applies an additional title-address gate.
 *
 * NO NETWORK CALL. This page computes everything from two documents already on disk — the leaf
 * and the publish policy — through `outwardStateOf`/`publishRows` in `./policy.ts`, the same
 * composition `policy.mjs check` prints to a terminal. Nothing here sends a byte anywhere, and the
 * page says so, because "preview" is a word that invites the opposite assumption.
 *
 * PUBLISHING IS A SEPARATE, EXPLICIT ACT, TODAY. This surface does not cross anything. When an
 * exact loopback Canopy manager is configured, the page links to its publication review; that
 * navigation does not publish. The two local commands are named at the foot of the page, spelled
 * so they run as printed (see `publishLauncher`). The bare scripts this page used to print exited
 * 2 (share.mjs needs --leaf) and 1 (export.mjs reads the checkout's leaf), and a bare `foliage …`
 * exited 127: nothing puts that binary on PATH. `share <id> --as public` grants one leaflet a
 * shareable address, and `export --out <dir>` writes a static folder from whatever is public.
 * Neither runs from here.
 *
 * THREE BUCKETS, the same three `OutwardState` already names in `./policy.ts`:
 *
 *   SERVED             the leaflet is shared AND no deny rule blocks it — its address would answer.
 *                       Counted apart by the subject's own word: only `public` is listed, and only
 *                       `public` crosses Canopy's publication gate and the static export. One
 *                       "Shared links" count read as if link-only work were going out too.
 *   WITHHELD BY A RULE  the leaflet is shared but a deny rule beats the share. Named loudly: this
 *                       is the one case where the policy overrides the subject's own act.
 *   NOT SHARED          the subject has not offered it. `may-propose` is shown as a sub-state —
 *                       "the policy would propose this" is not permission and is labelled as such.
 *
 * Every row retains its reason (`decisionReason`) behind a disclosure. Status facets and bounded
 * pages change only how many decisions are displayed at once, never which decision is computed.
 */

import { isAbsolute, join } from "node:path";

import { decisionReason, detectRedactableSpans, isListedOnLeaf, isSubjectsOwnWork, redactIdentifiers, type Leaf, type Leaflet, type PublishPolicy } from "@foliage/leaf";
import { ui } from "@foliage/ui";

import { DOCUMENT_ENV, fabricationSignals, type LeafLoad } from "./leafDocument.ts";
import { LEAF_LOAD_LABEL } from "./loadLabels.ts";
import { publishRows, type PublishRow } from "./policy.ts";
import { POLICY_ENV } from "./policyDocument.ts";
import { carriesVerbatimTitle, esc, page, proofBadge, titleProvenanceAttr,
  fabricationBand, ownerLeafletHref, sharedAddressLink,
} from "./render.ts";

// Preview the exact address rule export.mjs applies; the export itself remains the final gate.
function titleHasAddress(title: string): boolean {
  return detectRedactableSpans(title, ["email-address"]).length > 0;
}

/**
 * SERVED / WITHHELD / PROPOSED / PRIVATE (the CLI's own words) — AND the sentence that explains
 * each, together, because the two must never be computed from different questions.
 *
 * THE BUG THIS FIXES, measured on a running leaf: one leaflet in it carried
 * `visibility: "unlisted"` with a tier no rule proposes. `outward.kind` is correctly `"served"` —
 * `outwardStateOf`'s own header states the rule: a fail-closed `no-rule-matched` denial is a
 * denial of a PROPOSAL and must NOT retroactively revoke a share the subject already made by
 * hand. But `decisionReason(row.decision)` answers a DIFFERENT question — "would the policy
 * PROPOSE this?" — and for `no-rule-matched` that sentence is the fixed constant ending "...so it
 * is NOT published." Quoting it here produced a row reading `SERVED` beside "it is NOT
 * published", on the running page. `decisionReason` is the right text for a `not-shared` row
 * (that IS the question those rows answer); it is the wrong text for a `served` one, which asks
 * "why does this address answer" and the true answer there is always the same one sentence.
 *
 * A PRIVATE ROW NO LONGER QUOTES THE FAIL-CLOSED SENTENCE EITHER. It tells the owner to add an
 * allow rule, but an allow rule only proposes and `/policy` is read-only; what gives a leaflet an
 * address is `share`, so a not-shared row names that command with its own id.
 */
type PublishBucket = "public" | "unlisted" | "withheld" | "proposed" | "private";

function rowExplanation(row: PublishRow): {
  readonly label: string;
  readonly bucket: PublishBucket;
  readonly reason: string;
  readonly verbatim: boolean;
  readonly command: string | null;
} {
  switch (row.outward.kind) {
    case "served":
      return row.visibility === "public"
        ? { label: "Public", bucket: "public", reason: "You have shared this, and no rule denies it.", verbatim: false, command: null }
        : {
          label: "Link only",
          bucket: "unlisted",
          reason: "You have shared this as a link only, and no rule denies it. Canopy and the static export publish only Public work.",
          verbatim: false,
          command: null,
        };
    case "withheld-by-rule":
      return { label: "Withheld", bucket: "withheld", reason: row.outward.rule.reason, verbatim: true, command: null };
    case "not-shared":
      return row.outward.candidate
        // Only `may-propose` quotes a rule's own words — see `ruleRow` in `policyPage.ts`.
        ? { label: "Proposed", bucket: "proposed", reason: decisionReason(row.decision), verbatim: row.decision.outcome === "may-propose", command: shareArgs(row.id) }
        : { label: "Private", bucket: "private", reason: "You have not shared this.", verbatim: false, command: shareArgs(row.id) };
  }
}

/** One shell word: bare when plainly safe (every intake id is), single-quoted otherwise. */
function shellWord(word: string): string {
  return /^[A-Za-z0-9._:@%+=,/-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

function shareArgs(id: string): string {
  return `share ${shellWord(id)} --as public`;
}

/**
 * HOW THE COMMANDS ON THIS PAGE ARE SPELLED, so each runs exactly as printed. There is no global
 * `foliage` binary (TESTER-QUICKSTART), so a bare `foliage share …` exited 127. `foliage up` hands
 * the server its own launcher and garden, and the page prints the form the CLI's `nextCommand`
 * prints: absolute node, absolute launcher, `--garden` — runnable from any directory. It does so
 * only while the leaf and policy this page read ARE that garden's, so the command acts on the
 * documents the page shows. Otherwise (a server started without `up`) it prints the quickstart's
 * `node foliage.mjs …`, which runs from the checkout, and says when to add `--garden`.
 */
export interface Launcher {
  readonly node: string;
  readonly script: string;
  readonly garden: string;
}

export function publishLauncher(env: Readonly<Record<string, string | undefined>>, node: string): Launcher | null {
  const script = env["FOLIAGE_LAUNCHER"]?.trim();
  const garden = env["FOLIAGE_GARDEN"]?.trim();
  if (!script || !garden || !isAbsolute(node) || !isAbsolute(script) || !isAbsolute(garden)) return null;
  const gardenDocuments = env[DOCUMENT_ENV]?.trim() === join(garden, "leaf.json") && env[POLICY_ENV]?.trim() === join(garden, "policy.json");
  return gardenDocuments ? { node, script, garden } : null;
}

function cliCommand(launcher: Launcher | null, args: string): string {
  return launcher === null
    ? `node foliage.mjs ${args}`
    : `${shellWord(launcher.node)} ${shellWord(launcher.script)} ${args} --garden ${shellWord(launcher.garden)}`;
}

type StaticExportRow = "selected" | "email-title" | "link-only" | "not-own-work" | "example";

function staticExportRow(leaflet: Leaflet, row: PublishRow, example: boolean): StaticExportRow | null {
  if (row.outward.kind !== "served") return null;
  if (example) return "example";
  if (!isSubjectsOwnWork(leaflet)) return "not-own-work";
  if (!isListedOnLeaf(row.visibility)) return "link-only";
  return titleHasAddress(leaflet.title) ? "email-title" : "selected";
}

const STATIC_EXPORT_LABEL: Readonly<Record<StaticExportRow, string>> = {
  selected: "Selected for export",
  "email-title": "Title needs confirmation",
  // The status label already says "Link only"; this column says what that means for export.
  "link-only": "Not in export",
  "not-own-work": "Not in export",
  example: "Example — no export",
};

/**
 * `leaflet` travels beside `row` rather than living on `PublishRow` itself — `./policy.ts`
 * composes the RAIL and the subject's ACT, and a leaflet's own tier and title are neither; both
 * are read off the same leaflet `publishRows` already walked, at the same index, in the same
 * document order. The title gets the SAME `data-verbatim`/`data-authored` marker `render.ts`
 * puts on it everywhere else — a leaflet's title can be a carried commit subject, and this page
 * must not be the one surface that forgets that fact can contain digits a NO-SCORE sweep would
 * otherwise flag.
 */
function previewRow(leaflet: Leaflet, row: PublishRow, example: boolean, launcher: Launcher | null): string {
  const explanation = rowExplanation(row);
  const carried = carriesVerbatimTitle(leaflet);
  const staticExport = staticExportRow(leaflet, row, example);
  const publicTitle = row.outward.kind === "served" ? redactIdentifiers(leaflet.title).text : null;
  const titleDisclosure = publicTitle !== null && publicTitle !== leaflet.title
    ? `<details data-public-title-preview><summary>Public title</summary><p data-title-redacted="true">${esc(publicTitle)}</p></details>`
    : "";
  return `<li class="publish-row" data-publish-row="${esc(row.id)}" data-publish-status="${esc(explanation.bucket)}">
<div class="publish-row-main"><h3 ${titleProvenanceAttr(carried)}>${esc(row.title)}</h3>
<div class="publish-row-meta"><span class="fol-label" data-publish-status-label="${esc(explanation.bucket)}">${esc(explanation.label)}</span>${proofBadge(leaflet.tier, "private")}${staticExport === null ? "" : `<span class="fol-label" data-static-export-row="${staticExport}">${STATIC_EXPORT_LABEL[staticExport]}</span>`}</div></div>
${row.outward.kind === "served" ? `<div class="publish-row-address">${sharedAddressLink(row.id)}</div>\n` : ""}<div class="publish-row-actions"><a href="${ownerLeafletHref(row.id)}" aria-label="View record: ${esc(row.title)} (${esc(row.id)})">View record</a>
${titleDisclosure}
<details><summary>Reason</summary><p${explanation.verbatim ? ' data-verbatim="rule-reason"' : ""}>${esc(explanation.reason)}</p>${explanation.command === null ? "" : `<code>${esc(cliCommand(launcher, explanation.command))}</code>`}</details></div>
</li>`;
}

type PublishView = "all" | PublishBucket;
const PAGE_SIZE = 20;

function selectedView(query: URLSearchParams): PublishView {
  const requested = query.get("view");
  return requested === "public" || requested === "unlisted" || requested === "withheld" || requested === "proposed" || requested === "private" ? requested : "all";
}

function pageNumber(query: URLSearchParams, total: number): number {
  const requested = query.get("page");
  if (requested === null || !/^[1-9]\d*$/.test(requested)) return 1;
  const value = Number(requested);
  return Number.isSafeInteger(value) ? Math.min(value, Math.max(1, Math.ceil(total / PAGE_SIZE))) : 1;
}

function publishHref(view: PublishView, page: number): string {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/publish?${suffix}` : "/publish";
}

function previewFailure(load: Extract<LeafLoad, { ok: false }>): string {
  const remedy: Readonly<Record<Extract<LeafLoad, { ok: false }>["cause"], string>> = {
    unconfigured: `Set <span class="fol-metric">${esc(DOCUMENT_ENV)}</span> and reload.`,
    absent: "Create the Leaf file or change its path.",
    unreadable: "Check file permissions and reload.",
    malformed: "Correct the Leaf file and reload.",
    invalid: "Repair the Leaf file and reload.",
  };
  const body = `<section class="leaf-subject" aria-labelledby="publish-h">
<div class="leaf-subject-text">
<h1 id="publish-h">${esc(LEAF_LOAD_LABEL[load.cause])}</h1>
<p class="leaf-lede">Nothing computed</p>
</div>
</section>
<section aria-labelledby="publish-h">
<p class="aside">${remedy[load.cause]}</p>
<details class="leaf-detail"><summary>Details</summary><p class="fol-metric">${esc(load.detail)}</p></details>
</section>`;
  return page({
    title: "Foliage — publish preview",
    state: load.cause,
    surface: "publish",
    empty: false,
    face: "night",
    nav: "publish",
    body,
  });
}

export function renderPublishPage(load: LeafLoad, policy: PublishPolicy, query = new URLSearchParams(), managerOrigin: string | null = null, launcher: Launcher | null = null): string {
  if (!load.ok) return previewFailure(load);

  const leaf: Leaf = load.leaf;
  const rows = publishRows(leaf, policy);
  const entries = rows.map((row, index) => ({ row, leaflet: leaf.leaflets[index]! }));
  const example = fabricationSignals(load.source).length > 0;
  const exportSelected = entries.filter(({ row, leaflet }) =>
    row.outward.kind === "served" && isSubjectsOwnWork(leaflet) && isListedOnLeaf(row.visibility));
  const titleConfirmations = exportSelected.filter(({ leaflet }) => titleHasAddress(leaflet.title));
  const staticExportState = example ? "example" : exportSelected.length === 0 ? "empty" : titleConfirmations.length > 0 ? "confirmation" : "ready";
  const staticExportLabel = example ? "Example material · Export unavailable" :
    exportSelected.length === 0 ? "No public work selected" :
    titleConfirmations.length > 0 ? `${titleConfirmations.length} title${titleConfirmations.length === 1 ? "" : "s"} need${titleConfirmations.length === 1 ? "s" : ""} email confirmation` :
    `${exportSelected.length} public record${exportSelected.length === 1 ? "" : "s"} ready`;
  const totals: Record<PublishBucket, number> = { public: 0, unlisted: 0, withheld: 0, proposed: 0, private: 0 };
  for (const row of rows) totals[rowExplanation(row).bucket]++;
  const empty = rows.length === 0;
  const view = selectedView(query);
  const visible = view === "all" ? entries : entries.filter(({ row }) => rowExplanation(row).bucket === view);
  const currentPage = pageNumber(query, visible.length);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const shown = visible.slice(start, start + PAGE_SIZE);

  const facet = (value: PublishView, label: string, count: number) => `<a href="${publishHref(value, 1)}" data-publish-total="${value}"${view === value ? ' aria-current="page"' : ""}><span>${label}</span><b class="fol-metric leaf-count">${count.toLocaleString()}</b></a>`;
  const pagination = pageCount > 1 ? `<nav class="publish-pagination" aria-label="Leaflet pages">
${currentPage > 1 ? `<a rel="prev" href="${publishHref(view, currentPage - 1)}">Previous</a>` : '<span aria-disabled="true">Previous</span>'}
<span class="fol-metric" aria-current="page">Page ${currentPage} of ${pageCount}</span>
${currentPage < pageCount ? `<a rel="next" href="${publishHref(view, currentPage + 1)}">Next</a>` : '<span aria-disabled="true">Next</span>'}
</nav>` : "";

  const handoff = !empty && managerOrigin ? ui.link("Review in Canopy", { href: `${managerOrigin}/`, className: "publish-handoff", "data-publish-handoff": "canopy" }) : "";
  const intro = `<section class="leaf-subject publish-subject" aria-labelledby="publish-h">
<div class="leaf-subject-text">
<h1 id="publish-h">Publish preview</h1>
<p class="leaf-lede">Local preview · No change made</p>
</div>${handoff}
</section>`;

  if (empty) {
    return page({
      title: "Foliage — publish preview",
      state: "ok",
      surface: "publish",
      empty: true,
      face: "night",
      nav: "publish",
      body: `${intro}
<div class="plate" data-leaf-plate="nothing-to-preview">
<p class="plate-t">This leaf has no leaflets yet.</p>
</div>`,
    });
  }

  // Same differential control as the leaf page and the overview: leaf rows render here,
  // so an example document declares itself here.
  const body = `${fabricationBand(load.source)}${intro}
<nav class="publish-facets" aria-label="Publication status">
${facet("all", "All", rows.length)}${facet("public", "Public", totals.public)}${facet("unlisted", "Link only (unlisted)", totals.unlisted)}${facet("withheld", "Withheld", totals.withheld)}${facet("proposed", "Proposed", totals.proposed)}${facet("private", "Private", totals.private)}
</nav>
<p class="aside" data-publish-outward="public-only">Canopy and the static export publish only Public work</p>
<p class="aside" data-static-export="${staticExportState}">Static export · ${staticExportLabel}</p>
<section aria-labelledby="publish-rows-h">
<div class="publish-list-heading"><h2 id="publish-rows-h">Leaflets</h2><p class="fol-metric" role="status">${visible.length ? `${start + 1}–${start + shown.length} of ${visible.length}` : "0 leaflets"}</p></div>
${shown.length ? `<ol class="publish-list">${shown.map(({ row, leaflet }) => previewRow(leaflet, row, example, launcher)).join("\n")}</ol>` : '<p class="publish-no-rows">No leaflets in this view</p>'}
${pagination}
</section>
<details class="publish-command-line"><summary>Command line</summary><p>Share one record publicly</p><code>${esc(cliCommand(launcher, "share <id> --as public"))}</code><p>Write a static release</p><code>${esc(cliCommand(launcher, "export --out <dir>"))}</code><p>${launcher === null ? "Run these from the Foliage checkout. Add --garden &lt;folder&gt; unless this app's garden is ~/.foliage." : "These name this app's garden, so they run from any folder."}</p></details>`;

  return page({
    title: "Foliage — publish preview",
    state: "ok",
    surface: "publish",
    empty: false,
    face: "night",
    nav: "publish",
    body,
  });
}
