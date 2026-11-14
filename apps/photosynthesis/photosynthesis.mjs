#!/usr/bin/env node
/**
 * photosynthesis — raw activity in, reviewable career-evidence candidates out.
 *
 *   node apps/photosynthesis/photosynthesis.mjs \
 *     --repo <path> --subject "<name>" --identity <email> \
 *     [--photos <dir>] [--out <harvest path>] [--no-model] [--force]
 *
 * The nature analogy is literal: GATHER captures light (git history, README, photos —
 * deterministic, zero network), SYNTHESIZE turns it into sugar (candidate leaflets,
 * drafted by a LOOPBACK model or by counting), and nothing becomes part of the leaf
 * until a human reviews it (`review-server.mjs`) and promotion carries the approved
 * candidates across as PENDING leaflets.
 *
 * Exit codes: 0 wrote a harvest · 1 a gather/write failure · 2 usage error.
 */

/* eslint-disable no-console */
// BEFORE the first .ts import: below the floor, linking a .ts module dies with a raw loader
// stack — this line is the last chance to say something human. See apps/leaf/src/nodeFloor.mjs,
// the same shared, dependency-free preflight apps/leaf/server.mjs, intake.mjs and harvest.mjs
// already use. This REPLACES an inline `major < 22 || major >= 25` check that read only the
// major version and so passed on 22.6–22.17, where unflagged type-stripping does not exist yet
// and every real entry point below dies at module LINK time regardless of this file's own guard.
//
// this app's tsconfig rootDir is its own directory, and apps/photosynthesis does not declare a
// dependency on apps/leaf as a package (only on the @foliage/leaf domain package, a different
// thing), so tsc flags this cross-app file path as outside rootDir (TS6059) even though node
// resolves and runs it correctly. Reaching into apps/leaf's tsconfig to fix that is outside this
// lane's ownership; the directive below is scoped to this one import.
// @ts-ignore TS6059 — apps/leaf/src/nodeFloor.mjs is outside this app's tsconfig rootDir; node
// resolves and runs this import correctly, only tsc's rootDir check objects to it.
const { requireNodeFloor } = await import("../leaf/src/nodeFloor.mjs");
requireNodeFloor();
const { withDocumentLocks, writeDocument } = await import("@foliage/leaf/local-files");

const { parseArgs } = await import("node:util");
const { readFile } = await import("node:fs/promises");
const { existsSync } = await import("node:fs");
const { resolve } = await import("node:path");
const { gather } = await import("./src/gather.ts");
const { draftDeterministic, draftWithLocalModel, draftFromPhoto, DEFAULT_MODEL } = await import("./src/drafter.ts");
const { parseHarvestDocument, HARVEST_SCHEMA_VERSION } = await import("./src/harvestDocument.ts");

const USAGE = `usage:
  node apps/photosynthesis/photosynthesis.mjs --repo <path> --subject "<name>" --identity <email> [options]

  --repo <path>       repository to gather from
  --subject "<name>"  the person this evidence belongs to
  --identity <email>  email to attribute commits against
  --photos <dir>      optional directory of screenshots (analyzed by the LOCAL vision model)
  --out <path>        where to write the harvest (default: apps/photosynthesis/leaf.harvest.json)
  --no-model          skip ollama; deterministic drafting only
  --force             overwrite an existing harvest`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      repo: { type: "string" },
      subject: { type: "string" },
      identity: { type: "string" },
      photos: { type: "string" },
      out: { type: "string" },
      "no-model": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  }));
} catch (err) {
  console.error(`photosynthesis: ${err instanceof Error ? err.message : err}\n\n${USAGE}`);
  process.exit(2);
}

const missing = [];
if (!values.repo?.trim()) missing.push("--repo");
if (!values.subject?.trim()) missing.push("--subject");
if (!values.identity?.trim()) missing.push("--identity");
if (missing.length > 0) {
  console.error(`photosynthesis: missing required argument(s): ${missing.join(", ")}\n\n${USAGE}`);
  process.exit(2);
}

const out = resolve(values.out ?? new URL("./leaf.harvest.json", import.meta.url).pathname);
const repo = resolve((values.repo ?? "").trim());

console.log(`photosynthesis: gathering from ${repo} (identity ${(values.identity ?? "").trim()})`);
const gathered = await gather({
  repo,
  identity: (values.identity ?? "").trim(),
  ...(values.photos ? { photosDir: resolve(values.photos) } : {}),
});

// Every source reports success or its cause — never a silent zero.
if (gathered.git.ok) {
  console.log(`photosynthesis: git — ${gathered.git.data.total} commits in ${gathered.git.data.clusters.length} clusters`);
  // A PARTIAL READ SAYS SO — the same line intake.mjs prints. One dead branch narrows the walk to
  // HEAD rather than emptying the queue; narrowing without saying so would tell somebody they
  // have less work than they have.
  if (gathered.git.data.narrowedBecause !== null) {
    console.log(
      `photosynthesis: read HEAD only — a local branch could not be read, so work that exists only\n` +
        `photosynthesis:   on a branch is NOT in this harvest. git said: ${gathered.git.data.narrowedBecause}`,
    );
  }
} else {
  console.log(`photosynthesis: git UNAVAILABLE — ${gathered.git.cause}`);
}
console.log(
  gathered.readme.ok
    ? `photosynthesis: readme — ${gathered.readme.data.headings.length} headings`
    : `photosynthesis: readme unavailable — ${gathered.readme.cause}`,
);
if (gathered.photos !== undefined) {
  console.log(
    gathered.photos.ok
      ? `photosynthesis: photos — ${gathered.photos.data.length} file(s)`
      : `photosynthesis: photos unavailable — ${gathered.photos.cause}`,
  );
}
if (gathered.git.ok && gathered.git.data.total === 0) {
  console.log(
    `photosynthesis: no commits matched that identity — the harvest will be empty, which is ` +
      `an honest result, not a failure. Authors actually present in this repo:\n` +
      gathered.git.data.observedAuthors.slice(0, 10).map((a) => `    ${a.email} (${a.count})`).join("\n"),
  );
}

let result;
if (values["no-model"]) {
  result = draftDeterministic(gathered);
  console.log(`photosynthesis: drafting WITHOUT a model (--no-model): ${result.candidates.length} candidate(s)`);
} else {
  console.log(`photosynthesis: drafting with LOCAL model ${DEFAULT_MODEL} (loopback; budget is up to 3 minutes per call, and a cold model loads first)…`);
  result = await draftWithLocalModel(gathered);
  if (result.fallbackCause !== undefined) {
    console.log(`photosynthesis: model path failed (${result.fallbackCause}) — fell back to deterministic drafting`);
  }
  console.log(
    `photosynthesis: ${result.candidates.length} candidate(s), method ${result.provenance.method}` +
      (result.provenance.model ? ` (${result.provenance.model})` : ""),
  );
  for (const d of result.dropped) console.log(`photosynthesis: grounding gate dropped: ${d}`);
}

const candidates = [...result.candidates];
if (gathered.photos?.ok && !values["no-model"]) {
  for (const photo of gathered.photos.data) {
    const drafted = await draftFromPhoto(photo);
    if (drafted.candidate !== undefined) {
      candidates.push(drafted.candidate);
      console.log(`photosynthesis: photo candidate from ${photo.path}`);
    } else {
      console.log(`photosynthesis: photo ${photo.path} produced NO candidate — ${drafted.cause}`);
    }
  }
}

/*
 * MERGE, do not clobber. Found by adversarial review: this CLI used to build the harvest
 * wholly fresh and overwrite, so the only supported way to re-run (--force) silently
 * discarded every human decision — while drafter.ts promised content-derived ids exist
 * precisely "so review decisions survive re-harvesting" and harvestDocument.ts promised a
 * rejected candidate "is never re-proposed, so a re-run cannot nag". Both claims were
 * documented and neither was implemented.
 *
 * Candidate ids are content-derived, so the same work re-drafts to the same id: carrying
 * status/reviewedAt/promotedAt forward by id is all that is needed. A candidate the model
 * no longer proposes is KEPT if it was decided (the decision is a record of what the human
 * did, and dropping it would resurrect it on the next run) and dropped if it was untouched.
 */
await withDocumentLocks([out], async () => {
const prior = new Map();
  try {
    const parsedPrior = parseHarvestDocument(JSON.parse(await readFile(out, "utf8")));
    if (parsedPrior.ok) {
      for (const c of parsedPrior.harvest.candidates) if (c.status !== "proposed") prior.set(c.id, c);
    } else {
      throw new Error(`existing harvest at ${out} is invalid — prior bytes preserved`);
    }
  } catch (err) {
    if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) {
      throw new Error(`photosynthesis: could not read the existing harvest; prior bytes preserved: ${err instanceof Error ? err.message : err}`);
    }
  }

const merged = candidates.map((c) => {
  const decided = prior.get(c.id);
  if (decided === undefined) return c;
  // The human's decision wins over the fresh draft; the freshly-drafted prose is
  // discarded for that id so an approved candidate cannot silently change wording
  // after it was approved.
  return decided;
});
const carriedOver = [...prior.values()].filter((c) => !merged.some((m) => m.id === c.id));
if (prior.size > 0) {
  console.log(
    `photosynthesis: carried forward ${prior.size} prior decision(s)` +
      (carriedOver.length > 0 ? `, ${carriedOver.length} of which the model no longer proposes (kept as a record)` : ""),
  );
}

const harvest = {
  schemaVersion: HARVEST_SCHEMA_VERSION,
  subject: (values.subject ?? "").trim(),
  identity: (values.identity ?? "").trim(),
  sources: [repo, ...(values.photos ? [resolve(values.photos)] : [])],
  gatheredAt: new Date().toISOString(),
  candidates: [...merged, ...carriedOver],
};

// The document is validated through the SAME parser the review server uses, before
// it is written — this producer cannot emit a file its own consumer rejects.
const check = parseHarvestDocument(harvest);
if (!check.ok) {
  console.error(`photosynthesis: refused to write an invalid harvest:`);
  for (const i of check.issues) console.error(`  ${i.at}: ${i.message}`);
  process.exit(1);
}

if (existsSync(out) && !values.force) {
  console.error(`photosynthesis: ${out} already exists and was NOT overwritten. Re-run with --force.`);
  process.exit(1);
}
writeDocument(out, JSON.stringify(harvest, null, 2) + "\n", values.force === true);
console.log(`photosynthesis: wrote legacy standalone harvest at ${out}`);
console.log("photosynthesis: for the current garden queue, use node foliage.mjs grow and decide at /review in node foliage.mjs up");
console.log(`photosynthesis: to review only this legacy document, set FOLIAGE_HARVEST=${out} and FOLIAGE_LEAF=<your leaf.json>, then run node apps/photosynthesis/review-server.mjs`);

});
