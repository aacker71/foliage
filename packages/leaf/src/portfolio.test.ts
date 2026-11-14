/** Actual temporary Git intake supplies evidence. All authored words below explicitly
 * describe the persistence/citation protocol; none are a seeded portfolio or career claim. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { parseLeafDocument } from "./document.ts";
import { readCommits } from "./gitSource.ts";
import { commitsToLeaflets, type ObservedCommit } from "./intake.ts";
import { ACHIEVEMENT_CLAIM_KINDS, PORTFOLIO_LIMITS, type AchievementClaim, type ClaimCitation,
  type Leaf, type Leaflet } from "./leaf.ts";
import { mergeIntakeIntoLeaf } from "./merge.ts";
import { resolveClaimCitation, resolveClaimCitations, resolveLeafCollection } from "./portfolio.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../..", import.meta.url));
const owner = "portfolio-owner@protocol.invalid", other = "portfolio-other@protocol.invalid", subject = "Portfolio persistence protocol";
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
let directory: string, repo: string, leaf: Leaf, owned: readonly Leaflet[], excluded: Leaflet;
let observed: readonly ObservedCommit[];

function parsed(value: unknown): Leaf {
  const result = parseLeafDocument(value);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result.issues));
  return result.leaf;
}
function derive(identity = owner, at = new Date().toISOString()): readonly Leaflet[] {
  const result = commitsToLeaflets({ commits: observed, identities: [identity], observedAt: at });
  assert.ok(result.ok);
  return result.leaflets;
}
function citation(record = owned[0]!): ClaimCitation {
  assert.ok(record.provenance);
  return { leaflet: record.id, provenance: record.provenance };
}
function authored(base = leaf): Leaf {
  const available = base.leaflets.filter(record => record.tier !== "excluded");
  assert.ok(available[0] && available[1]);
  return parsed({ ...base,
    profile: { bio: "Protocol author account: I maintain this temporary test document.",
      direction: "Exercise preservation across actual local collection.", passions: ["Exact reference handling", "Explicit owner choices"] },
    achievements: [
      { id: "keystone-protocol", title: "Owner-selected persistence protocol", claims: [
        { id: "contribution", kind: "contribution", text: "Protocol account: I selected a retained temporary Git artifact.", citations: [citation(available[0])] },
        { id: "outcome", kind: "outcome", text: "Protocol account without attached support; it is not an established outcome.", citations: [] },
      ] },
      { id: "second-protocol", title: "Second owner-selected protocol", claims: [
        { id: "contribution", kind: "summary", text: "Protocol account: this second record is selected for the round-trip check.", citations: [citation(available[1])] },
      ] },
    ],
    collections: [{ id: "role-protocol", title: "Role scope protocol", kind: "role", description: "A named view for the persistence protocol.",
      achievements: ["second-protocol", "keystone-protocol"], leaflets: [available[1].id, available[0].id] }],
  });
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "foliage-authored-portfolio-"));
  repo = join(directory, "source"); await mkdir(repo);
  await exec("git", ["-C", repo, "init", "--initial-branch=main"], { env });
  for (const [index, [title, email]] of [
    ["feat: create portfolio protocol artifact", owner], ["feat: retain portfolio protocol artifact", owner],
    ["fix: inspect portfolio protocol artifact", owner], ["fix: inspect foreign protocol artifact", other],
  ].entries()) {
    const file = `protocol-${index}.txt`; await writeFile(join(repo, file), `${title}\n`);
    await exec("git", ["-C", repo, "add", file], { env });
    await exec("git", ["-C", repo, "-c", `user.name=${subject}`, "-c", `user.email=${email}`,
      "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-m", title!], { env });
  }
  const read = await readCommits(repo); assert.ok(read.ok); observed = read.commits;
  leaf = parsed({ id: "authored-portfolio-protocol", subject, leaflets: derive() });
  owned = leaf.leaflets.filter(record => record.tier !== "excluded");
  const foreign = leaf.leaflets.find(record => record.tier === "excluded"); assert.ok(foreign); excluded = foreign;
  assert.equal(owned.length, 3);
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("old documents gain no authored content; explicit empty values survive a round trip", () => {
  const old = parsed(JSON.parse(JSON.stringify(leaf)));
  for (const key of ["profile", "achievements", "collections"]) assert.equal(key in old, false);
  assert.equal(resolveLeafCollection(old, "missing"), null);
  const clear = parsed({ ...leaf, profile: {}, achievements: [], collections: [] });
  assert.deepEqual(parsed(JSON.parse(JSON.stringify(clear))), clear);
  assert.deepEqual(clear.profile, {});
  const titleFirst = parsed({ ...leaf, achievements: [{ id: "title-first", title: "Title-first authoring protocol", claims: [] }] });
  assert.deepEqual(titleFirst.achievements![0]!.claims, []);
});

test("authored profile, keystone order, exact claims and named collections are portable and detached", () => {
  const input = JSON.parse(JSON.stringify(authored()));
  const result = parsed(input);
  assert.deepEqual(parsed(JSON.parse(JSON.stringify(result))), result);
  assert.deepEqual(result.leaflets, leaf.leaflets, "authoring does not alter evidence or tier");
  assert.equal(result.achievements![0]!.id, "keystone-protocol");
  for (const value of [result.profile, result.profile!.passions, result.achievements, result.achievements![0],
    result.achievements![0]!.claims, result.achievements![0]!.claims[0], result.achievements![0]!.claims[0]!.citations,
    result.achievements![0]!.claims[0]!.citations![0], result.collections, result.collections![0], result.collections![0]!.leaflets]) assert.ok(Object.isFrozen(value));
  input.achievements.reverse(); input.profile.passions.push("caller mutation"); input.collections[0].leaflets.reverse();
  assert.equal(result.achievements![0]!.id, "keystone-protocol");
  assert.equal(result.profile!.passions!.length, 2);
  assert.equal(result.collections![0]!.leaflets[0], owned[1]!.id);
});

test("citation availability distinguishes exact retained, changed, missing and excluded references", () => {
  const document = authored(), claim = document.achievements![0]!.claims[0]!, saved = claim.citations![0]!;
  const before = JSON.stringify(document);
  assert.equal(resolveClaimCitations(document, claim)[0]!.status, "current");
  for (const provenance of [
    { ...saved.provenance, source: "different-source-protocol" },
    { ...saved.provenance, ref: "missing-reference-protocol" },
    { ...saved.provenance, observedAt: "2001-01-01T00:00:00Z" },
  ]) assert.equal(resolveClaimCitation(document, { ...saved, provenance }).status, "stale");
  assert.equal(resolveClaimCitation({ ...document, leaflets: document.leaflets.filter(record => record.id !== saved.leaflet) }, saved).status, "missing");
  const foreign = resolveClaimCitation(document, citation(excluded));
  assert.equal(foreign.status, "excluded"); assert.ok(foreign.status === "excluded"); assert.equal(foreign.reason, excluded.tier === "excluded" ? excluded.reason : "");
  assert.equal(JSON.stringify(document), before);
  assert.ok(document.leaflets.every(record => record.tier !== "verified"), "a current citation did not create verified attribution");
});

test("a retained body reference resolves without borrowing the same ref from another record", () => {
  const first = owned[0]!, second = owned[1]!;
  assert.ok(second.provenance);
  const bodyCitation = { leaflet: first.id, provenance: second.provenance };
  assert.equal(resolveClaimCitation(leaf, bodyCitation).status, "stale");
  const withBody = parsed({ ...leaf, leaflets: leaf.leaflets.map(record => record.id === first.id
    ? { ...record, body: [{ text: second.title, provenance: second.provenance }] } : record) });
  assert.equal(resolveClaimCitation(withBody, bodyCitation).status, "current");
});

test("claim kind never establishes an outcome and absent support remains absent", () => {
  for (const kind of ACHIEVEMENT_CLAIM_KINDS) {
    const document = parsed({ ...leaf, achievements: [{ id: "kind-protocol", title: "Claim-kind protocol", claims: [
      { id: "unsupported", kind, text: "Protocol account with no evidence attached." },
      { id: "empty-support", kind, text: "Protocol account with explicitly empty support.", citations: [] },
    ] }] });
    const [absent, empty] = document.achievements![0]!.claims;
    assert.equal("citations" in absent!, false); assert.deepEqual(empty!.citations, []);
    assert.deepEqual(resolveClaimCitations(document, absent!), []);
    assert.deepEqual(resolveClaimCitations(document, empty!), []);
    assert.deepEqual(document.leaflets, leaf.leaflets);
  }
});

test("named collections preserve owner order and unavailable members without substitutes", () => {
  const document = authored();
  const scoped = parsed({ ...document, collections: [{ ...document.collections![0],
    achievements: ["missing-achievement", "second-protocol", "keystone-protocol"],
    leaflets: ["missing-record", excluded.id, owned[1]!.id, owned[0]!.id],
  }] });
  const resolved = resolveLeafCollection(scoped, "role-protocol"); assert.ok(resolved);
  assert.deepEqual(resolved.achievements.map(item => item.id), ["second-protocol", "keystone-protocol"]);
  assert.deepEqual(resolved.unavailableAchievements, ["missing-achievement"]);
  assert.deepEqual(resolved.leaflets.map(item => item.id), [owned[1]!.id, owned[0]!.id]);
  assert.deepEqual(resolved.unavailableLeaflets.map(item => [item.id, item.status]), [["missing-record", "missing"], [excluded.id, "excluded"]]);
  assert.deepEqual(scoped.collections![0]!.leaflets, ["missing-record", excluded.id, owned[1]!.id, owned[0]!.id]);
  assert.deepEqual(parsed(JSON.parse(JSON.stringify(scoped))), scoped);
});

test("unknown and score-shaped fields are refused at every new nesting level", () => {
  const base = authored(), achievement = base.achievements![0]!, claim = achievement.claims[0]!, ref = claim.citations![0]!, collection = base.collections![0]!;
  const inputs: [unknown, string][] = [
    [{ ...base, profile: { ...base.profile, score: 1 } }, "profile.score"],
    [{ ...base, achievements: [{ ...achievement, rating: 1 }] }, "achievements[0].rating"],
    [{ ...base, achievements: [{ ...achievement, claims: [{ ...claim, confidence: 1 }] }] }, "achievements[0].claims[0].confidence"],
    [{ ...base, achievements: [{ ...achievement, claims: [{ ...claim, citations: [{ ...ref, score: 1 }] }] }] }, "achievements[0].claims[0].citations[0].score"],
    [{ ...base, achievements: [{ ...achievement, claims: [{ ...claim, citations: [{ ...ref, provenance: { ...ref.provenance, score: 1 } }] }] }] }, "achievements[0].claims[0].citations[0].provenance.score"],
    [{ ...base, collections: [{ ...collection, rank: 1 }] }, "collections[0].rank"],
    [{ ...base, collections: [{ ...collection, visibility: "public" }] }, "collections[0].visibility"],
  ];
  for (const [input, at] of inputs) {
    const result = parseLeafDocument(input); assert.ok(!result.ok);
    assert.ok(result.issues.some(issue => issue.at === at), `missing exact refusal at ${at}`);
  }
});

test("authored ratings, malformed references, duplicate identities and oversized inputs are refused", () => {
  const base = authored(), achievement = base.achievements![0]!, claim = achievement.claims[0]!, ref = claim.citations![0]!, collection = base.collections![0]!;
  const claimDoc = (over: Record<string, unknown>) => ({ ...base, achievements: [{ ...achievement, claims: [{ ...claim, ...over }] }] });
  const invalid: unknown[] = [
    ...[null, undefined, [], "profile"].map(profile => ({ ...base, profile })),
    { ...base, profile: { bio: "Top 10% of engineers" } },
    { ...base, profile: { direction: "Rated 4.9/5" } },
    { ...base, profile: { passions: ["Top 10%"] } },
    { ...base, profile: { passions: [" same ", "same"] } },
    { ...base, profile: { bio: "x".repeat(PORTFOLIO_LIMITS.bio + 1) } },
    { ...base, profile: { passions: Array.from({ length: PORTFOLIO_LIMITS.passions + 1 }, (_, index) => `protocol-${index}`) } },
    { ...base, achievements: [{ ...achievement, title: "Rated 4.9/5" }] },
    { ...base, achievements: [{ ...achievement, title: "two\nlines" }] },
    { ...base, achievements: [{ ...achievement, id: "invalid/id" }] },
    { ...base, achievements: [achievement, achievement] },
    { ...base, achievements: Array.from({ length: PORTFOLIO_LIMITS.achievements + 1 }, (_, index) => ({ ...achievement, id: `protocol-${index}` })) },
    { ...base, achievements: [{ ...achievement, claims: [claim, claim] }] },
    { ...base, achievements: [{ ...achievement, claims: Array.from({ length: PORTFOLIO_LIMITS.claims + 1 }, (_, index) => ({ ...claim, id: `protocol-${index}` })) }] },
    claimDoc({ text: "Top 10% of engineers" }), claimDoc({ text: "x".repeat(PORTFOLIO_LIMITS.claimText + 1) }),
    claimDoc({ kind: "verified" }), claimDoc({ id: "" }), claimDoc({ citations: null }),
    claimDoc({ citations: [ref, ref] }), claimDoc({ citations: [{ ...ref, provenance: { ...ref.provenance, observedAt: "2026-01-01" } }] }),
    claimDoc({ citations: [{ ...ref, provenance: null }] }), claimDoc({ citations: [{ ...ref, leaflet: " " }] }),
    { ...base, collections: [collection, collection] },
    { ...base, collections: [{ ...collection, kind: "score" }] },
    { ...base, collections: [{ ...collection, title: "Top 10%" }] },
    { ...base, collections: [{ ...collection, achievements: [achievement.id, achievement.id] }] },
    { ...base, collections: [{ ...collection, leaflets: [owned[0]!.id, owned[0]!.id] }] },
    { ...base, collections: [{ ...collection, leaflets: Array.from({ length: PORTFOLIO_LIMITS.collectionLeaflets + 1 }, (_, index) => `protocol-${index}`) }] },
    { ...base, collections: [{ ...collection, description: "x".repeat(PORTFOLIO_LIMITS.collectionDescription + 1) }] },
  ];
  for (const input of invalid) {
    const result = parseLeafDocument(input); assert.equal(result.ok, false, `invalid portfolio protocol input accepted: ${JSON.stringify(input).slice(0, 180)}`);
  }
});

test("refresh, reattribution and removal preserve authored words and make changed support explicit", () => {
  const document = authored(), claim = document.achievements![0]!.claims[0]!;
  const cited = claim.citations![0]!.leaflet;
  for (const [derived, unDerived, expected] of [
    // A re-read alone is not a change, so the citation stays current (QA 2026-10-02 #11).
    [derive(owner, "2002-02-02T02:02:02Z"), "retain", "current"],
    // A cited record that really re-derives differently takes the new observation: stale.
    [derive(owner, "2002-02-02T02:02:02Z").map(record => record.id === cited ? { ...record, title: `${record.title} (re-derived)` } : record), "retain", "stale"],
    [derive(other), "retain", "excluded"],
    [[], "discard", "missing"],
  ] as const) {
    const result = mergeIntakeIntoLeaf({ existing: { state: "present", leaf: document }, derived,
      incomingId: document.id, incomingSubject: document.subject, unDerived });
    assert.ok(result.ok);
    assert.deepEqual(result.leaf.profile, document.profile);
    assert.deepEqual(result.leaf.achievements, document.achievements);
    assert.deepEqual(result.leaf.collections, document.collections);
    assert.equal(resolveClaimCitations(result.leaf, claim)[0]!.status, expected);
    assert.deepEqual(parsed(JSON.parse(JSON.stringify(result.leaf))), result.leaf);
  }
});

test("actual intake and harvest promotion writers preserve the authored document", { timeout: 45_000 }, async () => {
  const leafPath = join(directory, "writer-leaf.json"), harvestPath = join(directory, "writer-harvest.json");
  const cli = (...args: string[]) => exec(process.execPath, args, { cwd: root, env, timeout: 15_000 });
  const read = async () => parsed(JSON.parse(await readFile(leafPath, "utf8")));
  const intake = (force = false) => cli("apps/leaf/intake.mjs", "--repo", repo, "--identity", owner, "--subject", subject, "--out", leafPath, ...(force ? ["--force"] : []));
  await intake();
  const collected = await read();
  assert.equal("profile" in collected, false); assert.equal("achievements" in collected, false); assert.equal("collections" in collected, false);
  const document = authored(collected); await writeFile(leafPath, JSON.stringify(document));
  const assertAuthored = (result: Leaf) => {
    assert.deepEqual(result.profile, document.profile); assert.deepEqual(result.achievements, document.achievements); assert.deepEqual(result.collections, document.collections);
    assert.ok(result.leaflets.every(record => record.visibility === undefined || record.visibility === "private"));
  };
  await intake(true); assertAuthored(await read());
  await cli("apps/leaf/harvest.mjs", "propose", "--repo", repo, "--identity", owner, "--out", harvestPath, "--into", leafPath);
  const harvest = JSON.parse(await readFile(harvestPath, "utf8")) as { candidates: { id: string }[] };
  assert.ok(harvest.candidates[0], "real collected protocol commits must produce a candidate for the promotion seam");
  await cli("apps/leaf/harvest.mjs", "approve", harvest.candidates[0].id, "--by", subject, "--doc", harvestPath);
  await cli("apps/leaf/harvest.mjs", "promote", "--doc", harvestPath, "--into", leafPath, "--force");
  const promoted = await read(); assertAuthored(promoted);
  assert.ok(promoted.leaflets.some(record => record.id === harvest.candidates[0]!.id));
});
