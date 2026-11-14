/**
 * Tests for the knowledge-base READ, against a REAL index built by the REAL retrieval tool.
 *
 * THE VAULT IS NOT MOCKED. Each test that retrieves anything copies `ask.mjs`, `build.mjs` and
 * `lib/` out of `tools/vault`, points a `sources.json` of its own at a temporary directory of
 * real markdown files, and RUNS THE BUILD — so what these tests read is an index the shipping
 * tool produced from files on disk, and `retrieveFromVault` spawns the same program the CLI
 * spawns. The same reasoning as building real git repositories in `gitIntake.test.ts` and
 * encoding real PNGs in `photoSource.test.ts`: do not mock what you can run. It is also the only
 * way to test the thing that actually broke — the graph walk crossing the source scope — because
 * that behaviour lives in the retriever, not here.
 *
 * THE MARKDOWN FILES ARE TEST CONSTRUCTION AND NOTHING ELSE. They are a few sentences written to
 * pin one decision each: a link that crosses a source boundary, a page long enough to be
 * truncated, a page nobody can open. They are not anybody's notes, no claim drafted from them
 * means anything about anyone, and NOT ONE BYTE of the real knowledge base this feature was
 * built against appears in this repository — which is the point of the whole lane.
 *
 * THE MODEL TESTS USE A STUB TRANSPORT ON LOOPBACK — a `node:http` server returning a chosen
 * body. It is a TRANSPORT double, not a model, and none of its answers are presented as something
 * a model said. What they pin is that a decline survives as a decline, that every failure mode is
 * a separate named cause, and that the bytes this code actually puts on the wire carry a fully
 * nullable schema and an explicit output ceiling. Two of them replay an answer the REAL
 * gemma4:12b produced on this machine, and each says so at the point it is used; the real model
 * path itself is exercised by hand through the CLI, and that run is the only evidence of what the
 * model does.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmodSync } from "node:fs";
import { cp, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  brainNotesToCandidates,
  partitionRetrieved,
  type SelectedNode,
} from "@foliage/photosynthesis";

import {
  VAULT_BUILD_COMMAND,
  confirmPages,
  draftLeaflets,
  readPages,
  relativePageId,
  retrieveFromVault,
  vaultSourceOf,
  type PageText,
} from "./brainSource.ts";

const exec = promisify(execFile);

/** The shipping retrieval tool. Copied from, never written to — another lane owns it. */
const REAL_VAULT_DIR = fileURLToPath(new URL("../../../tools/vault/", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix = "foliage-brain-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

interface BuiltVault {
  /** Pass as `vaultDir`; holds ask.mjs, build.mjs, lib/ and the built .vault/index.jsonl. */
  readonly dir: string;
  /** Absolute path of one source's root, by source name, so a test can name a file's path. */
  readonly roots: Readonly<Record<string, string>>;
}

/**
 * Write real markdown, then build a real index over it with the real tool.
 *
 * `pages` is keyed `"<source>/<relative path>.md"`. The build is a subprocess, exactly as the
 * product's own build is, and its failure is surfaced with the tool's own output rather than as
 * an assertion about a file that never appeared.
 */
async function buildVault(pages: Readonly<Record<string, string>>): Promise<BuiltVault> {
  const dir = await tempDir("foliage-vault-");
  for (const entry of ["ask.mjs", "build.mjs", "lib"]) {
    await cp(join(REAL_VAULT_DIR, entry), join(dir, entry), { recursive: true });
  }

  const notesRoot = join(dir, "notes-root");
  const roots: Record<string, string> = {};
  for (const [key, body] of Object.entries(pages)) {
    const cut = key.indexOf("/");
    const source = key.slice(0, cut);
    const rel = key.slice(cut + 1);
    roots[source] = join(notesRoot, source);
    const file = join(notesRoot, source, rel);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, body, "utf8");
  }

  await writeFile(
    join(dir, "sources.json"),
    JSON.stringify({
      sources: Object.entries(roots).map(([name, root]) => ({ name, root })),
    }),
    "utf8",
  );

  try {
    await exec(process.execPath, [join(dir, "build.mjs")], { timeout: 120_000 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`the real vault build failed, so nothing below could be measured: ${detail}`);
  }
  return { dir, roots: Object.freeze(roots) };
}

function okRetrieval(result: Awaited<ReturnType<typeof retrieveFromVault>>) {
  assert.equal(result.ok, true, "expected the built vault to answer");
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/* ------------------------------------------------------------------------- the ids ----- */

test("the two halves of a retrieval id are split at the same colon, and agree", () => {
  // Both read `nodeId` in tools/vault/lib/vault.mjs — `<source>:<relative path>` — so they are
  // asserted together: a change that moved one and not the other would fail here rather than
  // silently classify a page under the wrong source.
  assert.equal(vaultSourceOf("brain:people/dana-whitfield"), "brain");
  assert.equal(relativePageId("brain:people/dana-whitfield"), "people/dana-whitfield");
  assert.equal(vaultSourceOf("brain:specs/_archive/thing"), "brain");
  assert.equal(relativePageId("brain:specs/_archive/thing"), "specs/_archive/thing");
  // An id with no source in it must not accidentally satisfy a scope: the empty string it
  // returns matches nothing the operator can have asked for.
  assert.equal(vaultSourceOf("SOUL"), "");
  assert.equal(relativePageId("SOUL"), "SOUL");
});

/* ----------------------------------------------------------------------- retrieval ----- */

test("an unbuilt vault is a NAMED cause with its remedy, never an empty result", async () => {
  // THE FAILURE THIS WHOLE MODULE EXISTS TO PREVENT. "The vault has not been built" and "nothing
  // in it answers this" would otherwise print the same zero — the `commitCount: 0` collapse.
  const dir = await tempDir();
  const result = await retrieveFromVault("anything at all", { vaultDir: dir });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "no-index");
  assert.match(result.detail, /index\.jsonl/);
  assert.match(result.detail, new RegExp(VAULT_BUILD_COMMAND.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&")));
  assert.match(result.detail, /opposite facts/);
});

test("an index with no retriever beside it is a DIFFERENT cause from no index at all", async () => {
  // Two remedies: build the index, versus point --vault somewhere that has the tool. A single
  // "retrieval failed" would leave the operator guessing which.
  const dir = await tempDir();
  await mkdir(join(dir, ".vault"), { recursive: true });
  await writeFile(join(dir, ".vault", "index.jsonl"), "", "utf8");

  const result = await retrieveFromVault("anything at all", { vaultDir: dir });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "retriever-missing");
  assert.match(result.detail, /ask\.mjs/);
});

test("a real index, really built, answers with openable paths and states its own cost", async () => {
  const vault = await buildVault({
    "notes/projects/billing-migration.md":
      "# Billing migration\n\nMoved invoicing off the legacy processor over one quarter.\n",
    "notes/projects/search-reindex.md":
      "# Search reindex\n\nRebuilt the search index nightly instead of hourly.\n",
  });

  const result = okRetrieval(
    await retrieveFromVault("billing migration legacy processor", {
      vaultDir: vault.dir,
      sources: "notes",
    }),
  );

  assert.ok(result.nodes.length >= 1, "the page that says it must be selected");
  const first = result.nodes[0]!;
  assert.equal(first.id, "notes:projects/billing-migration");
  assert.equal(first.relPath, "projects/billing-migration");
  // THE REF IS AN ABSOLUTE PATH ON THIS MACHINE, and it is the real file the build walked.
  assert.equal(first.path, join(vault.roots["notes"]!, "projects", "billing-migration.md"));
  assert.ok(result.matched >= 1, "the ranking must report how many entries matched");
  assert.ok(result.packTokensEst > 0);
  assert.ok(result.wholeVaultTokensEst >= result.packTokensEst);
  assert.equal(result.indexPath, join(vault.dir, ".vault", "index.jsonl"));
});

test("a question nothing matches selects nothing, and that is NOT a failure", async () => {
  const vault = await buildVault({
    "notes/projects/billing-migration.md": "# Billing migration\n\nMoved invoicing off legacy.\n",
  });

  const result = okRetrieval(
    await retrieveFromVault("zyzzyva quixotic bandersnatch", {
      vaultDir: vault.dir,
      sources: "notes",
    }),
  );

  assert.deepEqual(result.nodes, []);
  assert.deepEqual(result.outOfScope, []);
  assert.equal(result.matched, 0, "zero entries matched is the measurement, not an error");
});

test("MEASURED: the walk crosses --source, so the scope is re-applied here and named", async () => {
  // THE REAL DEFECT, reproduced. On the real index this feature was built against,
  // `ask.mjs "…" --source brain --max 4` returned four pages and TWO were `memory:` — reached at
  // depth 1 and 2 by following links out of a `brain:` seed. The retriever scopes when it SCORES
  // and its graph walk does not, which is a fine choice for a question-answering pack and the
  // wrong one for evidence. Here the same shape is built from scratch: one in-scope page linking
  // to a page in another source.
  const vault = await buildVault({
    "notes/projects/billing-migration.md":
      "# Billing migration\n\nMoved invoicing off the legacy processor.\nSee [[vendor-thread]].\n",
    "scratch/vendor-thread.md":
      "# vendor-thread\n\nA scratch page in a different source, about the billing migration.\n",
  });

  const scoped = okRetrieval(
    await retrieveFromVault("billing migration legacy processor", {
      vaultDir: vault.dir,
      sources: "notes",
    }),
  );

  assert.deepEqual(
    scoped.outOfScope.map((n) => n.id),
    ["scratch:vendor-thread"],
    "the walk must have crossed the scope — if it stopped, this test is no longer testing it",
  );
  assert.equal(scoped.outOfScope[0]!.source, "scratch");
  assert.equal(scoped.outOfScope[0]!.path, join(vault.roots["scratch"]!, "vendor-thread.md"));
  // REMOVED, not drafted from. A page the operator did not scope to is not evidence they asked
  // for — and the third-party directory convention is a property of one source only, so a page
  // from another would come back "unclassified" when the truth is the convention does not
  // describe it at all.
  assert.equal(
    scoped.nodes.some((n) => n.id === "scratch:vendor-thread"),
    false,
  );

  // And widening the scope includes it, with nothing removed: the operator decides.
  const widened = okRetrieval(
    await retrieveFromVault("billing migration legacy processor", {
      vaultDir: vault.dir,
      sources: "notes,scratch",
    }),
  );
  assert.deepEqual(widened.outOfScope, []);
  assert.equal(
    widened.nodes.some((n) => n.id === "scratch:vendor-thread"),
    true,
  );
});

test("with no scope asked for, nothing is out of scope — the field cannot mean anything", async () => {
  const vault = await buildVault({
    "notes/projects/billing-migration.md":
      "# Billing migration\n\nMoved invoicing off legacy.\nSee [[vendor-thread]].\n",
    "scratch/vendor-thread.md": "# vendor-thread\n\nAbout the billing migration.\n",
  });

  const result = okRetrieval(
    await retrieveFromVault("billing migration legacy processor", { vaultDir: vault.dir }),
  );
  assert.deepEqual(result.outOfScope, []);
});

test("a retriever that does not print JSON is unparseable, not an empty retrieval", async () => {
  // A stub PROGRAM, standing in for the retriever's transport. What it pins is that prose where
  // JSON was demanded fails with a cause instead of being read as "nothing matched".
  const dir = await tempDir();
  await mkdir(join(dir, ".vault"), { recursive: true });
  await writeFile(join(dir, ".vault", "index.jsonl"), "", "utf8");
  await writeFile(join(dir, "ask.mjs"), `console.log("Sure! Here are your notes.");\n`, "utf8");

  const result = await retrieveFromVault("anything", { vaultDir: dir });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "unparseable-retrieval");
  assert.match(result.detail, /did not print JSON/);
});

test("a selection naming a relative path is refused — a ref has to open from anywhere", async () => {
  const dir = await tempDir();
  await mkdir(join(dir, ".vault"), { recursive: true });
  await writeFile(join(dir, ".vault", "index.jsonl"), "", "utf8");
  await writeFile(
    join(dir, "ask.mjs"),
    `console.log(JSON.stringify({ selected: [{ id: "notes:a", path: "notes/a.md" }] }));\n`,
    "utf8",
  );

  const result = await retrieveFromVault("anything", { vaultDir: dir });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "unparseable-retrieval");
  assert.match(result.detail, /relative path/);
});

test("a retriever that exits non-zero is a failure with its own output quoted", async () => {
  const dir = await tempDir();
  await mkdir(join(dir, ".vault"), { recursive: true });
  await writeFile(join(dir, ".vault", "index.jsonl"), "", "utf8");
  await writeFile(
    join(dir, "ask.mjs"),
    `console.error("the index is a different shape than this build expects");\nprocess.exit(3);\n`,
    "utf8",
  );

  const result = await retrieveFromVault("anything", { vaultDir: dir });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.cause, "retriever-failed");
  assert.match(result.detail, /different shape/, "the tool's own words, not a guess about them");
  assert.match(result.detail, /nothing was written/i);
});

/* ------------------------------------------------------------------- presence ---------- */

/** Confirm, and fail the test loudly if a page this suite just wrote is not there. */
async function confirmed(nodes: readonly SelectedNode[]) {
  const presence = await confirmPages(nodes);
  assert.equal(presence.ok, true, "every page these tests write must confirm");
  if (!presence.ok) throw new Error("unreachable");
  return presence.pages;
}

test("REGRESSION: a page in the index that is no longer on disk stops the command", async () => {
  // THE DEFECT THIS CLOSES, reproduced with real files. The retrieval ranks INDEX ENTRIES and
  // opens nothing — that is the property that makes this source auditable — so an index built
  // before a page was deleted still selects it. Without this step the deterministic mode never
  // touched the disk at all: the evidence ref and the observedAt were copied straight out of the
  // index, and a reviewer was handed a citation that resolves to nothing, stamped with a moment
  // somebody supposedly observed it.
  const vault = await buildVault({
    "notes/projects/billing-migration.md":
      "# Billing migration\n\nMoved invoicing off the legacy processor.\n",
    "notes/projects/search-reindex.md":
      "# Search reindex\n\nRebuilt the search index nightly, part of the billing migration work.\n",
  });
  const retrieval = okRetrieval(
    await retrieveFromVault("billing migration legacy processor reindex", {
      vaultDir: vault.dir,
      sources: "notes",
      maxNodes: 10,
    }),
  );
  assert.ok(retrieval.nodes.length >= 2, "both pages must be selected for this to prove anything");

  const deleted = join(vault.roots["notes"]!, "projects", "search-reindex.md");
  await rm(deleted);
  // The INDEX still lists it — that is the whole point, and asserting it keeps this test honest
  // if the retriever ever starts checking the disk itself.
  const stale = okRetrieval(
    await retrieveFromVault("billing migration legacy processor reindex", {
      vaultDir: vault.dir,
      sources: "notes",
      maxNodes: 10,
    }),
  );
  assert.ok(stale.nodes.some((n) => n.path === deleted), "the stale index must still select it");

  const presence = await confirmPages(stale.nodes);
  assert.equal(presence.ok, false);
  if (presence.ok) return;
  assert.equal(presence.cause, "unresolved-page");
  assert.deepEqual(
    presence.unresolved.map((u) => u.node.path),
    [deleted],
  );
  assert.equal(presence.unresolved[0]!.cause, "no-such-file");
  assert.match(presence.unresolved[0]!.detail, /index/);
  // The pages that DID resolve are counted, and none of them is handed back: a partial answer
  // here would be a quieter harvest than the retrieval just reported.
  assert.equal(presence.confirmed, stale.nodes.length - 1);
});

test("a confirmed page carries the instant its OWN stat returned, and nothing was opened", async () => {
  const vault = await buildVault({
    "notes/projects/billing-migration.md":
      "# Billing migration\n\nMoved invoicing off the legacy processor.\n",
  });
  const retrieval = okRetrieval(
    await retrieveFromVault("billing migration legacy processor", {
      vaultDir: vault.dir,
      sources: "notes",
    }),
  );
  // A SELECTION IS NOT AN OBSERVATION, and the types say so: what the retriever hands back has no
  // instant on it, because nothing had looked at the disk when it was built.
  assert.equal("observedAt" in retrieval.nodes[0]!, false);

  const before = Date.now();
  const presence = await confirmPages(retrieval.nodes);
  const after = Date.now();
  assert.equal(presence.ok, true);
  if (!presence.ok) return;
  const page = presence.pages[0]!;
  assert.equal(page.path, retrieval.nodes[0]!.path);
  const at = Date.parse(page.observedAt);
  assert.ok(
    at >= before && at <= after,
    "the instant must be the one this check happened at, not one copied from the index",
  );
  assert.match(page.observedAt, /Z$|[+-]\d{2}:\d{2}$/, "an instant carries its offset");
});

test("a path that resolves to something that is not a file is its own cause", async () => {
  // Distinct from "no such file" because the remedies differ: here the index and the disk
  // disagree about what kind of thing lives at that path, and there is no page to open either
  // way — so it must not become an evidence ref a reviewer is invited to follow.
  const dir = await tempDir();
  const asDirectory = join(dir, "projects", "not-a-page.md");
  await mkdir(asDirectory, { recursive: true });

  const presence = await confirmPages([
    { id: "notes:projects/not-a-page", path: asDirectory, relPath: "projects/not-a-page" },
  ]);
  assert.equal(presence.ok, false);
  if (presence.ok) return;
  assert.equal(presence.unresolved[0]!.cause, "not-a-file");
  assert.equal(presence.confirmed, 0);
});

/* ----------------------------------------------------------------------- reading ------- */

test("every selected page is read, and an over-long one says what the model did not see", async () => {
  // 12,000 characters is the cap. A claim drafted from the part the model saw is still cited to
  // the WHOLE page, so the operator reviewing it is entitled to know the rest was not shown.
  const vault = await buildVault({
    "notes/projects/short.md": "# Short\n\nOne paragraph.\n",
    "notes/projects/long.md": `# Long\n\n${"the same sentence again. ".repeat(700)}`,
  });
  const retrieval = okRetrieval(
    await retrieveFromVault("short long paragraph sentence", {
      vaultDir: vault.dir,
      sources: "notes",
      maxNodes: 10,
    }),
  );

  const read = await readPages(await confirmed(retrieval.nodes));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.pages.length, retrieval.nodes.length);

  const long = read.pages.find((p) => p.node.relPath === "projects/long");
  assert.ok(long, "the long page must have been retrieved for this test to mean anything");
  assert.equal(long.text.length, 12_000);
  assert.ok(long.truncatedFrom !== null && long.truncatedFrom > 12_000);

  const short = read.pages.find((p) => p.node.relPath === "projects/short");
  assert.ok(short);
  assert.equal(short.truncatedFrom, null, "a page that fit was not truncated and must not say so");
});

test("one unreadable page stops the whole read and names the file", async () => {
  // ALL OR NOTHING. Drafting from the rest would hand the model a body of work with a hole in it
  // and then report a pack the model never saw.
  const vault = await buildVault({
    "notes/projects/readable.md": "# Readable\n\nA page about the billing migration.\n",
    "notes/projects/locked.md": "# Locked\n\nA page about the billing migration.\n",
  });
  const locked = join(vault.roots["notes"]!, "projects", "locked.md");
  chmodSync(locked, 0o000);

  // Only meaningful where the machine actually enforces the mode — as root, or on a filesystem
  // that ignores it, this state does not exist and asserting it could not fail.
  let enforced = false;
  try {
    const handle = await open(locked, "r");
    await handle.close();
  } catch {
    enforced = true;
  }
  if (!enforced) {
    process.stdout.write("SKIPPED: this machine let the test read a 0o000 file.\n");
    return;
  }

  const retrieval = okRetrieval(
    await retrieveFromVault("billing migration page", {
      vaultDir: vault.dir,
      sources: "notes",
      maxNodes: 10,
    }),
  );
  // AND IT CONFIRMS FIRST. A 0o000 file still `stat`s — presence and readability are different
  // facts, and this is the case that separates them: the page is THERE, and the machine will not
  // let this process read it.
  const read = await readPages(await confirmed(retrieval.nodes));
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.cause, "unreadable-page");
  assert.equal(read.path, locked);
  assert.match(read.detail, /Nothing was drafted/);
});

/* ---------------------------------------------------------------------- drafting ------- */

/** A loopback HTTP stub. It doubles the TRANSPORT; nothing it returns is a model's answer. */
async function stub(
  handler: (body: string) => { status: number; body: string },
): Promise<{ endpoint: string; server: Server; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push(body);
      const answer = handler(body);
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { endpoint: `http://127.0.0.1:${port}/api/generate`, server, seen };
}

/** One page to send. Built by hand: what these tests exercise is the wire, not the disk. */
const onePage: readonly PageText[] = Object.freeze([
  Object.freeze({
    node: Object.freeze({
      id: "notes:projects/billing-migration",
      path: "/tmp/notes/projects/billing-migration.md",
      relPath: "projects/billing-migration",
      // A hand-built instant, like the path beside it: these tests exercise the WIRE, and what
      // goes on it does not depend on either. The tests above are where a real page is really
      // stat'ed and the instant is really measured.
      observedAt: "2026-08-18T00:00:00Z",
    }),
    text: "# Billing migration\n\nMoved invoicing off the legacy processor.\n",
    truncatedFrom: null,
  }),
]);

function answered(leaflets: unknown, extra: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ leaflets }), ...extra }),
  };
}

test("a non-loopback endpoint is refused before a single byte is sent", async () => {
  // A personal knowledge base is the last thing that should leave a machine by accident, so the
  // check is on the PARSED hostname rather than on the constant in the source.
  const outcome = await draftLeaflets(onePage, {
    endpoint: "https://api.example.com/v1/generate",
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.cause, "not-loopback");
  assert.match(outcome.detail, /loopback only/);

  // And a string that is not a URL at all cannot be checked, so it is refused too.
  const nonsense = await draftLeaflets(onePage, { endpoint: "not a url" });
  assert.equal(nonsense.ok, false);
  if (nonsense.ok) return;
  assert.equal(nonsense.cause, "not-loopback");
});

test("A 307 FROM THE ENDPOINT IS REFUSED, and the pages go nowhere", async () => {
  // THE REPRODUCED DEFECT, on this call site. Checking the hostname and then calling `fetch` was
  // not enough: a 307 preserves method and body, so an endpoint on the trusted port could name any
  // host and undici would carry the prompt — which on this path is the text of somebody's private
  // notes — there. Two real servers, because the thing that leaked was undici's redirect
  // behaviour and no test that stubbed fetch could see it.
  let stolen: string | null = null;
  const thief = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      stolen = body;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => thief.listen(0, "127.0.0.1", resolve));
  const thiefAddress = thief.address();
  const thiefPort = typeof thiefAddress === "object" && thiefAddress !== null ? thiefAddress.port : 0;

  const model = createServer((_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${thiefPort}/api/generate` });
    res.end();
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const modelAddress = model.address();
  const modelPort = typeof modelAddress === "object" && modelAddress !== null ? modelAddress.port : 0;

  try {
    const outcome = await draftLeaflets(onePage, {
      endpoint: `http://127.0.0.1:${modelPort}/api/generate`,
      timeoutMs: 20_000,
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(stolen, null, "THE SECOND HOST RECEIVED THE PAGES — the hole is open");
    // Its own cause. Told "unreachable", the operator restarts a model that is answering fine.
    assert.equal(outcome.cause, "redirected");
    assert.match(outcome.detail, /307/, "the status must be named");
    assert.match(outcome.detail, new RegExp(`${thiefPort}`), "and the location it refused");
    assert.match(outcome.detail, /nothing was written/i);
  } finally {
    thief.close();
    model.close();
  }
});

test("an empty selection makes NO request — it is not a model failure", async () => {
  const { endpoint, server, seen } = await stub(() => answered(null));
  try {
    const outcome = await draftLeaflets([], { endpoint });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.cause, "no-pages");
    assert.equal(seen.length, 0, "nothing may go on the wire when there is nothing to draft from");
  } finally {
    server.close();
  }
});

test("an unreachable model fails closed, with BOTH causes named", async () => {
  // Port 1 on loopback: nothing listens, and the refusal arrives wrapped in a generic
  // "fetch failed" that says nothing on its own.
  const outcome = await draftLeaflets(onePage, {
    endpoint: "http://127.0.0.1:1/api/generate",
    timeoutMs: 10_000,
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.cause, "unreachable");
  assert.match(outcome.detail, /cause:/);
  assert.match(outcome.detail, /nothing was written/i);
  assert.match(outcome.detail, /no deterministic titles were substituted/);
});

test("a model that is LISTENING but slow is timed-out — a different cause from unreachable", async () => {
  // The remedies are opposite: start the server, versus give a busy machine more time. This
  // matters more on this path than on the other two — measured, the same request took 33s, 63s
  // and 105s on one machine — so a ceiling reached must never read as a dead port. The server
  // below accepts the connection and deliberately never answers, so "unreachable" would be false
  // about a socket this test is holding open.
  const held: import("node:net").Socket[] = [];
  const server = createServer((req) => {
    held.push(req.socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  try {
    const outcome = await draftLeaflets(onePage, {
      endpoint: `http://127.0.0.1:${port}/api/generate`,
      timeoutMs: 750,
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.cause, "timed-out");
    assert.match(outcome.detail, /750ms/, "the ceiling that was hit must be named");
    assert.match(outcome.detail, /NOT a refused connection/);
  } finally {
    for (const socket of held) socket.destroy();
    server.close();
  }
});

test("the request on the wire asks for a FULLY NULLABLE schema and states its own ceiling", async () => {
  // THE HAZARD, PINNED AT THE WIRE. ollama's `format` is grammar-enforced, so a required
  // non-nullable field whose answer is not in the pages can only be satisfied by inventing one.
  // And `num_predict` is sent EXPLICITLY because the server's unstated default cut a response
  // mid-string at 128 tokens on the photograph path. This asserts the bytes, not the intent.
  const { endpoint, server, seen } = await stub(() => answered(null));
  try {
    await draftLeaflets(onePage, { endpoint, timeoutMs: 20_000 });
    const sent = JSON.parse(seen[0] ?? "{}") as {
      format?: {
        properties?: { leaflets?: { type?: unknown; items?: { properties?: Record<string, { type?: unknown }> } } };
      };
      options?: { num_predict?: unknown };
      stream?: unknown;
      prompt?: string;
    };
    assert.deepEqual(sent.format?.properties?.leaflets?.type, ["array", "null"]);
    const item = sent.format?.properties?.leaflets?.items?.properties ?? {};
    assert.deepEqual(item["title"]?.type, ["string", "null"]);
    assert.deepEqual(item["citedPaths"]?.type, ["array", "null"]);
    assert.equal(typeof sent.options?.num_predict, "number");
    assert.equal(sent.stream, false);
    // There is no field in that schema a rating could live in, and the PROMPT says so too.
    assert.match(sent.prompt ?? "", /no ratings/);
    // The page's own path is what the model is told to copy, so the domain's grounding check can
    // tell a copied citation from an invented one.
    assert.match(sent.prompt ?? "", /\/tmp\/notes\/projects\/billing-migration\.md/);
  } finally {
    server.close();
  }
});

test("leaflets: null is the model DECLINING, which is the outcome the schema exists to allow", async () => {
  const { endpoint, server } = await stub(() => answered(null));
  try {
    const outcome = await draftLeaflets(onePage, { endpoint, timeoutMs: 20_000 });
    // NOT a failure. An honest "the pages do not say what this person did" has to be
    // representable, or a grammar that cannot decline will make the model invent an answer.
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.drafts, []);
    assert.equal(outcome.sentChars, onePage[0]!.text.length);
  } finally {
    server.close();
  }
});

test('MEASURED: an entry whose title is the word "null" is an absence, not a leaflet', async () => {
  // Not hypothetical. Asked for a list it could have left null, the real gemma4:12b returned
  // exactly `[{"title":"null","citedPaths":null}]` on a run over three pages of real notes —
  // declining INSIDE a container it could have declined by leaving empty. A grammar that permits
  // null does not oblige a model to reach for it. Carried through, that becomes a leaflet titled
  // "null" in somebody's portfolio.
  const { endpoint, server } = await stub(() =>
    answered([
      { title: "null", citedPaths: null },
      { title: "  ", citedPaths: null },
      { title: "N/A", citedPaths: null },
    ]),
  );
  try {
    const outcome = await draftLeaflets(onePage, { endpoint, timeoutMs: 20_000 });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(
      outcome.drafts.map((d) => d.title),
      [null, null, null],
    );
    // The entries themselves are NOT dropped: the domain refuses each with `empty-draft` and
    // reports it, so three declines are visible as three declines rather than as silence.
    assert.equal(outcome.drafts.length, 3);
  } finally {
    server.close();
  }
});

test("a whole title containing the word none is still a real answer", async () => {
  const { endpoint, server } = await stub(() =>
    answered([{ title: "Migrated billing with none of the downtime budgeted", citedPaths: [] }]),
  );
  try {
    const outcome = await draftLeaflets(onePage, { endpoint, timeoutMs: 20_000 });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.drafts[0]!.title, "Migrated billing with none of the downtime budgeted");
  } finally {
    server.close();
  }
});

test("an answer cut off at the output ceiling is its OWN cause and fails closed", async () => {
  // A list cut at the token ceiling is missing leaflets, and afterwards it looks exactly like a
  // model that found less to say. Read from the server's `done_reason`, never guessed from text —
  // and it fails even though the JSON below happens to be complete, because the fact that the
  // generation was truncated is what makes the list untrustworthy.
  const { endpoint, server } = await stub(() =>
    answered([{ title: "Migrated billing off the legacy processor", citedPaths: [] }], {
      done_reason: "length",
    }),
  );
  try {
    const outcome = await draftLeaflets(onePage, { endpoint, timeoutMs: 20_000 });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.cause, "cut-off");
    assert.match(outcome.detail, /done_reason "length"/);
    assert.match(outcome.detail, /Nothing was drafted/);
  } finally {
    server.close();
  }
});

test("a non-200 and prose-where-a-schema-was-demanded are distinct named causes", async () => {
  const refused = await stub(() => ({ status: 500, body: "model exploded" }));
  try {
    const outcome = await draftLeaflets(onePage, {
      endpoint: refused.endpoint,
      timeoutMs: 20_000,
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.cause, "http-error");
  } finally {
    refused.server.close();
  }

  const prose = await stub(() => ({
    status: 200,
    body: JSON.stringify({ response: "Sure! Here are some lovely portfolio entries." }),
  }));
  try {
    const outcome = await draftLeaflets(onePage, { endpoint: prose.endpoint, timeoutMs: 20_000 });
    // NOT salvaged into a title. An answer outside the schema is a named failure.
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.cause, "unparseable");
  } finally {
    prose.server.close();
  }

  const wrongShape = await stub(() => answered("a string, not a list"));
  try {
    const outcome = await draftLeaflets(onePage, {
      endpoint: wrongShape.endpoint,
      timeoutMs: 20_000,
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.cause, "unparseable");
  } finally {
    wrongShape.server.close();
  }
});

test("a citation that is not a string is carried through as null, never dropped", async () => {
  // Dropping it here would hide a citation from the check that exists to catch invented ones.
  // It arrives in the domain as a null, which is not a citation and is not counted as one.
  const { endpoint, server } = await stub(() =>
    answered([
      {
        title: "Migrated billing off the legacy processor",
        citedPaths: ["/tmp/notes/projects/billing-migration.md", 7, null],
      },
    ]),
  );
  try {
    const outcome = await draftLeaflets(onePage, { endpoint, timeoutMs: 20_000 });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.drafts[0]!.citedPaths, [
      "/tmp/notes/projects/billing-migration.md",
      null,
      null,
    ]);
  } finally {
    server.close();
  }
});

/* -------------------------------------------------------------------------- seam ------- */

test("a real retrieval feeds the domain unchanged, and the real page path is the ref", async () => {
  const vault = await buildVault({
    "notes/projects/billing-migration.md":
      "# Billing migration\n\nMoved invoicing off the legacy processor.\n",
  });
  const retrieval = okRetrieval(
    await retrieveFromVault("billing migration legacy processor", {
      vaultDir: vault.dir,
      sources: "notes",
    }),
  );
  const { offered, withheld } = partitionRetrieved(await confirmed(retrieval.nodes), false);

  const built = brainNotesToCandidates({
    offered,
    withheld,
    drafts: null,
    shown: null,
    draftedAt: "2026-08-18T00:00:00Z",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.candidates.length, offered.length);
  assert.equal(
    built.candidates[0]!.evidence[0]!.ref,
    join(vault.roots["notes"]!, "projects", "billing-migration.md"),
    "the ref is the file the build actually walked, so a reviewer can open it",
  );
  // AND ITS observedAt IS THE ONE THE PRESENCE CHECK PRODUCED, not the drafting run's — so the
  // field says what actually happened: at this instant, this path resolved to a file.
  assert.equal(built.candidates[0]!.evidence[0]!.observedAt, offered[0]!.observedAt);
  assert.notEqual(built.candidates[0]!.evidence[0]!.observedAt, "2026-08-18T00:00:00Z");
});

test("MEASURED: the near-miss path this model really produced is refused whole", async () => {
  // THE FABRICATION VECTOR, replayed from a real run. Shown two real pages, gemma4:12b cited
  // `…/specs/<page>.md` for a page whose real path is `…/specs/_archive/<page>.md` — ONE
  // DIRECTORY SEGMENT DROPPED, the rest character-perfect. (The page is a real one on the machine
  // this was measured on and is not named here; nothing from a real knowledge base belongs in
  // this repo. The shape of the miss is the part that matters and it is reproduced exactly.)
  // It is not a wild invention and it is not a typo a human would catch by eye; it is a plausible
  // path that resolves to nothing, which is exactly why the check has to be an exact match
  // against the set the model was given rather than anything fuzzier. The real run refused it and
  // named the path; this replays that shape over a vault built here, so the rule is pinned
  // without a model in the loop.
  const vault = await buildVault({
    "notes/specs/_archive/self-evidence-pipeline.md":
      "# Self evidence pipeline\n\nBuilt the pipeline that verifies commit references.\n",
  });
  const retrieval = okRetrieval(
    await retrieveFromVault("self evidence pipeline commit references", {
      vaultDir: vault.dir,
      sources: "notes",
    }),
  );
  const offered = await confirmed(retrieval.nodes);
  const real = offered[0]!.path;
  const nearMiss = real.replace("/_archive/", "/");
  assert.notEqual(nearMiss, real, "the two paths must differ or this test proves nothing");

  const built = brainNotesToCandidates({
    offered,
    withheld: [],
    drafts: [
      {
        drafter: "local-model:gemma4:12b",
        title: "Developed a system for portfolio evidence and verification of accomplishments.",
        citedPaths: [nearMiss],
      },
    ],
    shown: offered.map((node) => ({ node, charsShown: 96, charsInPage: 96 })),
    draftedAt: "2026-08-18T00:00:00Z",
  });

  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(built.candidates, [], "nothing about this claim may be written");
  assert.equal(built.refusals.length, 1);
  assert.equal(built.refusals[0]!.cause, "cited-a-source-it-was-not-given");
  assert.match(built.refusals[0]!.reason, /refused WHOLE/);
  // The offending path is quoted back, so the operator can see what the model made up.
  assert.ok(built.refusals[0]!.reason.includes(nearMiss));
});
