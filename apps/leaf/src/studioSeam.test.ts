/**
 * THE STUDIO, END TO END — real HTTP against the real server process, over REAL documents: not
 * `apps/leaf/leaf.json` itself (the owner's own, deliberately gitignored so no fake data ever
 * stands in for it — a fresh clone has no such file, CI included), but the same shape of document,
 * produced the same way the owner produces it: by running `intake.mjs` / `harvest.mjs propose`
 * over a real repository's real git history. Here that repository is this one — every CI
 * checkout already carries its full history (`fetch-depth: 0`, `.github/workflows/ci.yml`) — so
 * the seam is self-sufficient without a fixture and without the owner's machine. Same discipline
 * as `seam.test.ts`'s own header: an isolated render test can pass while the assembled product is
 * wrong, because nothing in it starts the server or compares against a file nobody invented for
 * the test.
 *
 * WHAT THIS FILE CHECKS THAT `studio.test.ts` CANNOT: that GET on each of the five new routes
 * (`/`, `/garden`, `/policy`, `/publish`, plus `/leaf` — moved off `/`) actually answers 200 from
 * the real running server; that the studio nav is present on those five PLUS `/review` and absent
 * on `/leaflet/<id>` and `/my/leaflet/<id>`, over real HTTP responses rather than a function
 * return value; and that Overview's displayed counts equal a SEPARATE, independent recomputation
 * over the same two real files — the same "counted twice, compared" discipline `seam.test.ts`'s
 * SEAM 1 already uses for the leaf page.
 */

import assert from "node:assert/strict";
import { testRepository } from "../../../tools/development/testRepository.mjs";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { get as httpGet } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { attributionLedger, parseLeafDocument } from "@foliage/leaf";
import { parseHarvestDocument, reviewSubjectDigest } from "@foliage/photosynthesis";
import { renderCompoundPage } from "./compoundPage.ts";
import { loadLeafDocument } from "./leafDocument.ts";
import { esc, ownerLeafletHref } from "./render.ts";

const exec = promisify(execFile);
const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const INTAKE_CLI = fileURLToPath(new URL("../intake.mjs", import.meta.url));
const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
/** This repository's own root — the real history every real command below reads. */
const REPO = testRepository();

let tmpRoot: string;
let LEAF_JSON: string;
let HARVEST_JSON: string;
let POLICY_JSON: string;

/**
 * Produce leaf.json / harvest.json ONCE for the whole file, by spawning the REAL producers over
 * THIS repository's own commits — nothing here is written by hand. The identity is read out of
 * the history at run time, exactly as `apps/canopy/src/seam.test.ts`'s `realIdentities` does: a
 * hardcoded address would rot, and worse, one that matched nobody would quietly produce an
 * all-excluded document that still passed every assertion below.
 *
 * `policy.json` is deliberately left unwritten: `policyDocument.ts` treats an absent file as the
 * shipped default, which is the true, honest state of a fresh checkout — writing one here would
 * be inventing a policy nobody set.
 */
before(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "foliage-studioseam-"));
  LEAF_JSON = join(tmpRoot, "leaf.json");
  HARVEST_JSON = join(tmpRoot, "harvest.json");
  POLICY_JSON = join(tmpRoot, "policy.json");

  const { stdout } = await exec("git", ["-C", REPO, "log", "--no-merges", "--format=%ae"]);
  // The author with the most commits, not the newest: one recent commit by someone else must not
  // turn the whole fixture into a three-record portfolio.
  const authors = new Map<string, number>();
  for (const author of stdout.split("\n").map((s) => s.trim()).filter(Boolean)) authors.set(author, (authors.get(author) ?? 0) + 1);
  const identity = [...authors].sort((a, b) => b[1] - a[1])[0]?.[0];
  assert.ok(identity !== undefined, "this repository has no commit authors, so nothing real can be read");

  await exec(process.execPath, [
    INTAKE_CLI,
    "--repo",
    REPO,
    "--subject",
    "CI Seam",
    "--identity",
    identity,
    "--out",
    LEAF_JSON,
  ]);
  await exec(process.execPath, [HARVEST_CLI, "propose", "--repo", REPO, "--identity", identity, "--out", HARVEST_JSON]);
});

after(async () => {
  if (tmpRoot !== undefined) await rm(tmpRoot, { recursive: true, force: true });
});

const BOOT_DEADLINE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 4_000;

/** Same probe-then-close technique `seam.test.ts` uses — see its own comment on the race. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (addr === null || typeof addr === "string") {
        probe.close(() => reject(new Error("no port from the OS")));
        return;
      }
      const { port } = addr;
      probe.close(() => resolve(port));
    });
  });
}

interface Running {
  readonly origin: string;
  get(path: string): Promise<{ status: number; body: string }>;
}

async function withRealServer(body: (s: Running) => Promise<void>, harvestPath = HARVEST_JSON, leafPath = LEAF_JSON): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    // EXPLICIT PATHS TO THE REAL DOCUMENTS, rather than relying on the default-path/cwd
    // coincidence — this is "the documents your app already loads" named outright, so the test
    // says exactly what it is reading and does not depend on ambient environment or cwd.
    env: {
      ...process.env,
      FOLIAGE_LEAF: leafPath,
      FOLIAGE_HARVEST: harvestPath,
      FOLIAGE_POLICY: POLICY_JSON,
      PORT: String(port),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (b: Buffer) => {
    stderr += b.toString();
  });
  let exited: string | null = null;
  child.on("exit", (code, signal) => {
    exited = `exit code ${String(code)} signal ${String(signal)}`;
  });

  const origin = `http://127.0.0.1:${port}`;
  const get = async (path: string): Promise<{ status: number; body: string }> => {
    const res = await fetch(origin + path, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text() };
  };

  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) {
        throw new Error(`server exited before serving: ${exited}\nstderr:\n${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`server did not answer within ${BOOT_DEADLINE_MS}ms: ${lastError}\nstderr:\n${stderr}`);
      }
      try {
        await get("/policy"); // any real route; confirms both the listener and the policy load
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ origin, get });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

const OWNER_ROUTES: readonly [string, string][] = [
  ["/", "Home"],
  ["/leaf", "Portfolio"],
  ["/review", "Review"],
  ["/garden", "Harvest"],
  ["/policy", "Policy"],
  ["/publish", "Publish"],
  ["/scarlet", "Photosynthesis"],
];

test("every new route (plus /leaf and /review) answers 200 against the REAL on-disk documents", async () => {
  await withRealServer(async ({ get }) => {
    for (const [path] of OWNER_ROUTES) {
      const { status, body } = await get(path);
      assert.equal(status, 200, `GET ${path} — real leaf.json/harvest.json/policy.json — must 200. Body head: ${body.slice(0, 300)}`);
      assert.match(body, /<!doctype html>/i, `GET ${path} must serve an HTML document`);
    }
  });
});

test("publish preview bounds real repository history while keeping every decision reachable", async () => {
  const parsed = parseLeafDocument(JSON.parse(await readFile(LEAF_JSON, "utf8")));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const total = parsed.leaf.leaflets.length;
  assert.ok(total > 40, "the real repository must exercise more than two publish pages");
  const ids = (html: string) => [...html.matchAll(/data-publish-row="([^"]+)"/g)].map((match) => match[1]);
  const allCount = (html: string) => /data-publish-total="all"[\s\S]*?leaf-count">([^<]+)</.exec(html)?.[1];

  await withRealServer(async ({ get }) => {
    const first = await get("/publish");
    const second = await get("/publish?page=2");
    const last = await get("/publish?page=999999");
    const privateRows = await get("/publish?view=private");
    const publicRows = await get("/publish?view=public");
    const linkOnly = await get("/publish?view=unlisted");
    for (const response of [first, second, last, privateRows, publicRows, linkOnly]) assert.equal(response.status, 200);

    assert.equal(allCount(first.body), total.toLocaleString());
    assert.equal(allCount(privateRows.body), total.toLocaleString(), "faceting cannot change the whole-document total");
    assert.equal(ids(first.body).length, 20);
    assert.equal(ids(second.body).length, 20);
    assert.equal(new Set([...ids(first.body), ...ids(second.body)]).size, 40, "pages must not repeat records");
    assert.equal((first.body.match(/<summary>Reason<\/summary>/g) ?? []).length, 20, "every visible decision keeps its reason on demand");
    assert.match(first.body, /rel="next" href="\/publish\?page=2"/);
    assert.match(second.body, /rel="prev" href="\/publish"/);
    const lastPage = Math.ceil(total / 20);
    assert.match(last.body, new RegExp(`Page ${lastPage} of ${lastPage}`), "oversized page requests clamp to the final real page");
    assert.equal(ids(last.body).length, total - (lastPage - 1) * 20);
    assert.equal(ids(privateRows.body).length, 20, "the default-private records remain inspectable through their facet");
    assert.match(privateRows.body, /data-publish-total="private" aria-current="page"/);
    assert.match(privateRows.body, /href="\/my\/leaflet\/[^"<>]+" aria-label="View record: [^"<>]+ \([^)]+\)">View record<\/a>/);
    for (const shared of [publicRows, linkOnly]) {
      assert.equal(ids(shared.body).length, 0, "intake cannot silently share anything");
      assert.match(shared.body, /No leaflets in this view/);
    }
  });
});

test("the studio nav is present, and correctly marks itself active, on all seven owner routes — real server", async () => {
  await withRealServer(async ({ get }) => {
    for (const [path, activeLabel] of OWNER_ROUTES) {
      const { body } = await get(path);
      assert.match(body, /<header class="(?:fol-nav|fol-workspace)"/, `${path}: nav must be present`);
      assert.match(body, /(?:Personal|Private workspace)/, `${path}: plane badge wording`);
      const header = /<header class="(?:fol-nav|fol-workspace)"[\s\S]*?<\/header>/.exec(body)?.[0] ?? "";
      assert.match(header, /<a class="fol-workspace-brand" href="\/">/, `${path}: the wordmark returns Home`);
      if (path === "/" || path === "/leaf" || path === "/review") {
        assert.match(header, new RegExp(`aria-current="page">${activeLabel}<`), path + ": primary route must be active");
      } else {
        assert.match(header, /<summary aria-current="page"[^>]*>More<\/summary>/, path + ": More marks the current tool's location");
        const tools = /<nav aria-label="More tools">([\s\S]*?)<\/nav>/.exec(header)?.[1] ?? "";
        assert.doesNotMatch(tools, /aria-current="page"/, path + ": the current tool is not repeated in More");
      }
    }
  });
});

test("the nav is ABSENT from the public leaflet route and the owner's leaflet instrument — real server", async () => {
  await withRealServer(async ({ get }) => {
    // `intake.mjs` never sets `visibility` — sharing is `share.mjs`'s separate act, exercised in
    // `mediaSeam.test.ts` — so every leaflet this `before` hook just derived resolves to "nothing
    // is shared here": a real, live response, and the exact one a stranger holding a guessed id
    // would receive today. Nav must still be absent from it.
    const leaf = parseLeafDocument(JSON.parse(await readFile(LEAF_JSON, "utf8")));
    assert.equal(leaf.ok, true, "the generated leaf.json must parse — if not, intake.mjs itself broke");
    if (!leaf.ok) return;
    const anyId = leaf.leaf.leaflets[0]?.id;
    assert.ok(anyId !== undefined, "the real leaf must hold at least one leaflet to test against");

    const shared = await get(`/leaflet/${encodeURIComponent(String(anyId))}`);
    assert.doesNotMatch(shared.body, /<header class="(?:fol-nav|fol-workspace)"/, "/leaflet/<id> must never carry the studio nav");

    const owned = await get(`/my/leaflet/${encodeURIComponent(String(anyId))}`);
    assert.equal(owned.status, 200);
    assert.match(owned.body, /<header class="(?:fol-nav|fol-workspace)"/, "/my/leaflet/<id> keeps the private workspace navigation");
  });
});

test("Overview's counts equal an INDEPENDENT recomputation over the same real files", async () => {
  const [leafParsed, harvestParsed] = await Promise.all([
    readFile(LEAF_JSON, "utf8").then((t) => parseLeafDocument(JSON.parse(t))),
    readFile(HARVEST_JSON, "utf8").then((t) => parseHarvestDocument(JSON.parse(t))),
  ]);
  assert.equal(leafParsed.ok, true);
  assert.equal(harvestParsed.ok, true);
  if (!leafParsed.ok || !harvestParsed.ok) return;

  const ledger = attributionLedger(leafParsed.leaf);
  const reviewCounts = { candidate: 0, approved: 0, rejected: 0 };
  for (const c of harvestParsed.harvest.candidates) reviewCounts[c.review.state]++;

  await withRealServer(async ({ get }) => {
    const { body } = await get("/");
    const read = (attr: string): number => {
      const m = new RegExp(`data-overview-stat="${attr}"[\\s\\S]*?fol-metric leaf-count">(\\d+)<`).exec(body);
      assert.ok(m, `Overview must render a stat cell for "${attr}"`);
      return Number(m![1]);
    };
    assert.equal(read("verified"), ledger.verified);
    assert.equal(read("pending"), ledger.pending);
    assert.equal(read("excluded"), ledger.excluded);
    assert.equal(read("candidate"), reviewCounts.candidate);
    assert.equal(read("approved"), reviewCounts.approved);
    assert.equal(read("rejected"), reviewCounts.rejected);
  });
});

// The explorer consumes the same real intake as the readable portfolio. No seeded work.
test("compound explorer preserves every real artifact, private links and publication CSP", async () => {
  const parsed = parseLeafDocument(JSON.parse(await readFile(LEAF_JSON, "utf8")));
  assert.ok(parsed.ok);
  await withRealServer(async ({ origin }) => {
    const response = await fetch(`${origin}/leaf/explore`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.equal((html.match(/data-index=/g) ?? []).length, parsed.leaf.leaflets.length);
    assert.equal((html.match(/<template id="cx-record-/g) ?? []).length, parsed.leaf.leaflets.length);
    for (const record of parsed.leaf.leaflets) {
      assert.ok(html.includes(`data-id="${esc(record.id)}"`));
      assert.ok(html.includes(`href="${ownerLeafletHref(record.id)}"`));
      if (record.tier === "excluded") assert.ok(html.includes(esc(record.reason)));
    }
    const publicResponse = await fetch(`${origin}/leaflet/${encodeURIComponent(parsed.leaf.leaflets[0]!.id)}`);
    assert.doesNotMatch(publicResponse.headers.get("content-security-policy") ?? "", /script-src/);
    assert.doesNotMatch(await publicResponse.text(), /compound-leaf.bundle/);
    assert.equal((await fetch(`${origin}/leaf/explore`, { method: "HEAD" })).status, 200);
    assert.equal((await fetch(`${origin}/leaf/explore`, { method: "POST" })).status, 405);
  });
});

test("compound explorer distinguishes empty from unavailable and escapes untrusted record text", async () => {
  const loaded = await loadLeafDocument({ FOLIAGE_LEAF: LEAF_JSON });
  assert.ok(loaded.ok);
  const empty = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: [] } });
  assert.match(empty, /No records/);
  assert.doesNotMatch(empty, /<template id="cx-record-/);
  const absent = renderCompoundPage({ ok: false, cause: "absent", detail: "File is missing", path: "/missing" });
  assert.match(absent, /collection unavailable/);
  assert.match(absent, /File is missing/);
  assert.doesNotMatch(absent, /0<\/span>/);
  // Adversarial strings are parser/render probes, never presented as real evidence.
  const first = loaded.leaf.leaflets[0]!;
  const hostile = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: [{ ...first, title: '<img src=x onerror="alert(1)">' }] } });
  assert.doesNotMatch(hostile, /<img src=x/);
  assert.match(hostile, /&lt;img src=x/);
});


test("reviewed real Photosynthesis work grows the explorer once and retains every evidence ref", async () => {
  const before = await loadLeafDocument({ FOLIAGE_LEAF: LEAF_JSON });
  assert.ok(before.ok);
  const harvest = parseHarvestDocument(JSON.parse(await readFile(HARVEST_JSON, "utf8")));
  assert.ok(harvest.ok);
  const candidate = harvest.harvest.candidates.find(c => !before.leaf.leaflets.some(l => String(l.id) === String(c.id)));
  assert.ok(candidate, "the real repository intake must contain work not already promoted");
  await withRealServer(async ({ origin, get }) => {
    const post = (path: string, body: URLSearchParams) => fetch(origin + path, {
      method: "POST", headers: { origin }, body, redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const approved = await post("/review", new URLSearchParams({
      id: candidate.id, subjectDigest: reviewSubjectDigest(candidate),
      decision: "approve", by: "CI workflow check", title: candidate.title,
    }));
    assert.equal(approved.status, 303, await approved.text());
    const promoted = await post("/promote", new URLSearchParams());
    assert.equal(promoted.status, 303, await promoted.text());
    const after = await loadLeafDocument({ FOLIAGE_LEAF: LEAF_JSON });
    assert.ok(after.ok);
    assert.equal(after.leaf.leaflets.length, before.leaf.leaflets.length + 1);
    const leaflet = after.leaf.leaflets.find(l => String(l.id) === String(candidate.id));
    assert.ok(leaflet);
    assert.equal(leaflet.tier, "pending");
    assert.equal(leaflet.title, candidate.title);
    assert.deepEqual(leaflet.body?.map(e => e.provenance.ref), candidate.evidence.map(e => e.ref));
    const preview = await get("/leaf/setup/preview");
    assert.equal(preview.status, 200);
    assert.match(preview.body, /Work in your record/);
    assert.doesNotMatch(preview.body, /<h3>No work<\/h3>/);
    assert.match(preview.body, /Retained records/);
    assert.ok(preview.body.includes(`href="${ownerLeafletHref(leaflet.id)}"`), "promoted work opens its private retained record from the preview");
    assert.ok(preview.body.includes(esc(leaflet.title)), "promoted work stays visible before authored achievements exist");
    assert.ok((preview.body.match(/data-retained-record=/g) ?? []).length <= 4, "the preview stays bounded for a large garden");
    assert.match(preview.body, /href="\/leaf\/photosynthesis\?view=records">Browse records<\/a>/);
    const explorer = await get("/leaf/explore");
    assert.equal(explorer.status, 200);
    assert.equal((explorer.body.match(/data-index=/g) ?? []).length, after.leaf.leaflets.length);
    assert.ok(explorer.body.includes(`data-id="${esc(leaflet.id)}"`));
    const context = await get(`/scarlet/workspace?leaflet=${encodeURIComponent(leaflet.id)}`);
    // The AI context admits eight body elements; the complete Leaflet above must retain all.
    for (const evidence of candidate.evidence.slice(0, 8)) assert.ok(context.body.includes(esc(evidence.ref)));
    if (candidate.evidence.length > 8) assert.match(context.body, /Further body elements were omitted/);
    const bytes = await readFile(LEAF_JSON, "utf8");
    assert.equal((await post("/promote", new URLSearchParams())).status, 303);
    assert.equal(await readFile(LEAF_JSON, "utf8"), bytes, "repeated promotion must not duplicate or rewrite the Leaf");
  });
});

test("portfolio import HTTP preview, digest, origin and replay preserve canonical work", async () => {
  const importHarvest = join(tmpRoot,'portfolio-import-harvest.json');
  await withRealServer(async ({origin,get}) => {
    const sourceText = (await readFile(fileURLToPath(import.meta.url),'utf8')).slice(0,3000);
    const leafBefore = await readFile(LEAF_JSON,'utf8');
    const harvestBefore = await readFile(HARVEST_JSON,'utf8');
    const fields = {title:'HTTP regression source',source:'studioSeam.test.ts',text:sourceText,action:'preview'};
    const post = (values:Record<string,string>, requestOrigin=origin) => fetch(origin+'/leaf/import',{method:'POST',headers:{origin:requestOrigin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values),signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
    assert.equal((await get('/leaf/import')).status,200);
    const preview = await post(fields);assert.equal(preview.status,200);
    const html = await preview.text();
    assert.match(html,/Add to private review/);
    assert.equal(await readFile(HARVEST_JSON,'utf8'),harvestBefore);
    const identity = JSON.parse(leafBefore);
    const binding = {leafId:identity.id,subject:identity.subject};
    const digest = html.match(/name="digest" value="([^"]+)"/)?.[1];assert.ok(digest);
    assert.equal((await post({...fields,...binding,action:'import',digest},'https://foreign.invalid')).status,403);
    assert.equal((await post({...fields,...binding,action:'import',digest,text:sourceText+'\n'})).status,409);
    assert.equal(await readFile(HARVEST_JSON,'utf8'),harvestBefore);
    assert.equal((await post({...fields,...binding,subject:'Changed identity',action:'import',digest})).status,409);
    assert.equal(await readFile(LEAF_JSON,'utf8'),leafBefore);
    const imported = await post({...fields,...binding,action:'import',digest});const receipt = await imported.text();assert.equal(imported.status,200,receipt);
    assert.match(receipt,/<h2>Added to review<\/h2>/);
    const harvestAfter = await readFile(importHarvest,'utf8');
    const repeated = await post({...fields,...binding,action:'import',digest});assert.equal(repeated.status,200);
    assert.equal(await readFile(importHarvest,'utf8'),harvestAfter);
    assert.equal(await readFile(HARVEST_JSON,'utf8'),harvestBefore);
    assert.equal(await readFile(LEAF_JSON,'utf8'),leafBefore);
  }, importHarvest);
});

test("connected editor preserves canonical evidence, supports every claim kind, and gates preview framing", async () => {
  await withRealServer(async ({origin,get}) => {
    const before=JSON.parse(await readFile(LEAF_JSON,'utf8'));
    const response=await fetch(origin+'/leaf/setup');assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy')??'',/frame-src 'self'/);
    const shell=await response.text();assert.match(shell,/portfolio-setup\.mjs/);
    assert.match(shell,/id="save-status" role="status"><\/p>/,'loading must not claim the record is saved');
    assert.match(shell,/id="setup-read-actions"[^>]*hidden>[\s\S]*?id="retry-read"/,'failed reads need a retry control outside the editor');
    for(const kind of ['intent','decision','challenge','pivot','discovery','learning']) assert.ok(shell.includes(`value="${kind}"`));
    const state=async()=>{const r=await fetch(origin+'/leaf/setup/state');assert.equal(r.status,200);return await r.json() as ReturnType<typeof import('./portfolioSetup.ts').setupState>;};
    let current=await state();
    const post=async(values:Record<string,string>,requestOrigin=origin)=>fetch(origin+'/leaf/setup',{method:'POST',headers:{origin:requestOrigin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)});
    const record=before.leaflets.find((r:{tier:string})=>r.tier!=='excluded');assert.ok(record);
    const create={action:'achievement',achievement:'',leafId:current.leafId,subject:current.subject,documentRevision:current.documentRevision,title:record.title};
    assert.equal((await post(create,'https://foreign.invalid')).status,403);
    const created=await post(create);assert.equal(created.status,200,await created.text());
    assert.equal((await post(create)).status,409,'stale creation cannot duplicate the account');
    current=await state();const achievement=current.achievements.at(-1);assert.ok(achievement);
    const citation=current.evidence.find((e:{title:string})=>e.title===record.title);assert.ok(citation);
    const claim={action:'claim',leafId:current.leafId,subject:current.subject,documentRevision:current.documentRevision,achievement:achievement.id,claim:'',kind:'summary',text:record.title,citation:citation.key};
    assert.equal((await post(claim)).status,200);
    const after=JSON.parse(await readFile(LEAF_JSON,'utf8'));
    assert.deepEqual(after.leaflets,before.leaflets,'editing an account preserves retained evidence');
    const work=await get('/leaf/photosynthesis?view=saved');assert.equal(work.status,200);
    assert.ok(work.body.includes(esc(record.title)));
    assert.ok(work.body.includes(`/leaf/achievement?id=${encodeURIComponent(achievement.id)}`));
    const absent=await get('/leaf/photosynthesis?q=NO_SUCH_WORK_8b33927');assert.match(absent.body,/No matching work/);
    const preview=await fetch(origin+'/leaf/setup/preview');assert.equal(preview.status,200);
    assert.match(preview.headers.get('content-security-policy')??'',/frame-ancestors 'self'/);
    const reader=await preview.text();assert.ok(reader.includes(esc(record.title)));assert.match(reader,/Private preview/);
    const published=await fetch(origin+'/leaflet/not-present');
    assert.match(published.headers.get('content-security-policy')??'',/frame-ancestors 'none'/,'published documents still refuse framing');
    const source=await fetch(origin+'/leaf/photosynthesis/sources',{redirect:'manual'});assert.equal(source.status,303);assert.equal(source.headers.get('location'),'/workflow#sources');
    const history=await get(`/leaf/presentation?edit=journey-history&achievement=${encodeURIComponent(achievement.id)}`);assert.equal(history.status,200);assert.match(history.body,/<h1>History<\/h1>/);
  });
});

test("new private work routes retain unavailable states and refuse foreign hosts before document reads", async () => {
  await withRealServer(async ({origin,get}) => {
    const work=await get('/leaf/photosynthesis');assert.equal(work.status,200);assert.match(work.body,/class="work-start"/);assert.match(work.body,/Connect a source/);
    assert.doesNotMatch(work.body,/<article class="work-item/);
    const first=await get('/leaf/setup');assert.equal(first.status,200);assert.match(first.body,/Create private record/);
    assert.doesNotMatch(first.body,/fol-workspace-action|Start a private record with your name/);
    assert.doesNotMatch(first.body,/portfolio-setup\.mjs|FOLIAGE_LEAF|missing-work-leaf\.json/);
    const state=await fetch(origin+'/leaf/setup/state');assert.equal(state.status,409);assert.match(state.headers.get('content-type')??'',/application\/json/);
    assert.doesNotMatch(await state.text(),/FOLIAGE_LEAF|missing-work-leaf\.json/);
    const preview=await fetch(origin+'/leaf/setup/preview');assert.equal(preview.status,409);assert.match(preview.headers.get('content-type')??'',/text\/html/);const previewHtml=await preview.text();assert.match(previewHtml,/<h1>Couldn't open this page\.<\/h1>/);assert.doesNotMatch(previewHtml,/Not saved/,'a read that failed is not a save that failed');
    for(const route of ['/leaf/photosynthesis','/leaf/photosynthesis/sources','/leaf/setup','/leaf/setup/state','/leaf/setup/preview']) {
      const status=await new Promise<number | undefined>((resolve,reject)=>{
        httpGet(origin+route,{headers:{host:'foreign.invalid'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);
      });assert.equal(status,421,route);
    }
    const subject=(await exec('git',['-C',REPO,'log','-1','--format=%an'])).stdout.trim();assert.ok(subject);
    const form=new URLSearchParams({action:'create',subject});
    const foreign=await fetch(origin+'/leaf/setup',{method:'POST',headers:{origin:'https://foreign.invalid','content-type':'application/x-www-form-urlencoded'},body:form,redirect:'manual'});
    assert.equal(foreign.status,403);
    const created=await fetch(origin+'/leaf/setup',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:form,redirect:'manual'});
    assert.equal(created.status,303,await created.text());assert.equal(created.headers.get('location'),'/leaf/setup');
    const document=JSON.parse(await readFile(join(tmpRoot,'missing-work-leaf.json'),'utf8'));
    assert.equal(document.subject,subject);assert.deepEqual(document.leaflets,[]);assert.ok(parseLeafDocument(document).ok);
    const bytes=await readFile(join(tmpRoot,'missing-work-leaf.json'),'utf8');
    const repeated=await fetch(origin+'/leaf/setup',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:form,redirect:'manual'});
    assert.equal(repeated.status,409);assert.equal(await readFile(join(tmpRoot,'missing-work-leaf.json'),'utf8'),bytes);
    const setup=await get('/leaf/setup');assert.match(setup.body,/portfolio-setup\.mjs/);
    const leaf=await get('/leaf');assert.equal(leaf.status,200);assert.match(leaf.body,/data-leaf-state="ok"/);assert.ok(leaf.body.includes(esc(subject)));
  },join(tmpRoot,'missing-work-harvest.json'),join(tmpRoot,'missing-work-leaf.json'));
});
