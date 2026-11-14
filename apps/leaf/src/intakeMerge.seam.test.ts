/**
 * THE FORCED-REFRESH SEAM — `intake --force` over a document that holds approved work.
 *
 * This is the automated form of the P2 repro, and it exists because every other way of
 * checking P2 is a way of missing it. The ledger's own reproduction reads: a leaf held 59
 * leaflets, 2 of them promoted through Photosynthesis after a human clicked Approve; re-running
 *
 *   node apps/leaf/intake.mjs --repo . --subject "…" --identity <id> --out <same file> --force
 *
 * left 68 leaflets and 0 promoted — both approvals gone, no warning, nothing in the output,
 * exit 0. The cause is two writers and one file: `intake.mjs` writes the WHOLE document
 * (`flag: force ? "w" : "wx"`) while `promote.ts` APPENDS to it, and the appending one loses.
 *
 * WHY THIS FILE IS A SEAM TEST AND NOT A UNIT TEST. The merge rule can be — and should be —
 * unit-tested as a pure function in the domain package. That test will pass while the product
 * still destroys the person's approvals, because a pure function nobody calls is correct and
 * inert. What has to be true is a chain: real commits → the real `intake.mjs` process →
 * the real file on disk → the real `server.mjs` process → the bytes a reader receives. So
 * everything here is a subprocess over real files, and the final assertion is made against
 * PAINTED HTML rather than JSON. A JSON assertion is precisely the isolated check this seam
 * exists to distrust: the document could hold the promoted row and the page could still not
 * show it, and the person whose portfolio it is only ever looks at the page.
 *
 * FOUR THINGS ARE CHECKED HERE THAT NOTHING ELSE CAN SEE:
 *
 *   1. THE REPRO, LITERALLY. Real repository, real intake, a promoted row appended the way
 *      `promote.ts` appends one, more real commits, then `--force` over the same path. The
 *      promoted row survives, the git-derived set grows, and the surviving row is ON THE PAGE.
 *   2. THE TEST HAS TEETH. The pre-fix outcome is constructed deliberately and fed to the same
 *      checker, which must reject it — naming the destroyed id. A green test that would also be
 *      green against the broken behaviour proves nothing, and this repo has paid for that.
 *   3. OWNERSHIP IS DECLARED, NOT INFERRED. History is rewritten between two runs, so a
 *      git-sourced leaflet from run one is genuinely not re-derivable in run two. It is kept,
 *      and it is reported BY ID with a cause — not silently dropped, and not silently kept.
 *   4. A FAILURE IS NEVER A ZERO. An unreadable existing document must stop the run with a
 *      named cause and write NOTHING. A fall-through to overwrite is the same bug wearing a
 *      different hat: the operator loses the file precisely when the tool could not read it.
 *
 * DISCIPLINE, all of it paid for already: every wait has a deadline; every child is killed in a
 * `finally`; the port is taken from the OS BEFORE binding and the listener is then proven to be
 * ours by a nonce only our document carries (a previous run curled another session's server on
 * a fixed port and reported the answer as its own). The helpers below are deliberate copies of
 * the ones in `seam.test.ts` rather than imports — importing a test module registers its tests,
 * and this file must not drag another file's suite into its own run.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseLeafDocument } from "@foliage/leaf";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const INTAKE = fileURLToPath(new URL("../intake.mjs", import.meta.url));

const exec = promisify(execFile);

/** How long a server gets to answer its first request before the test FAILS (never hangs). */
const BOOT_DEADLINE_MS = 10_000;
/** Per-request ceiling, so a hung fetch cannot stall the suite. */
const REQUEST_TIMEOUT_MS = 4_000;
/** Ceiling on any subprocess this file starts. */
const SUBPROCESS_TIMEOUT_MS = 60_000;

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-intake-merge-"));
  tmpRoots.push(dir);
  return dir;
}

/** `git` in a directory, non-interactive, ambient config neutralised. */
async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(
    "git",
    ["-C", dir, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { encoding: "utf8", timeout: SUBPROCESS_TIMEOUT_MS },
  );
  return stdout;
}

interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  /** null only if the process was killed by a signal, which is itself a failure here. */
  readonly code: number | null;
}

/**
 * Run a node script to completion and return its output AND its exit code.
 *
 * `promisify(execFile)` rejects on a non-zero exit, which would turn "intake refused, correctly,
 * with a named cause" into a thrown test error indistinguishable from a crash. Every case in
 * this file cares about the code as data — a refusal is a PASS in two tests here — so the
 * rejection is unwrapped rather than propagated.
 */
async function runNode(args: readonly string[], env?: NodeJS.ProcessEnv): Promise<ProcessResult> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [...args], {
      encoding: "utf8",
      timeout: SUBPROCESS_TIMEOUT_MS,
      ...(env === undefined ? {} : { env }),
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; signal?: string };
    assert.ok(
      e.signal === undefined || e.signal === null,
      `the child was killed by ${String(e.signal)} — it hung rather than answering`,
    );
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: typeof e.code === "number" ? e.code : null,
    };
  }
}

/** Run the REAL intake command — the same entry point a self-hoster runs. */
function runIntake(opts: {
  repo: string;
  subject: string;
  identities: readonly string[];
  out: string;
  force: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<ProcessResult> {
  const args = [INTAKE, "--repo", opts.repo, "--subject", opts.subject, "--out", opts.out];
  for (const id of opts.identities) args.push("--identity", id);
  if (opts.force) args.push("--force");
  return runNode(args, opts.env);
}

/**
 * A port nothing is listening on, obtained by briefly listening on port 0 and asking the OS.
 *
 * There is an unavoidable race between closing this and the child binding it; a fixed port
 * races against every other test run AND against the developer's own dev server, which is
 * strictly worse — that is how a verification run once curled :4177, got a 200 from somebody
 * else's process, and reported it as its own. If the child loses this race it exits and
 * `withServer` reports the exit, so the failure is legible rather than a hang. The nonce check
 * below closes the remaining gap: it proves the answering process is serving OUR document.
 */
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

/**
 * Boot the real server over `leafPath`, hand the painted page to `body`, and always kill it.
 *
 * The child is killed by its own pid handle, never by "whatever is listening on that port".
 * Killing by port is how one session murders another session's server; the pid we spawned is
 * the only process we are entitled to signal.
 */
async function withPaintedPage(
  leafPath: string,
  body: (page: { html: string; status: number; origin: string }) => Promise<void>,
): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, FOLIAGE_LEAF: leafPath, PORT: String(port), HOST: "127.0.0.1" },
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
  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    let status = 0;
    let html = "";
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
        // `/leaf` since the studio landed: `/` is the Overview now, and this seam paints the
        // DOCUMENT — the assertion is retargeted, not weakened.
        const res = await fetch(`${origin}/leaf`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        status = res.status;
        html = await res.text();
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ html, status, origin });
  } finally {
    child.kill("SIGKILL");
    if (exited === null) {
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

/** Undo the renderer's escaping, so a comparison is against the original string. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function allMatches(html: string, re: RegExp): string[] {
  return [...html.matchAll(re)].map((m) => unescapeHtml(m[1] ?? ""));
}

// ---------------------------------------------------------------------------------------------
// The observation, and the total function that judges it.
// ---------------------------------------------------------------------------------------------

/** One leaflet, reduced to what this seam judges. */
export interface ObservedLeaflet {
  readonly id: string;
  readonly title: string;
  readonly tier: string;
  /** `provenance.source`, or null for a leaflet carrying no provenance at all. */
  readonly source: string | null;
  /** The row's `visibility`, or null when the document does not carry one — absent means private. */
  readonly visibility: string | null;
  /** The leaflet's exact JSON, so "unmodified" can mean unmodified rather than "still present". */
  readonly json: string;
}

/** Everything observable about one forced refresh, gathered from the real processes. */
export interface ForcedRefreshObservation {
  /** The document as it stood BEFORE the forced run. */
  readonly before: readonly ObservedLeaflet[];
  /** The document as it stands AFTER it. */
  readonly after: readonly ObservedLeaflet[];
  /** Everything intake said on stdout during the forced run. */
  readonly stdout: string;
  /** Its exit code. */
  readonly exitCode: number | null;
  /** The painted page, or null when this observation did not serve one. */
  readonly page: string | null;
  /**
   * How many git-sourced leaflets the caller KNOWS this run could not re-derive, established
   * outside the document — by rewriting the history itself. It cannot be computed from `before`
   * and `after`: a git leaflet that is still there might have been re-derived or might have
   * been kept, and those are the two facts this whole slice exists to keep apart.
   */
  readonly expectUnderived?: number;
}

/** One way a forced refresh betrayed the person whose portfolio it is. */
export interface RefreshViolation {
  /** A short machine-ish tag, so a caller can assert on the KIND without matching prose. */
  readonly kind:
    | "destroyed"
    | "modified"
    | "absent-from-page"
    | "silent-existing"
    | "silent-carry"
    | "silent-would-drop"
    | "wrong-carry-count"
    | "visibility-lost";
  readonly message: string;
}

/** Numbers appearing on any stdout line that matches `re`. */
function numbersOnLinesMatching(stdout: string, re: RegExp): number[] {
  return stdout
    .split("\n")
    .filter((line) => re.test(line))
    .flatMap((line) => [...line.matchAll(/\b(\d+)\b/g)].map((m) => Number(m[1])));
}

/**
 * Every carried-forward count intake stated, in either order it could sensibly state one.
 *
 * Targeted rather than "any number on a line mentioning carrying", because the summary line
 * carries four numbers and a check that accepts any of them would pass a run that printed
 * `kept 1 … carried forward 0` when one leaflet was in fact carried. The count is the claim;
 * it has to be read as the count.
 */
function reportedCarriedForward(stdout: string): number[] {
  return [
    ...[...stdout.matchAll(/carried[- ]?forward\D{0,24}?(\d+)/gi)].map((m) => Number(m[1])),
    ...[...stdout.matchAll(/(\d+)\D{0,24}?carried[- ]?forward/gi)].map((m) => Number(m[1])),
  ];
}

/**
 * Judge one forced refresh. TOTAL and PURE: no fs, no clock, no throw — it takes the
 * observation and returns every way it failed, all of them, in one pass.
 *
 * The rule it enforces is the slice's, stated once here so both halves of this file agree:
 *
 *   INTAKE OWNS EXACTLY THE LEAFLETS IT PRODUCED. A leaflet whose `provenance.source` is not
 *   `git` was produced by somebody else — today, by a human clicking Approve in Photosynthesis
 *   — and a refresh may not touch it. Not drop it, not rewrite it, not quietly reorder its
 *   fields. And because a destructive outcome must never again exit 0 with no mention, the run
 *   must SAY what it did to the file it found: the carried-forward count and the would-drop
 *   count, both, on every forced run — including when they are zero. A number that only appears
 *   when it is interesting is a number nobody can trust the absence of.
 *
 * Returned as a list rather than a boolean on purpose: "the refresh was bad" is not an
 * actionable sentence, and this failure mode is exactly the kind that arrives three at a time.
 */
export function judgeForcedRefresh(o: ForcedRefreshObservation): readonly RefreshViolation[] {
  const violations: RefreshViolation[] = [];
  const afterById = new Map(o.after.map((l) => [l.id, l]));
  const notOurs = o.before.filter((l) => l.source !== "git");

  for (const leaflet of notOurs) {
    const survivor = afterById.get(leaflet.id);
    if (survivor === undefined) {
      violations.push({
        kind: "destroyed",
        message:
          `${leaflet.id} was in the document before the forced run and is gone after it. ` +
          `Its provenance.source is "${String(leaflet.source)}", so intake did not produce it ` +
          `and had no standing to remove it. This is a human's approval, silently withdrawn.`,
      });
      continue;
    }
    if (survivor.json !== leaflet.json) {
      violations.push({
        kind: "modified",
        message:
          `${leaflet.id} survived the forced run but was REWRITTEN. Carried forward means ` +
          `byte-identical:\n  before: ${leaflet.json}\n  after:  ${survivor.json}`,
      });
    }
    if (o.page !== null) {
      const titles = allMatches(o.page, /<h3[^>]*data-verbatim="title"[^>]*>([^<]*)<\/h3>/g);
      if (!titles.includes(leaflet.title)) {
        violations.push({
          kind: "absent-from-page",
          message:
            `${leaflet.id} is in the document after the forced run but NOT on the painted ` +
            `page. The person whose portfolio this is reads the page, not the JSON.`,
        });
      }
    }
  }

  // The blind spot `notOurs` cannot see: rows intake DOES own. A git-sourced leaflet a person
  // shared is exactly the row a forced refresh replaces, and "not ours to touch" is no
  // protection for it — this file's whole reason to exist is that intake replacing rows it
  // owns is not automatically safe. `excluded` is the one case a drop is correct: that row is
  // no longer this person's own work, and a public flag surviving onto it would be the silent
  // widening the product refuses.
  const sharedGit = o.before.filter(
    (l) => l.source === "git" && l.visibility !== null && l.visibility !== "private",
  );
  for (const leaflet of sharedGit) {
    const survivor = afterById.get(leaflet.id);
    if (survivor === undefined) continue; // not-re-derived: a different, already-checked failure.
    if (survivor.tier === "excluded") continue; // the one case dropping it is correct.
    if (survivor.visibility !== leaflet.visibility) {
      violations.push({
        kind: "visibility-lost",
        message:
          `${leaflet.id} was shared (visibility: "${leaflet.visibility}") before the forced ` +
          `run and is "${String(survivor.visibility)}" after it, though its tier is still ` +
          `"${survivor.tier}" — not the one case (a flip to excluded) in which dropping a ` +
          `share decision is correct. A share decision must survive a refresh unless the work ` +
          `stops being this person's.`,
      });
    }
  }

  // What intake SAID. Every count is recomputed here, from the two documents and from the
  // history the caller rewrote — never read off the output — so a run that prints a flattering
  // number fails instead of passing.
  if (!/merged into|existing document|no document existed/i.test(o.stdout)) {
    violations.push({
      kind: "silent-existing",
      message:
        `intake's stdout never says what became of the document that was already at that ` +
        `path. The defect this seam exists for exited 0 having deleted two human approvals ` +
        `and printed nothing about the existing file at all — not that one had been read, not ` +
        `what happened to its contents.\nstdout was:\n${o.stdout}`,
    });
  }

  const carried = notOurs.filter((l) => afterById.has(l.id)).length;
  const carryNumbers = reportedCarriedForward(o.stdout);
  if (carryNumbers.length === 0) {
    violations.push({
      kind: "silent-carry",
      message:
        `no carried-forward count anywhere in intake's stdout. ${notOurs.length} leaflet(s) ` +
        `intake did not produce were in that file and ${carried} survived. Exit ` +
        `${String(o.exitCode)} with no mention is how this defect stayed invisible for a ` +
        `release.\nstdout was:\n${o.stdout}`,
    });
  } else if (!carryNumbers.includes(carried)) {
    violations.push({
      kind: "wrong-carry-count",
      message:
        `${carried} leaflet(s) were carried forward, but the carried-forward count(s) printed ` +
        `were ${JSON.stringify(carryNumbers)}. A count that disagrees with the file is worse ` +
        `than no count.`,
    });
  }

  // The would-drop side is only checkable when the caller established it outside the document.
  // Where it is, it is checked hard: a git-sourced leaflet this run could not re-derive must be
  // reported WITH ITS COUNT, because "something was kept" is not a report an operator can act on.
  const expectUnderived = o.expectUnderived ?? 0;
  if (
    expectUnderived > 0 &&
    !numbersOnLinesMatching(o.stdout, /would[- ]?drop|not re-derived|drop-underived/i).includes(
      expectUnderived,
    )
  ) {
    violations.push({
      kind: "silent-would-drop",
      message:
        `${expectUnderived} git-sourced leaflet(s) could not be re-derived this run and no ` +
        `line states that number. A destructive outcome must never again be reachable without ` +
        `a mention.\nstdout was:\n${o.stdout}`,
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------------------------
// Reading the real artifacts.
// ---------------------------------------------------------------------------------------------

/** Read a leaf document off disk, prove the product can still load it, and reduce it. */
async function observe(path: string): Promise<readonly ObservedLeaflet[]> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  const parsed = parseLeafDocument(raw);
  assert.equal(
    parsed.ok,
    true,
    `the document at ${path} must be one this product can load: ` +
      (parsed.ok ? "" : parsed.issues.map((i) => `${i.at}: ${i.message}`).join("; ")),
  );
  const leaflets = (raw as { leaflets: Record<string, unknown>[] }).leaflets;
  return leaflets.map((l) => {
    const provenance = l["provenance"] as { source?: unknown } | undefined;
    return {
      id: String(l["id"]),
      title: String(l["title"]),
      tier: String(l["tier"]),
      source:
        provenance !== undefined && typeof provenance["source"] === "string"
          ? provenance["source"]
          : null,
      visibility: typeof l["visibility"] === "string" ? l["visibility"] : null,
      json: JSON.stringify(l),
    };
  });
}

/**
 * A real repository with real commits by one declared author.
 *
 * `git init` and `git commit` — the objects are genuinely in a real object database, and every
 * sha this file asserts on came out of git rather than out of a fixture.
 */
async function realRepo(author: string, messages: readonly string[]): Promise<string> {
  const repo = await tempDir();
  await git(repo, "init", "--quiet", "--initial-branch=main");
  await commitAll(repo, author, messages, 0);
  return repo;
}

async function commitAll(
  repo: string,
  author: string,
  messages: readonly string[],
  startIndex: number,
): Promise<void> {
  for (const [i, message] of messages.entries()) {
    await writeFile(join(repo, `f-${startIndex + i}.txt`), message, "utf8");
    await git(repo, "add", "-A");
    await git(
      repo,
      "-c",
      "user.name=Merge Seam Subject",
      "-c",
      `user.email=${author}`,
      "commit",
      "-m",
      message,
    );
  }
}

const SUBJECT_EMAIL = "merge.seam.subject@example.com";

/**
 * Append a leaflet EXACTLY as `apps/photosynthesis/src/promote.ts` appends one.
 *
 * Not imported, because importing it would drag a harvest document and the whole extraction
 * pipeline into a test about a file write; replicated instead, and the shape is pinned by
 * `promote.ts`'s `toLeaflet`: id `photosynthesis-<candidate>`, tier ALWAYS `pending` (the
 * verified tier is signature-only and no AI pipeline may mint it), provenance source
 * `photosynthesis`, ref the candidate's first evidence ref, observedAt the promotion instant.
 * If that shape ever changes, this test should be updated to match it — a promoted row that no
 * longer looks like a promoted row would make the whole file vacuous.
 */
async function appendPromoted(
  leafPath: string,
  candidate: { id: string; title: string; ref: string },
): Promise<string> {
  const doc = JSON.parse(await readFile(leafPath, "utf8")) as {
    leaflets: Record<string, unknown>[];
  };
  const leaflet = {
    id: `photosynthesis-${candidate.id}`,
    title: candidate.title,
    tier: "pending",
    provenance: {
      source: "photosynthesis",
      ref: candidate.ref,
      observedAt: "2026-08-18T09:15:00Z",
    },
  };
  const merged = { ...doc, leaflets: [...doc.leaflets, leaflet] };
  const check = parseLeafDocument(merged);
  assert.equal(
    check.ok,
    true,
    "the promoted row this test appends must itself be a valid document — otherwise the test " +
      "is measuring its own mistake",
  );
  await writeFile(leafPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return leaflet.id;
}

/**
 * Set `visibility` on one existing row in the document, the same edit `foliage share` makes.
 *
 * Not driven through `share.mjs` for the same reason `appendPromoted` does not import
 * `promote.ts`: this file tests what a forced refresh does to a row that is ALREADY shared, not
 * how sharing itself is written. Refuses if the id is not there — a test that silently shares
 * nothing would report a pass having checked nothing.
 */
async function shareLeaflet(leafPath: string, id: string, visibility: string): Promise<void> {
  const doc = JSON.parse(await readFile(leafPath, "utf8")) as {
    leaflets: Record<string, unknown>[];
  };
  let found = false;
  const leaflets = doc.leaflets.map((l) => {
    if (l["id"] !== id) return l;
    found = true;
    return { ...l, visibility };
  });
  assert.ok(found, `no leaflet ${id} in ${leafPath} to share`);
  const merged = { ...doc, leaflets };
  const check = parseLeafDocument(merged);
  assert.equal(check.ok, true, "the shared row this test writes must itself be a valid document");
  await writeFile(leafPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------------------------
// TIE 1 — the ledger's repro, literally, ending on the painted page.
// ---------------------------------------------------------------------------------------------

test(
  "TIE 1: --force over a document holding an approved leaflet keeps it, says so, and paints it",
  { timeout: 120_000 },
  async () => {
    // 1. A real repository. Real git objects; the shas below came from `git`, not from a table.
    const repo = await realRepo(SUBJECT_EMAIL, [
      "feat: the work the first intake reads",
      "fix: a second real commit",
      "chore: a third",
    ]);

    // 2. Real intake into a fresh path — the no-force path, exclusive create.
    const out = join(await tempDir(), "leaf.json");
    const first = await runIntake({
      repo,
      subject: "Merge Seam Subject",
      identities: [SUBJECT_EMAIL],
      out,
      force: false,
    });
    assert.equal(first.code, 0, `first intake failed:\n${first.stderr}`);
    const afterFirst = await observe(out);
    const gitAfterFirst = afterFirst.filter((l) => l.source === "git").length;
    assert.equal(gitAfterFirst, 3, "three real commits, three git-sourced leaflets");

    // 3. A human approves something in Photosynthesis and it is promoted into this same file.
    //    The ref is a REAL commit in this repository, which is what promote.ts carries: the
    //    candidate's first piece of evidence.
    const headSha = (await git(repo, "rev-parse", "HEAD")).trim();
    const promotedTitle = "Led the incident retro and wrote the follow-up (approved by a human)";
    const promotedId = await appendPromoted(out, {
      id: "cand-retro-001",
      title: promotedTitle,
      ref: `git:${headSha}`,
    });
    const before = await observe(out);
    assert.equal(before.length, 4, "three git leaflets plus one approved one");

    // 4. The repository moves on, exactly as it did in the ledger's repro (59 leaflets became
    //    68 because real work had happened in between).
    await commitAll(repo, SUBJECT_EMAIL, ["feat: work done after the approval", "docs: and more"], 3);

    // 5. THE COMMAND FROM THE LEDGER ROW, against the SAME path, with --force.
    const forced = await runIntake({
      repo,
      subject: "Merge Seam Subject",
      identities: [SUBJECT_EMAIL],
      out,
      force: true,
    });
    assert.equal(forced.code, 0, `forced intake failed:\n${forced.stderr}`);
    const after = await observe(out);

    // The git-derived set GREW — the refresh did its actual job, so a green result here cannot
    // be explained by intake having quietly done nothing.
    assert.equal(
      after.filter((l) => l.source === "git").length,
      5,
      "the forced refresh must pick up the two new commits",
    );

    // 6. THE PAGE. A real server over the real file, and the promoted row must be ON it.
    await withPaintedPage(out, async (page) => {
      assert.equal(page.status, 200);
      // The listener is ours: this subject string exists only in the document we just wrote.
      assert.ok(
        page.html.includes("Merge Seam Subject"),
        "the process answering this port is not serving our document — do not trust its bytes",
      );

      const violations = judgeForcedRefresh({
        before,
        after,
        stdout: forced.stdout,
        exitCode: forced.code,
        page: page.html,
      });
      assert.deepEqual(
        violations.map((v) => `${v.kind}: ${v.message}`),
        [],
        "a forced refresh must not destroy, rewrite, hide or fail to mention work it did not produce",
      );

      // Said again directly, without the checker, because this one sentence is the row: the
      // approved title is on the page a reader actually sees, after the refresh that used to
      // delete it.
      assert.ok(
        page.html.includes(promotedTitle.replace(/&/g, "&amp;")),
        `the approved leaflet ${promotedId} must be painted, not merely present in the JSON`,
      );
    });

    // 7. The atomic write left no debris. `rename` into place means the directory holds the
    //    document and nothing else; a stray temp file is a half-written document waiting to be
    //    mistaken for one.
    const entries = await readdir(join(out, ".."));
    assert.deepEqual(entries, ["leaf.json"], "a forced write must leave no temp file behind");
  },
);

// ---------------------------------------------------------------------------------------------
// TIE 2 — the teeth. The pre-fix outcome must FAIL this test.
// ---------------------------------------------------------------------------------------------

test(
  "TIE 2: the pre-fix outcome — approval gone, count changed, exit 0 — is REJECTED",
  { timeout: 30_000 },
  async () => {
    // Constructed rather than run, because once P2 is fixed the broken behaviour is no longer
    // reachable through the real command — and a test whose teeth disappear the moment the bug
    // is fixed cannot tell anyone whether the fix still holds. This is the observation the
    // ledger recorded on 2026-08-18, in the shape `judgeForcedRefresh` receives.
    const approved: ObservedLeaflet = {
      id: "photosynthesis-cand-retro-001",
      title: "Led the incident retro and wrote the follow-up (approved by a human)",
      tier: "pending",
      source: "photosynthesis",
      visibility: null,
      json: JSON.stringify({ id: "photosynthesis-cand-retro-001", tier: "pending" }),
    };
    const gitLeaflet = (n: number): ObservedLeaflet => ({
      id: `git:${String(n).padStart(40, "0")}`,
      title: `commit ${n}`,
      tier: "pending",
      source: "git",
      visibility: null,
      json: JSON.stringify({ id: `git:${String(n).padStart(40, "0")}`, tier: "pending" }),
    });

    const preFix = judgeForcedRefresh({
      before: [gitLeaflet(1), gitLeaflet(2), approved],
      // The whole-document overwrite: every git leaflet re-derived, the approved one simply
      // not there. Counts changed, nothing said, exit 0.
      after: [gitLeaflet(1), gitLeaflet(2), gitLeaflet(3)],
      stdout:
        "intake: read 3 non-merge commit(s) from /tmp/repo\n" +
        "intake: wrote /tmp/leaf.json\n" +
        "intake: verified 0  pending 3  excluded 0\n",
      exitCode: 0,
      page: "<h3 data-verbatim=\"title\">commit 1</h3>",
    });

    const kinds = preFix.map((v) => v.kind);
    assert.ok(
      kinds.includes("destroyed"),
      "the destroyed approval must be named — this is the whole defect",
    );
    assert.ok(
      preFix.some((v) => v.kind === "destroyed" && v.message.includes(approved.id)),
      "and named BY ID, so an operator knows what they lost rather than that they lost",
    );
    assert.ok(
      kinds.includes("silent-existing"),
      "silence about the existing file is its own violation: exit 0 with no mention is what " +
        "let this ship",
    );
    assert.ok(
      kinds.includes("silent-carry"),
      "and so is the missing carried-forward count",
    );

    // And the mirror: a well-behaved observation must produce NOTHING, or the checker is a
    // rubber stamp in the other direction.
    const wellBehaved = judgeForcedRefresh({
      before: [gitLeaflet(1), approved],
      after: [gitLeaflet(1), gitLeaflet(2), approved],
      stdout:
        "intake: merged into the existing /tmp/leaf.json:\n" +
        "intake:   kept 1  updated 0  added 1  carried forward 1\n",
      exitCode: 0,
      page: `<h3 data-verbatim="title">${approved.title}</h3>`,
    });
    assert.deepEqual(wellBehaved, [], "a correct refresh must produce no violations");

    // A COUNT THAT DISAGREES WITH THE FILE. The same well-behaved run, saying "0" about one
    // carried leaflet — which is the shape a regression takes once the line exists and the
    // number stops being computed from the document.
    assert.deepEqual(
      judgeForcedRefresh({
        before: [gitLeaflet(1), approved],
        after: [gitLeaflet(1), approved],
        stdout:
          "intake: merged into the existing /tmp/leaf.json:\n" +
          "intake:   kept 1  updated 0  added 0  carried forward 0\n",
        exitCode: 0,
        page: `<h3 data-verbatim="title">${approved.title}</h3>`,
      }).map((v) => v.kind),
      ["wrong-carry-count"],
      "the count must be read as the count, not matched against any number on the line",
    );

    // A leaflet this run could not re-derive, kept and never mentioned.
    assert.ok(
      judgeForcedRefresh({
        before: [gitLeaflet(1), gitLeaflet(2), approved],
        after: [gitLeaflet(1), gitLeaflet(2), approved],
        stdout:
          "intake: merged into the existing /tmp/leaf.json:\n" +
          "intake:   kept 2  updated 0  added 0  carried forward 1\n",
        exitCode: 0,
        page: `<h3 data-verbatim="title">${approved.title}</h3>`,
        expectUnderived: 1,
      })
        .map((v) => v.kind)
        .includes("silent-would-drop"),
      "keeping a leaflet the history no longer contains, silently, is the same defect in a " +
        "quieter register",
    );

    // A rewrite is not a carry-forward, even when the row is still there under the same id.
    const rewritten = judgeForcedRefresh({
      before: [approved],
      after: [{ ...approved, json: JSON.stringify({ id: approved.id, tier: "verified" }) }],
      stdout:
        "intake: merged into the existing /tmp/leaf.json:\n" +
        "intake:   kept 0  updated 0  added 0  carried forward 1\n",
      exitCode: 0,
      page: `<h3 data-verbatim="title">${approved.title}</h3>`,
    });
    assert.deepEqual(
      rewritten.map((v) => v.kind),
      ["modified"],
      "silently promoting somebody's approved row to verified is data loss wearing a promotion",
    );
  },
);

// ---------------------------------------------------------------------------------------------
// TIE 3 — a git leaflet this run genuinely could not re-derive.
// ---------------------------------------------------------------------------------------------

test(
  "TIE 3: a git leaflet that history no longer contains is KEPT and reported by id",
  { timeout: 120_000 },
  async () => {
    // Real history, really rewritten: the tip commit is discarded between the two runs, so the
    // second run cannot re-derive the leaflet the first one wrote. No simulation — `git reset
    // --hard` makes the object genuinely unreachable, which is exactly what happens to a person
    // who rebases, squashes, or amends after their first intake.
    const repo = await realRepo(SUBJECT_EMAIL, [
      "feat: a commit that survives the rewrite",
      "fix: a second survivor",
      "chore: the commit that gets rewritten away",
    ]);
    const doomedSha = (await git(repo, "rev-parse", "HEAD")).trim();

    const out = join(await tempDir(), "leaf.json");
    const first = await runIntake({
      repo,
      subject: "Merge Seam Subject",
      identities: [SUBJECT_EMAIL],
      out,
      force: false,
    });
    assert.equal(first.code, 0, `first intake failed:\n${first.stderr}`);

    const beforeAll = await observe(out);
    const doomed = beforeAll.find((l) => l.json.includes(doomedSha));
    assert.ok(doomed, `the first run must have written a leaflet for ${doomedSha}`);

    // A human approves something too, so this test also covers the case the fix must not
    // regress: both kinds of survivor in one document.
    const promotedId = await appendPromoted(out, {
      id: "cand-rewrite-002",
      title: "Reviewed the migration plan (approved by a human)",
      ref: `git:${doomedSha}`,
    });
    const before = await observe(out);

    await git(repo, "reset", "--hard", "--quiet", "HEAD~1");
    const survivingShas = (await git(repo, "log", "--format=%H")).trim().split("\n");
    assert.equal(survivingShas.length, 2, "the rewrite must actually have removed a commit");
    assert.ok(!survivingShas.includes(doomedSha), `${doomedSha} must be unreachable now`);

    const forced = await runIntake({
      repo,
      subject: "Merge Seam Subject",
      identities: [SUBJECT_EMAIL],
      out,
      force: true,
    });
    assert.equal(forced.code, 0, `forced intake failed:\n${forced.stderr}`);
    const after = await observe(out);
    const afterIds = new Set(after.map((l) => l.id));

    // KEPT, absent an explicit opt-in. Dropping it would be intake deciding, on its own, that
    // work the person did stopped counting because their history was rewritten.
    assert.ok(
      afterIds.has(doomed.id),
      `${doomed.id} was derived from ${doomedSha}, which this run could not re-derive. It must ` +
        `be kept and reported, not silently dropped — a dropped row is a claim that the work ` +
        `never happened.`,
    );
    assert.ok(afterIds.has(promotedId), "and the approved row survives alongside it");

    // REPORTED BY ID, with a would-drop count that is not zero. "Something was kept" is not a
    // report; the operator has to be able to go and look at the one thing.
    assert.ok(
      forced.stdout.includes(doomed.id) || forced.stdout.includes(doomedSha),
      `intake must name ${doomed.id} (or ${doomedSha}) on stdout — it is the row a human has ` +
        `to make a decision about.\nstdout was:\n${forced.stdout}`,
    );
    assert.ok(
      numbersOnLinesMatching(forced.stdout, /would[- ]?drop|not re-derived|drop-underived/i).includes(
        1,
      ),
      `exactly one leaflet could not be re-derived and the count must say 1.\n` +
        `stdout was:\n${forced.stdout}`,
    );

    // The generic judgement holds too, page included.
    await withPaintedPage(out, async (page) => {
      assert.equal(page.status, 200);
      assert.ok(page.html.includes("Merge Seam Subject"), "the answering process must be ours");
      assert.deepEqual(
        judgeForcedRefresh({
          before,
          after,
          stdout: forced.stdout,
          exitCode: forced.code,
          page: page.html,
          expectUnderived: 1,
        }).map((v) => `${v.kind}: ${v.message}`),
        [],
      );
    });
  },
);

test(
  "TIE 3b: a kept leaflet whose commit the repository read does not hold gets no command naming that repository; one it holds still does",
  { timeout: 120_000 },
  async () => {
    // MEASURED (0.3.0 retest): grow --repo B into a garden grown from A printed "Settle it: git -C
    // <B> show --no-patch <sha>" for A's commit. B cannot show it, and intake does not know which
    // repository can, so the command is left out and the sentence says where the commit is not.
    const first = await realRepo(SUBJECT_EMAIL, ["feat: work in the first repository"]);
    const second = await realRepo(SUBJECT_EMAIL, ["docs: work in the second repository", "fix: a second commit there"]);
    const elsewhere = (await git(first, "rev-parse", "HEAD")).trim();
    const out = join(await tempDir(), "leaf.json");
    const grown = await runIntake({ repo: first, subject: "Merge Seam Subject", identities: [SUBJECT_EMAIL], out, force: false });
    assert.equal(grown.code, 0, grown.stderr);

    const other = await runIntake({ repo: second, subject: "Merge Seam Subject", identities: [SUBJECT_EMAIL], out, force: true });
    assert.equal(other.code, 0, other.stderr);
    const root = await realpath(second);
    assert.doesNotMatch(other.stdout, /Settle it/, other.stdout);
    assert.ok(!other.stdout.includes(`show --no-patch ${elsewhere}`), other.stdout);
    assert.ok(other.stdout.includes(`git:${elsewhere}`), "the kept leaflet is still named by id");
    assert.ok(
      other.stdout.includes(`intake:     this run produced no leaflet for it, and its commit is not in ${root}: it may come from another repository grown into this garden, or be gone from this one's history. Look for it in the repository it came from.\n`),
      other.stdout,
    );
    assert.ok(other.stdout.includes(`intake:   --drop-underived would also remove the 1 whose commit is not in ${root}, even if it is another repository's work.\n`), other.stdout);
    assert.ok((await observe(out)).some((l) => l.id === `git:${elsewhere}`), "and it is kept");

    // A commit the repository still holds, though no branch reaches it any more, keeps its command.
    const dropped = (await git(second, "rev-parse", "HEAD")).trim();
    await git(second, "reset", "--hard", "--quiet", "HEAD~1");
    const rewritten = await runIntake({ repo: second, subject: "Merge Seam Subject", identities: [SUBJECT_EMAIL], out, force: true });
    assert.equal(rewritten.code, 0, rewritten.stderr);
    assert.ok(rewritten.stdout.includes(`Settle it: git -C ${root} show --no-patch ${dropped}\n`), rewritten.stdout);
    assert.ok(!rewritten.stdout.includes(`show --no-patch ${elsewhere}`), rewritten.stdout);
  },
);

test(
  "TIE 3c: when git gives no answer about which commits the repository holds, nothing is claimed absent and no command is named",
  { timeout: 120_000 },
  async () => {
    // The check is one `cat-file --batch-check`. A git that answers every read but that one
    // (SYNTHETIC: a PATH shim refusing only cat-file) checked nothing, so the kept leaflet is not
    // said to be missing from the repository, and no command that might not work is offered.
    const first = await realRepo(SUBJECT_EMAIL, ["feat: work in the first repository"]);
    const second = await realRepo(SUBJECT_EMAIL, ["docs: work in the second repository"]);
    const elsewhere = (await git(first, "rev-parse", "HEAD")).trim();
    const out = join(await tempDir(), "leaf.json");
    const grown = await runIntake({ repo: first, subject: "Merge Seam Subject", identities: [SUBJECT_EMAIL], out, force: false });
    assert.equal(grown.code, 0, grown.stderr);

    const bin = await tempDir();
    const realGit = `${(await exec("git", ["--exec-path"], { encoding: "utf8" })).stdout.trim()}/git`;
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = cat-file ] && { echo "synthetic: cat-file refused" >&2; exit 1; }; done\nexec ${JSON.stringify(realGit)} "$@"\n`,
      { mode: 0o755 },
    );
    const env = { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` };
    const other = await runIntake({ repo: second, subject: "Merge Seam Subject", identities: [SUBJECT_EMAIL], out, force: true, env });
    assert.equal(other.code, 0, other.stderr);
    assert.ok(other.stdout.includes(`git:${elsewhere}`), "the kept leaflet is still named by id");
    assert.match(other.stdout, /KEPT, not re-derived — not-re-derived:/, other.stdout);
    assert.ok(
      other.stdout.includes(
        "intake:     this run produced no leaflet for it. That is the observation, not a diagnosis: the history may " +
          "have been rewritten, the commit may no longer be reachable, or the declared identities may have changed.\n",
      ),
      other.stdout,
    );
    assert.doesNotMatch(other.stdout, /not in .*: it may come from another repository|Settle it|--drop-underived would also remove/, other.stdout);
  },
);

// ---------------------------------------------------------------------------------------------
// TIE 4 — a failure is never a zero, and never an overwrite.
// ---------------------------------------------------------------------------------------------

test(
  "TIE 4: --force over an unreadable document writes NOTHING and names the cause",
  { timeout: 120_000 },
  async () => {
    const repo = await realRepo(SUBJECT_EMAIL, ["feat: the only commit here"]);
    const out = join(await tempDir(), "leaf.json");

    // Truncated JSON — the shape a file takes when a previous write was interrupted, which is
    // exactly when the operator can least afford to lose it. A fall-through to overwrite would
    // destroy the evidence of the failure along with the file.
    const damaged = '{\n  "id": "merge-seam",\n  "subject": "Merge Seam Subject",\n  "leaflets": [\n';
    await writeFile(out, damaged, "utf8");

    const forced = await runIntake({
      repo,
      subject: "Merge Seam Subject",
      identities: [SUBJECT_EMAIL],
      out,
      force: true,
    });

    assert.notEqual(
      forced.code,
      0,
      `intake exited 0 over a document it could not read. A failure is never a zero, and it is ` +
        `never an overwrite either.\nstdout:\n${forced.stdout}\nstderr:\n${forced.stderr}`,
    );
    assert.equal(
      await readFile(out, "utf8"),
      damaged,
      "the unreadable document must be left exactly as it was found",
    );
    assert.match(
      `${forced.stdout}${forced.stderr}`,
      /pars|read|invalid|malformed|not a leaf/i,
      "the refusal must name a cause — 'it failed' sends the operator looking at everything",
    );
    assert.ok(
      `${forced.stdout}${forced.stderr}`.includes(out),
      "and name the file it refused to touch",
    );

    // No temp file left behind by the aborted write, either.
    assert.deepEqual(
      await readdir(join(out, "..")),
      ["leaf.json"],
      "an aborted forced write must leave no debris",
    );
  },
);

// ---------------------------------------------------------------------------------------------
// TIE 5 — a share decision on a git-owned row survives the refresh that owns the row.
// ---------------------------------------------------------------------------------------------
//
// TIE 1-4 all filter to `l.source !== "git"` (`notOurs`, :337) before checking anything, which
// is exactly the blind spot that let this ship: intake DOES own git rows, and "intake owns it"
// was read as "intake may erase whatever a human later did to it". A leaflet a person shared
// has no other source to declare — it is a git row with `visibility` added after the fact —
// so the non-git checks above never see it at all.

test(
  "TIE 5: a shared git leaflet's visibility survives an ordinary forced refresh",
  { timeout: 120_000 },
  async () => {
    const repo = await realRepo(SUBJECT_EMAIL, ["feat: the work this person shared"]);
    const out = join(await tempDir(), "leaf.json");

    const first = await runIntake({
      repo,
      subject: "Merge Seam Subject",
      identities: [SUBJECT_EMAIL],
      out,
      force: false,
    });
    assert.equal(first.code, 0, `first intake failed:\n${first.stderr}`);

    const afterFirst = await observe(out);
    const shared = afterFirst.find((l) => l.source === "git");
    assert.ok(shared, "the first run must have written at least one git-sourced leaflet");
    await shareLeaflet(out, shared.id, "public");
    const before = await observe(out);
    assert.equal(
      before.find((l) => l.id === shared.id)?.visibility,
      "public",
      "the row must actually be shared before the refresh this test measures",
    );

    // An ORDINARY forced refresh: same repository, same declared identity, one unrelated new
    // commit. The shared row is re-derived unchanged apart from observedAt, so it is kept as it
    // was; the update path's consent carry is pinned in packages/leaf/src/merge.test.ts.
    await commitAll(repo, SUBJECT_EMAIL, ["fix: something unrelated, after the share"], 1);
    const forced = await runIntake({
      repo,
      subject: "Merge Seam Subject",
      identities: [SUBJECT_EMAIL],
      out,
      force: true,
    });
    assert.equal(forced.code, 0, `forced intake failed:\n${forced.stderr}`);
    const after = await observe(out);

    assert.equal(
      after.find((l) => l.id === shared.id)?.visibility,
      "public",
      `${shared.id} was shared before the forced refresh and must still be shared after it — ` +
        `an ordinary re-run is not a reason for a share decision to disappear.`,
    );

    const violations = judgeForcedRefresh({
      before,
      after,
      stdout: forced.stdout,
      exitCode: forced.code,
      page: null,
    });
    assert.deepEqual(
      violations.map((v) => `${v.kind}: ${v.message}`),
      [],
      "the generic judgement must also see nothing wrong",
    );
  },
);

test(
  "TIE 5b: a shared git leaflet that re-derives as excluded loses its visibility and says so",
  { timeout: 120_000 },
  async () => {
    const repo = await realRepo(SUBJECT_EMAIL, ["feat: work later disowned by a changed identity"]);
    const out = join(await tempDir(), "leaf.json");

    const first = await runIntake({
      repo,
      subject: "Merge Seam Subject",
      identities: [SUBJECT_EMAIL],
      out,
      force: false,
    });
    assert.equal(first.code, 0, `first intake failed:\n${first.stderr}`);

    const afterFirst = await observe(out);
    const shared = afterFirst.find((l) => l.source === "git");
    assert.ok(shared, "the first run must have written at least one git-sourced leaflet");
    await shareLeaflet(out, shared.id, "public");

    // The declared identity changes between runs — not the history. This is the same real
    // partition intake reports as "excluded", never simulated.
    const forced = await runIntake({
      repo,
      subject: "Merge Seam Subject",
      identities: ["somebody-else@example.com"],
      out,
      force: true,
    });
    assert.equal(forced.code, 0, `forced intake failed:\n${forced.stderr}`);
    const after = await observe(out);
    const survivor = after.find((l) => l.id === shared.id);

    assert.equal(survivor?.tier, "excluded", "the changed identity must exclude the commit");
    assert.equal(
      survivor?.visibility,
      null,
      "excluded is no longer this person's own work — a public flag must not survive onto it",
    );
    assert.match(
      forced.stdout,
      /visibility/,
      "the drop must be named in the report, not merely visible in the file",
    );
  },
);

test("TIE 5c: the checker itself catches a visibility lost off a git row that stayed attributed", () => {
  // The teeth, in the same shape TIE 2 uses: a synthetic observation shaped like the defect
  // this seam exists to catch, fed to the same checker every real run above is judged by.
  const sharedGit: ObservedLeaflet = {
    id: "git:1111111111111111111111111111111111111111",
    title: "commit shared with a link",
    tier: "pending",
    source: "git",
    visibility: "public",
    json: JSON.stringify({ id: "git:1111111111111111111111111111111111111111", tier: "pending" }),
  };
  const violations = judgeForcedRefresh({
    before: [sharedGit],
    // Re-derived and STILL pending, but the wholesale-overwrite bug this file's header
    // documents dropped the visibility along the way.
    after: [{ ...sharedGit, visibility: null }],
    stdout:
      "intake: merged into the existing /tmp/leaf.json\n" +
      "intake:   carried forward 0  would-drop 0  kept 0  updated 1  added 0\n",
    exitCode: 0,
    page: null,
  });
  assert.deepEqual(violations.map((v) => v.kind), ["visibility-lost"]);

  // And the mirror: a tier that legitimately flips to excluded is not flagged for the same drop.
  const droppedForCause = judgeForcedRefresh({
    before: [sharedGit],
    after: [{ ...sharedGit, tier: "excluded", visibility: null }],
    stdout:
      "intake: merged into the existing /tmp/leaf.json\n" +
      "intake:   carried forward 0  would-drop 0  kept 0  updated 1  added 0\n",
    exitCode: 0,
    page: null,
  });
  assert.deepEqual(droppedForCause, [], "excluded is the one case dropping visibility is correct");
});
