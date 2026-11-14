/**
 * The surfaces: their ports, boot commands, and what each one ASSERTS.
 *
 * ONE definition, imported by both `verify.mjs` (measures them) and `serve.mjs` (keeps
 * them up). They were briefly about to drift into two copies, which is how a harness
 * starts checking a port nothing is listening on. Adding a surface here is the whole
 * job — neither consumer has per-surface logic beyond this table.
 */
import { resolve } from "node:path";
import { exportSiteIdentity } from "./static.mjs";

export const SURFACES = {
  leaf: {
    port: 4174,
    cmd: ["apps/leaf/server.mjs"],
    /** @param {Record<string, string>} o */
    env: (o) => (o["leaf"] ? { FOLIAGE_LEAF: o["leaf"] } : {}),
    // `/` is Home (apps/leaf/src/overview.ts), not the compound leaf, which moved to `/leaf`.
    // These selectors are Home's own markup. `.leaf-subject`, `.leaf-count-cell`, `.leaf-pill` and
    // `.leaf-note` are gone; Home leads with `#ov-h` and an optional next step, then retained work
    // and quiet counts that each render only when there is something to count. The leaflet rows live
    // on `/leaf`, whose private workspace CSP permits same-origin script, which this row refuses.
    path: "/",
    headers: { "content-security-policy": /default-src 'none'/, "x-content-type-options": /nosniff/ },
    // The leaf app's script-execution-impossible backstop is contractual: no script-src.
    headerRefusals: { "content-security-policy": /script-src/ },
    probe: {
      contrast: [
        // Both the first-use heading and Home's own use this id, so it exists in every state.
        { name: "page heading", selector: "#ov-h" },
        // The counts render only once the record or the queue has something in it.
        { optionalWhenEmpty: "counts", name: "count label", selector: ".ov-stat .fol-label" },
        { optionalWhenEmpty: "counts", name: "count number", selector: ".ov-stat .leaf-count" },
        // Home's quiet notes appear only when a record or queue is absent, unreadable or paused.
        { optional: true, name: "note", selector: ".aside" },
        // "Nothing waiting" renders no next step.
        { optionalWhenEmpty: "nextSteps", name: "next step", selector: "[data-next-step] a" },
      ],
      count: {
        counts: "[data-overview-stat]",
        nextSteps: "[data-next-step]",
        leafRead: '[data-garden-state="ok"]',
        queueRead: '[data-queue-state="ok"]',
      },
    },
  },
  "export-site": {
    // The EXPORTED folder — what `foliage export` writes, the first surface a non-owner
    // would ever see. CORPSE: the stale export at ~/.foliage/site carried 106 false PRIVATE
    // badges from 2026-08-23 until the two-faces fix (2c7b33e) with nothing in the loop able
    // to see it, because this was the one surface with no row here. Port ≥4210 by the ports
    // gotcha (4173–4199 hold long-running demo servers). The response identity below
    // also refuses another folder or another kind of server already using this port.
    port: 4214,
    cmd: ["tools/verify/static.mjs"],
    label: "static",
    // EXPLICIT ADDRESS ONLY — no homedir default. Every sibling row defaults to a synthetic
    // /tmp fixture; this row's subject is a REAL artifact, and defaulting to the machine-global
    // ~/.foliage/site made bare `pnpm verify` fail on any clean machine and, worse, silently
    // measure whatever stale export sat there regardless of the checkout under test (PR #22's
    // seams pass). The row runs only when the operator names the folder.
    /** @param {NodeJS.ProcessEnv} env */
    requires: (env) =>
      (env["FOLIAGE_SITE"] ?? "").trim() !== ""
        ? null
        : "export-site measures a real export by explicit address only — run " +
          "`node apps/leaf/export.mjs --out <dir>` then `FOLIAGE_SITE=<dir> pnpm verify export-site`",
    /** @param {Record<string,string>} _opts @param {NodeJS.ProcessEnv} env */
    env: (_opts, env = process.env) => ({ FOLIAGE_SITE: resolve(env["FOLIAGE_SITE"] ?? "") }),
    /** @param {NodeJS.ProcessEnv} env */
    responseIdentity: (env) => ({ header: "x-foliage-site", value: exportSiteIdentity(env["FOLIAGE_SITE"] ?? "") }),
    path: "/",
    // No CSP assertion, deliberately: the folder is handed to hosts that send nothing, so it
    // is measured the way a stranger's host would serve it — safe by its own bytes. nosniff
    // is the one header any competent static host sends, and ours does.
    headers: { "x-content-type-options": /nosniff/ },
    probe: {
      contrast: [
        // The PUBLISHED page's own classes — not the server view's .leaf-pill/.leaf-note,
        // which do not render on an export (measured on the 2026-09-01 artifact).
        { name: "subject h1", selector: ".leaf-subject h1" },
        // A real export can contain no shared leaflets. Measure row text when present.
        { optionalWhenEmpty: "leaflets", name: "leaflet title", selector: ".leaf-leaflet-title" },
        { optionalWhenEmpty: "leaflets", name: "tier pill", selector: ".proof" },
        { optionalWhenEmpty: "leaflets", name: "provenance", selector: ".leaf-prov" },
        { optionalWhenEmpty: "leaflets", name: "when (mono)", selector: ".leaf-leaflet-when" },
      ],
      count: {
        leaflets: ".leaf-leaflet",
        pending: '[data-tier="pending"]',
        verified: '[data-tier="verified"]',
        excluded: '[data-tier="excluded"]',
        // Both must read 0 on any export: a private badge is M1 item-1's corpse, and a
        // /review link dangles the moment the folder leaves this machine. ENFORCED via
        // mustBeZero below — a comment saying "must" while the runner printed an info line
        // was PR #22's correctness blocker.
        privateBadges: "[data-visibility]",
        reviewLinks: 'a[href="/review"]',
      },
    },
    mustBeZero: ["privateBadges", "reviewLinks"],
  },
  canopy: {
    port: 4173,
    cmd: ["apps/canopy/server.mjs"],
    /** @param {Record<string, string>} o */
    env: (o) => (o["tree"] ? { FOLIAGE_TREE: o["tree"] } : {}),
    path: "/tree",
    headers: { "content-security-policy": /default-src 'none'/ },
    probe: {
      contrast: [
        { name: "org h1", selector: ".tree-subject h1" },
        { name: "person name", selector: ".tree-person-name" },
        { name: "count label", selector: ".tree-count .fol-label" },
      ],
      count: { people: '[data-roster-row="true"]', failures: "[data-entry-failure]" },
    },
  },
  photosynthesis: {
    // The review queue as people reach it: the leaf app's /review, which reads the harvest
    // `foliage grow` writes (packages/photosynthesis's format). The standalone
    // apps/photosynthesis/review-server.mjs reads a different, older harvest schema and answered
    // 500 "harvest invalid" on that document, so a healthy install could never pass this row.
    port: 4177,
    cmd: ["apps/leaf/server.mjs"],
    label: "leaf",
    /** @param {Record<string, string>} o */
    env: (o) => ({
      ...(o["harvest"] ? { FOLIAGE_HARVEST: o["harvest"] } : {}),
      ...(o["leaf"] ? { FOLIAGE_LEAF: o["leaf"] } : {}),
    }),
    path: "/review",
    // The leaf app's framing defence is CSP `frame-ancestors 'none'`; unlike the standalone
    // server it sends no legacy X-Frame-Options header, so that header is not asserted here.
    headers: {
      "content-security-policy": /frame-ancestors 'none'/,
      "x-content-type-options": /nosniff/,
    },
    headerRefusals: { "content-security-policy": /script-src/ },
    probe: {
      contrast: [
        // The queue's own heading, or the one heading of its "No drafts yet" / unreadable state.
        { name: "page heading", selector: "h1" },
        // Present whenever the queue holds any candidate, open or decided.
        { optionalWhenEmpty: "candidates", name: "queue heading", selector: ".review-heading-line h2" },
        { optionalWhenEmpty: "candidates", name: "access note", selector: ".review-access" },
        { optionalWhenEmpty: "candidates", name: "count label", selector: ".review-count-item .fol-label" },
        { optionalWhenEmpty: "candidates", name: "count number", selector: ".review-count-item .leaf-count" },
        { optionalWhenEmpty: "candidates", name: "candidate title", selector: ".review-title" },
        { optionalWhenEmpty: "candidates", name: "review state", selector: "[data-review-pill]" },
        { optionalWhenEmpty: "candidates", name: "drafter line", selector: ".review-ref-count" },
        // The decision form renders only for a candidate still awaiting a decision.
        { optionalWhenEmpty: "open", name: "field label", selector: ".review-field .fol-label" },
        { optionalWhenEmpty: "open", name: "field help", selector: ".review-help" },
        { optional: true, name: "decision", selector: ".review-decision" },
        { optional: true, name: "promote note", selector: ".review-promote .aside" },
        { optional: true, name: "empty queue", selector: '[data-leaf-plate="empty-queue"] .plate-t' },
      ],
      count: {
        candidates: ".review-candidate",
        open: "[data-review-open] > .review-candidate",
        decided: "[data-review-decided] .review-candidate",
        unreviewed: '[data-review-pill="candidate"]',
        approved: '[data-review-pill="approved"]',
        rejected: '[data-review-pill="rejected"]',
        // THE ACCENT BUDGET, counted rather than remembered: chartreuse appears at most
        // twice per screen. These are the three ways an element can carry it.
        accentBearing: ".btn-primary, .proof-verified, .acc",
      },
    },
    // A mutating surface must refuse forged requests. Checked over HTTP, not asserted.
    csrf: [
      { name: "cross-origin /promote", path: "/promote", origin: "https://evil.example.com", expect: 403 },
      { name: "no-origin /promote", path: "/promote", expect: 403 },
      { name: "cross-origin /review", path: "/review", origin: "https://evil.example.com", body: "id=x&decision=approve", expect: 403 },
    ],
  },
  enterprise: {
    port: 4176,
    cmd: ["apps/enterprise/server.mjs"],
    /** @param {Record<string, string>} o */
    env: (o) => ({
      ...(o["company"] ? { FOLIAGE_COMPANY: o["company"] } : {}),
      ...(o["release"] ? { FOLIAGE_RELEASE: o["release"] } : {}),
      ...(o["actor"] ? { FOLIAGE_ACTOR: o["actor"] } : {}),
    }),
    path: "/",
    headers: {
      "content-security-policy": /frame-ancestors 'none'/,
      "x-frame-options": /DENY/,
    },
    headerRefusals: { "content-security-policy": /script-src/ },
    probe: {
      contrast: [
        { name: "company h1", selector: "h1" },
        { name: "lede", selector: ".lede" },
        { name: "bough name", selector: '[data-limb="Organization"] .ent-limb__name' },
        { name: "person name", selector: ".ent-name" },
        { name: "stat label", selector: ".ent-stat .fol-label" },
        { name: "readout number", selector: ".counts__n" },
        { optional: true, name: "chip internal", selector: '[data-chip="internal"]' },
        { optional: true, name: "chip live", selector: '[data-chip="live"]' },
      ],
      count: {
        boughs: '[data-limb="Organization"]',
        teams: '[data-limb="Team"]',
        people: "[data-person]",
        live: '[data-release="live"]',
        internal: '[data-release="internal"]',
        failures: "[data-entry-failure]",
      },
    },
    // A release decision is a more consequential thing to forge than a review click.
    csrf: [
      { name: "cross-origin /release", path: "/release", origin: "https://evil.example.com", body: "leaf=alex&event=publish", expect: 403 },
      { name: "no-origin /release", path: "/release", body: "leaf=alex&event=publish", expect: 403 },
    ],
  },
};
