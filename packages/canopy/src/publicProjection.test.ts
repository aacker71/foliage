/**
 * Tests for the public projection — the file that decides what a stranger sees.
 *
 * WHAT THESE FIXTURES ARE, stated plainly because this repository refuses fake data: they are
 * DOMAIN INPUTS to a pure total function, in the same shape and for the same reason as the ones
 * in `canopy.test.ts`. They are not evidence, not a demo, and nothing here claims any leaflet
 * below was ever produced by a real intake.
 *
 * The `verified` fixtures deserve their own sentence, because they are the one shape this
 * machine CANNOT obtain from real git. Re-measured 2026-08-19 on a fresh intake of this
 * repository (57 non-merge commits, `--identity 126364027+aacker71@users.noreply.github.com`):
 * tiers came back `verified 0 · pending 57 · excluded 0`, and one of those 57 commits CARRIES a
 * PGP signature that sits unchecked because git invokes `gpg`, which `which gpg` cannot find on
 * this machine. So `verified` is unobtainable here, and every `verified` fixture below is a
 * constructed input exercising a shape real git will not hand us today. That is a fact about
 * the machine and it is reported, not papered over.
 *
 * WHAT THAT SAME MEASUREMENT USED TO MEAN, and why the tier gate is gone. While the projection
 * required `verified`, the sentence above finished "…so a `listed` state is unreachable with
 * this repository's real history". It was true, and it was the bug: the only state a real
 * document could reach was empty. Re-measured after the change, on the SAME real document —
 * written by the real `intake.mjs`, edited by the real `share.mjs share <id> --as public`:
 *
 *   before → nothing-publishable, 0 of 57 link-reachable
 *   after  → listed, 3 artifacts, tiers ["pending","pending","pending"], 5 of 57 reachable
 *            (3 public + 2 unlisted), visibility {"public":3,"unlisted":2,"(absent)":52}
 *
 * The pending tier is not hidden by that listing, it is CARRIED on it — which is the half of
 * the change that keeps it honest, and the assertion for it is in section 3.
 *
 * The REAL-DATA measurements are recorded beside the assertions they correspond to. They come
 * from two real documents: `/tmp/tier-honesty-lane.leaf.json` (this repository read through the
 * owner's identity) and `/tmp/tier-honesty-other.leaf.json` (the same history read through an
 * identity that authored none of it — 58 `excluded` leaflets, which is how the third state
 * below was exercised on real data rather than only on a constructed input).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { leafId, leafletId, type Leaf, type Leaflet, type LeafletVisibility } from "@foliage/leaf";

import { treeId, type Canopy } from "./canopy.ts";
import {
  findPublicLeaf,
  findPublicLeaflet,
  isListable,
  isReachableByLink,
  projectCanopy as projectCanopyWith,
  projectLeaf as projectLeafWith,
  projectTree as projectTreeWith,
  publicCanopySize,
  type ListableLeaflet,
  type PublicLeaf,
} from "./publicProjection.ts";
import { defaultPublishPolicy, type PublishPolicy } from "@foliage/leaf";

/**
 * Every projection in this file runs under the DEFAULT policy — the rail with the shipped deny
 * rules attached, exactly what a canopy uses for a subject who wrote no policy of their own.
 * Stated once here, so the rail is always on in these tests and never invisibly absent; the
 * rail-specific behaviours (a deny beating a public share) get their own tests below.
 */
const parsedDefault = defaultPublishPolicy();
if (!parsedDefault.ok) throw new Error("the built-in default publish policy failed to parse");
const POLICY: PublishPolicy = parsedDefault.policy;
const projectLeaf = (leaf: Leaf) => projectLeafWith(leaf, POLICY);
const projectTree = (tree: Parameters<typeof projectTreeWith>[0]) => projectTreeWith(tree, () => POLICY);
const projectCanopy = (canopy: Canopy) => projectCanopyWith(canopy, () => POLICY);

const prov = { source: "git", ref: "f0221ec", observedAt: "2026-08-13T00:00:00Z" };

/** `vis: null` writes NO visibility key at all — private the way a real document spells it. */
function leaflet(
  id: string,
  tier: Leaflet["tier"],
  vis: LeafletVisibility | null,
  title = `leaflet ${id}`,
): Leaflet {
  const visibility = vis === null ? {} : { visibility: vis };
  if (tier === "verified") return { id: leafletId(id), title, tier, provenance: prov, ...visibility };
  if (tier === "pending") return { id: leafletId(id), title, tier, provenance: prov, ...visibility };
  return { id: leafletId(id), title, tier, reason: "authored by someone else", ...visibility };
}

const leafOf = (id: string, subject: string, leaflets: readonly Leaflet[]): Leaf => ({
  id: leafId(id),
  subject,
  leaflets,
});

/** Narrowing helper: `assert.equal` does not narrow a union, `assert.fail` returns `never`. */
function listedOf(p: PublicLeaf): readonly ListableLeaflet[] {
  if (p.state !== "listed") assert.fail(`expected a listing, got ${p.state}`);
  return p.listed;
}

/**
 * Every number a reader could derive from a projection: the literal numbers in it plus the
 * length of every array. This is how the leak tests below ask "does any figure on this surface
 * equal the number of things the subject withheld?" without guessing which field to look at.
 */
function derivableNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") out.push(value);
  else if (Array.isArray(value)) {
    out.push(value.length);
    for (const v of value) derivableNumbers(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) derivableNumbers(v, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 1. THE CARDINAL SIN: private, by absence and by name.
// ---------------------------------------------------------------------------------------------

test("a leaf whose leaflets are all private by ABSENCE projects to nothing-offered", () => {
  // MEASURED, real data: a fresh intake of this repository wrote 57 leaflets, every one of them
  // with no `visibility` key — `{"(absent)": 57}`. projectLeaf on that document returned
  // `nothing-offered`, and 0 of the 57 ids were link-reachable.
  const leaf = leafOf("l1", "A. Acker", [
    leaflet("a", "verified", null),
    leaflet("b", "verified", null),
    leaflet("c", "pending", null),
  ]);
  const p = projectLeaf(leaf);
  assert.equal(p.state, "nothing-offered");
  assert.deepEqual(Object.keys(p).sort(), ["id", "state", "subject"]);
});

test("no title, id or ref of a private leaflet appears anywhere in the projection", () => {
  const leaf = leafOf("l1", "A. Acker", [
    leaflet("secret-a", "verified", null, "The unannounced acquisition"),
    leaflet("secret-b", "verified", "private", "The other one"),
    leaflet("shown", "verified", "public", "The shipped gate"),
  ]);
  const serialized = JSON.stringify(projectLeaf(leaf));
  assert.ok(!serialized.includes("secret-a"));
  assert.ok(!serialized.includes("secret-b"));
  assert.ok(!serialized.includes("unannounced"));
  assert.ok(serialized.includes("The shipped gate"));
});

test("the word `private` written out is refused exactly like its absence", () => {
  // `share.mjs unshare` deletes the key rather than writing the word, so the two spellings must
  // never diverge here — one of them going unchecked is how the second spelling starts leaking.
  for (const vis of [null, "private"] as const) {
    const leaf = leafOf("l1", "A. Acker", [leaflet("a", "verified", vis)]);
    assert.equal(projectLeaf(leaf).state, "nothing-offered");
    assert.equal(isListable(leaflet("a", "verified", vis)), false);
    assert.equal(isReachableByLink(leaflet("a", "verified", vis)), false);
  }
});

test("the listed array is frozen, so a renderer cannot push a private leaflet into it", () => {
  const leaf = leafOf("l1", "A. Acker", [
    leaflet("pub", "verified", "public"),
    leaflet("priv", "verified", null),
  ]);
  const listed = listedOf(projectLeaf(leaf));
  assert.equal(Object.isFrozen(listed), true);
  assert.throws(() => (listed as ListableLeaflet[]).push(listed[0]!), TypeError);
});

// ---------------------------------------------------------------------------------------------
// 2. `unlisted` IS NOT `public` — the distinction that has to survive counting.
// ---------------------------------------------------------------------------------------------

test("unlisted leaflets are neither listed NOR counted", () => {
  const leaf = leafOf("l1", "A. Acker", [
    leaflet("pub", "verified", "public"),
    ...["u1", "u2", "u3", "u4", "u5"].map((id) => leaflet(id, "verified", "unlisted")),
    ...["p1", "p2"].map((id) => leaflet(id, "verified", null)),
  ]);
  // 8 leaflets: 1 public, 5 unlisted, 2 private.
  const p = projectLeaf(leaf);
  assert.equal(listedOf(p).length, 1);

  // The leak this test exists for: a total of 6 (public + unlisted) or 8 (everything) tells the
  // reader how many things they were not shown, which is the fact the subject withheld.
  const numbers = derivableNumbers(p);
  assert.deepEqual(
    numbers.filter((n) => n !== 1),
    [],
    `the only figure derivable from this projection must be 1, got ${numbers.join(", ")}`,
  );
});

test("a person holding ONLY unlisted work is indistinguishable from one holding nothing", () => {
  // If `nothing-offered` and "offered only by link" said different words, the browse surface
  // would announce the existence of leaflets whose owner consented to a link and nothing more.
  const onlyUnlisted = projectLeaf(
    leafOf("l1", "A. Acker", [
      leaflet("u1", "verified", "unlisted"),
      leaflet("u2", "verified", "unlisted"),
    ]),
  );
  const empty = projectLeaf(leafOf("l1", "A. Acker", []));
  assert.deepEqual({ ...onlyUnlisted }, { ...empty });
});

test("unlisted IS reachable at its own address — the other half of the distinction", () => {
  const leaf = leafOf("l1", "A. Acker", [
    leaflet("u", "verified", "unlisted"),
    leaflet("pb", "verified", "public"),
    leaflet("pv", "verified", null),
  ]);
  assert.equal(findPublicLeaflet(leaf, "u").found, true);
  assert.equal(findPublicLeaflet(leaf, "pb").found, true);
  assert.equal(findPublicLeaflet(leaf, "pv").found, false);
});

// ---------------------------------------------------------------------------------------------
// 3. THE TIER IS SHOWN, NOT USED AS A GATE — and `excluded` is the one refusal that stays.
//
// The gate that used to live here (`publishableLeaflets`, i.e. verified-only) was removed on
// 2026-08-19 because it made the surface permanently empty on real data, and permanently empty
// BY DEFINITION for work with no cryptographic authorship — a weld, a shift, a meal. The tests
// below are the replacement contract: the subject's decision is what publishes, the tier rides
// along so the reader can see what it proves, and somebody else's work still never appears.
// ---------------------------------------------------------------------------------------------

test("public and pending IS listed, and it carries its pending tier", () => {
  // MEASURED, real data, before/after on ONE document — this repository read through the owner's
  // identity, 57 pending leaflets, then `share.mjs share <id> --as public` on three of them:
  //   before this change → nothing-publishable, listed absent, nothing on the page
  //   after              → listed, 3 artifacts, every one of them tier "pending"
  // The listing is the subject's decision; the tier is the disclosure that keeps it honest. A
  // listing that dropped the tier would be the overclaim the old gate was defending against.
  const leaf = leafOf("l1", "A. Acker", [
    leaflet("a", "pending", "public"),
    leaflet("b", "pending", "public"),
    leaflet("c", "verified", "public"),
  ]);
  const listed = listedOf(projectLeaf(leaf));
  assert.deepEqual(
    listed.map((l) => l.tier),
    ["pending", "pending", "verified"],
    "the projected leaflets must carry their own tiers, in the document's order",
  );
});

test("the tier survives every hop a renderer would take to reach it", () => {
  // The regression this guards: a projection that carried `tier` out of `projectLeaf` but lost
  // it through the canopy/tree/lookup path would render a pending artifact with no disclosure,
  // which reads to a stranger exactly like a verified one.
  const canopy = projectCanopy({
    trees: [
      {
        id: treeId("t1"),
        company: "Foliage",
        leaves: [leafOf("l1", "A. Acker", [leaflet("a", "pending", "public")])],
      },
    ],
  });
  const hit = findPublicLeaf(canopy, "l1");
  assert.equal(hit.found, true);
  if (hit.found) assert.equal(listedOf(hit.leaf)[0]?.tier, "pending");

  const direct = findPublicLeaflet(leafOf("l1", "A. Acker", [leaflet("u", "pending", "unlisted")]), "u");
  assert.equal(direct.found, true);
  if (direct.found) assert.equal(direct.leaflet.tier, "pending");
});

test("excluded never reaches a public surface, by either route", () => {
  // MEASURED, real data: this repository read through an identity that authored none of it
  // yields 58 `excluded` leaflets. `share.mjs share <id> --as public` on the first, then
  // projectLeaf → `nothing-publishable`, findPublicLeaflet → not found, and the artifact's
  // title appears nowhere in the serialized projection.
  //
  // This is NOT the tier gate coming back in another coat. `excluded` answers "whose work is
  // this?", not "how well proven is it?" — publishing it here would attribute somebody else's
  // commit to this subject, and no badge fixes a false attribution.
  const leaf = leafOf("l1", "A. Acker", [leaflet("x", "excluded", "public", "Somebody else's fix")]);
  assert.equal(projectLeaf(leaf).state, "nothing-publishable");
  assert.equal(findPublicLeaflet(leaf, "x").found, false);
  assert.ok(!JSON.stringify(projectLeaf(leaf)).includes("Somebody else's"));
  assert.equal(isListable(leaflet("x", "excluded", "public")), false);
  assert.equal(isReachableByLink(leaflet("x", "excluded", "unlisted")), false);
});

test("the excluded leaflet's REASON never reaches the surface either", () => {
  // The reason is the honest half of an exclusion on the subject's own page, and it names the
  // other party's work. Outward it is doubly refused: the artifact is not published, and no
  // field of the projection could carry the sentence even if it were.
  const leaf = leafOf("l1", "A. Acker", [
    { ...leaflet("x", "excluded", "public"), reason: "authored by dana@other.example" } as Leaflet,
    leaflet("ok", "pending", "public"),
  ]);
  assert.ok(!JSON.stringify(projectLeaf(leaf)).includes("dana@other.example"));
});

test("public is the only visibility that lists, and excluded is the only tier that cannot", () => {
  const tiers = ["verified", "pending", "excluded"] as const;
  const visibilities = [null, "private", "unlisted", "public"] as const;
  const listedCombos: string[] = [];
  for (const tier of tiers) {
    for (const vis of visibilities) {
      const p = projectLeaf(leafOf("l1", "A. Acker", [leaflet("a", tier, vis)]));
      if (p.state === "listed") listedCombos.push(`${tier}/${vis ?? "absent"}`);
    }
  }
  // The whole 3 × 4 table, enumerated rather than spot-checked, because this is the one
  // statement of the rule a reader can check against the header without running anything.
  assert.deepEqual(listedCombos, ["verified/public", "pending/public"]);
});

test("an all-excluded public set reaches nothing-publishable — one of the two ways in", () => {
  // The state kept its name and narrowed its meaning: offering unproven work no longer lands
  // here, offering somebody else's still does. Collapsing this into `nothing-offered` would
  // print "published nothing" about someone who published.
  //
  // THIS TEST WAS NAMED "reached ONLY by an all-excluded public set" UNTIL 2026-09-04, AND THAT
  // WAS FALSE — a test NAME being the most quotable comment a repository has. `projectLeaf` also
  // reaches this state through the publish RAIL, on work that IS the subject's, at any tier
  // including `verified`. That false narrowing is exactly what F-028 was: a later author read it,
  // believed it, and shipped a public page telling a person their work could not be attributed to
  // them when the rail had withheld it. The rail cause is exercised in
  // `apps/canopy/src/renderPublic.test.ts`; this one covers attribution, and its name now says so.
  const excludedOnly = projectLeaf(
    leafOf("l1", "A. Acker", [
      leaflet("x", "excluded", "public"),
      leaflet("y", "excluded", "public"),
      leaflet("p", "pending", null),
    ]),
  );
  assert.equal(excludedOnly.state, "nothing-publishable");
  assert.equal("listed" in excludedOnly, false, "an empty arm carries no field a zero could come from");

  const pendingOffered = projectLeaf(leafOf("l1", "A. Acker", [leaflet("a", "pending", "public")]));
  assert.equal(pendingOffered.state, "listed");

  // And a mix: one excluded artifact does not suppress the person's own work beside it.
  const mixed = projectLeaf(
    leafOf("l1", "A. Acker", [leaflet("x", "excluded", "public"), leaflet("a", "pending", "public")]),
  );
  assert.deepEqual(
    listedOf(mixed).map((l) => l.id),
    [leafletId("a")],
  );
});

// ---------------------------------------------------------------------------------------------
// 4. COUNTS ONLY, AND NEVER ACROSS PEOPLE.
// ---------------------------------------------------------------------------------------------

test("publicCanopySize reports trees and people — no leaflet total, no ratio", () => {
  const canopy = projectCanopy({
    trees: [
      {
        id: treeId("t1"),
        company: "Foliage",
        leaves: [
          leafOf("l1", "A", [leaflet("a", "verified", "public"), leaflet("b", "verified", "public")]),
          leafOf("l2", "B", [leaflet("c", "verified", "public")]),
        ],
      },
      { id: treeId("t2"), company: "Newly Incorporated", leaves: [] },
    ],
  });
  const size = publicCanopySize(canopy) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(size).sort(), ["people", "trees"]);
  // Two trees, two people — and no third figure. The three public leaflets those two people
  // hold between them are NOT summed anywhere: that sum is a company scoreboard.
  assert.deepEqual(size, { trees: 2, people: 2 });
  for (const v of Object.values(size)) assert.ok(Number.isInteger(v));
});

test("a listed set carries the tier PER ARTIFACT and no tally of tiers", () => {
  // Dropping the tier gate makes this the live risk: listed sets now have real contents on real
  // data, so a per-person "3 verified, 9 pending" is one field away. Per artifact the tier is a
  // fact the reader needs; per person, summed, it ranks two people by how checkable their trade
  // is — a welder's leaf would read as 0/12 forever. The only figure derivable from a listing
  // stays `listed.length`, the person's own tally of what they chose to publish.
  const p = projectLeaf(
    leafOf("l1", "A. Acker", [
      leaflet("a", "verified", "public"),
      leaflet("b", "pending", "public"),
      leaflet("c", "pending", "public"),
      leaflet("d", "excluded", "public"),
      leaflet("e", "pending", "unlisted"),
    ]),
  );
  assert.deepEqual(
    listedOf(p).map((l) => l.tier),
    ["verified", "pending", "pending"],
  );
  const numbers = derivableNumbers(p);
  assert.deepEqual(
    numbers.filter((n) => n !== 3),
    [],
    `the only figure derivable from a listing must be its length, got ${numbers.join(", ")}`,
  );
});

test("the module exports nothing that sums, rates, ranks or scores", async () => {
  const mod = await import("./publicProjection.ts");
  const forbidden = /total|sum|score|rank|rating|ratio|percent|density|coverage|average|top|best/i;
  const offenders = Object.keys(mod).filter((k) => forbidden.test(k));
  assert.deepEqual(offenders, []);
});

test("the roster keeps manifest order — it is never sorted by how much anyone published", () => {
  const tree = projectTree({
    id: treeId("t1"),
    company: "Foliage",
    leaves: [
      leafOf("l1", "Published nothing", []),
      leafOf("l2", "Published three", [
        leaflet("a", "verified", "public"),
        leaflet("b", "verified", "public"),
        leaflet("c", "verified", "public"),
      ]),
      leafOf("l3", "Published one", [leaflet("d", "verified", "public")]),
    ],
  });
  assert.deepEqual(
    tree.people.map((p) => p.subject),
    ["Published nothing", "Published three", "Published one"],
  );
});

// ---------------------------------------------------------------------------------------------
// 5. THE HONEST EMPTY STATE — an empty portfolio is not a missing person.
// ---------------------------------------------------------------------------------------------

test("a person who published nothing is still IN the tree", () => {
  const tree = projectTree({
    id: treeId("t1"),
    company: "Foliage",
    leaves: [leafOf("l1", "Publishes nothing", [leaflet("a", "verified", null)])],
  });
  assert.equal(tree.people.length, 1);
  assert.equal(tree.people[0]?.subject, "Publishes nothing");
  assert.equal(tree.people[0]?.state, "nothing-offered");
});

test("published nothing and no such person are DIFFERENT answers", () => {
  const canopy: Canopy = {
    trees: [
      {
        id: treeId("t1"),
        company: "Foliage",
        leaves: [leafOf("l1", "Publishes nothing", [leaflet("a", "verified", null)])],
      },
    ],
  };
  const projected = projectCanopy(canopy);

  const present = findPublicLeaf(projected, "l1");
  assert.equal(present.found, true);
  if (present.found) {
    assert.equal(present.leaf.state, "nothing-offered");
    assert.equal(present.tree.company, "Foliage");
  }

  const absent = findPublicLeaf(projected, "l-nobody");
  assert.deepEqual({ ...absent }, {
    found: false,
    cause: "no-such-leaf",
    requestedId: "l-nobody",
  });
});

test("an empty canopy and an empty tree are valid, not errors", () => {
  assert.deepEqual(publicCanopySize(projectCanopy({ trees: [] })), { trees: 0, people: 0 });
  const tree = projectTree({ id: treeId("t"), company: "Newly Incorporated", leaves: [] });
  assert.deepEqual(tree.people, []);
});

// ---------------------------------------------------------------------------------------------
// 6. THE LEAFLET ADDRESS — where collapsing the causes is the CORRECT answer.
// ---------------------------------------------------------------------------------------------

test("private, somebody-else's and nonexistent are indistinguishable at the address", () => {
  // Everywhere else in this repository a failure names its cause. Here it must not: a lookup
  // that told them apart would let anyone learn which leaflet ids exist by trying ids.
  //
  // The second id changed with the tier gate. It used to be a public `pending` leaflet, which
  // is now SERVED — the refusals left are "not offered" and "not theirs", and they still have
  // to be one answer.
  const leaf = leafOf("l1", "A. Acker", [
    leaflet("kept-private", "verified", null),
    leaflet("public-but-excluded", "excluded", "public"),
  ]);
  const answers = ["kept-private", "public-but-excluded", "never-existed"].map((id) => ({
    ...findPublicLeaflet(leaf, id),
    requestedId: "<echoed>",
  }));
  assert.deepEqual(answers[0], answers[1]);
  assert.deepEqual(answers[1], answers[2]);
  assert.deepEqual(answers[0], { found: false, cause: "not-reachable", requestedId: "<echoed>" });
});

test("the roster and the address agree — every listed artifact resolves at its own URL", () => {
  // THE DEFECT THIS EXISTS FOR, and the reason both gates had to move together: while
  // `findPublicLeaflet` still applied the tier gate, a listed `pending` artifact would have
  // been named on the person page with a link that answered 404. `apps/leaf` learned the
  // smaller version of this already — "a link that would 404 is worse than no link".
  const leaf = leafOf("l1", "A. Acker", [
    leaflet("a", "pending", "public"),
    leaflet("b", "verified", "public"),
    leaflet("c", "pending", "unlisted"),
    leaflet("d", "excluded", "public"),
    leaflet("e", "pending", null),
  ]);
  for (const l of listedOf(projectLeaf(leaf))) {
    assert.equal(
      findPublicLeaflet(leaf, l.id).found,
      true,
      `${l.id} is listed on the roster and refuses at its own address`,
    );
  }
});

test("a found leaflet carries the subject and leaf it belongs to", () => {
  const leaf = leafOf("l1", "A. Acker", [leaflet("u", "verified", "unlisted", "The shipped gate")]);
  const hit = findPublicLeaflet(leaf, "u");
  assert.equal(hit.found, true);
  if (hit.found) {
    assert.equal(hit.subject, "A. Acker");
    assert.equal(hit.leaf, leafId("l1"));
    assert.equal(hit.leaflet.title, "The shipped gate");
  }
});

// ---------------------------------------------------------------------------------------------
// 7. PURE AND TOTAL.
// ---------------------------------------------------------------------------------------------

test("the projection mutates nothing and is total over every leaf it is given", () => {
  const leaflets = [leaflet("a", "verified", "public"), leaflet("b", "verified", null)];
  const leaf = leafOf("l1", "A. Acker", leaflets);
  const before = JSON.stringify(leaf);
  projectCanopy({ trees: [{ id: treeId("t"), company: "Foliage", leaves: [leaf] }] });
  assert.equal(JSON.stringify(leaf), before);
  assert.equal(leaflets.length, 2);

  // Totality across every shape the domain can hand it, including a leaf with no leaflets.
  for (const l of [leafOf("l", "S", []), leaf]) {
    assert.doesNotThrow(() => projectLeaf(l));
    assert.doesNotThrow(() => findPublicLeaflet(l, ""));
  }
});
