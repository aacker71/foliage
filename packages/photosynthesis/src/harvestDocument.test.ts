import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLeafDocument } from "@foliage/leaf";

import {
  reviewSubjectDigest, parseHarvestDocument } from "./harvestDocument.ts";
import { promoteApproved } from "./promote.ts";

/**
 * Every document in this file is a PARSER INPUT, not harvest content: each one exists to pin
 * a specific accept/reject decision. Nothing here is rendered or promoted anywhere, and a
 * passing suite proves the format is enforced — it does not imply any real extraction ran.
 */

const instant = "2026-08-16T00:00:00Z";
const evidence = [{ source: "git", ref: "e3b4489", observedAt: instant }];

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "git-cluster:parser-input",
    title: "parser input: 2 commits",
    evidence,
    extractor: "git-cluster",
    draftedAt: instant,
    review: { state: "candidate" },
    ...overrides,
  };
}

function issuesAt(value: unknown): string[] {
  const parsed = parseHarvestDocument(value);
  assert.equal(parsed.ok, false, "expected the document to be rejected");
  return parsed.ok ? [] : parsed.issues.map((i) => i.at);
}

test("a well-formed document parses, in all three review states", () => {
  const parsed = parseHarvestDocument({
    candidates: [
      candidate(),
      candidate({
        id: "approved-one",
        review: { state: "approved", by: "reviewer", at: instant },
      }),
      candidate({
        id: "rejected-one",
        review: { state: "rejected", by: "reviewer", at: instant, reason: "not their work" },
      }),
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.harvest.candidates.length, 3);
  assert.deepEqual(
    parsed.harvest.candidates.map((c) => c.review.state),
    ["candidate", "approved", "rejected"],
  );
  assert.ok(Object.isFrozen(parsed.harvest));
  assert.ok(Object.isFrozen(parsed.harvest.candidates[0]));
});

test("AN EMPTY candidates ARRAY IS VALID — an empty harvest is not a missing one", () => {
  const parsed = parseHarvestDocument({ candidates: [] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.harvest.candidates.length, 0);
});

test("an unknown field is refused so a misspelling cannot become an invisible omission", () => {
  assert.deepEqual(issuesAt({ candidates: [], extras: true }), ["extras"]);
  assert.deepEqual(issuesAt({ candidates: [candidate({ draftedBy: "who" })] }), [
    "candidates[0].draftedBy",
  ]);
});

test("EACH score-family key is refused BY NAME, with a distinct issue naming why", () => {
  // The six the seam contract names explicitly, one at a time, so a regression on any single
  // key fails with that key's name in the assertion message.
  for (const key of ["confidence", "score", "strength", "rating", "rank", "weight"]) {
    const parsed = parseHarvestDocument({ candidates: [candidate({ [key]: 0.9 })] });
    assert.equal(parsed.ok, false, `expected "${key}" to be refused`);
    if (parsed.ok) continue;
    const issue = parsed.issues.find((i) => i.at === `candidates[0].${key}`);
    assert.ok(issue, `expected an issue at candidates[0].${key}`);
    assert.match(issue.message, /refused by name/, key);
    assert.match(issue.message, /never a number/, key);
  }
});

test("a score-shaped key is refused at the document level too", () => {
  const parsed = parseHarvestDocument({ candidates: [], confidence: 0.5 });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.issues[0]!.message, /refused by name/);
});

test("a candidate with no evidence cannot exist — empty and absent are both refused", () => {
  assert.deepEqual(issuesAt({ candidates: [candidate({ evidence: [] })] }), [
    "candidates[0].evidence",
  ]);
  const absent = candidate();
  delete absent["evidence"];
  assert.deepEqual(issuesAt({ candidates: [absent] }), ["candidates[0].evidence"]);
});

test("evidence refs are held to Provenance's rules: observedAt needs an offset", () => {
  assert.deepEqual(
    issuesAt({
      candidates: [
        candidate({ evidence: [{ source: "git", ref: "abc", observedAt: "2026-08-16" }] }),
      ],
    }),
    ["candidates[0].evidence[0].observedAt"],
  );
});

test("rejected WITHOUT a reason is refused — a rejection may not be a silent disappearance", () => {
  const parsed = parseHarvestDocument({
    candidates: [candidate({ review: { state: "rejected", by: "reviewer", at: instant } })],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "candidates[0].review.reason");
  assert.ok(issue, "expected the missing reason to be reported");
  assert.match(issue.message, /requires a reason/);
});

test("`reason` on an approved review is refused rather than carried and never shown", () => {
  assert.deepEqual(
    issuesAt({
      candidates: [
        candidate({ review: { state: "approved", by: "r", at: instant, reason: "stray" } }),
      ],
    }),
    ["candidates[0].review.reason"],
  );
});

test("an approved review requires by and at — the act must be attributable", () => {
  assert.deepEqual(issuesAt({ candidates: [candidate({ review: { state: "approved" } })] }), [
    "candidates[0].review.by",
    "candidates[0].review.at",
  ]);
});

test("an unknown review state is rejected", () => {
  assert.deepEqual(issuesAt({ candidates: [candidate({ review: { state: "maybe" } })] }), [
    "candidates[0].review.state",
  ]);
});

test("a blank extractor is rejected — review must see what drafted a title", () => {
  const parsed = parseHarvestDocument({ candidates: [candidate({ extractor: " " })] });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.issues[0]!.message, /what drafted/);
});

test("duplicate candidate ids are rejected", () => {
  assert.deepEqual(
    issuesAt({ candidates: [candidate(), candidate({ title: "same id, other title" })] }),
    ["candidates[1].id"],
  );
});

test("one invalid candidate rejects the WHOLE document — no partial success", () => {
  const parsed = parseHarvestDocument({
    candidates: [candidate(), candidate({ id: "bad-one", evidence: [] })],
  });
  assert.equal(parsed.ok, false);
});

test("the parser never throws, whatever it is handed", () => {
  for (const input of [null, undefined, 0, "", "a string", [], [1, 2], true, NaN]) {
    const parsed = parseHarvestDocument(input);
    assert.equal(parsed.ok, false, `${String(input)} must be rejected, not thrown on`);
    if (!parsed.ok) assert.ok(parsed.issues.length > 0, "a rejection must carry a reason");
  }
});

/* ------------------------------------------------------------------- shownPages ------- */

const shown = [
  {
    page: "/tmp/knowledge/projects/billing-migration.md",
    kind: "unclassified",
    charsShown: 12_000,
    charsInPage: 41_309,
  },
  {
    page: "/tmp/knowledge/meetings/2026-05-vendor-review.md",
    kind: "third-party-shaped",
    charsShown: 800,
    charsInPage: 800,
  },
];

test("a candidate may record the pack its drafter was shown, and it round-trips whole", () => {
  const parsed = parseHarvestDocument({ candidates: [candidate({ shownPages: shown })] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.harvest.candidates[0]!.shownPages, shown);
  assert.ok(Object.isFrozen(parsed.harvest.candidates[0]!.shownPages));
});

test("ABSENT and EMPTY are different statements, and only one of them can be true", () => {
  // Absent means no drafter wrote this title. `[]` would mean a drafter was shown nothing and
  // wrote one anyway, which is not a state that can have happened.
  const absent = parseHarvestDocument({ candidates: [candidate()] });
  assert.equal(absent.ok, true);
  if (!absent.ok) return;
  assert.equal(absent.harvest.candidates[0]!.shownPages, undefined);
  assert.equal(
    Object.prototype.hasOwnProperty.call(absent.harvest.candidates[0]!, "shownPages"),
    false,
    "an absent pack must not come back as an explicit undefined — a key that is there says " +
      "something the document did not",
  );

  assert.deepEqual(issuesAt({ candidates: [candidate({ shownPages: [] })] }), [
    "candidates[0].shownPages",
  ]);
});

test("a pack entry is checked field by field, and an impossible reading is refused", () => {
  assert.deepEqual(
    issuesAt({ candidates: [candidate({ shownPages: [{ ...shown[0], page: "  " }] })] }),
    ["candidates[0].shownPages[0].page"],
  );
  // The kind states what the PATH said; a word this format does not know would be a
  // classification nobody can act on.
  assert.deepEqual(
    issuesAt({ candidates: [candidate({ shownPages: [{ ...shown[0], kind: "safe" }] })] }),
    ["candidates[0].shownPages[0].kind"],
  );
  assert.deepEqual(
    issuesAt({ candidates: [candidate({ shownPages: [{ ...shown[0], charsShown: 1.5 }] })] }),
    ["candidates[0].shownPages[0].charsShown"],
  );
  // More characters read than the page holds is not a measurement anything could have produced,
  // and it would make the one number a reviewer acts on unreadable.
  assert.deepEqual(
    issuesAt({
      candidates: [candidate({ shownPages: [{ ...shown[0], charsShown: 90_000 }] })],
    }),
    ["candidates[0].shownPages[0].charsShown"],
  );
  // One page shown twice is one page; a duplicate would overstate the pack.
  assert.deepEqual(
    issuesAt({ candidates: [candidate({ shownPages: [shown[0], shown[0]] })] }),
    ["candidates[0].shownPages[1].page"],
  );
});

test("a pack entry refuses unknown keys, and a score-shaped one BY NAME", () => {
  // The pack is exactly the sort of record something would want to hang a relevance number on.
  assert.deepEqual(
    issuesAt({
      candidates: [candidate({ shownPages: [{ ...shown[0], confidence: 0.9 }] })],
    }),
    ["candidates[0].shownPages[0].confidence"],
  );
  const parsed = parseHarvestDocument({
    candidates: [candidate({ shownPages: [{ ...shown[0], confidence: 0.9 }] })],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.issues[0]!.message, /refused by name/);
});

test("an evidence excerpt is accepted and preserved verbatim — it is the material review shows", () => {
  const parsed = parseHarvestDocument({
    candidates: [
      candidate({
        evidence: [
          { source: "git", ref: "e3b4489", observedAt: instant, excerpt: "fix: the gate refused its own fixture" },
          { source: "git", ref: "a1b2c3d", observedAt: instant },
        ],
      }),
    ],
  });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
  if (!parsed.ok) return;
  const [withText, bare] = parsed.harvest.candidates[0]!.evidence;
  assert.equal(withText!.excerpt, "fix: the gate refused its own fixture");
  // Absence is the honest spelling on the bare ref — not an empty string, not null.
  assert.equal("excerpt" in bare!, false);
});

test("an EMPTY excerpt is refused by name — a blank line pretending to be material", () => {
  const parsed = parseHarvestDocument({
    candidates: [candidate({ evidence: [{ source: "git", ref: "e3b4489", observedAt: instant, excerpt: "  " }] })],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.ok(
    parsed.issues.some((i) => i.at.endsWith(".excerpt")),
    `the refusal must land at .excerpt, got ${JSON.stringify(parsed.issues)}`,
  );
});

test("a non-string excerpt is refused at its address", () => {
  const parsed = parseHarvestDocument({
    candidates: [candidate({ evidence: [{ source: "git", ref: "e3b4489", observedAt: instant, excerpt: 7 }] })],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.ok(parsed.issues.some((i) => i.at.endsWith(".excerpt")));
});

/* ------------------------------------------------------------- review-subject digest ---- */

test("reviewSubjectDigest: key order cannot change it; evidence ORDER can", () => {
  const base = {
    id: "git-cluster:x",
    title: "x: 2 commits",
    evidence: [
      { source: "git", ref: "a".repeat(40), observedAt: instant },
      { source: "git", ref: "b".repeat(40), observedAt: instant },
    ],
    extractor: "git-cluster",
  };
  const reordered = {
    extractor: "git-cluster",
    evidence: [
      { observedAt: instant, ref: "a".repeat(40), source: "git" },
      { source: "git", ref: "b".repeat(40), observedAt: instant },
    ],
    title: "x: 2 commits",
    id: "git-cluster:x",
  };
  assert.equal(reviewSubjectDigest(base), reviewSubjectDigest(reordered));
  // Evidence order IS meaning — the first ref becomes the promoted leaflet's own provenance.
  const swapped = { ...base, evidence: [base.evidence[1]!, base.evidence[0]!] };
  assert.notEqual(reviewSubjectDigest(base), reviewSubjectDigest(swapped));
});

test("reviewSubjectDigest: an excerpt changes it; draftedAt and review do not", () => {
  const base = {
    id: "git-cluster:x",
    title: "x: 1 commit",
    evidence: [{ source: "git", ref: "a".repeat(40), observedAt: instant }],
    extractor: "git-cluster",
  };
  const withExcerpt = {
    ...base,
    evidence: [{ source: "git", ref: "a".repeat(40), observedAt: instant, excerpt: "feat: the words that publish" }],
  };
  assert.notEqual(
    reviewSubjectDigest(base),
    reviewSubjectDigest(withExcerpt),
    "an excerpt is publish-affecting material — it must reopen a decision",
  );
  // The two stated exclusions: the machine clock and the decision itself.
  const noisy = { ...base, draftedAt: "2099-01-01T00:00:00Z", review: { state: "approved" } };
  assert.equal(reviewSubjectDigest(base), reviewSubjectDigest(/** as-is */ noisy as typeof base));
});

test("a recorded subjectDigest survives the parser; a malformed one is refused at its address", () => {
  const good = parseHarvestDocument({
    candidates: [
      candidate({
        review: { state: "approved", by: "r", at: instant, subjectDigest: `rsd1:${"a".repeat(64)}` },
      }),
    ],
  });
  assert.equal(good.ok, true, JSON.stringify(!good.ok && good.issues));
  if (good.ok) {
    const review = good.harvest.candidates[0]!.review;
    assert.equal(review.state === "approved" ? review.subjectDigest : "", `rsd1:${"a".repeat(64)}`);
  }
  const bad = parseHarvestDocument({
    candidates: [candidate({ review: { state: "approved", by: "r", at: instant, subjectDigest: "not-a-digest" } })],
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.issues.some((i) => i.at.endsWith(".subjectDigest")));
});

/* -------------------------------------------------------- the target binding, F-014 ---- */

test("F-014: subject and leafId are OPTIONAL top-level fields and survive the parser verbatim", () => {
  const parsed = parseHarvestDocument({
    subject: "Rowan",
    leafId: "leaf:rowan",
    candidates: [candidate()],
  });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
  if (!parsed.ok) return;
  assert.equal(parsed.harvest.subject, "Rowan");
  assert.equal(parsed.harvest.leafId, "leaf:rowan");
});

test("F-014: BOTH ABSENT is valid — an unbound document is not a malformed one", () => {
  const parsed = parseHarvestDocument({ candidates: [] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal("subject" in parsed.harvest, false, "absence must be the field missing, not an empty string");
  assert.equal("leafId" in parsed.harvest, false);
});

test("F-014: a present subject, leafId or repo that is not a non-empty string is refused at its own address", () => {
  for (const bad of [0, null, "", "   ", [], {}]) {
    for (const field of ["subject", "leafId", "repo"]) {
      const parsed = parseHarvestDocument({ [field]: bad, candidates: [] });
      assert.equal(parsed.ok, false, `${field}: ${JSON.stringify(bad)} must be refused`);
      if (!parsed.ok) assert.ok(parsed.issues.some((i) => i.at === field), `the refusal must land at ${field}`);
    }
  }
});

test("the repository a harvest was drafted from is an OPTIONAL top-level field that survives the parser verbatim", () => {
  const parsed = parseHarvestDocument({ repo: "/work/mine", candidates: [] });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
  if (!parsed.ok) return;
  assert.equal(parsed.harvest.repo, "/work/mine");
  // Absent means UNCHECKED — the field missing, never an empty string standing in for it.
  const absent = parseHarvestDocument({ candidates: [] });
  assert.equal(absent.ok, true);
  if (absent.ok) assert.equal("repo" in absent.harvest, false);
});

test("F-014: neither field is score-shaped or otherwise refused BY the unknown-key gate — they are DECLARED keys", () => {
  // If this ever regresses, "subject"/"leafId" would be rejected as an "unknown field" — the
  // same gate that refuses a misspelling. Asserted directly so a future rename of DOCUMENT_KEYS
  // fails here rather than as a silent behaviour change three call sites away.
  const parsed = parseHarvestDocument({ subject: "Rowan", leafId: "leaf:rowan", candidates: [] });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
});

/* ------------------------------------------------------------------ authoredAt ------- */

test("authoredAt: an ISO instant parses and is kept on the evidence entry", () => {
  const parsed = parseHarvestDocument({
    candidates: [candidate({ evidence: [{ source: "git", ref: "e3b4489", observedAt: instant, authoredAt: "2026-08-10T09:30:00+02:00" }] })],
  });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
  if (!parsed.ok) return;
  assert.equal(parsed.harvest.candidates[0]!.evidence[0]!.authoredAt, "2026-08-10T09:30:00+02:00");
  // Absent stays absent — not an undefined-valued key.
  const bare = parseHarvestDocument({ candidates: [candidate()] });
  assert.equal(bare.ok, true);
  if (bare.ok) assert.equal("authoredAt" in bare.harvest.candidates[0]!.evidence[0]!, false);
});

test("authoredAt: non-ISO, blank and number values are refused at the field's address", () => {
  for (const bad of ["2026-08-10", "last tuesday", "", "   ", 1_723_000_000, null]) {
    assert.deepEqual(
      issuesAt({ candidates: [candidate({ evidence: [{ source: "git", ref: "e3b4489", observedAt: instant, authoredAt: bad }] })] }),
      ["candidates[0].evidence[0].authoredAt"],
      `authoredAt ${JSON.stringify(bad)} must be refused`,
    );
  }
});

/**
 * Shaped like approved git clusters in a real garden: several refs, excerpts, a recorded digest.
 * Synthetic values throughout — a parser/digest input, not anybody's history.
 */
function approvedClusters(withAuthored: boolean): Record<string, unknown>[] {
  return ["docs", "feat", "fix(review)"].map((prefix, n) => ({
    id: `git-cluster:${prefix}`,
    title: `${prefix}: synthetic input ${n}`,
    evidence: [0, 1, 2].map((i) => ({
      source: "git",
      ref: `${String(n)}${String(i)}`.padEnd(40, "c"),
      observedAt: instant,
      excerpt: `${prefix}: synthetic subject ${i}`,
      ...(withAuthored ? { authoredAt: `2026-07-0${i + 1}T10:00:00Z` } : {}),
    })),
    extractor: "git-cluster",
    draftedAt: instant,
    review: { state: "approved", by: "Synthetic Reviewer", at: instant },
  }));
}

test("authoredAt is outside the review digest: every approved digest is byte-identical with and without it", () => {
  const without = approvedClusters(false);
  const withDates = approvedClusters(true);
  for (const [i, bare] of without.entries()) {
    const dated = withDates[i]!;
    assert.notDeepEqual(bare["evidence"], dated["evidence"], "the fixture must actually differ");
    assert.equal(
      reviewSubjectDigest(dated as Parameters<typeof reviewSubjectDigest>[0]),
      reviewSubjectDigest(bare as Parameters<typeof reviewSubjectDigest>[0]),
      `${String(bare["id"])}: adding author dates must not reopen an approval`,
    );
  }
});

test("authoredAt never crosses into the leaf: promotion output carries none and passes the leaf gate", () => {
  const harvest = parseHarvestDocument({ candidates: approvedClusters(true) });
  assert.equal(harvest.ok, true, JSON.stringify(!harvest.ok && harvest.issues));
  if (!harvest.ok) return;
  const leaf = parseLeafDocument({ id: "leaf-under-test", subject: "Parser Input", leaflets: [] });
  assert.equal(leaf.ok, true);
  if (!leaf.ok) return;
  const promoted = promoteApproved(harvest.harvest, leaf.leaf);
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  assert.equal(promoted.leaf.leaflets.length, 3);
  const serialized = JSON.stringify(promoted.leaf);
  assert.equal(serialized.includes("authoredAt"), false, "no author date may reach the leaf");
  const again = parseLeafDocument(JSON.parse(serialized));
  assert.equal(again.ok, true, JSON.stringify(!again.ok && again.issues));
});
