/**
 * THE PUBLISH SEAM, end to end: the REAL command, the REAL artifact, the REAL server, over HTTP.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `publishedDocument.test.ts` AND `publishedLeaf.test.ts`.
 * Those two prove the gate refuses what it should and the loader keeps its causes apart. Every
 * assertion in them can pass while the seam is broken, because neither ever runs the command that
 * writes the file or the server that serves it. The gap between "the module is correct" and "a
 * person can publish and a stranger can read it" is exactly where this project's recorded failures
 * live, so this file closes it by spawning both real processes.
 *
 * FOUR SEAMS, each one a thing the isolated tests cannot see:
 *
 *   1. CONSENT IS NOT IMPLIED BY RUNNING THE COMMAND. The command is run with no confirmation and
 *      the FILESYSTEM is inspected afterwards: not just a non-zero exit, but no file, and no
 *      directory either. An implementation that created the output directory "ready for later"
 *      would pass an exit-code test and fail this one — and it would have written something a
 *      person never agreed to.
 *
 *   2. THE ARTIFACT THE COMMAND WRITES IS THE ARTIFACT THE CANOPY SERVES. The bytes are parsed
 *      back by the canopy's own gate through a real HTTP request, and the page's claims are
 *      compared against the leaf document the review started from.
 *
 *   3. RE-PUBLISH IS A SECOND DECISION, and the second decision is separately gated. Consent alone
 *      does not replace a publication; the diff is printed first; and the live server follows the
 *      replacement with NO RESTART, which is what distinguishes a real read per request from a
 *      fixture baked in at boot.
 *
 *   4. UNPUBLISH IS ONE FILE REMOVED. Deleting it makes the URL a 404 on the same running process.
 *      An unpublish that is still being served from memory is this seam's worst failure, so it is
 *      driven through the live server rather than reasoned about.
 *
 * The leaf documents here are written by this test rather than by intake. That is deliberate and
 * it is the opposite of the choice `seam.test.ts` makes: THAT file's subject is whether real git
 * history survives the chain, so it must use the real producer. THIS file's subject is the consent
 * gate and the re-publish rule, and those need documents whose verified/pending mix is CHOSEN —
 * including a verified leaflet, which no repository on this machine can currently produce, because
 * nothing here holds a signature git can check. Using intake would silently reduce every case to
 * "nothing crossed", and the crossing is the thing being tested. Nothing written here is presented
 * as anybody's evidence: it is input to a gate, it lives in a temporary directory, and it is
 * deleted when the test ends.
 *
 * DISCIPLINE: every wait has a deadline and every child is killed in a `finally`. A check may
 * fail; it must never hang.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { documentDigest, parsePublishedDocument } from "@foliage/canopy";
import { loadPublishPolicy } from "@foliage/leaf-app/policyDocument";
import { withDocumentLocks } from "@foliage/leaf/local-files";

import { PUBLISHED_ENV, publishedPath, publishedUrl } from "./publishedLeaf.ts";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const PUBLISH = fileURLToPath(new URL("../publish.mjs", import.meta.url));

const BOOT_DEADLINE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 30_000;
const INSTANT = "2026-08-13T09:41:00Z";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-publish-seam-"));
  tmpRoots.push(dir);
  return dir;
}

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the REAL publish command. Never throws on a non-zero exit — the exit code is the subject. */
function publish(args: readonly string[], env: Readonly<Record<string, string>> = {}): Promise<Ran> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [PUBLISH, ...args],
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        if (err !== null && typeof err.code !== "number") {
          reject(new Error(`publish command failed to run: ${err.message}\n${stderr}`));
          return;
        }
        resolve({ code: err === null ? 0 : Number(err.code), stdout, stderr });
      },
    );
  });
}

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
  get(path: string): Promise<{ status: number; body: string; headers: Headers }>;
}

/** Start the REAL server with the given environment, hand it to `body`, and always kill it. */
async function withServer(
  env: Readonly<Record<string, string>>,
  body: (s: Running) => Promise<void>,
): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env, PORT: String(port), HOST: "127.0.0.1" },
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
  const get = async (path: string) => {
    const res = await fetch(origin + path, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { status: res.status, body: await res.text(), headers: res.headers };
  };

  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) {
        throw new Error(`server exited before serving: ${exited}\nstderr:\n${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `server did not answer within ${BOOT_DEADLINE_MS}ms: ${lastError}\nstderr:\n${stderr}`,
        );
      }
      try {
        await get("/tree");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ get });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

/**
 * Write a leaf document. Input to the gate, in a temporary directory, deleted afterwards.
 *
 * `verified` leaflets carry provenance because the open format requires it — verification with no
 * record of what was observed is an assertion rather than a proof.
 */
async function leafDocument(
  dir: string,
  name: string,
  doc: Record<string, unknown>,
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return path;
}

// `visibility: "public"` here because this fixture is shared by tests about the PUBLISH COMMAND's
// own consent gate (--confirm, re-publish, unpublish), not about a leaflet's own visibility — a
// fixture correction, not a weakened assertion. The one test about leaflet-level consent below
// builds its own leaflet with visibility left absent.
function verifiedLeaflet(ref: string, title: string): Record<string, unknown> {
  return {
    id: `git:${ref}`,
    title,
    tier: "verified",
    provenance: { source: "git", ref, observedAt: INSTANT },
    visibility: "public",
  };
}

/* ==========================================================================================
   SEAM 1 — consent cannot be implied by running the command.
   ========================================================================================== */

test("withoutConsentTheCommandPrintsTheReport_exitsNonZero_andWritesNOTHING", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [
      verifiedLeaflet("4f884f6", "fix: hold the roster in manifest order"),
      // Offered and pending — crosses since D1 (2026-09-06), so this is not a withholding.
      { ...verifiedLeaflet("aaa1111", "chore: bump the toolchain"), tier: "pending" },
      // Offered but excluded — still refused, and the one withholding left in this fixture.
      {
        id: "git:ccc3333",
        title: "docs: correct the README",
        tier: "excluded",
        visibility: "public",
        reason: "authored by another identity",
      },
    ],
  });

  const ran = await publish(["--document", document, "--into", into]);

  assert.notEqual(ran.code, 0, "running the command must not be enough to publish");
  assert.equal(ran.code, 3, "the no-consent exit code must be distinguishable from a failure");

  // NOTHING WAS WRITTEN — and "nothing" includes the directory. An implementation that created it
  // "ready for later" would have written something nobody agreed to.
  await assert.rejects(
    stat(into),
    (err: NodeJS.ErrnoException) => err.code === "ENOENT",
    "the output directory was created despite there being no consent",
  );

  // The report is the product of the run, so it has to be there in full.
  assert.match(ran.stdout, /WOULD PUBLISH — 2 leaflet/, "the verified AND the offered pending leaflet");
  // The consent report is the one screen a person reads before typing --confirm, and a verified
  // and a pending claim now cross alike — so the tier has to be printed beside each row, not just
  // on the published page, or a reader cannot tell which is which.
  assert.match(
    ran.stdout,
    /git:4f884f6 {2}\[verified\] {2}fix: hold the roster in manifest order/,
    "the verified leaflet's tier must be visible in the consent report",
  );
  assert.match(
    ran.stdout,
    /git:aaa1111 {2}\[pending\] {2}chore: bump the toolchain/,
    "the pending leaflet's tier must be visible in the consent report, distinguishing it from verified",
  );
  assert.match(ran.stdout, /WOULD WITHHOLD — 1 entry/);
  assert.match(ran.stdout, /unattributed-leaflet/);
  assert.doesNotMatch(ran.stdout, /unproven-leaflet/, "pending is no longer a withholding reason");
  assert.match(ran.stdout, /WHAT THIS REVIEW CANNOT CATCH/);
  assert.match(ran.stderr, /NOTHING WAS WRITTEN/);
  assert.match(ran.stderr, /Consent is not implied by running this command/);
  // The instruction it prints must be the command that actually works.
  assert.match(ran.stderr, /--confirm 'rowan-vale'/);
  assert.match(ran.stderr, new RegExp(`--expect-digest ${documentDigest(await readFile(document))}`));
  assert.match(ran.stderr, /--expect-policy-digest sha256:[0-9a-f]{64}/);
});

test("pending publication preserves absolute deny rules and records explicit policy consent", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "pending-policy", subject: "Publication policy input",
    leaflets: [{ id: "no-evidence", title: "A pending assertion", tier: "pending", visibility: "public" }],
  });
  const defaultReview = await publish(["--document", document, "--into", into]);
  assert.equal(defaultReview.code, 3);
  assert.match(defaultReview.stdout, /\[policy-denied\]/);
  assert.match(defaultReview.stdout, /deny-no-evidence/);
  const policy = join(dir, "policy.json");
  await writeFile(policy, JSON.stringify({ rules: [] }));
  const consent = await publish(["--document", document, "--policy", policy, "--into", into, "--confirm", "pending-policy"]);
  assert.equal(consent.code, 0, consent.stderr);
  const raw = JSON.parse(await readFile(publishedPath(into, "pending-policy"), "utf8"));
  assert.equal(raw.artifactVersion, 5);
  assert.equal(raw.leaf.leaflets[0].tier, "pending");
  assert.equal("provenance" in raw.leaf.leaflets[0], false);
  const loadedPolicy = await loadPublishPolicy({}, policy);
  assert.ok(loadedPolicy.ok);
  assert.equal(raw.source.policyDigest, loadedPolicy.policyDigest);
  await withServer({ [PUBLISHED_ENV]: into }, async (server) => {
    const page = await server.get(publishedUrl("pending-policy"));
    assert.equal(page.status, 200);
    assert.match(page.body, /class="proof proof-pending"/);
  });
});

test("publication holds both reviewed document locks before reading or writing", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", { id: "lock-test", subject: "Lock test input", leaflets: [] });
  const policy = join(dir, "policy.json");
  await writeFile(policy, JSON.stringify({ rules: [] }));
  const args = ["--document", document, "--policy", policy, "--into", into, "--confirm", "lock-test"];
  for (const path of [document, policy]) {
    await withDocumentLocks([path], async () => {
      const refused = await publish(args);
      assert.notEqual(refused.code, 0);
      assert.match(refused.stderr, /local document busy/);
      await assert.rejects(stat(into), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    });
  }
  await withDocumentLocks([policy], async () => {
    const refused = await publish(["--document", document, "--into", into, "--confirm", "lock-test"],
      { FOLIAGE_POLICY: `  ${policy}  ` });
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /local document busy/);
    await assert.rejects(stat(into), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  });
  const retried = await publish(args);
  assert.equal(retried.code, 0, retried.stderr);
});

test("an abbreviated review can never be used to publish", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: Array.from({ length: 8 }, (_, index) => ({
      id: `git:pending-${index}`,
      title: `pending claim ${index}`,
      tier: "pending",
    })),
  });

  const brief = await publish(["--document", document, "--into", into, "--brief"]);
  assert.equal(brief.code, 3);
  assert.match(brief.stdout, /TRUNCATED/);
  assert.match(brief.stderr, /complete, still non-confirming review/);
  assert.doesNotMatch(brief.stderr, /--confirm/);
  await assert.rejects(stat(into), (err: NodeJS.ErrnoException) => err.code === "ENOENT");

  const refused = await publish([
    "--document", document,
    "--into", into,
    "--brief",
    "--confirm", "rowan-vale",
  ]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /--brief cannot be combined with --confirm/);
  await assert.rejects(stat(into), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
});

test("theConfirmationNamesTheLeaf_soAWrongOneIsRefusedRatherThanResolved", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [verifiedLeaflet("4f884f6", "fix: hold the roster in manifest order")],
  });

  const ran = await publish(["--document", document, "--into", into, "--confirm", "somebody-else"]);
  assert.notEqual(ran.code, 0);
  assert.match(ran.stderr, /names "somebody-else", and this document publishes as "rowan-vale"/);
  await assert.rejects(stat(into), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
});

test("aConfirmationIsBoundToTheReviewedBytes_notJustTheLeafId", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [verifiedLeaflet("4f884f6", "fix: hold the roster in manifest order")],
  });
  const reviewedDigest = documentDigest(await readFile(document));

  await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [verifiedLeaflet("4f884f6", "fix: content changed after the review")],
  });
  const ran = await publish([
    "--document", document,
    "--into", into,
    "--expect-digest", reviewedDigest,
    "--confirm", "rowan-vale",
  ]);

  assert.notEqual(ran.code, 0);
  assert.match(ran.stderr, /leaf changed after its publication review/);
  assert.match(ran.stderr, /Review the current document and confirm again/);
  await assert.rejects(stat(into), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
});

test("aConfirmationIsBoundToTheReviewedPolicy_notJustTheLeafBytes", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [],
  });
  const policyPath = join(dir, "policy.json");
  await writeFile(policyPath, `${JSON.stringify({ rules: [] })}\n`);
  const reviewed = await loadPublishPolicy({}, policyPath);
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) return;

  const dryReview = await publish(["--document", document, "--into", into, "--policy", policyPath]);
  assert.equal(dryReview.code, 3);
  assert.match(dryReview.stderr, new RegExp(`--policy '${policyPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(dryReview.stderr, new RegExp(`--expect-policy-digest ${reviewed.policyDigest}`));

  await writeFile(policyPath, `${JSON.stringify({ rules: [{ id: "deny-empty", effect: "deny", match: { kind: "no-evidence" }, reason: "changed" }] })}\n`);
  const ran = await publish([
    "--document", document,
    "--into", into,
    "--policy", policyPath,
    "--expect-policy-digest", reviewed.policyDigest,
    "--confirm", "rowan-vale",
  ]);

  assert.notEqual(ran.code, 0);
  assert.match(ran.stderr, /publication rules changed after review/);
  await assert.rejects(stat(into), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
});

test("aDocumentDeclaringItselfAnExampleIsRefusedWHOLE_evenWithConsent", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    example: true,
    leaflets: [verifiedLeaflet("4f884f6", "fix: hold the roster in manifest order")],
  });

  const ran = await publish(["--document", document, "--into", into, "--confirm", "rowan-vale"]);
  assert.notEqual(ran.code, 0);
  assert.match(ran.stderr, /REFUSED/);
  // A band is a caption, and a caption is lost to a screenshot while the fabricated claims travel.
  assert.match(ran.stderr, /fabricated illustration/);
  await assert.rejects(stat(into), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
});

test("everyFailedReadIsNamedAsItsOwnCauseAndWritesNothing", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");

  const absent = await publish(["--document", join(dir, "nope.json"), "--into", into]);
  assert.match(absent.stderr, /absent —/);

  const malformedPath = join(dir, "broken.json");
  await writeFile(malformedPath, "{oh no", "utf8");
  const malformed = await publish(["--document", malformedPath, "--into", into]);
  assert.match(malformed.stderr, /malformed —/);

  const invalidPath = await leafDocument(dir, "invalid.json", { id: "x", score: 9 });
  const invalid = await publish(["--document", invalidPath, "--into", into]);
  assert.match(invalid.stderr, /invalid —/);
  assert.match(invalid.stderr, /refused by name/, "a score-shaped key must be refused by name");

  for (const ran of [absent, malformed, invalid]) assert.notEqual(ran.code, 0);
  await assert.rejects(stat(into), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
});

/* ==========================================================================================
   SEAM 2 — what the command writes is what the canopy serves.
   ========================================================================================== */

test("withConsentItPublishes_andTheCanopyServesExactlyWhatTheReviewAllowed", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [
      verifiedLeaflet("4f884f6", "fix: hold the roster in manifest order"),
      verifiedLeaflet("bbb2222", "feat: add the ingest route"),
      { ...verifiedLeaflet("aaa1111", "chore: bump the toolchain"), tier: "pending" },
      {
        id: "git:ccc3333",
        title: "docs: correct the README",
        tier: "excluded",
        visibility: "public",
        reason: "authored by another identity",
      },
    ],
  });

  const ran = await publish(["--document", document, "--into", into, "--confirm", "rowan-vale"]);
  assert.equal(ran.code, 0, `${ran.stderr}\n${ran.stdout}`);
  assert.match(ran.stdout, /PUBLISHED rowan-vale/);

  // The artifact on disk is a real published artifact by the canopy's own gate.
  const bytes = await readFile(publishedPath(into, "rowan-vale"), "utf8");
  const parsed = parsePublishedDocument(JSON.parse(bytes));
  assert.equal(parsed.ok, true, parsed.ok ? "" : JSON.stringify(parsed.issues, null, 2));
  if (!parsed.ok) return;
  // D1 (2026-09-06): the offered pending leaflet crosses beside the two verified ones — only the
  // excluded one is withheld.
  assert.equal(parsed.document.leaf.leaflets.length, 3, "verified AND offered pending may cross");
  assert.deepEqual(
    new Map(parsed.document.leaf.leaflets.map((l) => [l.id, l.tier])),
    new Map([
      ["git:4f884f6", "verified"],
      ["git:bbb2222", "verified"],
      ["git:aaa1111", "pending"],
    ]),
  );
  assert.equal(parsed.document.withheld.count, 1);

  await withServer({ [PUBLISHED_ENV]: into, FOLIAGE_TREE: "" }, async (s) => {
    const res = await s.get(publishedUrl("rowan-vale"));
    assert.equal(res.status, 200);
    const leafletLink = "/leaflet/git%3A4f884f6?publication=rowan-vale";
    assert.match(res.body, /href="\/leaflet\/git%3A4f884f6\?publication=rowan-vale"/);
    const detail = await s.get(leafletLink);
    assert.equal(detail.status, 200, "a published leaflet reads the artifact with no tree configured");
    assert.match(detail.body, /fix: hold the roster in manifest order/);
    assert.doesNotMatch(detail.body, /feat: add the ingest route|docs: correct the README|FOLIAGE_TREE/);
    assert.equal(detail.headers.get("cache-control"), "no-store");
    assert.equal((await s.get("/leaflet/git%3Amissing?publication=rowan-vale")).status, 404);

    /*
     * THE SECURITY HEADERS, ON THE ONE PAGE THAT IS A REAL PUBLISHED ARTIFACT — asserted here
     * because this is the only file that publishes one through the real `publish.mjs` and serves
     * it over real HTTP, and it asserted no headers at all until 2026-09-04.
     *
     * That gap hid F-033's own defect for exactly as long as it existed. This route built its
     * header object by hand instead of spreading the shared one, so when `publicHeaders()`
     * gained `x-robots-tag` every response got it EXCEPT a published leaf — measured on the wire:
     * `/tree` carried it, `/leaf/rowan-vale` did not. `csp.test.ts` and `seam.test.ts` could not
     * catch it because they only reach `/leaf/<id>` when no artifact exists, which falls through
     * to a different code path.
     *
     * `renderPublic.ts`'s header calls this "the page a stranger receives" and records that it
     * takes precedence over the live projection. It is the page most likely to be crawled, so it
     * is the page whose headers most need a test in the file that can actually produce it.
     */
    assert.equal(
      res.headers.get("x-robots-tag"),
      "noindex, noarchive, nosnippet, noimageindex",
      "a published leaf is indexable — readable was never the same as findable",
    );
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/, "a published leaf is framable by any origin");

    // WHAT THE PAGE CLAIMS IS EXACTLY WHAT CROSSED — set difference in both directions. A title on
    // a public page that the review did not pass is a fabrication, whatever put it there.
    const titles = [...res.body.matchAll(/<h2 class="pub-title"[^>]*>([^<]+)<\/h2>/g)].map(
      (m) => m[1] as string,
    );
    assert.deepEqual(
      new Set(titles),
      // D1: the offered PENDING leaflet crosses too, since 2026-09-06.
      new Set([
        "fix: hold the roster in manifest order",
        "feat: add the ingest route",
        "chore: bump the toolchain",
      ]),
    );
    assert.match(
      res.body,
      /data-leaflet="git:aaa1111" data-tier="pending"/,
      "the pending row must be marked as pending, not left to read as verified",
    );
    // THE VISIBLE BADGE ON THAT SAME ROW, not only the data attribute above — `data-tier` is
    // markup a stranger never reads, and a page that got the attribute right while every row's
    // rendered badge said "Verified" would be the overclaim D1 exists to prevent.
    const pendingRow = /<li class="pub-leaflet lp-record" data-leaflet="git:aaa1111"[\s\S]*?<\/li>/.exec(
      res.body,
    );
    assert.ok(pendingRow !== null, "no <li> found for the pending leaflet");
    assert.match(pendingRow![0], /class="proof proof-pending"/, "the pending row's badge must read pending");
    assert.match(pendingRow![0], />Pending</);
    assert.doesNotMatch(pendingRow![0], /proof-verified/, "the pending row must not carry a verified badge");
    const verifiedRow = /<li class="pub-leaflet lp-record" data-leaflet="git:4f884f6"[\s\S]*?<\/li>/.exec(
      res.body,
    );
    assert.ok(verifiedRow !== null, "no <li> found for the verified leaflet");
    assert.match(verifiedRow![0], /class="proof proof-verified"/, "the verified row's badge must read verified");
    assert.doesNotMatch(verifiedRow![0], /proof-pending/, "the verified row must not carry a pending badge");
    // THE ICON ITSELF, not only the markup that references it. `proofBadge` emits
    // `<use href="#i-partial">`/`<use href="#i-check">`, which renders nothing unless the page also
    // carries the matching `<symbol id="…">` def — every other dynamic route gets that from
    // `sendPage`'s `inlineSprite`, and the published route once built its response by hand instead
    // and skipped it, so the badge was an empty 14x14 box beside every row on the one page a
    // stranger reads.
    assert.match(pendingRow![0], /<use href="#i-partial">/, "the pending badge must reference its icon");
    assert.ok(
      res.body.includes('<symbol id="i-partial"'),
      "the sprite's i-partial symbol must be in the response, or the pending badge's <use> resolves to nothing",
    );
    assert.match(verifiedRow![0], /<use href="#i-check">/, "the verified badge must reference its icon");
    assert.ok(
      res.body.includes('<symbol id="i-check"'),
      "the sprite's i-check symbol must be in the response, or the verified badge's <use> resolves to nothing",
    );
    assert.ok(
      !res.body.includes("docs: correct the README"),
      "an excluded leaflet — somebody else's work — reached this person's public page",
    );
    // The page states the shape of the loss rather than hiding it.
    assert.ok(res.body.includes('data-withheld="present"'));
    assert.ok(!res.body.includes('data-withheld="2"'));

    // Every other address on this canopy stays honest at the same time.
    assert.equal((await s.get(publishedUrl("somebody-else"))).status, 404);
    assert.equal((await s.get("/leaf/Not An Id")).status, 400);
  });
});

test("aRealThirdPartyAddressInATitleIsRedactedBeforeItCanReachTheServedPage", async () => {
  // The exact defect ledger rows C1/C2/C5 recorded: a leaflet title is copied VERBATIM from a
  // commit subject, and on a multi-author repository those subjects carry other people's
  // addresses. This drives it through the whole seam — document, command, artifact, HTTP — and
  // requires the address to be absent from the bytes a client receives.
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [
      verifiedLeaflet("4f884f6", "fix: use hi@example.invalid in the English README"),
    ],
  });

  const ran = await publish(["--document", document, "--into", into, "--confirm", "rowan-vale"]);
  assert.equal(ran.code, 0, ran.stderr);
  // The report itself must not republish the value it withheld.
  assert.ok(
    !ran.stdout.includes("hi@example.invalid"),
    "the review printed the very address it withheld",
  );

  await withServer({ [PUBLISHED_ENV]: into }, async (s) => {
    const res = await s.get(publishedUrl("rowan-vale"));
    assert.equal(res.status, 200);
    assert.ok(!res.body.includes("hi@example.invalid"), "the address reached the public page");
    // The rest of the sentence survives — the loss is proportionate — and the page says the title
    // is no longer the artifact's own words.
    assert.ok(res.body.includes("in the English README"));
    assert.ok(res.body.includes('data-title-redacted="true"'));
    assert.ok(!res.body.includes('data-verbatim="title"'));
  });
});

test("aVerifiedLeafletTheSubjectNeverOfferedDoesNotReachTheServedPage", async () => {
  // The corpse this PR fixes: a verified leaflet with NO `visibility` at all — the safe default is
  // `private` — must not cross just because it is proven. The other leaflet in this leaf carries
  // `visibility: "public"` explicitly, so this is a control: one offered, one not, same tier.
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [
      verifiedLeaflet("4f884f6", "fix: hold the roster in manifest order"),
      {
        id: "git:nnn1414",
        title: "feat: add the local-only sync job",
        tier: "verified",
        provenance: { source: "git", ref: "nnn1414", observedAt: INSTANT },
        // visibility deliberately absent
      },
    ],
  });

  const ran = await publish(["--document", document, "--into", into, "--confirm", "rowan-vale"]);
  assert.equal(ran.code, 0, ran.stderr);
  assert.match(ran.stdout, /not-shared/, "the report must name the true reason: consent, not tier");

  await withServer({ [PUBLISHED_ENV]: into }, async (s) => {
    const res = await s.get(publishedUrl("rowan-vale"));
    assert.equal(res.status, 200);
    assert.ok(
      res.body.includes("fix: hold the roster in manifest order"),
      "the leaflet the subject offered is on the page",
    );
    assert.ok(
      !res.body.includes("feat: add the local-only sync job"),
      "a verified leaflet the subject never offered reached a public page",
    );
    assert.ok(res.body.includes('data-withheld-kind="not-shared"'));
    assert.match(res.body, /leaflet not offered/, "the label must be the true reason, in plain words");
  });
});

test("anArtifactHandEditedAfterPublicationIsRefusedByTheCanopy_notServed", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [verifiedLeaflet("4f884f6", "fix: hold the roster in manifest order")],
  });
  assert.equal((await publish(["--document", document, "--into", into, "--confirm", "rowan-vale"])).code, 0);

  // Somebody edits the published file to put a title back the way it was.
  const path = publishedPath(into, "rowan-vale");
  const artifact = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const leaf = artifact["leaf"] as Record<string, unknown>;
  (leaf["leaflets"] as Record<string, unknown>[])[0]!["title"] =
    "fix: thanks rowan@example.invalid for the catch";
  await writeFile(path, JSON.stringify(artifact, null, 2), "utf8");

  await withServer({ [PUBLISHED_ENV]: into }, async (s) => {
    const res = await s.get(publishedUrl("rowan-vale"));
    assert.equal(res.status, 500, "an artifact carrying an address must not be served at all");
    assert.ok(!res.body.includes("rowan@example.invalid"));
    assert.ok(res.body.includes('data-published-state="invalid"'));
  });
});

test("aVersionOnePublicationFromBeforeThisPRKeepsServing_onTheRealServer", async () => {
  // THE BLOCKER THIS TEST REPRODUCES AND CLOSES. This PR made `tier` required on every published
  // leaflet and deleted `unproven-leaflet` from the kinds a withheld report may name. Both were
  // true of every artifact `publish.mjs` had ever written before 2026-09-07 — a real published
  // page — and `PUBLISHED_ARTIFACT_VERSION` did not move, so the ingest gate refused a once-valid
  // file as though it had rotted. Reproduced by hand-building exactly that shape (no per-leaflet
  // `tier`, a `withheld.kinds` entry naming `unproven-leaflet`, `artifactVersion: 1`) and serving
  // it through the real `apps/canopy/server.mjs`: GET /leaf/<id> returned HTTP 500. A unit test on
  // `parsePublishedDocument` alone would not have caught this — the defect was in the seam between
  // the parser and the route, which is exactly what `withServer` drives over real HTTP.
  const dir = await tempDir();
  const into = join(dir, "publications");
  await mkdir(into, { recursive: true });

  // Not run through `publish.mjs` — that command only ever writes the CURRENT version. This is
  // written directly, because the file under test is one nothing in this repository can produce
  // anymore: an artifact from before this PR shipped.
  await writeFile(
    publishedPath(into, "rowan-vale"),
    `${JSON.stringify(
      {
        artifact: "foliage/published-leaf",
        artifactVersion: 1,
        publishedAt: INSTANT,
        source: { documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 1024 },
        leaf: {
          id: "rowan-vale",
          subject: "Rowan Vale",
          subjectRedacted: false,
          leaflets: [
            {
              id: "git:4f884f6",
              title: "fix: hold the roster in manifest order",
              // NO "tier" — this key never existed on disk before 2026-09-07.
              titleRedacted: false,
              provenance: { source: "git", ref: "4f884f6", observedAt: INSTANT },
            },
          ],
        },
        withheld: { count: 1, kinds: [{ kind: "unproven-leaflet", count: 1 }] },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await withServer({ [PUBLISHED_ENV]: into }, async (s) => {
    const res = await s.get(publishedUrl("rowan-vale"));
    assert.equal(res.status, 200, `a pre-existing publication must keep serving — got:\n${res.body}`);
    assert.ok(
      res.body.includes("fix: hold the roster in manifest order"),
      "the leaflet this old artifact carried must still be on the page",
    );
    assert.match(
      res.body,
      /data-leaflet="git:4f884f6" data-tier="verified"/,
      "an absent tier on a version-1 artifact must be read as verified, per its own gate's rules",
    );
    assert.match(res.body, /v1\b/, "the footer must say v1 honestly — this file was never rewritten");
  });
});

/* ==========================================================================================
   SEAM 3 and 4 — re-publish is a second decision; unpublish is one file.
   ========================================================================================== */

test("republishIsSeparatelyGated_diffedFirst_andFollowedByTheLiveServerWithNoRestart", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const first = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [verifiedLeaflet("4f884f6", "fix: hold the roster in manifest order")],
  });
  assert.equal((await publish(["--document", first, "--into", into, "--confirm", "rowan-vale"])).code, 0);
  const firstBytes = await readFile(publishedPath(into, "rowan-vale"), "utf8");
  const reviewedPublicDigest = documentDigest(Buffer.from(firstBytes));

  // A second, DIFFERENT document for the same leaf: one claim gained, one lost.
  const second = await leafDocument(dir, "leaf2.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [verifiedLeaflet("bbb2222", "feat: add the ingest route")],
  });

  // CONSENT ALONE DOES NOT REPLACE. Same confirmation as the first publication, and it is refused.
  const refused = await publish(["--document", second, "--into", into, "--confirm", "rowan-vale"]);
  assert.equal(refused.code, 4, "a second publication must be a second decision");
  assert.match(refused.stderr, /A PUBLICATION ALREADY EXISTS UNDER "rowan-vale" AND WAS NOT REPLACED/);
  assert.equal(
    await readFile(publishedPath(into, "rowan-vale"), "utf8"),
    firstBytes,
    "the existing publication was modified by a run that refused to replace it",
  );

  // And the refusal shows WHAT would have changed, computed from the two artifacts.
  assert.match(refused.stdout, /THIS WOULD REPLACE A PUBLICATION MADE AT/);
  assert.match(
    refused.stdout,
    /\+ git:bbb2222 {2}\[verified\] {2}— this page would START making this claim/,
    "an added claim's tier must be visible, the same disclosure a first publication makes",
  );
  assert.match(refused.stdout, /- git:4f884f6 {2}— this page would STOP making this claim/);

  const dryReview = await publish(["--document", second, "--into", into]);
  assert.equal(dryReview.code, 3);
  assert.match(dryReview.stderr, new RegExp(`--expect-public-digest ${reviewedPublicDigest}`));

  const stalePublicReview = await publish([
    "--document", second,
    "--into", into,
    "--expect-public-digest", `sha256:${"0".repeat(64)}`,
    "--confirm", "rowan-vale",
    "--republish",
  ]);
  assert.equal(stalePublicReview.code, 4);
  assert.match(stalePublicReview.stderr, /public artifact changed after review/);
  assert.equal(await readFile(publishedPath(into, "rowan-vale"), "utf8"), firstBytes);

  await withServer({ [PUBLISHED_ENV]: into, FOLIAGE_TREE: "" }, async (s) => {
    const before = await s.get(publishedUrl("rowan-vale"));
    assert.equal(before.status, 200);
    assert.ok(before.body.includes("fix: hold the roster in manifest order"));
    const firstDetail = "/leaflet/git%3A4f884f6?publication=rowan-vale";
    assert.equal((await s.get(firstDetail)).status, 200);

    // Now the second decision is taken, WHILE THE SERVER IS RUNNING.
    const done = await publish([
      "--document",
      second,
      "--into",
      into,
      "--expect-public-digest",
      reviewedPublicDigest,
      "--confirm",
      "rowan-vale",
      "--republish",
    ]);
    assert.equal(done.code, 0, done.stderr);
    assert.match(done.stdout, /REPUBLISHED rowan-vale/);

    // The SAME process follows the file with no restart. This is what distinguishes a real read
    // per request from a fixture baked in at boot.
    const after = await s.get(publishedUrl("rowan-vale"));
    assert.equal(after.status, 200);
    assert.ok(after.body.includes("feat: add the ingest route"));
    assert.ok(
      !after.body.includes("fix: hold the roster in manifest order"),
      "the replaced claim is still being served",
    );
    assert.equal((await s.get(firstDetail)).status, 404, "a removed item cannot survive replacement at its detail URL");
    const secondDetail = "/leaflet/git%3Abbb2222?publication=rowan-vale";
    assert.equal((await s.get(secondDetail)).status, 200);

    // The URL did not change. One leaf, one address, however many times it is published.
    assert.equal((await s.get(publishedUrl("rowan-vale"))).status, 200);

    // UNPUBLISH: one file removed, and the page is gone on the same running process.
    await rm(publishedPath(into, "rowan-vale"));
    const gone = await s.get(publishedUrl("rowan-vale"));
    assert.equal(gone.status, 404, "an unpublish that is still served is the worst failure here");
    assert.ok(gone.body.includes('data-published-state="absent"'));
    assert.equal((await s.get(secondDetail)).status, 404, "withdrawal also ends the publication-qualified leaflet link");
  });
});

test("republishWhereTheSameClaimIsNowVerifiedNamesBothTiersInTheDiff", async () => {
  // A tier-only change — the title never moves — is still a claim change: "authorship is not
  // cryptographically established" becoming "git accepted a signature" is exactly the fact a
  // re-publish exists to surface, and `tierChanged` alone (a boolean) does not say WHAT changed.
  const dir = await tempDir();
  const into = join(dir, "publications");
  const first = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [{ ...verifiedLeaflet("aaa1111", "chore: bump the toolchain"), tier: "pending" }],
  });
  assert.equal((await publish(["--document", first, "--into", into, "--confirm", "rowan-vale"])).code, 0);

  // The SAME claim, same id and title, now carrying a signature git accepted.
  const second = await leafDocument(dir, "leaf2.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [verifiedLeaflet("aaa1111", "chore: bump the toolchain")],
  });

  const refused = await publish(["--document", second, "--into", into, "--confirm", "rowan-vale"]);
  assert.equal(refused.code, 4, "a second publication must be a second decision");
  assert.match(
    refused.stdout,
    /tier: pending → verified/,
    "the diff must name both tiers, not just announce that one changed",
  );
});

test("a policy-only republish says the public page is unchanged but the rules differ", async () => {
  const dir = await tempDir();
  const into = join(dir, "publications");
  const document = await leafDocument(dir, "leaf.json", {
    id: "rowan-vale",
    subject: "Rowan Vale",
    leaflets: [verifiedLeaflet("4f884f6", "fix: hold the roster in manifest order")],
  });
  assert.equal((await publish(["--document", document, "--into", into, "--confirm", "rowan-vale"])).code, 0);
  const policyPath = join(dir, "policy.json");
  await writeFile(policyPath, `${JSON.stringify({ rules: [] })}\n`);

  const again = await publish(["--document", document, "--into", into, "--policy", policyPath, "--confirm", "rowan-vale"]);
  assert.equal(again.code, 4);
  assert.match(again.stdout, /byte-identical/);
  assert.match(again.stdout, /Nothing a reader could see would change/);
  assert.match(again.stdout, /publication rules used for this release differ/);
  assert.doesNotMatch(again.stdout, /Only the publication instant differs/);
});
