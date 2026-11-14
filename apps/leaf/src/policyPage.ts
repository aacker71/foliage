/**
 * The Policy page — GET `/policy`, a read-only view of the publish policy document.
 *
 * READ-ONLY IS THE WHOLE POINT, and it is stated on the page rather than merely true of it: the
 * leaf server has no authentication of any kind and binds loopback, which — `share.mjs` and
 * `policy.mjs`'s own headers argue this at length — is not a defence against the browser the
 * operator is already using. A POST that could WIDEN who may read somebody's evidence does not
 * belong on an unauthenticated surface. So this page renders `evaluatePolicy`'s rules exactly as
 * `node apps/leaf/policy.mjs show` prints them and offers no form to change any of it; editing
 * stays the terminal, where the filesystem's own permissions already answer "is this the person".
 *
 * NOTHING HERE IS RECOMPUTED. `policy.rules` and `source` are the exact values `loadPublishPolicy`
 * returned to the caller — this module parses nothing and re-derives nothing.
 */

import type { PublishMatch, PublishPolicy, PublishRule } from "@foliage/leaf";

import type { PolicySource } from "./policyDocument.ts";
import { describePolicySourceHtml, esc, page } from "./render.ts";

/**
 * A rule's match in reading language, without adding a condition. The policy document remains
 * authoritative; this only makes its exact match kind and value legible before its identifier.
 */
function describeMatch(match: PublishMatch): string {
  switch (match.kind) {
    case "tier":
      return `Leaflet is ${match.tier}`;
    case "evidence-source":
      return `Evidence source is ${match.source}`;
    case "evidence-source-segment":
      return `Evidence source has segment ${match.segment}`;
    case "evidence-ref":
      return `Evidence reference is ${match.ref}`;
    case "id-prefix":
      return `Leaflet ID starts with ${match.prefix}`;
    case "title-rating-shaped":
      return `Title looks like a rating`;
    case "no-evidence":
      return `Leaflet has no evidence reference`;
    default: {
      const impossible: never = match;
      throw new Error(`unhandled publish match kind: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * `data-verbatim="rule-reason"` — SAME marker, same meaning, as `data-verbatim="title"` on a
 * carried commit subject in `render.ts`: this cell is the OWNER'S OWN WORDS (or the shipped
 * default's, which the owner may edit or replace with their own file), read from the policy
 * document rather than authored by this module. A rule explaining what it refuses necessarily
 * quotes an example of the shape it refuses — `deny-rating-shaped-title`'s own reason names
 * "40%" as the thing it exists to deny — so a blanket NO-SCORE sweep over this page's authored
 * chrome has to exempt this document-authored cell. The owner's rule ID sits below the reason in
 * the same disclosure. No other page chrome has this exemption.
 */
function ruleRow(rule: PublishRule, index: number): string {
  return `<tr role="row" class="policy-rule-row" data-policy-rule="${esc(rule.id)}" data-policy-effect="${esc(rule.effect)}">
<td role="cell" class="fol-metric policy-order" data-mobile-label="Order">${index + 1}</td>
<td role="cell" class="policy-match" data-mobile-label="Matches">${esc(describeMatch(rule.match))}</td>
<td role="cell" class="policy-effect" data-mobile-label="Effect">${esc(rule.effect.toUpperCase())}</td>
<td data-verbatim="rule-reason" role="cell" class="policy-why" data-mobile-label="Reason"><details><summary>Why</summary><p>${esc(rule.reason)}</p><p class="policy-id">Rule ID <code class="fol-metric">${esc(rule.id)}</code></p></details></td>
</tr>`;
}

export function renderPolicyPage(policy: PublishPolicy, source: PolicySource): string {
  const denies = policy.rules.filter((r) => r.effect === "deny").length;
  const allows = policy.rules.length - denies;
  const empty = policy.rules.length === 0;

  const body = `<section class="leaf-subject" aria-labelledby="policy-h">
<div class="leaf-subject-text">
<h1 id="policy-h">Publish policy</h1>
<p class="leaf-lede">Read-only · Deny overrides allow. Allow proposes, never publishes.</p>
</div>
</section>
<section class="policy-rules" aria-labelledby="policy-rules-h">
<h2 id="policy-rules-h">Rules in force</h2>
<p class="policy-counts">
<span data-policy-stat="rules"><b class="fol-metric leaf-count">${policy.rules.length}</b> rules</span>
<span data-policy-stat="deny-rules"><b class="fol-metric leaf-count">${denies}</b> deny</span>
<span data-policy-stat="allow-rules"><b class="fol-metric leaf-count">${allows}</b> allow</span>
</p>
${
  empty
    ? `<div class="plate" data-leaf-plate="no-rules">
<p class="plate-t">No rules in force</p>
<p class="plate-b">This policy adds no proposals or denials.</p>
</div>`
    : `<div class="fol-table-wrap policy-rules-wrap">
<table class="fol-table policy-rules-table" role="table">
<thead role="rowgroup"><tr role="row">
<th scope="col">Order</th><th scope="col">Matches</th><th scope="col">Effect</th><th scope="col">Reason</th>
</tr></thead>
<tbody role="rowgroup">
${policy.rules.map(ruleRow).join("\n")}
</tbody>
</table>
</div>`
}
</section>
<div class="policy-technical">
<details><summary>Policy source</summary><p class="aside">${source.kind === "default" ? "Default rules · no policy document yet" : describePolicySourceHtml(source)}</p></details>
<details><summary>Terminal commands</summary><p class="aside"><code class="fol-metric">foliage policy show|check|deny|allow|drop</code></p></details>
</div>`;

  return page({
    title: "Foliage — publish policy",
    state: "ok",
    surface: "policy",
    empty,
    face: "night",
    nav: "policy",
    body,
  });
}
