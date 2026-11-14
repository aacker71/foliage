/**
 * Tests for the redaction gate.
 *
 * ALL TEXT HERE IS INVENTED. Addresses use the `.invalid` and `example.com` TLDs reserved by
 * RFC 2606/6761 precisely so they can never resolve to a real mailbox, and the people named are
 * made up. That is legitimate test data — it exercises the mechanism — and it is the opposite of
 * the fake-product-data this repository refuses: nothing here is ever rendered, stored, or
 * presented as somebody's evidence. Quoting a REAL third party's address in a committed test
 * file would be this repository committing the exact egress the gate exists to prevent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  leafId,
  leafletId,
  parsePublishPolicy,
  type Leaf,
  type Leaflet,
  type Provenance,
} from "@foliage/leaf";

import {
  PUBLICATION_LIMITS,
  publicAuthoredTextIssue,
  publicNarrativeIssue,
  publicPhotoIssue,
  reviewForPublication,
  type PublicationReview,
  type Withholding,
} from "./publish.ts";

test("an HTTPS citation is publishable text while local file locations remain private", () => {
  const citation = "See https://example.com/work";
  const localPath = "See C:\\Users\\builder\\work";
  assert.equal(publicAuthoredTextIssue(citation), null);
  assert.match(publicAuthoredTextIssue(localPath) ?? "", /Local file locations/);
  const narrative = { text: citation, provenance: { source: "git", ref: "https://example.com/commit", observedAt: "2026-08-15T22:21:43.057Z" } };
  assert.equal(publicNarrativeIssue(narrative), null);
  assert.match(publicNarrativeIssue({ ...narrative, provenance: { ...narrative.provenance, ref: localPath } }) ?? "", /local file location/);
  const digest = `sha256:${"0".repeat(64)}`;
  const photo = { sourceRef: digest, renditionDigest: digest, bytes: 1, format: "png" as const, alt: citation };
  assert.equal(publicPhotoIssue(photo), null);
  assert.match(publicPhotoIssue({ ...photo, caption: localPath }) ?? "", /disclosure gate refuses/);
});

const prov = (ref: string): Provenance =>
  Object.freeze({ source: "git", ref, observedAt: "2026-08-15T22:21:43.057Z" });

// `visibility: "public"` here because these fixtures are about redaction and tier mechanics, not
// consent — a fixture correction, not a weakened assertion. The one test about consent below
// (`"a verified leaflet nobody offered..."`) builds its own leaflet with visibility left absent.
const verified = (id: string, title: string, ref = "4f884f6"): Leaflet => ({
  id: leafletId(id),
  title,
  tier: "verified",
  provenance: prov(ref),
  visibility: "public",
});

const leafOf = (...leaflets: Leaflet[]): Leaf => ({
  id: leafId("leaf-1"),
  subject: "Wren Halloway",
  leaflets,
});

const review = (leaf: Leaf, declaredExample = false): PublicationReview =>
  reviewForPublication({ leaf, declaredExample });

/** The ok branch, or a failure that says which refusals came back instead. */
function published(r: PublicationReview) {
  assert.ok(r.ok, `expected a publishable review, got refusals: ${JSON.stringify(r)}`);
  return r;
}

const forLeaflet = (withheld: readonly Withholding[], id: string): readonly Withholding[] =>
  withheld.filter((w) => w.leaflet === id);

/* ── The five real shapes ─────────────────────────────────────────────────────────────────── */

test("a verified title carrying an email address is redacted, and the address never appears", () => {
  const r = published(
    review(leafOf(verified("git:aaa1111", "fix: use hi@northwind-labs.invalid in the README"))),
  );

  const only = r.published.leaflets[0];
  assert.ok(only);
  assert.equal(only.title, "fix: use [withheld: email address] in the README");
  assert.equal(only.titleRedacted, true, "a redacted title is no longer verbatim and must say so");

  // The whole result — page AND report — must not contain the address in any form.
  const everything = JSON.stringify(r);
  assert.ok(!everything.includes("hi@northwind-labs.invalid"));
  assert.ok(!everything.includes("northwind-labs"));

  const [w] = forLeaflet(r.withheld, "git:aaa1111");
  assert.ok(w, "the withholding must be reported, not silently applied");
  assert.equal(w.kind, "email-address");
  assert.equal(w.at, "leaflets[git:aaa1111].title");
  assert.match(w.reason, /verbatim/);
  assert.match(w.inspect, /git show 4f884f6/);
});

test("a title naming another person through a git trailer withholds the name, not just the address", () => {
  const r = published(
    review(
      leafOf(
        verified(
          "git:bbb2222",
          "feat: batched writer Co-authored-by: Rowan Vale <rowan.vale@example.com>",
        ),
      ),
    ),
  );

  const only = r.published.leaflets[0];
  assert.ok(only);
  assert.equal(
    only.title,
    "feat: batched writer [withheld: a co-author credit naming another person]",
  );

  const everything = JSON.stringify(r);
  assert.ok(!everything.includes("Rowan Vale"), "the third party's NAME must not survive");
  assert.ok(!everything.includes("rowan.vale@example.com"));

  const [w] = forLeaflet(r.withheld, "git:bbb2222");
  assert.ok(w);
  assert.equal(
    w.kind,
    "identity-trailer",
    "the trailer subsumes the address it contains — one span, and the more informative kind wins",
  );
  assert.equal(
    forLeaflet(r.withheld, "git:bbb2222").length,
    1,
    "the address inside the trailer must not be reported a second time as its own span",
  );
});

test("an excluded leaflet does not cross at all, and is named in the report with its reason", () => {
  const excluded: Leaflet = {
    id: leafletId("git:ccc3333"),
    title: "chore: rotate the staging key",
    tier: "excluded",
    reason:
      "could not be attributed to this subject: the author identity on commit ccc3333 is not " +
      "among the declared identities.",
    provenance: prov("ccc3333"),
    visibility: "public",
  };
  const r = published(review(leafOf(verified("git:aaa1111", "feat: add the intake reader"), excluded)));

  assert.deepEqual(
    r.published.leaflets.map((l) => l.id),
    ["git:aaa1111"],
    "only verified leaflets cross — an excluded leaflet is somebody else's work",
  );

  const [w] = forLeaflet(r.withheld, "git:ccc3333");
  assert.ok(w, "a dropped leaflet must be named, never merely counted");
  assert.equal(w.kind, "unattributed-leaflet");
  assert.equal(w.item, "chore: rotate the staging key");
  assert.match(w.reason, /somebody else's work/);
  assert.match(w.reason, /not among the declared identities/);
  assert.match(w.inspect, /git show ccc3333/);
});

test("a clean verified title crosses unchanged and is marked as still verbatim", () => {
  const r = published(
    review(leafOf(verified("git:ddd4444", "perf: cut the walk to one pass", "ddd4444"))),
  );

  const only = r.published.leaflets[0];
  assert.ok(only);
  assert.equal(only.tier, "verified");
  assert.equal(only.title, "perf: cut the walk to one pass");
  assert.equal(only.titleRedacted, false);
  assert.equal(
    only.tier === "verified" ? only.provenance.ref : undefined,
    "ddd4444",
    "provenance is never rewritten",
  );
  assert.deepEqual(r.withheld, []);
  assert.equal(r.published.subjectRedacted, false);
});

test("the empty leaf publishes an honest empty view, not an error", () => {
  const r = published(review(leafOf()));

  assert.deepEqual(r.published.leaflets, []);
  assert.equal(r.published.subject, "Wren Halloway");
  assert.deepEqual(r.withheld, [], "nothing was withheld because there was nothing to withhold");
  assert.deepEqual(
    r.limits,
    PUBLICATION_LIMITS,
    "an empty leaf still ships the limits — an empty report is not a clean bill of health",
  );
});

/* ── Detection honesty: the floor, and the ceiling stated out loud ────────────────────────── */

test("a person's name in ordinary prose is NOT caught, and the report says that class is missed", () => {
  const r = published(
    review(leafOf(verified("git:eee5555", "fix: null guard, thanks to Rowan for the catch"))),
  );

  const only = r.published.leaflets[0];
  assert.ok(only);
  assert.equal(
    only.title,
    "fix: null guard, thanks to Rowan for the catch",
    "the name goes out as written — this gate makes no model call and does not pretend otherwise",
  );
  assert.deepEqual(r.withheld, []);

  // The gap must be DECLARED, not merely true. A report that stayed silent here would let an
  // empty withheld list read as "no personal data", which is the guarantee this cannot give.
  const limits = r.limits.join(" ");
  assert.match(limits, /name written in ordinary prose is NOT detected/i);
  assert.match(limits, /FOUND NOTHING/);
  assert.match(limits, /obfuscated|written around the pattern/i);
});

test("no output of the gate claims safety, cleanliness, or absence of personal data", () => {
  const r = published(review(leafOf(verified("git:ddd4444", "perf: cut the walk to one pass"))));
  const prose = JSON.stringify(r).toLowerCase();
  for (const forbidden of ["is safe", "no personal data", "guarantee", "fully redacted", "clean"]) {
    assert.ok(!prose.includes(forbidden), `the gate must never claim "${forbidden}"`);
  }
});

/* ── The tier decision ────────────────────────────────────────────────────────────────────── */

// D1 (owner, 2026-09-06, `.loop/MERGE-DECISIONS.md`): "one predicate everywhere. Offered + not
// railed + the subject's own work crosses; the tier is printed beside each row, never gated on."
// This replaces the control that used to sit here, which asserted the opposite of the decision.

test("an offered pending leaflet crosses, carrying its own tier — not the artifact's default", () => {
  const pending: Leaflet = {
    id: leafletId("git:fff6666"),
    title: "feat: the seam test drives a real repository",
    tier: "pending",
    provenance: prov("fff6666"),
    visibility: "public",
  };
  const r = published(review(leafOf(pending)));

  assert.equal(forLeaflet(r.withheld, "git:fff6666").length, 0, "pending is not a withholding reason");
  const [only] = r.published.leaflets;
  assert.ok(only);
  assert.equal(only.id, "git:fff6666");
  assert.equal(only.tier, "pending", "the tier travels with the leaflet — it is a fact, not verified by default");
  assert.equal(only.title, "feat: the seam test drives a real repository");
});

test("verified and pending offered together both cross, each keeping its own tier", () => {
  const pending: Leaflet = {
    id: leafletId("git:fff6666"),
    title: "feat: the seam test drives a real repository",
    tier: "pending",
    provenance: prov("fff6666"),
    visibility: "public",
  };
  const r = published(
    review(leafOf(verified("git:aaa1111", "feat: add the intake reader"), pending)),
  );

  assert.deepEqual(
    new Map(r.published.leaflets.map((l) => [l.id, l.tier])),
    new Map([
      ["git:aaa1111", "verified"],
      ["git:fff6666", "pending"],
    ]),
    "mutation check: swapping either tier, or dropping either leaflet, must redden this",
  );
});

test("a leaf with nothing but offered pending work is not an empty publication", () => {
  const pending: Leaflet = {
    id: leafletId("git:fff6666"),
    title: "feat: the seam test drives a real repository",
    tier: "pending",
    provenance: prov("fff6666"),
    visibility: "public",
  };
  const r = published(review(leafOf(pending)));

  assert.equal(r.published.leaflets.length, 1, "zero verified leaflets no longer means an empty artifact");
  assert.deepEqual(r.withheld, []);
});

test("a dropped leaflet's title is quoted in its REDACTED form — the report is not the leak", () => {
  const excluded: Leaflet = {
    id: leafletId("git:ggg7777"),
    title: "docs: point support at help@northwind-labs.invalid",
    tier: "excluded",
    reason: "could not be attributed to this subject.",
    provenance: prov("ggg7777"),
    visibility: "public",
  };
  const r = published(review(leafOf(excluded)));

  const [w] = forLeaflet(r.withheld, "git:ggg7777");
  assert.ok(w);
  assert.equal(w.item, "docs: point support at [withheld: email address]");
  assert.ok(!JSON.stringify(r).includes("help@northwind-labs.invalid"));
  // Both causes, never one: the tier is why it did not cross, and the reader still needs to know
  // what was in it, or the silence reads as "nothing was found".
  assert.match(w.reason, /somebody else's work/);
  assert.match(w.reason, /also contains text shaped like an email address/);
});

test("an absolute deny rule withholds a verified leaflet even after leaf-level consent", () => {
  const parsed = parsePublishPolicy({
    rules: [
      {
        id: "deny-one-ref",
        effect: "deny",
        match: { kind: "evidence-ref", ref: "4f884f6" },
        reason: "This artifact must stay on the subject's machine.",
      },
    ],
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;

  const r = published(
    reviewForPublication({
      leaf: leafOf(verified("git:aaa1111", "fix: keep the local boundary")),
      declaredExample: false,
      policy: parsed.policy,
    }),
  );

  assert.deepEqual(r.published.leaflets, []);
  const [w] = forLeaflet(r.withheld, "git:aaa1111");
  assert.ok(w);
  assert.equal(w.kind, "policy-denied");
  assert.match(w.reason, /deny-one-ref/);
  assert.match(w.reason, /cannot override/);
});

test("a policy denial never repeats the sensitive provenance value it withholds", () => {
  const sensitiveRef = "mailto:private-review@example.invalid";
  const parsed = parsePublishPolicy({
    rules: [
      {
        id: "deny-sensitive-ref",
        effect: "deny",
        match: { kind: "evidence-ref", ref: sensitiveRef },
        reason: "This artifact must stay on the subject's machine.",
      },
    ],
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;

  const r = published(reviewForPublication({
    leaf: leafOf(verified("git:sensitive-ref", "fix: keep the private review private", sensitiveRef)),
    declaredExample: false,
    policy: parsed.policy,
  }));

  const [w] = forLeaflet(r.withheld, "git:sensitive-ref");
  assert.ok(w);
  assert.equal(w.kind, "policy-denied");
  assert.match(w.inspect, /ref is not repeated/);
  assert.ok(!JSON.stringify(r).includes(sensitiveRef));
});

test("an example document is refused whole — no partial publication of a fabricated illustration", () => {
  const r = review(leafOf(verified("git:aaa1111", "feat: add the intake reader")), true);
  assert.equal(r.ok, false);
  assert.ok(!r.ok);
  const [refusal] = r.refusals;
  assert.ok(refusal);
  assert.equal(refusal.at, "example");
  assert.match(refusal.reason, /fabricated illustration/);
  assert.match(refusal.reason, /caption/, "the argument against a band-at-egress must be stated");
  assert.ok(!JSON.stringify(r).includes("intake reader"), "nothing of it is published");
});

/* ── Consent, asked before proof ──────────────────────────────────────────────────────────── */

test("a verified leaflet nobody offered outward does not cross, for the true reason", () => {
  // No `visibility` at all — the safe default is `private`, and the whole point of this control
  // is that the gate must not paper over that with "it is not verified", which would be true of
  // nothing here: this leaflet IS verified.
  const neverOffered: Leaflet = {
    id: leafletId("git:nnn1414"),
    title: "feat: add the local-only sync job",
    tier: "verified",
    provenance: prov("nnn1414"),
  };
  const r = published(review(leafOf(neverOffered)));

  assert.deepEqual(
    r.published.leaflets,
    [],
    "a leaflet the subject never offered outward must not cross just because it is proven",
  );
  const [w] = forLeaflet(r.withheld, "git:nnn1414");
  assert.ok(w, "a leaflet withheld for consent must still be named in the report");
  assert.equal(w.kind, "not-shared");
  assert.equal(w.item, "feat: add the local-only sync job");
  assert.match(w.reason, /never offered/);
  assert.match(w.reason, /consent refusal, not a proof refusal/);
  assert.doesNotMatch(
    w.reason,
    /it is pending|nothing proves it/,
    "the reason must never be a tier reason for a leaflet that was never offered at all",
  );
});

test("an excluded leaflet with no visibility set still reports attribution, not consent", () => {
  // The normal, ONLY state intake produces for an excluded leaflet: `visibility` is never set.
  // The reviewed regression: consent asked first read this as `private`-by-absence and reported
  // "not-shared" — "the leaflet may be verified" — for a leaflet that is not the subject's work
  // at all. Attribution is the true cause and must win regardless of what visibility says.
  const excluded: Leaflet = {
    id: leafletId("git:ooo1515"),
    title: "docs: fix the changelog for the release",
    tier: "excluded",
    reason: "could not be attributed to this subject: no declared identity matches the author.",
    provenance: prov("ooo1515"),
    // visibility deliberately absent
  };
  const r = published(review(leafOf(excluded)));

  const [w] = forLeaflet(r.withheld, "git:ooo1515");
  assert.ok(w, "an excluded leaflet must still be named in the report");
  assert.equal(w.kind, "unattributed-leaflet", "attribution is the true cause, not consent");
  assert.match(w.reason, /somebody else's work/);
  assert.doesNotMatch(
    w.reason,
    /never offered|consent refusal/,
    "the reason must never be a consent reason for work that is not the subject's at all",
  );
});

/* ── Field coverage and the deliberate asymmetries ────────────────────────────────────────── */

test("an address in the subject's own display name is withheld too", () => {
  const leaf: Leaf = {
    id: leafId("leaf-2"),
    subject: "Wren Halloway <wren@halloway.invalid>",
    leaflets: [],
  };
  const r = published(review(leaf));

  assert.equal(r.published.subject, "Wren Halloway <[withheld: email address]>");
  assert.equal(r.published.subjectRedacted, true);
  const [w] = r.withheld;
  assert.ok(w);
  assert.equal(w.leaflet, null);
  assert.equal(w.at, "subject");
  assert.match(w.reason, /pattern match is not that/);
});

test("an identifier inside provenance withholds the whole leaflet — a ref is never rewritten", () => {
  const odd: Leaflet = {
    id: leafletId("upload:1"),
    title: "design: the release review surface",
    tier: "verified",
    provenance: Object.freeze({
      source: "connector",
      ref: "mailto:ops@northwind-labs.invalid",
      observedAt: "2026-08-15T22:21:43.057Z",
    }),
    visibility: "public",
  };
  const r = published(review(leafOf(odd)));

  assert.deepEqual(r.published.leaflets, [], "a leaflet you cannot check is worse than none");
  const [w] = forLeaflet(r.withheld, "upload:1");
  assert.ok(w);
  assert.equal(w.kind, "unpublishable-provenance");
  assert.match(w.reason, /redacted ref\s+resolves to nothing/);
  assert.ok(
    !JSON.stringify(r).includes("ops@northwind-labs.invalid"),
    "the inspect sentence must not quote the very ref it is withholding",
  );
});

test("an account handle is withheld, and a scoped package name is not mistaken for one", () => {
  const r = published(
    review(
      leafOf(
        verified("git:hhh8888", "fix: crash on empty input, reported by @rowan-vale"),
        verified("git:iii9999", "chore: bump @types/node to 22.20.0", "iii9999"),
      ),
    ),
  );

  const [first, second] = r.published.leaflets;
  assert.ok(first && second);
  assert.equal(first.title, "fix: crash on empty input, reported by [withheld: account handle]");
  assert.equal(
    second.title,
    "chore: bump @types/node to 22.20.0",
    "a scoped dependency is not a person and must survive",
  );
  assert.equal(second.titleRedacted, false);
});

test("a version pin survives while a real address in the same title does not", () => {
  const r = published(
    review(leafOf(verified("git:jjj1010", "chore: bump npm@1.2.3, ping ops@example.com"))),
  );
  const only = r.published.leaflets[0];
  assert.ok(only);
  assert.equal(only.title, "chore: bump npm@1.2.3, ping [withheld: email address]");
});

test("a telephone number is withheld, and shas, dates and versions are not mistaken for one", () => {
  const r = published(
    review(
      leafOf(
        verified("git:kkk1111", "docs: on-call rota is 415-555-0142 during the freeze"),
        verified("git:lll1212", "chore: pin 4f884f6 observed 2026-08-15, bump 1.240.4801", "lll1212"),
      ),
    ),
  );
  const [first, second] = r.published.leaflets;
  assert.ok(first && second);
  assert.equal(first.title, "docs: on-call rota is [withheld: telephone number] during the freeze");
  assert.equal(second.title, "chore: pin 4f884f6 observed 2026-08-15, bump 1.240.4801");
});

test("two identifiers in one title are both withheld and both reported separately", () => {
  const r = published(
    review(
      leafOf(verified("git:mmm1313", "fix: route wren@example.com and ops@example.com to the queue")),
    ),
  );
  const only = r.published.leaflets[0];
  assert.ok(only);
  assert.equal(
    only.title,
    "fix: route [withheld: email address] and [withheld: email address] to the queue",
  );
  assert.equal(
    forLeaflet(r.withheld, "git:mmm1313").length,
    2,
    "each withheld item gets its own entry — a report is a list of things, not a tally",
  );
});

/* ── Totality, purity, determinism ────────────────────────────────────────────────────────── */

test("every entry in the report names its item and its reason — never a bare count", () => {
  const excluded: Leaflet = {
    id: leafletId("git:ccc3333"),
    title: "chore: rotate the staging key",
    tier: "excluded",
    reason: "could not be attributed to this subject.",
    provenance: prov("ccc3333"),
    visibility: "public",
  };
  // Never offered outward — no `visibility` at all — so this is a THIRD, distinct withholding
  // (`not-shared`), not the `pending` this test used to carry: `pending` crosses now (D1).
  const neverOffered: Leaflet = {
    id: leafletId("git:fff6666"),
    title: "feat: the seam test",
    tier: "pending",
    provenance: prov("fff6666"),
  };
  const r = published(
    review(leafOf(verified("git:aaa1111", "fix: mail hi@example.com"), excluded, neverOffered)),
  );

  assert.equal(r.withheld.length, 3);
  for (const w of r.withheld) {
    assert.ok(w.at.length > 0, "every withholding says where");
    assert.ok(w.item.trim().length > 0, "every withholding names the item");
    assert.ok(w.reason.length > 40, "every withholding argues, rather than labelling");
    assert.ok(w.inspect.length > 0, "every withholding says how to see the original");
  }
});

test("the gate is deterministic and does not mutate its input", () => {
  const leaf = leafOf(
    verified("git:aaa1111", "fix: mail hi@example.com Co-authored-by: Rowan Vale <r@example.com>"),
    verified("git:ddd4444", "perf: cut the walk to one pass", "ddd4444"),
  );
  const before = JSON.stringify(leaf);

  const a = JSON.stringify(review(leaf));
  const b = JSON.stringify(review(leaf));
  assert.equal(a, b, "same input, same output — a human consented to exactly this");
  assert.equal(JSON.stringify(leaf), before, "the source leaf is untouched");
});

test("a published leaf is usable as a Leaf, and a raw Leaf cannot pose as a published one", () => {
  const r = published(review(leafOf(verified("git:ddd4444", "perf: cut the walk to one pass"))));
  // Structural direction: this assignment compiles, so a renderer takes the gated value directly.
  const asLeaf: Leaf = r.published;
  assert.equal(asLeaf.leaflets.length, 1);
  // The other direction is refused by the type system (`reviewedForPublication` is missing), which
  // is what stops an ungated leaf from reaching a publication path. Asserted at the value level
  // here because a type error cannot be observed at runtime.
  assert.equal(
    Object.hasOwn(leafOf() as object, "reviewedForPublication"),
    false,
    "a raw leaf carries no publication brand",
  );
  assert.equal(r.published.reviewedForPublication, true);
});

test("pathological text is handled without throwing and without dropping the rest of the title", () => {
  for (const title of [
    "@",
    "@@@@",
    "a@b",
    "....@....",
    "+".repeat(200),
    "Co-authored-by:",
    "fix: " + "a".repeat(5000) + " hi@example.com",
  ]) {
    const r = review(leafOf(verified("git:aaa1111", title)));
    assert.ok(r.ok, `the gate must be total; it refused ${JSON.stringify(title.slice(0, 20))}`);
    const only = r.published.leaflets[0];
    assert.ok(only, "a verified leaflet with an odd title is still publishable");
    assert.ok(only.title.length > 0, "a redacted title never becomes empty");
  }
});
