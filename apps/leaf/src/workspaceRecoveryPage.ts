import type { LeafLoad } from "./leafDocument.ts";
import type { PolicyLoad } from "./policyDocument.ts";
import { esc, page, type NavKey } from "./render.ts";
import { POLICY_UNAVAILABLE } from "./loadLabels.ts";

type FailedLeaf = Extract<LeafLoad, { ok: false }>;
type FailedPolicy = Extract<PolicyLoad, { ok: false }>;

/** A missing or broken private record must leave Scarlet's owner navigation usable. */
export function renderScarletLeafRecovery(load: FailedLeaf): string {
  const absent = load.cause === "absent";
  const heading = absent ? "Scarlet needs a private record" : "Private record unavailable";
  const explanation = absent
    ? "Create a private record before opening Scarlet's journey workspace."
    : load.cause === "unconfigured"
      ? "Set the private record location in your local launch settings."
      : load.cause === "unreadable"
        ? "Check local storage access, then try this page again."
        : load.cause === "malformed"
          ? "The private record is not valid JSON. Repair it before using Scarlet."
          : "The private record has an invalid format. Repair it before using Scarlet.";

  return page({
    title: `${heading} · Foliage`,
    state: `scarlet-leaf-${load.cause}`,
    surface: "leaf",
    face: "night",
    nav: "journey",
    empty: false,
    body: `<section class="leaf-state" data-recovery="scarlet-leaf" aria-labelledby="recovery-heading">
<div class="plate">
<h1 class="plate-t" id="recovery-heading">${heading}</h1>
<p class="plate-b">${explanation}</p>
<p><a class="fol-button fol-button-primary" href="/leaf/setup">${absent ? "Create private record" : "Open portfolio setup"}</a></p>
<p><a href="/leaf/photosynthesis">Work</a> · <a href="/review">Review</a></p>
<details><summary>Technical details</summary><p class="fol-metric">cause: ${esc(load.cause)}</p><p>${esc(load.detail)}</p></details>
</div>
</section>`,
  });
}

/** Owner UI recovery only; no Leaf content is rendered while publish rules cannot be applied. */
export function renderPolicyRecovery(load: FailedPolicy, nav: NavKey, retryHref: string): string {
  const issues = load.cause === "invalid" && load.issues.length
    ? `<ul>${load.issues.map(issue => `<li><code>${esc(issue.at)}</code>: ${esc(issue.message)}</li>`).join("")}</ul>`
    : "";
  return page({
    title: "Publish policy unavailable · Foliage",
    state: `policy-${load.cause}`,
    surface: "policy",
    face: "night",
    nav,
    empty: false,
    body: `<section class="leaf-state" data-recovery="publish-policy" aria-labelledby="recovery-heading">
<div class="plate">
<h1 class="plate-t" id="recovery-heading">Publish policy unavailable</h1>
<p class="plate-b">${POLICY_UNAVAILABLE}</p>
<p><a class="fol-button fol-button-primary" href="/leaf/photosynthesis">Open Work</a></p>
<p><a href="${esc(retryHref)}">Try this page again</a></p>
<details><summary>Technical details</summary><p class="fol-metric">cause: ${esc(load.cause)}</p>${load.path === null ? "" : `<p>Policy file: <code>${esc(load.path)}</code></p>`}<p>${esc(load.detail)}</p>${issues}</details>
</div>
</section>`,
  });
}
