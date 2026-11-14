/**
 * THE SEAM. End-to-end over real HTTP, against the real server process.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE OTHER TESTS HERE. `leafDocument.test.ts` proves the
 * loader reads a real file. `render.test.ts` proves the view turns a load into the right markup.
 * `dayFace.test.ts` proves the declared colour pairings are arithmetically sound. Every one of
 * those can pass while the assembled product is wrong, because none of them starts the server,
 * and none of them compares what a client actually receives against what the domain actually
 * said. That gap is where this project's recorded failures live: a module verified in isolation,
 * reported as a working surface.
 *
 * So these tests spawn `server.mjs` as a real child process, speak HTTP to it, and check the
 * bytes that come back. Five seams, each one a thing that isolated tests cannot see:
 *
 *   1. THE NUMBERS ON THE PAGE ARE THE DOMAIN'S NUMBERS. `attributionLedger()` is called a
 *      second time, here, against the same file, and compared digit for digit with what the
 *      response contains. A view that recounted for itself would pass render.test.ts and fail
 *      this.
 *
 *   2. THE PAGE ASSERTS NOTHING THE DOCUMENT DID NOT CONTAIN. Set difference in both
 *      directions over titles, refs, observed instants, sources and exclusion reasons. This is
 *      the mechanical form of "no fake data": a string on the page that is not in the file is a
 *      fabrication, whatever put it there.
 *
 *   3. ABSENT AND VALID-BUT-EMPTY ARE DIFFERENT RESPONSES. Two servers, two bodies, compared.
 *      The `commitCount: 0` failure was exactly these two states collapsed into one.
 *
 *   4. THE PAGE TRACKS THE FILE WITH NO RESTART. The document is edited between two requests to
 *      the SAME process and the response has to follow it. This is what distinguishes a real
 *      read from a fixture baked in at boot, and it is not observable without a live server.
 *
 *   5. THE PAGE IS DOWNSTREAM OF REAL COMMITS (SEAM 6 below). Every seam above begins with a
 *      document somebody typed; this one begins with `git init` and runs the real intake
 *      command, so the chain producer → document → loader → view is checked end to end. It is
 *      the only test that can see the fabrication band's ABSENCE mean something.
 *
 * Plus one gate that belongs at the seam rather than in either half: the DAY-face contrast fix
 * is a claim in `dayFace.ts` and a CSS rule in `leaf.css`, and nothing tied them together.
 *
 * DISCIPLINE: every wait has a deadline and every child is killed in a `finally`. A check may
 * fail; it must never hang.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { attributionLedger, parseLeafDocument } from "@foliage/leaf";
import { parseHarvestDocument, reviewSubjectDigest } from "@foliage/photosynthesis";

import { esc } from "./render.ts";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const INTAKE = fileURLToPath(new URL("../intake.mjs", import.meta.url));
const LEAF_CSS = fileURLToPath(new URL("../public/leaf.css", import.meta.url));

const exec = promisify(execFile);

/** How long a server gets to answer its first request before the test fails (not hangs). */
const BOOT_DEADLINE_MS = 10_000;
/** Per-request ceiling. A hung fetch would otherwise stall the whole suite. */
const REQUEST_TIMEOUT_MS = 4_000;

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-seam-"));
  tmpRoots.push(dir);
  return dir;
}

/**
 * A port nothing is listening on, obtained by briefly listening on port 0 and asking the OS.
 *
 * There is an unavoidable race between closing this and the child binding it. The alternative —
 * a fixed port — races against every other test run and against the developer's own dev server,
 * which is strictly worse. If the child loses the race it exits and `start` reports the exit,
 * so the failure is legible rather than a hang.
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

interface Response {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;
}

interface Running {
  readonly origin: string;
  /** GET a path, returning status and body. Never waits forever. */
  get(path: string): Promise<{ status: number; body: string }>;
  /** Any method, with the headers back — needed for `allow`, the CSP and a 303's Location. */
  send(path: string, init?: RequestInit): Promise<Response>;
  /**
   * POST the review form. `Origin` is set to this server's own, which is what a browser does on
   * a same-origin form submission and what the server requires — see `sameOrigin` in server.mjs.
   */
  postForm(path: string, fields: Record<string, string>, origin?: string): Promise<Response>;
}

/**
 * Start the real server with the given environment, hand it to `body`, and always kill it.
 *
 * `env` is the ONLY thing that varies: this is the same entry point a self-hoster runs, not a
 * test harness standing in for it.
 */
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
  const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetch(origin + path, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...init,
    });
    return { status: res.status, body: await res.text(), headers: res.headers };
  };
  const get = async (path: string) => {
    const { status, body } = await send(path);
    return { status, body };
  };
  const postForm = (path: string, fields: Record<string, string>, from = origin) =>
    send(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: from },
      body: new URLSearchParams(fields).toString(),
    });

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
        await get("/");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body({ origin, get, send, postForm });
  } finally {
    child.kill("SIGKILL");
    // Reap it, so a finished test never leaves a listener behind for the next one.
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

const REAL_ENOUGH_TO_CHECK = {
  id: "seam-subject-leaf",
  subject: "Seam Test Subject",
  leaflets: [
    {
      id: "seam-v1",
      title: "A verified leaflet <with> \"quotes\" & an ampersand",
      tier: "verified",
      provenance: { source: "git", ref: "0f1e2d3c4b5a6978", observedAt: "2026-08-13T00:00:00Z" },
    },
    {
      id: "seam-v2",
      title: "A second verified leaflet",
      tier: "verified",
      provenance: { source: "git", ref: "aabbccddeeff0011", observedAt: "2026-08-12T11:22:33Z" },
    },
    { id: "seam-p1", title: "A pending leaflet", tier: "pending" },
    {
      id: "seam-x1",
      title: "An excluded leaflet",
      tier: "excluded",
      reason: "could not be attributed to this subject: the commits carry a different author",
    },
    {
      id: "seam-x2",
      title: "A second excluded leaflet",
      tier: "excluded",
      reason: "could not be attributed to this subject: the repository history was rewritten",
    },
  ],
} as const;

async function writeDoc(dir: string, name: string, doc: unknown): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(doc, null, 2), "utf8");
  return path;
}

/** The ledger, computed here from the file rather than taken from the page. */
async function ledgerOf(path: string) {
  const parsed = parseLeafDocument(JSON.parse(await readFile(path, "utf8")));
  assert.equal(parsed.ok, true, `the seam fixture must itself be a valid document: ${path}`);
  if (!parsed.ok) throw new Error("unreachable");
  return { leaf: parsed.leaf, ledger: attributionLedger(parsed.leaf) };
}

test(
  "SEAM 1: the counts a client receives ARE the domain's ledger, computed independently",
  { timeout: 30_000 },
  async () => {
    const dir = await tempDir();
    const path = await writeDoc(dir, "leaf.json", REAL_ENOUGH_TO_CHECK);
    const { ledger } = await ledgerOf(path);

    await withServer({ FOLIAGE_LEAF: path }, async (s) => {
      // The compound leaf lives at /leaf now (render.ts's header records the move); / is the
      // studio dashboard (overview.ts) and carries none of this page's markup.
      const { status, body } = await s.get("/leaf");
      assert.equal(status, 200);
      const source = await s.get("/leaf?records=source");
      assert.equal(source.status, 200);

      // Read the numbers off the wire, keyed by tier so a reordering cannot hide a swap.
      //
      // THE STRIP CARRIES A FOURTH CELL AND IT IS THE TOTAL. That is checked here rather than
      // waved through: a fourth counts cell that is not the total is a fourth proof tier wearing
      // a number, and there are exactly three. So the total is asserted to be the sum of the
      // three AND the number of leaflets in the file — if it were ever anything else it would be
      // a figure the domain never computed.
      const served = new Map(
        [...body.matchAll(/data-count="([a-z]+)">(\d+)</g)].map((m) => [m[1]!, Number(m[2])]),
      );
      assert.deepEqual(
        new Map([...served].filter(([k]) => k !== "total")),
        new Map([
          ["verified", ledger.verified],
          ["pending", ledger.pending],
          ["excluded", ledger.excluded],
        ]),
        "the page's counts must equal attributionLedger() over the same file",
      );
      assert.equal(
        served.get("total"),
        ledger.verified + ledger.pending + ledger.excluded,
        "the fourth cell must be the sum of the three and nothing else",
      );
      assert.equal(
        served.get("total"),
        REAL_ENOUGH_TO_CHECK.leaflets.length,
        "and that sum must be the number of leaflets in the file on disk",
      );
      // No percentage, ratio or proportion anywhere near them.
      assert.doesNotMatch(body, /\d+(?:\.\d+)?\s*%/, "a percentage over a person's work is a score");

      // And the rendered ROWS must agree with the numbers, or the page contradicts itself.
      for (const tier of ["verified", "pending", "excluded"] as const) {
        const rows = [
          // The plain attribute: `data-tier` marks a leaflet ROW and nothing else since
          // the pill took `data-pill-tier`. The old compound match was the workaround from
          // when it was overloaded, and it silently depended on the class list never changing.
          ...(tier === "excluded" ? body : body + source.body).matchAll(new RegExp(`data-tier="${tier}"`, "g")),
        ].length;
        assert.equal(rows, served.get(tier), `${tier}: rendered rows must match the count shown`);
      }

      // Every exclusion reason the domain carries has to be visible, not merely counted.
      for (const reason of ledger.exclusionReasons) {
        assert.ok(
          allMatches(body, /<span class="fol-label">Reason<\/span> ([^<]*)</g).includes(reason),
          `exclusion reason must be rendered as text: ${reason}`,
        );
      }
    });
  },
);

test(
  "SEAM 2: the page asserts NOTHING the document did not contain",
  { timeout: 30_000 },
  async () => {
    const dir = await tempDir();
    const path = await writeDoc(dir, "leaf.json", REAL_ENOUGH_TO_CHECK);
    const doc = REAL_ENOUGH_TO_CHECK;

    await withServer({ FOLIAGE_LEAF: path }, async (s) => {
      const { body } = await s.get("/leaf");
      const { body: sourceBody } = await s.get("/leaf?records=source");

      const provs = doc.leaflets.flatMap((l) => ("provenance" in l ? [l.provenance] : []));
      const cases: readonly [string, string[], readonly string[]][] = [
        [
          "leaflet titles",
          allMatches(body + sourceBody, /<h3[^>]*data-verbatim="title"[^>]*>([^<]*)<\/h3>/g),
          doc.leaflets.map((l) => l.title),
        ],
        [
          "exclusion reasons",
          allMatches(body, /<span class="fol-label">Reason<\/span> ([^<]*)</g),
          doc.leaflets.flatMap((l) => ("reason" in l ? [l.reason] : [])),
        ],
        [
          "provenance refs",
          [...allMatches(body, /<dt class="fol-label">Ref<\/dt><dd class="fol-metric"><span title="([^"]+)"/g),
            ...allMatches(sourceBody, /<code class="fol-metric" title="([^"]+)" aria-label="Git ref /g)],
          provs.map((p) => p.ref),
        ],
        [
          "provenance sources",
          [...allMatches(body, /<dt class="fol-label">Source<\/dt><dd>([^<]*)</g),
            ...allMatches(sourceBody, /<li class="lp-source-record"[^>]*data-source="([^"]+)"/g)],
          provs.map((p) => p.source),
        ],
        ["subject", allMatches(body, /<h1(?:\s[^>]*)?>([^<]*)<\/h1>/g), [doc.subject]],
      ];

      for (const [what, onPage, inFile] of cases) {
        const fabricated = [...new Set(onPage)].filter((v) => !inFile.includes(v));
        assert.deepEqual(fabricated, [], `${what}: on the page but NOT in the document`);
        assert.ok(onPage.length > 0, `${what}: nothing rendered, so nothing was actually checked`);
      }

      // A verified leaflet is an outward claim and must appear; the escaped title proves the
      // comparison survived escaping rather than accidentally matching a mangled string.
      assert.ok(
        (body + sourceBody).includes("A verified leaflet &lt;with&gt; &quot;quotes&quot; &amp; an ampersand"),
        "the title must be present AND escaped",
      );

      // No score, searched in the delivered bytes.
      for (const term of ["%", "score", "rank", "/5", "out of", "rating", "composite"]) {
        assert.ok(
          !body.toLowerCase().includes(term),
          `a served page must contain no "${term}"`,
        );
      }

      // Every ledger link has to land on an id the same response actually rendered.
      for (const id of allMatches(body, /data-ledger="[a-z]+" href="#([^"]+)"/g)) {
        assert.ok(body.includes(`id="${id}"`), `ledger link points at a missing target: #${id}`);
      }
    });
  },
);

test(
  "SEAM 3: absent and valid-but-empty are DIFFERENT responses, not one masked state",
  { timeout: 30_000 },
  async () => {
    const dir = await tempDir();
    const emptyDoc = await writeDoc(dir, "empty.json", {
      id: "empty-leaf",
      subject: "Someone With No Leaflets Yet",
      leaflets: [],
    });
    const missing = join(dir, "definitely-not-created.json");

    let absentBody = "";
    let emptyBody = "";

    await withServer({ FOLIAGE_LEAF: missing }, async (s) => {
      const r = await s.get("/leaf");
      // A first run is not an error: it answers 200 and explains itself.
      assert.equal(r.status, 200);
      absentBody = r.body;
    });
    await withServer({ FOLIAGE_LEAF: emptyDoc }, async (s) => {
      const r = await s.get("/leaf");
      assert.equal(r.status, 200);
      emptyBody = r.body;
    });

    assert.match(absentBody, /data-leaf-state="absent"/);
    assert.match(emptyBody, /data-leaf-state="ok"[^>]*data-leaf-empty="true"/);

    // First-run owner UI gives a working next step without exposing local configuration.
    assert.match(absentBody, /href="\/leaf\/setup"/);
    assert.ok(!absentBody.includes(missing), "the absent page must not expose the local path");
    assert.doesNotMatch(absentBody, /FOLIAGE_LEAF/);

    // The empty leaf is a leaf: its subject is named and its honest zeros are shown.
    assert.ok(emptyBody.includes("Someone With No Leaflets Yet"));
    assert.match(emptyBody, /data-count="verified">0</);

    // THE POINT: the absent page must not be a dashboard of zeros.
    assert.doesNotMatch(absentBody, /data-count=/, "absent must not render a ledger at all");
    assert.notEqual(
      absentBody,
      emptyBody,
      "if these two bodies were equal the two causes would be masked",
    );
  },
);

test(
  "SEAM 4: editing the document changes the page with NO restart",
  { timeout: 30_000 },
  async () => {
    const dir = await tempDir();
    const path = await writeDoc(dir, "leaf.json", REAL_ENOUGH_TO_CHECK);

    await withServer({ FOLIAGE_LEAF: path }, async (s) => {
      const before = await s.get("/leaf");
      const first = await ledgerOf(path);
      assert.ok(before.body.includes(`data-count="verified">${first.ledger.verified}<`));

      // Edit the real file underneath the running process.
      const mutated = {
        ...REAL_ENOUGH_TO_CHECK,
        subject: "Renamed Between Two Requests",
        leaflets: REAL_ENOUGH_TO_CHECK.leaflets.filter((l) => l.id !== "seam-v2"),
      };
      await writeFile(path, JSON.stringify(mutated, null, 2), "utf8");

      const after = await s.get("/leaf");
      const second = await ledgerOf(path);

      assert.notEqual(second.ledger.verified, first.ledger.verified, "the edit must change a count");
      assert.ok(
        after.body.includes(`data-count="verified">${second.ledger.verified}<`),
        "the second response must reflect the edited file",
      );
      assert.ok(after.body.includes("Renamed Between Two Requests"));
      assert.ok(
        !after.body.includes("A second verified leaflet"),
        "a removed leaflet must disappear — a cached page would still show it",
      );
      assert.ok(!after.body.includes(path), "local document diagnostics stay out of the portfolio reading surface");
    });
  },
);

test(
  "SEAM 5: the DAY-face label rebinding still exists, and every page can still reach it",
  { timeout: 10_000 },
  async () => {
    // WHY THIS IS HERE. `dayFace.test.ts` proves --fol-ink-muted on --fol-paper clears AA at
    // 11px. It cannot prove the SERVED page uses it — and by default it would not: the base
    // `.fol-label` rule binds --fol-text-faint, a NIGHT value, and on paper that is:
    //
    //     --fol-text-faint  #7D9184  on --fol-paper  #F6F4ED   =  3.05:1 at 11px  (needs 4.5)
    //
    // A CORRECTION TO A FIGURE THIS FILE CARRIED FOR THREE REVISIONS. It said 3.57:1, in three
    // places, and 3.57 is the ratio of `#728579` — the value --fol-text-faint held BEFORE the
    // token was lifted for exactly this reason. The conclusion was right and the number was one
    // revision stale, which is precisely the failure a recorded ratio is supposed to prevent. It
    // is now computed here, from the token file, rather than quoted.
    //
    // WHAT MOVED. The rebinding used to live in leaf.css as `html[data-face="day"] .fol-label`,
    // and tree.css carried a second copy of the same rule. Both are retired: the face — and this
    // rebinding with it — is in @foliage/tokens now, once, WITHOUT the `html` prefix. Dropping
    // the prefix is a specificity fix, not cosmetics: `html[data-face="day"] .fol-label` is
    // (0,2,1) and silently outranked an ordinary `.some-band .fol-label` at (0,2,0), which is how
    // a label ends up muted inside a band that intended otherwise.
    //
    // So this seam now checks the two halves that can still break independently: the package
    // still rebinds, and every page this app serves still carries the attribute the rebinding is
    // keyed on. Either one alone leaves the pair looking protected while the page fails AA.
    const tokensCss = await readFile(
      fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css")),
      "utf8",
    );

    const rebinding = /\[data-face="day"\][^{]*\.fol-label[^{]*\{[^}]*color:\s*var\(--fol-ink-muted\)/;
    assert.match(
      tokensCss,
      rebinding,
      "@foliage/tokens must rebind .fol-label to --fol-ink-muted on the day face",
    );
    assert.doesNotMatch(
      tokensCss,
      /\[data-face="day"\][^{]*\.fol-label[^{]*\{[^}]*color:\s*var\(--fol-text-faint\)/,
      "--fol-text-faint is a NIGHT value and fails AA on paper at label size",
    );

    // The night value's REAL ratio on paper, computed rather than quoted. This is the number that
    // makes the rebinding necessary, and if it ever clears 4.5 the rebinding is redundant and
    // should be deleted rather than left as folklore.
    const { contrastRatio, resolveTokenValue } = await import("./dayFace.ts");
    const faint = resolveTokenValue(tokensCss, "--fol-text-faint");
    const paper = resolveTokenValue(tokensCss, "--fol-paper");
    const inkMuted = resolveTokenValue(tokensCss, "--fol-ink-muted");
    assert.ok(faint !== null && paper !== null && inkMuted !== null, "a token did not resolve");
    const unbound = contrastRatio(faint, paper);
    const bound = contrastRatio(inkMuted, paper);
    assert.ok(unbound !== null && bound !== null, "a pairing could not be measured");
    console.log(
      `    .fol-label on --fol-paper at 11px: unbound ${unbound.toFixed(2)}:1 ` +
        `(--fol-text-faint), rebound ${bound.toFixed(2)}:1 (--fol-ink-muted), needs 4.5:1`,
    );
    assert.ok(unbound < 4.5, "the night faint token must still FAIL on paper, or this rule is dead");
    assert.ok(bound >= 4.5, "the rebinding must clear AA at 11px, which is normal text");

    // And leaf.css must NOT have grown its own copy back. A second rebinding is the drift.
    const css = await readFile(LEAF_CSS, "utf8");
    assert.doesNotMatch(
      css.replace(/\/\*[\s\S]*?\*\//g, ""),
      /\.fol-label\s*\{[^}]*color:\s*var\(--fol-(?:ink-muted|text-faint)\)/,
      "the label's face colour belongs to @foliage/tokens; a copy here is the drift surface",
    );

    // The rebinding is only reachable while the renderer emits the attribute it is keyed on.
    // EVERY surface, not one: a page that forgot it would render night labels on paper.
    const { renderLeafPage } = await import("./render.ts");
    // The empty policy: this assertion is about the day face, not about the rail, and an empty
    // policy fires no rule while still being a real state of the domain.
    const failure = renderLeafPage(
      { ok: false, cause: "absent", detail: "d", path: "/nowhere" },
      { rules: [] },
    );
    assert.match(
      failure,
      /<html[^>]*data-face="day"/,
      'the day-face selector is dead unless every page carries data-face="day"',
    );
  },
);

/**
 * SEAM 6 — THE PRODUCER SEAM: a real repository, through intake, to a rendered page.
 *
 * Every seam above starts from a document somebody typed. This one starts from COMMITS, which
 * is the only way to check the property that actually distinguishes this capability: that the
 * page a reader sees is downstream of real git objects and of nothing else.
 *
 * Four things are checked here that no unit test can see:
 *
 *   a. THE FABRICATION BAND IS ABSENT. Every populated page this product had ever rendered
 *      carried `data-fabricated="true"`, because the only populated document in the tree was
 *      the declared example. A populated page WITHOUT the band is the first real portfolio
 *      this product has produced, and the band's absence is the single visual difference that
 *      the whole row turns on.
 *   b. A REF READ OFF THE PAGE RESOLVES IN GIT. Not off the JSON — off the rendered HTML, so
 *      the check spans the producer, the document, the loader and the view. `git cat-file -t`
 *      answering `commit` is the mechanical form of no-fake-data.
 *   c. THE COUNTS ARE THE DOMAIN'S COUNTS, recomputed here from the file.
 *   d. NOTHING ON THE PAGE WAS INVENTED — set difference in both directions, as SEAM 2 does
 *      for a hand-written document, now for a machine-produced one.
 */

/** `git` in a directory, non-interactive, ambient config neutralised. */
async function seamGit(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(
    "git",
    ["-C", dir, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { encoding: "utf8", timeout: 60_000 },
  );
  return stdout;
}

const SEAM_AUTHOR = "seam.subject@example.com";
const SEAM_OTHER = "seam.other@example.com";

test(
  "SEAM 6: a REAL repository becomes a page with no fabrication band and resolvable refs",
  { timeout: 60_000 },
  async () => {
    // 1. A real repository with real commits — real git objects, not a fixture.
    const repo = await tempDir();
    await seamGit(repo, "init", "--quiet", "--initial-branch=main");
    const messages = [
      "feat: the first real thing this product ever ingested",
      'fix: a subject with "quotes" & an ampersand <and> angle brackets',
      "chore: a third commit",
    ];
    for (const [i, message] of messages.entries()) {
      await writeFile(join(repo, `file-${i}.txt`), message, "utf8");
      await seamGit(repo, "add", "-A");
      await seamGit(
        repo,
        "-c",
        "user.name=Seam Subject",
        "-c",
        `user.email=${SEAM_AUTHOR}`,
        "commit",
        "-m",
        message,
      );
    }
    // One commit by somebody else, so the excluded path is exercised end to end.
    await writeFile(join(repo, "theirs.txt"), "not the subject's work", "utf8");
    await seamGit(repo, "add", "-A");
    await seamGit(
      repo,
      "-c",
      "user.name=Someone Else",
      "-c",
      `user.email=${SEAM_OTHER}`,
      "commit",
      "-m",
      "docs: a commit by another author entirely",
    );

    // 2. Run the REAL intake command — the same one a self-hoster runs.
    const out = join(await tempDir(), "leaf.json");
    const { stdout: intakeLog } = await exec(
      process.execPath,
      [INTAKE, "--repo", repo, "--subject", "Seam Subject", "--identity", SEAM_AUTHOR, "--out", out],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.match(intakeLog, /read 4 non-merge commit\(s\)/);

    const document = JSON.parse(await readFile(out, "utf8")) as {
      subject: string;
      leaflets: { title: string; reason?: string; provenance?: { ref: string; source: string } }[];
    };
    const { leaf, ledger } = await ledgerOf(out);

    // The producer's own arithmetic, stated so a silent change is visible here.
    assert.deepEqual(
      { v: ledger.verified, p: ledger.pending, x: ledger.excluded },
      { v: 0, p: 3, x: 1 },
      "unsigned commits are pending; another author's commit is excluded",
    );

    // 3. Serve it and look at what a client actually receives.
    await withServer({ FOLIAGE_LEAF: out }, async (s) => {
      const { status, body } = await s.get("/leaf?records=source");
      assert.equal(status, 200);

      // (a) THE ROW-DEFINING ASSERTION.
      assert.ok(
        !body.includes("data-fabricated"),
        "a document produced from real commits must NOT carry the fabrication band",
      );
      assert.ok(
        !body.includes("Example document"),
        "nor the example wording that band renders",
      );
      // ...and the page is genuinely populated, so the absence is not vacuous.
      assert.match(body, /data-tier="/, "the page must actually have leaflets on it");

      // (b) A REF READ OFF THE PAGE MUST RESOLVE IN THE REPOSITORY.
      const refsOnPage = [
        ...allMatches(body, /<code class="fol-metric" title="([^"]+)" aria-label="Git ref /g),
        ...allMatches(body, /<dt class="fol-label">Ref<\/dt><dd class="fol-metric"><span title="([^"]+)"/g),
      ];
      assert.equal(refsOnPage.length, 4, "every leaflet's provenance must reach the page");
      for (const ref of refsOnPage) {
        const type = (await seamGit(repo, "cat-file", "-t", ref)).trim();
        assert.equal(type, "commit", `${ref} came off the page and must be a real commit`);
      }

      // (c) THE COUNTS ARE THE DOMAIN'S COUNTS, recomputed from the file — and the total is the
      //     sum of them, over real commits rather than a fixture.
      const served = new Map(
        [...body.matchAll(/data-count="([a-z]+)">(\d+)</g)].map((m) => [m[1]!, Number(m[2])]),
      );
      assert.deepEqual(
        new Map([...served].filter(([k]) => k !== "total")),
        new Map([
          ["verified", ledger.verified],
          ["pending", ledger.pending],
          ["excluded", ledger.excluded],
        ]),
      );
      assert.equal(served.get("total"), document.leaflets.length);

      // (d) NOTHING INVENTED — set difference in BOTH directions.
      const cases: readonly [string, string[], string[]][] = [
        [
          "leaflet titles",
          allMatches(body, /<h3[^>]*data-verbatim="title"[^>]*>([^<]*)<\/h3>/g),
          document.leaflets.map((l) => l.title),
        ],
        [
          "provenance refs",
          refsOnPage,
          document.leaflets.flatMap((l) => (l.provenance ? [l.provenance.ref] : [])),
        ],
        [
          "exclusion reasons",
          allMatches(body, /<span class="fol-label">Reason<\/span> ([^<]*)</g),
          document.leaflets.flatMap((l) => (l.reason !== undefined ? [l.reason] : [])),
        ],
      ];
      for (const [what, onPage, inFile] of cases) {
        assert.ok(onPage.length > 0, `${what}: nothing rendered, so nothing was checked`);
        assert.deepEqual(
          [...new Set(onPage)].filter((v) => !inFile.includes(v)),
          [],
          `${what}: on the page but NOT in the document — a fabrication`,
        );
        assert.deepEqual(
          [...new Set(inFile)].filter((v) => !onPage.includes(v)),
          [],
          `${what}: in the document but NOT on the page — a silent omission`,
        );
      }

      // The subject named on the page is the one intake was told, not one it inferred.
      assert.deepEqual(allMatches(body, /<h1(?:\s[^>]*)?>([^<]*)<\/h1>/g), [leaf.subject]);

      // (e) NO THIRD PARTY'S ADDRESS REACHES THE PUBLIC PAGE. The excluded commit belongs to
      // somebody else; publishing their email on the subject's portfolio would be an egress
      // leak, and the exclusion reason is the one place it could slip through.
      assert.ok(!body.includes(SEAM_OTHER), "another author's address must never be rendered");
      assert.ok(!body.includes(SEAM_AUTHOR), "nor the subject's own, which was never asked for");
    });
  },
);

const SEAM7_SUBJECT = "seam7.subject@example.com";
const SEAM7_FOREIGN = ["seam7.first@example.com", "seam7.second@example.com"] as const;

/**
 * Build a real, genuinely multi-author repository and return its path.
 *
 * Real `git init`, real commits, real distinct author identities — the exclusion in SEAM 7 is
 * produced by git reporting somebody else's address, not by a document that says "excluded".
 */
async function multiAuthorRepo(): Promise<string> {
  const repo = await tempDir();
  await seamGit(repo, "init", "--quiet", "--initial-branch=main");
  const commits: readonly [string, string][] = [
    // The subject's own work. One title deliberately carries a score-shaped word, because that
    // is what a real commit subject is allowed to say and the page must carry it unaltered.
    [SEAM7_SUBJECT, "feat: add score normalizer and a 40% faster ranking pass"],
    [SEAM7_SUBJECT, "fix: the second thing the subject actually did"],
    // Three commits by two other people, so `excluded` is exercised well past n=1.
    [SEAM7_FOREIGN[0], "docs: somebody else's commit"],
    [SEAM7_FOREIGN[1], "chore: a third party's commit"],
    [SEAM7_FOREIGN[1], "refactor: the same third party again"],
  ];
  for (const [i, [email, message]] of commits.entries()) {
    await writeFile(join(repo, `f-${i}.txt`), message, "utf8");
    await seamGit(repo, "add", "-A");
    await seamGit(repo, "-c", "user.name=Author", "-c", `user.email=${email}`, "commit", "-m", message);
  }
  return repo;
}

/** Run the real intake command over `repo`, declaring `identities`, and return the doc path. */
async function intakeInto(repo: string, identities: readonly string[]): Promise<string> {
  const out = join(await tempDir(), "leaf.json");
  const args = [INTAKE, "--repo", repo, "--subject", "Seam Seven", "--out", out];
  for (const id of identities) args.push("--identity", id);
  await exec(process.execPath, args, { encoding: "utf8", timeout: 60_000 });
  return out;
}

test(
  "SEAM 7: on REAL multi-author history, the excluded count is a live link to rows that all explain themselves",
  { timeout: 90_000 },
  async () => {
    // This is the branch at render.ts's ledger cells — n === 0 renders an aria-disabled div,
    // n > 0 renders an anchor — and until now it had only ever been seen at n > 0 on the
    // bundled EXAMPLE document. A repository whose history is entirely one person's cannot
    // reach it, which is why this test builds one whose history is not.
    const repo = await multiAuthorRepo();

    // ---- n > 0: the subject declares only their own address, so real exclusions appear.
    const withExclusions = await intakeInto(repo, [SEAM7_SUBJECT]);
    const { ledger } = await ledgerOf(withExclusions);
    assert.deepEqual(
      { v: ledger.verified, p: ledger.pending, x: ledger.excluded },
      { v: 0, p: 2, x: 3 },
      "two commits by the subject, three by other people — from real git, not a fixture",
    );

    await withServer({ FOLIAGE_LEAF: withExclusions }, async (s) => {
      const { status, body } = await s.get("/leaf");
      assert.equal(status, 200);
      const source = await s.get("/leaf?records=source");
      assert.equal(source.status, 200);
      assert.doesNotMatch(body, /<li class="lp-source-record"/, "selected work must not repeat raw Git source records");

      // (a) THE CELL IS A LIVE LINK, and its target is a section this same response rendered.
      const cell = /<a class="[^"]*" data-ledger="excluded" href="#([^"]+)"/.exec(body);
      assert.ok(cell, "a non-zero excluded count must be a link, not an aria-disabled div");
      assert.equal(cell[1], "leaf-group-excluded");
      assert.ok(
        body.includes(`id="${cell[1]}"`),
        `the excluded count links to #${cell[1]}, which this response never rendered`,
      );
      assert.ok(
        !/data-ledger="excluded"[^>]*aria-disabled/.test(body),
        "the disabled form must not also be present",
      );

      // (b) EVERY EXCLUDED ROW EXPLAINS ITSELF. Counted, not sampled: a row without a reason is
      // an unexplained absence, which is the exact failure `excluded` exists to prevent.
      const rows = [...body.matchAll(/data-tier="excluded"/g)].length;
      const reasons = allMatches(body, /<p class="leaf-reason">[\s\S]*?<\/span> ([^<]*)</g);
      assert.equal(rows, ledger.excluded, "every excluded leaflet must reach the page");
      assert.equal(
        reasons.length,
        rows,
        `${rows} excluded rows but ${reasons.length} reasons — a row with no reason is a bare count`,
      );
      assert.ok(rows > 1, "n=1 would not distinguish a parity check from a coincidence");
      for (const reason of reasons) {
        assert.ok(reason.trim().length > 0, "an excluded row's reason must not be blank");
      }

      // (c) EXCLUDED READS AS "NOT ATTRIBUTABLE", NEVER AS AN ERROR OR A FAULT.
      const visible = unescapeHtml(body.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
      assert.match(visible, /not an error/i, "the page must say excluded is not an error");
      assert.match(visible, /could not be attributed/i);
      for (const alarming of ["failed", "invalid", "rejected", "error occurred"]) {
        assert.ok(
          !visible.toLowerCase().includes(alarming),
          `excluded work must not be described with "${alarming}"`,
        );
      }

      // (d) NO THIRD PARTY'S ADDRESS REACHES THE PAGE, from three real foreign commits.
      for (const email of [...SEAM7_FOREIGN, SEAM7_SUBJECT]) {
        assert.ok(!body.includes(email), `${email} must never be rendered`);
      }

      // (e) THE SCORE-SHAPED REAL SUBJECT IS CARRIED VERBATIM, and marked as carried.
      assert.match(
        source.body,
        /<h3[^>]*\sdata-verbatim="title"[^>]*>feat: add score normalizer and a 40% faster ranking pass</,
        "a real commit subject must survive unaltered in Source records, inside a verbatim region",
      );
    });

    // ---- n === 0: the SAME repository, with every author declared. Real data, other branch.
    const noExclusions = await intakeInto(repo, [SEAM7_SUBJECT, ...SEAM7_FOREIGN]);
    const zero = await ledgerOf(noExclusions);
    assert.equal(zero.ledger.excluded, 0, "declaring every identity excludes nobody");

    await withServer({ FOLIAGE_LEAF: noExclusions }, async (s) => {
      const { status, body } = await s.get("/leaf");
      assert.equal(status, 200);
      assert.match(
        body,
        /<div class="[^"]*" data-ledger="excluded"[^>]*aria-disabled="true"/,
        "a zero count must be an aria-disabled div, not a link to nothing",
      );
      assert.ok(
        !/data-ledger="excluded" href=/.test(body),
        "a zero excluded count must not be a link",
      );
      assert.ok(
        !body.includes('id="leaf-group-excluded"'),
        "no excluded rows means no excluded section",
      );
      // And no ledger link anywhere may dangle — the same guarantee, checked over all three.
      for (const id of allMatches(body, /data-ledger="[a-z]+" href="#([^"]+)"/g)) {
        assert.ok(body.includes(`id="${id}"`), `ledger link points at a missing target: #${id}`);
      }
    });
  },
);

/**
 * SEAM 8 — THE ARTIFACT SEAM: one leaflet, over real HTTP, without the compound.
 *
 * The privacy claim of `/leaflet/<id>` is a claim about BYTES, so it is checked in the bytes a
 * client actually received. Nothing short of this can see it: the renderer's own test proves the
 * markup it builds, and a DOM read would miss a title sitting in an attribute or a comment.
 *
 * The document under it is produced by the REAL intake command from a REAL repository with two
 * authors, so the other leaflets this page must not disclose are genuinely somebody's evidence
 * and a genuine exclusion reason — not strings invented to be searched for.
 */
test(
  "SEAM 8: a leaflet is reachable from the leaf, and serving it discloses NOTHING else in the leaf",
  { timeout: 90_000 },
  async () => {
    const repo = await multiAuthorRepo();
    const intaken = await intakeInto(repo, [SEAM7_SUBJECT]);

    // INTAKE WRITES NOTHING SHAREABLE, and that is the correct first state: `visibility` is
    // absent on every leaflet it produces and the domain reads absence as `private`. So the
    // served leaf offers no links at all until its owner decides — checked here, because a
    // fixture that skipped straight to "unlisted" would never see the default a real user meets.
    const fresh = JSON.parse(await readFile(intaken, "utf8")) as {
      leaflets: { id: string; visibility?: string }[];
    };
    assert.ok(
      fresh.leaflets.every((l) => l.visibility === undefined),
      "intake must not be deciding visibility on the subject's behalf",
    );
    await withServer({ FOLIAGE_LEAF: intaken }, async (s) => {
      const untouched = await s.get("/leaf");
      const untouchedSources = await s.get("/leaf?records=source");
      // PRIVATE IS STILL THE DEFAULT — what changed (owner rule 2026-08-23) is where it is
      // enforced. The served page is the OWNER'S instrument now, and every row links to the
      // owner route; what a fresh document must hand out none of is SHARE links, and the share
      // route below still refuses. The invariant moved from "no links drawn" to "no share
      // handed out", which is the half that ever protected anyone.
      assert.equal(
        [...untouched.body.matchAll(/<a href="\/leaflet\//g)].length,
        0,
        "a fresh document must hand out no SHARE links — private is the default",
      );
      assert.equal(
        new Set([...(untouched.body + untouchedSources.body).matchAll(/<a href="(\/my\/leaflet\/[^\"]+)"/g)].map(match => match[1])).size,
        fresh.leaflets.length,
        "and every Leaflet opens for the owner across Selected work, Source records and the ledger",
      );
      assert.match(untouched.body + untouchedSources.body, /data-visibility="private"/);
      // ...and the route refuses, so the default is enforced where it counts and not only drawn.
      const refused = await s.get(`/leaflet/${encodeURIComponent(fresh.leaflets[0]!.id)}`);
      assert.equal(refused.status, 404);
      assert.match(refused.body, /data-leaf-state="not-shareable"/);
    });

    // THE SUBJECT THEN SHARES EXACTLY ONE, which is the act this whole route exists for.
    //
    // NOT `leaflets[0]`, AND THE REASON IS A REAL PRODUCT BEHAVIOUR RATHER THAN A FIXTURE QUIRK.
    // This server now applies the shipped default publish policy, and `leaflets[0]` is the
    // fixture's "…and a 40% faster ranking pass" commit is now an ordinary engineering fact,
    // eligible under the default rail. This test is about the LINK and what it discloses, so it
    // shares a stable, named leaflet rather than whichever commit happens to be newest.
    const doc = JSON.parse(await readFile(intaken, "utf8")) as {
      leaflets: { id: string; title: string; visibility?: string }[];
    };
    const shareable = doc.leaflets.findIndex((l) =>
      l.title.startsWith("fix: the second thing the subject actually did"),
    );
    assert.ok(shareable >= 0, "the fixture's non-rating-shaped commit is gone; fix the fixture");
    const sharedId = doc.leaflets[shareable]!.id;
    doc.leaflets[shareable]!.visibility = "unlisted";
    const path = join(await tempDir(), "leaf.json");
    await writeFile(path, JSON.stringify(doc, null, 2), "utf8");
    const { leaf } = await ledgerOf(path);
    assert.ok(leaf.leaflets.length > 3, "the fixture needs several leaflets or nothing is hidden");

    await withServer({ FOLIAGE_LEAF: path }, async (s) => {
      // 1. THE LINK EXISTS. Before this, the leaf page's only hrefs were two in-page anchors and
      //    two stylesheets — an artifact with a route and no link is unreachable through the
      //    real user path, which is the same as not shipping it.
      const list = await s.get("/leaf");
      const sourceList = await s.get("/leaf?records=source");
      // Owner rule 2026-08-23: every row owner-links (/my/leaflet/); the SHARE distinction lives
      // in the visibility marker and on the share route itself. Exactly one row is marked
      // shareable, and it is the one the subject marked.
      const hrefs = [...(list.body + sourceList.body).matchAll(/<p class="leaf-leaflet-open"[^>]*><a href="([^"]+)"/g)].map(
        (m) => m[1]!,
      );
      assert.equal(new Set(hrefs).size, leaf.leaflets.length, "every row opens for the owner across Work and source records");
      const unlistedRows = [...list.body.matchAll(
        /<p class="leaf-leaflet-open" data-visibility="unlisted"><a href="([^"]+)"/g,
      )].map((m) => decodeURIComponent(m[1]!.slice("/my/leaflet/".length)));
      assert.deepEqual(
        unlistedRows,
        [sharedId],
        "exactly the leaflet the subject marked shareable is marked so, and no other",
      );

      // 2. FOLLOW ONE, exactly as a reader would. WHICH one is read back off the href rather than
      //    assumed to be leaflets[0]: the page groups verified first, so the document's order and
      //    the page's order are deliberately not the same.
      // Follow the SHARE surface, as a stranger with the link would: the share href is built
      // from the id the page marked shareable, through the same route definition.
      const openedId = sharedId;
      const openedHref = `/leaflet/${encodeURIComponent(openedId)}`;
      const target = leaf.leaflets.find((l) => l.id === openedId);
      assert.ok(target, `the first link points at ${openedId}, which is not in the document`);
      const opened = await s.get(openedHref);
      assert.equal(opened.status, 200);
      assert.ok(opened.body.includes(esc(target.title)), "the artifact must render the leaflet asked for");

      // 3. NOTHING ELSE IN THE LEAF TRAVELLED WITH IT. Every other leaflet's title, id and reason,
      //    checked against the raw response.
      for (const other of leaf.leaflets.filter((l) => l.id !== openedId)) {
        for (const secret of [
          other.title,
          other.id,
          ..."reason" in other ? [other.reason] : [],
          ...("provenance" in other && other.provenance !== undefined ? [other.provenance.ref] : []),
        ]) {
          assert.ok(
            !opened.body.includes(secret),
            `GET ${openedHref} disclosed "${secret}" from a DIFFERENT leaflet of the same leaf`,
          );
        }
      }
      // Not a count of them either, and no way back to the whole portfolio.
      assert.ok(!opened.body.includes("data-count="), "no ledger may appear on a shared artifact");
      assert.ok(!/href="\/"/.test(opened.body), "no navigation to the compound");
      assert.ok(!opened.body.includes("/review"), "nor to the operator's queue");

      // 4. AND NO THIRD PARTY'S ADDRESS, from three real commits by two other people.
      for (const email of [...SEAM7_FOREIGN, SEAM7_SUBJECT]) {
        assert.ok(!opened.body.includes(email), `${email} must never be rendered`);
      }

      // 5. AN ID THAT IS NOT THERE IS A 404 WITH AN ANSWER, not an empty page and not a 200.
      const missing = await s.get("/leaflet/definitely-not-an-id");
      assert.equal(missing.status, 404);
      assert.ok(missing.body.includes("definitely-not-an-id"), "the 404 names what was asked for");
      assert.match(missing.body, /data-leaf-state="not-shareable"/);

      // AND A REAL BUT PRIVATE LEAFLET ANSWERS THE SAME WAY, over the wire, so the route cannot
      // be used to find out which ids exist. Compared byte for byte with the id swapped out.
      const privateId = leaf.leaflets[1]!.id;
      const withheld = await s.get(`/leaflet/${encodeURIComponent(privateId)}`);
      assert.equal(withheld.status, 404);
      assert.equal(
        withheld.body.split(esc(privateId)).join("ID"),
        missing.body.split("definitely-not-an-id").join("ID"),
        "a private leaflet and a missing one must be indistinguishable at the URL",
      );
      assert.ok(!withheld.body.includes(leaf.leaflets[1]!.title), "and disclose no title");
      for (const l of leaf.leaflets) {
        assert.ok(!missing.body.includes(l.id), `the 404 named ${l.id} — an enumeration oracle`);
      }

      // 6. HEAD is the same response without the body, so a link checker sees the real status.
      const head = await s.send(openedHref, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(head.body, "");
      assert.equal(head.headers.get("content-type"), "text/html; charset=utf-8");
    });
  },
);

/**
 * SEAM 9 — THE REVIEW SEAM: the browser decides, the CLI's own gate writes, the leaf renders it.
 *
 * This is the tie the whole capability turns on, and every step of it is real: a real repository,
 * the real `harvest.mjs propose` reading real commits, a real HTTP POST from the review page, the
 * real `parseHarvestDocument` gate, the real file on disk, then the real `harvest.mjs promote`
 * and the real server rendering the result. Nothing is stubbed and no fixture stands in for a
 * document — if any link in that chain is wrong, this test is what sees it.
 *
 * Six properties, in the order a reviewer would hit them:
 *   a. the queue shows the candidates that are actually in the file;
 *   b. a rejection with NO REASON is refused and NOTHING is written — checked by comparing the
 *      file's bytes before and after, not by trusting the response;
 *   c. a rejection with a reason is recorded, and the file still passes the gate;
 *   d. a decided candidate cannot be re-decided;
 *   e. a cross-site POST is refused;
 *   f. a candidate approved IN THE BROWSER is promoted BY THE CLI into a leaf that renders.
 */
test(
  "SEAM 9: a decision made in the browser is written through the CLI's gate and reaches the leaf",
  { timeout: 120_000 },
  async () => {
    const HARVEST = fileURLToPath(new URL("../harvest.mjs", import.meta.url));

    // 1. A REAL repository with conventional-commit prefixes, so `propose` finds real clusters.
    const repo = await tempDir();
    await seamGit(repo, "init", "--quiet", "--initial-branch=main");
    const messages = [
      "feat: the retrieval layer",
      "feat: the second half of the retrieval layer",
      "docs: the plan",
      "docs: the plan, corrected",
    ];
    for (const [i, message] of messages.entries()) {
      await writeFile(join(repo, `f-${i}.txt`), message, "utf8");
      await seamGit(repo, "add", "-A");
      await seamGit(
        repo,
        "-c",
        "user.name=Seam Nine",
        "-c",
        `user.email=${SEAM_AUTHOR}`,
        "commit",
        "-m",
        message,
      );
    }

    // 2. The REAL propose command. Two clusters of two commits each become two candidates.
    //    `--identity` is REQUIRED by the command and is passed the address these four commits were
    //    actually authored under: a candidate is a claim about ONE person's work, and a harvest
    //    drafted without saying whose would cluster somebody else's commits into it.
    const harvestPath = join(await tempDir(), "harvest.json");
    const { stdout: proposeLog } = await exec(
      process.execPath,
      [HARVEST, "propose", "--repo", repo, "--identity", SEAM_AUTHOR, "--out", harvestPath],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.match(proposeLog, /drafted 2 · carried 0 · held 0/);
    const drafted = JSON.parse(await readFile(harvestPath, "utf8")) as {
      candidates: { id: string; title: string; extractor: string; evidence: { ref: string }[] }[];
    };
    assert.equal(drafted.candidates.length, 2);
    const [first, second] = drafted.candidates as [
      (typeof drafted.candidates)[number],
      (typeof drafted.candidates)[number],
    ];
    // The reviewer's own words for (f) — counts and facts, deliberately nothing rating-shaped.
    const OWN_WORDS_TITLE = "Built the review seam and proved both write paths against one file";
    // No leaf exists while the browser decides: named explicitly, so a local apps/leaf/leaf.json
    // cannot stand in for it.
    const noLeafYet = join(await tempDir(), "leaf.json");

    await withServer({ FOLIAGE_HARVEST: harvestPath, FOLIAGE_LEAF: noLeafYet }, async (s) => {
      // (a) THE QUEUE IS THE FILE. Every candidate, its real drafted title, its real evidence.
      const queue = await s.send("/review");
      assert.equal(queue.status, 200);
      assert.match(queue.body, /<html lang="en" data-face="night">/);
      for (const c of drafted.candidates) {
        assert.ok(queue.body.includes(c.id), `the queue must show ${c.id}`);
        assert.ok(queue.body.includes(c.title), `and its drafted title`);
        assert.ok(queue.body.includes(c.extractor), `and what drafted it`);
        for (const e of c.evidence) {
          assert.ok(queue.body.includes(e.ref), `and every ref it cites: ${e.ref}`);
        }
      }
      // Every ref on the queue is a real commit in the real repository.
      for (const e of first.evidence) {
        assert.equal((await seamGit(repo, "cat-file", "-t", e.ref)).trim(), "commit");
      }
      // The form is only reachable because the CSP on THIS response permits one. `/` (the studio
      // dashboard) is any other page for this check's purposes — no form, so `form-action 'none'`
      // regardless of what it renders.
      assert.match(String(queue.headers.get("content-security-policy")), /form-action 'self'/);
      const nonFormPage = await s.send("/");
      assert.match(String(nonFormPage.headers.get("content-security-policy")), /form-action 'none'/);

      const before = await readFile(harvestPath, "utf8");

      // (b) A REJECTION WITH NO REASON IS REFUSED, and the file is untouched. A rejection with no
      //     reason is a silent disappearance — the same refusal `harvest.mjs reject` makes.
      const noReason = await s.postForm("/review", {
        id: first.id,
        by: "Alex",
        reason: "   ",
        decision: "reject",
      });
      assert.equal(noReason.status, 400);
      assert.match(noReason.body, /data-refusal="missing-reason"/);
      assert.equal(await readFile(harvestPath, "utf8"), before, "the document must be unchanged");

      // ...and so is a decision with no reviewer. Attributability is not optional either.
      const noReviewer = await s.postForm("/review", {
        id: first.id,
        by: "",
        decision: "approve",
      });
      assert.equal(noReviewer.status, 400);
      assert.match(noReviewer.body, /data-refusal="missing-reviewer"/);
      assert.equal(await readFile(harvestPath, "utf8"), before, "still unchanged");

      // (e) A CROSS-SITE POST IS REFUSED. Binding to loopback does not keep out the browser the
      //     operator is already running, and this endpoint writes to a file.
      const foreign = await s.postForm(
        "/review",
        { id: first.id, by: "Attacker", decision: "approve" },
        "http://evil.example",
      );
      assert.equal(foreign.status, 403);
      assert.equal(await readFile(harvestPath, "utf8"), before, "a cross-site POST wrote nothing");

      // (c) A REJECTION WITH A REASON IS RECORDED — through the gate, into the same file.
      const rejected = await s.postForm("/review", {
        id: second.id,
        by: "Alex",
        reason: "documentation commits are not a body of work worth claiming",
        decision: "reject",
      });
      assert.equal(rejected.status, 303, "a decision redirects, so a reload cannot re-submit it");
      // ...on to the one draft still open, under a line naming the decision just recorded. Only
      // the two ids cross the redirect; the line is read back from the file on the GET.
      const nextDraft = `/review?decided=${encodeURIComponent(second.id)}&focus=${encodeURIComponent(first.id)}#review-status`;
      assert.equal(rejected.headers.get("location"), nextDraft);
      const landed = await s.get(nextDraft);
      assert.match(landed.body, /<p id="review-status" class="review-status" role="status" data-review-decided="rejected">/);
      assert.ok(landed.body.includes(`<strong>Rejected:</strong> <span data-authored="drafted-title">${second.title}</span>`));
      assert.ok(!landed.body.includes("approved waiting"), "nothing approved, so nothing is waiting");
      assert.match(landed.body, new RegExp(`id="candidate-${first.id}"[^>]*>[\\s\\S]*?<details class="review-candidate-disclosure" open>`),
        "the next undecided draft is opened");
      assert.match(landed.body, new RegExp(`<input(?=[^>]*id="by-${first.id}")(?=[^>]*value="Alex")(?=[^>]*required)[^>]*>`),
        "the reviewer just recorded starts the next decision, still required");

      const afterReject = parseHarvestDocument(JSON.parse(await readFile(harvestPath, "utf8")));
      assert.equal(afterReject.ok, true, "the file the browser wrote must still pass the gate");
      if (!afterReject.ok) throw new Error("unreachable");
      const rejectedCandidate = afterReject.harvest.candidates.find((c) => c.id === second.id);
      assert.deepEqual(rejectedCandidate?.review.state, "rejected");
      assert.equal(
        rejectedCandidate?.review.state === "rejected" ? rejectedCandidate.review.reason : null,
        "documentation commits are not a body of work worth claiming",
      );

      // The queue now shows the record — who, when and why — and offers no second decision.
      const afterQueue = await s.get("/review");
      assert.ok(afterQueue.body.includes("documentation commits are not a body of work"));
      assert.match(afterQueue.body, /data-review-state="rejected"/);

      // (d) AND IT CANNOT BE RE-DECIDED. A recorded decision is not overwritten by a later
      //     request, and the refusal names the state that stands in the way.
      const again = await s.postForm("/review", {
        id: second.id,
        by: "Someone Else",
        decision: "approve",
      });
      assert.equal(again.status, 409);
      assert.match(again.body, /data-refusal="already-decided"/);
      assert.ok(again.body.includes("rejected by Alex"), "the refusal names the current state");

      // (f0) THE OWN-WORDS RULES, same as the CLI's: a title belongs to approve, and the
      //      no-rating gate judges the reviewer's words exactly as it judges the machine's.
      //      Both refusals leave the file untouched.
      const beforeApprove = await readFile(harvestPath, "utf8");
      const titleOnReject = await s.postForm("/review", {
        id: first.id,
        by: "Alex",
        reason: "any",
        title: "these words are going nowhere",
        decision: "reject",
      });
      assert.equal(titleOnReject.status, 400);
      assert.match(titleOnReject.body, /data-refusal="title-on-reject"/);
      assert.equal(await readFile(harvestPath, "utf8"), beforeApprove, "unchanged");
      const ratingShaped = await s.postForm("/review", {
        id: first.id,
        by: "Alex",
        title: "rated 5/5 by the whole team",
        decision: "approve",
      });
      assert.equal(ratingShaped.status, 400);
      assert.match(ratingShaped.body, /data-refusal="rating-shaped-title"/);
      assert.equal(await readFile(harvestPath, "utf8"), beforeApprove, "still unchanged");

      // (f) APPROVE IN THE BROWSER — in the reviewer's own words. The digest must cover the
      //     candidate AS DECIDED, retitle included, and the extractor must change with the
      //     words: reviewer-authored prose attributed to a machine would be a false byline.
      const approved = await s.postForm("/review", {
        id: first.id,
        by: "Alex",
        title: OWN_WORDS_TITLE,
        decision: "approve",
      });
      assert.equal(approved.status, 303);
      // Nothing is left open, so there is no draft to focus; the line names the approval in the
      // reviewer's words. This server has no leaf yet (the CLI makes one below), so nothing can be
      // subtracted or added: the line counts nothing as waiting, and the promote panel says why.
      const lastDecision = `/review?decided=${encodeURIComponent(first.id)}#review-status`;
      assert.equal(approved.headers.get("location"), lastDecision);
      const finished = await s.get(lastDecision);
      assert.ok(finished.body.includes(`<strong>Approved:</strong> <span data-authored="drafted-title">${OWN_WORDS_TITLE}</span>`));
      assert.doesNotMatch(finished.body, /approved waiting/, "no leaf was read, so no waiting count");
      assert.match(finished.body, /<h2 id="review-promote-h">[\s\S]*?data-leaf-plate="promote-unavailable"/, "the panel names the missing leaf");

      const afterApprove = parseHarvestDocument(JSON.parse(await readFile(harvestPath, "utf8")));
      assert.equal(afterApprove.ok, true);
      if (!afterApprove.ok) throw new Error("unreachable");
      const decided = afterApprove.harvest.candidates.find((c) => c.id === first.id);
      assert.ok(decided);
      assert.equal(decided.title, OWN_WORDS_TITLE);
      assert.equal(decided.extractor, "reviewer:Alex");
      assert.equal(decided.review.state, "approved");
      assert.equal(
        decided.review.state === "approved" ? decided.review.subjectDigest : null,
        reviewSubjectDigest(decided),
        "the stamp covers the candidate as decided — the reviewer's words, not the draft",
      );
    });

    // ...and PROMOTE WITH THE CLI, into a real leaf, which then renders as a real artifact. This
    // is the whole point of writing through the shared gate: the browser and the terminal are one
    // workflow over one file, not two tools that happen to agree today.
    const leafPath = join(await tempDir(), "leaf.json");
    await writeFile(
      leafPath,
      JSON.stringify({ id: "seam9-leaf", subject: "Seam Nine", leaflets: [] }, null, 2),
      "utf8",
    );
    const { stdout: promoteLog } = await exec(
      process.execPath,
      [HARVEST, "promote", "--doc", harvestPath, "--into", leafPath, "--force"],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.match(promoteLog, /promoted 1\b/, "exactly the browser-approved candidate is promoted");

    const promoted = await ledgerOf(leafPath);
    assert.deepEqual(
      { v: promoted.ledger.verified, p: promoted.ledger.pending, x: promoted.ledger.excluded },
      { v: 0, p: 1, x: 0 },
      "an approved candidate promotes to PENDING — reviewed is attributable, never verified",
    );

    await withServer({ FOLIAGE_LEAF: leafPath }, async (s) => {
      const page = await s.get("/leaf");
      assert.ok(page.body.includes(OWN_WORDS_TITLE), "the reviewer's words are on the leaf");
      assert.ok(!page.body.includes(first.title), "the machine's superseded draft is not");
      // PROMOTION DOES NOT SHARE ANYTHING. `promoteApproved` omits `visibility`, so the new
      // leaflet is private: approving a draft is a decision about whether it is TRUE, and
      // sharing it is a second decision the subject has not made yet. The leaf says so.
      // Owner rule 2026-08-23: the promoted leaflet links for its OWNER; what it must not carry
      // is a SHARE link, because nothing here was shared.
      assert.equal([...page.body.matchAll(/<a href="\/leaflet\//g)].length, 0);
      assert.ok(page.body.includes(`href="/my/leaflet/`), "the owner can open the promoted artifact");
      assert.match(page.body, /data-visibility="private"/);

      const promotedDoc = JSON.parse(await readFile(leafPath, "utf8")) as {
        leaflets: { id: string; visibility?: string }[];
      };
      assert.equal(promotedDoc.leaflets[0]!.visibility, undefined);
      promotedDoc.leaflets[0]!.visibility = "unlisted";
      await writeFile(leafPath, JSON.stringify(promotedDoc, null, 2), "utf8");

      const shared = await s.get("/leaf");
      const href = /<p class="leaf-leaflet-open"[^>]*><a href="([^"]+)"/.exec(shared.body)?.[1];
      assert.ok(href, "once shared, it is reachable as its own artifact");
      const artifact = await s.get(href);
      assert.equal(artifact.status, 200);
      assert.ok(artifact.body.includes(OWN_WORDS_TITLE));
      // The tier the domain assigned, rendered as what it is: a person approved a draft, and that
      // is attribution, not proof.
      assert.match(artifact.body, /data-pill-tier="pending"/);
      assert.match(
        unescapeHtml(artifact.body.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " "),
        /not an outward claim/i,
      );
    });
  },
);

/**
 * SEAM 10 — METHOD AND FORM POLICY, which only exists at the transport.
 *
 * The server answered a blanket `405 allow: GET, HEAD` to every non-GET request. That is now a
 * per-route answer, and getting it wrong is the kind of bug that makes a correct client give up
 * on a working endpoint: `allow` is a promise about ONE resource.
 */
test("SEAM 10: allow is per route, and the POST endpoint refuses what it cannot honour", async () => {
  const dir = await tempDir();
  const harvestPath = await writeDoc(dir, "harvest.json", { candidates: [] });

  await withServer({ FOLIAGE_HARVEST: harvestPath }, async (s) => {
    // A route with no POST says so, and names the methods it really has — true of / (the studio
    // dashboard) exactly as it was of the compound leaf that used to answer here.
    const postToRoot = await s.send("/", { method: "POST" });
    assert.equal(postToRoot.status, 405);
    assert.equal(postToRoot.headers.get("allow"), "GET, HEAD");

    // The review route names all three, so a client that got a 405 from a typo can recover.
    const del = await s.send("/review", { method: "DELETE" });
    assert.equal(del.status, 405);
    assert.equal(del.headers.get("allow"), "GET, HEAD, POST");

    // A POST of the wrong media type is a 415 with the type it received named, not a 400 that
    // leaves the caller guessing which half of their request was wrong.
    const wrongType = await s.send("/review", {
      method: "POST",
      headers: { "content-type": "application/json", origin: s.origin },
      body: JSON.stringify({ id: "x" }),
    });
    assert.equal(wrongType.status, 415);
    assert.match(wrongType.body, /application\/json/);

    // A form past the ceiling is a 413 THE CLIENT CAN READ. Until 2026-09-02 the reader destroyed
    // the socket the moment the ceiling was crossed and the refusal was written to nothing; now the
    // read pauses, the refusal names the ceiling, and `connection: close` lets Node end the socket
    // after the response has been flushed. Five in a row is the measurement that found it.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const oversize = await s.send("/review", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: s.origin },
        body: `id=x&decision=approve&by=Alex&note=${"a".repeat(70 * 1024)}`,
      });
      assert.equal(oversize.status, 413, `attempt ${attempt}`);
      assert.match(oversize.body, /passed 65536 bytes and was not read to the end/);
      assert.equal(oversize.headers.get("connection"), "close");
    }

    // A POST with no Origin at all is refused, and the refusal tells a non-browser client how to
    // send one rather than leaving it looking like an outage.
    const noOrigin = await s.send("/review", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "id=x&decision=approve&by=Alex",
    });
    assert.equal(noOrigin.status, 403);
    assert.match(noOrigin.body, /Origin/);

    // An empty harvest is an honest empty queue: 200, without leaking the local file path.
    const queue = await s.get("/review");
    assert.equal(queue.status, 200);
    assert.match(queue.body, /data-leaf-empty="true"/);
    assert.ok(!queue.body.includes(harvestPath));
    assert.match(queue.body, /href="\/workflow#sources"/);
  });
});

/**
 * SEAM 11 — THE HONEST FIRST RUN: no harvest document at all.
 *
 * "There is no file yet" and "the file holds nothing" are opposite facts, and a queue that
 * rendered the same page for both would be the `commitCount: 0` collapse in a new place. There is
 * no fixture here on purpose — the selected file does not exist.
 */
test("SEAM 11: with no harvest document the queue names the state and offers Sources", async () => {
  const missing = join(await tempDir(), "not-created.json");
  await withServer({ FOLIAGE_HARVEST: missing }, async (s) => {
    const { status, body } = await s.get("/review");
    // A first run is not an error. It answers 200 with one route action.
    assert.equal(status, 200);
    assert.match(body, /data-leaf-state="absent"/);
    assert.match(body, /No drafts yet/);
    assert.match(body, /href="\/workflow#sources"/);
    assert.ok(!body.includes(missing), "the UI must not reveal the local file path");
    assert.doesNotMatch(body, /harvest\.mjs propose/);
    assert.ok(!body.includes("data-review-count="), "it must not render a queue of zeros");
    assert.ok(!body.includes("<form"), "nor a form over nothing");
  });
});

/**
 * SEAM 12 — THE HEADER PAIR THAT ONLY A REAL BROWSER EXPOSED.
 *
 * This test exists because of a defect that every other test in this file was blind to, found by
 * clicking Reject on the served queue in a real browser: the page came back
 * `refused: the Origin header "null" is not a URL`, and the review form was unusable in ANY
 * browser while the whole suite stayed green.
 *
 * The mechanism is in Fetch, "append a request Origin header": for a non-CORS request whose
 * method is not GET or HEAD, a referrer policy of `no-referrer` sets the serialized origin to
 * `null`. This server sends `referrer-policy: no-referrer` on every response — so its own privacy
 * header was nulling the header its own CSRF check reads. Node's `fetch` sends whatever `Origin`
 * a test tells it to, which is exactly why no test could see it.
 *
 * Both halves are pinned here, because either one alone leaves the pair looking protected:
 * the page that carries a form must relax the policy, and the check must accept the header the
 * browser actually sends.
 */
test("SEAM 12: the form page relaxes referrer-policy, and the CSRF check reads what browsers send", async () => {
  const dir = await tempDir();
  const harvestPath = await writeDoc(dir, "harvest.json", {
    candidates: [
      {
        id: "c1",
        title: "a candidate to decide on",
        evidence: [{ source: "git", ref: "abc1234", observedAt: "2026-08-16T09:00:00Z" }],
        extractor: "git-cluster",
        draftedAt: "2026-08-16T09:00:00Z",
        review: { state: "candidate" },
      },
    ],
  });

  await withServer({ FOLIAGE_HARVEST: harvestPath }, async (s) => {
    // (a) THE PAGE WITH THE FORM relaxes to `same-origin`, so a browser sends this server its own
    //     origin on the POST — and still sends nothing to anybody else.
    const queue = await s.send("/review");
    assert.equal(queue.headers.get("referrer-policy"), "same-origin");
    // (b) EVERY OTHER SURFACE KEEPS `no-referrer`. The relaxation is scoped to the one page that
    //     needs it, not applied globally to make a bug go away.
    for (const path of ["/", "/leaf.css"]) {
      const other = await s.send(path);
      assert.equal(other.headers.get("referrer-policy"), "no-referrer", `${path} must not relax`);
    }

    // (c) `Origin: null` IS REFUSED — that is what a cross-site page with a no-referrer policy
    //     produces, and it is not an origin. This is the exact string the browser sent.
    const nulled = await s.send("/review", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "null" },
      body: "id=c1&by=Alex&decision=approve",
    });
    assert.equal(nulled.status, 403);

    // (d) `Sec-Fetch-Site: same-origin` IS ENOUGH ON ITS OWN. The browser sets it and a page
    //     cannot influence it, so it is worth more than anything in `Origin` — and it is what a
    //     browser too old for the relaxation above would still be judged by.
    const bySecFetch = await s.send("/review", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
      },
      body: "id=c1&by=Alex&decision=approve",
    });
    assert.equal(bySecFetch.status, 303, "a same-origin POST with no Origin header must be honoured");

    // (e) AND IT DECIDES IN BOTH DIRECTIONS: a browser saying "cross-site" is not overruled by a
    //     matching Origin, which a cross-site page could send.
    const crossSite = await s.send("/review", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "cross-site",
        origin: s.origin,
      },
      body: "id=c1&by=Attacker&decision=approve",
    });
    assert.equal(crossSite.status, 403);
    assert.match(crossSite.body, /cross-site/);
  });
});

/**
 * SEAM 13 — THE DIFFERENTIAL CONTROL: one binary, one document, two routes, one answer.
 *
 * SEAM 6 proves the band is ABSENT on a real repository. Nothing proved it was PRESENT everywhere
 * it has to be, and it was not: measured on the running server, `GET /` rendered `data-fabricated`
 * once and `GET /leaflet/<id>` rendered it zero times over the very same bytes, while telling the
 * reader "This is an outward claim: authorship is cryptographically established" about a leaflet
 * whose provenance ref is the literal string `example-ref-not-a-commit-0001`.
 *
 * WHY NO UNIT TEST FOUND IT. Both renderers were tested, separately, and each was right about what
 * it was given. The band's input — the `LeafSource` — simply never reached the second one, and a
 * test that calls a renderer directly supplies whatever that renderer takes. The defect lived in
 * the WIRING, so the check has to be the same process answering both routes.
 *
 * THE DOCUMENT IS THE SHIPPED EXAMPLE, COPIED. Copying matters: the copy is not at the bundled
 * path, so `bundledExample` cannot fire and the ONLY signal left is the document's own
 * `"example": true`. That is the flag whose whole purpose is that the PRODUCT says it — the
 * shipped file also happens to start every title "EXAMPLE —", which is the document author's
 * wording and not a control, and a reader who saw only that would have been reassured by nothing.
 */
test("SEAM 13: an example document is marked on EVERY route the same binary serves", async () => {
  const doc = JSON.parse(
    await readFile(new URL("../example/leaf.example.json", import.meta.url), "utf8"),
  ) as { example?: boolean; leaflets: { id: string; title: string; visibility?: string }[] };
  assert.equal(doc.example, true, "the fixture is the shipped example and must declare itself one");

  // The subject shares exactly one leaflet — the act the leaflet route exists for.
  const shared = doc.leaflets[0]!;
  doc.leaflets[0]!.visibility = "unlisted";
  const path = await writeDoc(await tempDir(), "leaf.json", doc);

  await withServer({ FOLIAGE_LEAF: path }, async (s) => {
    // The compound leaf lives at /leaf now — see render.ts's header on the move.
    const leaf = await s.get("/leaf");
    const leaflet = await s.get(`/leaflet/${encodeURIComponent(shared.id)}`);
    assert.equal(leaf.status, 200);
    assert.equal(leaflet.status, 200, "the shared leaflet must actually be served, or this is vacuous");
    assert.ok(leaflet.body.includes(esc(shared.title)), "and it must be the leaflet asked for");

    // THE POINT. Both routes, same process, same file, same answer about what those bytes are.
    for (const [route, res] of [["/leaf", leaf], [`/leaflet/${shared.id}`, leaflet]] as const) {
      assert.match(
        res.body,
        /data-fabricated="true"/,
        `${route} served a declared example document with no fabrication band`,
      );
      assert.ok(
        res.body.includes('declares &quot;example&quot;: true'),
        `${route} must name the signal that fired, not merely show a band`,
      );
    }

    // AND THE SENTENCE THAT WAS FALSE IS GONE FROM THE WIRE. The band above is the general
    // statement; this is the specific one, and a reader believes the specific one.
    assert.ok(
      !leaflet.body.includes("outward claim: authorship is cryptographically"),
      "the artifact page claimed cryptographic establishment about an illustration",
    );
    assert.match(leaflet.body, /data-standing="example"/);
    // The tier is still shown: withdrawing the claim must not become hiding the document.
    assert.match(leaflet.body, /data-pill-tier="verified"/);

    // THE BAND DID NOT LEAK THE COMPOUND. Every other leaflet's title, id and reason, checked in
    // the bytes — the protection this route was built around still holds with the band present.
    for (const other of doc.leaflets.filter((l) => l.id !== shared.id)) {
      for (const secret of [other.title, other.id, ...("reason" in other ? [String(other.reason)] : [])]) {
        assert.ok(
          !leaflet.body.includes(esc(secret)),
          `the marked artifact page disclosed "${secret}" from a DIFFERENT leaflet`,
        );
      }
    }
    assert.ok(!leaflet.body.includes("data-count="), "no ledger may appear on a shared artifact");

    // A refusal from the same document is marked too, and the mark cannot separate "no such id"
    // from "not shared" — those two answers are compared byte for byte with the id swapped out.
    const missing = await s.get("/leaflet/definitely-not-an-id");
    const withheld = await s.get(`/leaflet/${encodeURIComponent(doc.leaflets[1]!.id)}`);
    assert.equal(missing.status, 404);
    assert.equal(withheld.status, 404);
    assert.match(missing.body, /data-fabricated="true"/);
    assert.equal(
      withheld.body.split(esc(doc.leaflets[1]!.id)).join("ID"),
      missing.body.split("definitely-not-an-id").join("ID"),
      "the band must not make a private leaflet distinguishable from a missing one",
    );
  });
});

/**
 * SEAM 14 — A WRITE THAT WROTE NOTHING MUST NOT ANSWER SUCCESS.
 *
 * Measured before the fix: POST /review, with FOLIAGE_HARVEST naming a path that holds no file,
 * answered `200 OK` — and the body was the queue's own "there is no harvest document yet" page,
 * which never mentions the decision that was just submitted. The status came from
 * `httpStatusForHarvest`, which is right for a GET (a first run is not an error) and is a lie
 * about a POST. A caller reading the status — a script, a retry wrapper, an uptime check — was
 * told its decision had been recorded.
 *
 * The GET is checked here too, on the SAME server, because the two answers differing is the whole
 * fix: one route may say 200 about that document and the other may not.
 */
test("SEAM 14: a review POST with no document to write to is refused, and creates nothing", async () => {
  const dir = await tempDir();
  const missing = join(dir, "not-created.json");

  await withServer({ FOLIAGE_HARVEST: missing }, async (s) => {
    const posted = await s.postForm("/review", { id: "anything", decision: "approve", by: "Alex" });

    assert.notEqual(posted.status, 200, "a POST that wrote nothing must not answer OK");
    assert.ok(posted.status < 200 || posted.status >= 300, `2xx for a write that did not happen: ${posted.status}`);
    assert.equal(posted.status, 409, "there is no document to record a decision in — a state conflict");

    // The page says it as well, because the reviewer is looking at the page and not the status.
    assert.match(posted.body, /data-refusal="absent"/, "the load's own cause is named");
    assert.match(posted.body, /data-written="none"/);
    assert.ok(posted.body.includes("Nothing was written"), "and said in words");
    assert.ok(!posted.body.includes(missing), "a refusal does not reveal the local file path");
    assert.match(posted.body, /href="\/workflow#sources"/);

    // THE CLAIM CHECKED AGAINST THE FILESYSTEM RATHER THAN THE RESPONSE: no file was created.
    await assert.rejects(
      () => readFile(missing, "utf8"),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT",
      "the refused POST created a harvest document",
    );

    // The GET over the same absent document is still an honest 200 — a first run is not an error.
    const queue = await s.get("/review");
    assert.equal(queue.status, 200);
    assert.ok(!queue.body.includes("Nothing was written"), "a GET decided nothing to report on");
  });

  // AND THE OTHER HALF OF THE UNION: a document this app cannot READ — a directory where a file
  // was named, so the OS supplies the errno. Still a conflict with the target's state, not a
  // fault in this app: the page names the file to repair.
  await withServer({ FOLIAGE_HARVEST: dir }, async (s) => {
    const posted = await s.postForm("/review", { id: "anything", decision: "approve", by: "Alex" });
    assert.equal(posted.status, 409, "the draft file needs the owner's repair; nothing was written");
    assert.ok(posted.body.includes("Nothing was written"));
    assert.match(posted.body, /data-leaf-state="unreadable"/);
  });
});

/** First-run UI offers Sources; the separate CLI still drafts only the selected identity. */
test("SEAM 15: Sources is the first-run action and the CLI still drafts the selected identity", { timeout: 90_000 }, async () => {
  const HARVEST = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
  const missing = join(await tempDir(), "not-created-yet.json");

  // A real repository, and a multi-author one: the flag whose absence broke the printed command
  // exists to keep the third party's commit out, so a single-author repo would exercise the
  // argument without exercising what it is FOR. Two commits share a prefix, clearing the
  // two-commit floor a cluster has to clear before it is drafted at all.
  const repo = await tempDir();
  await seamGit(repo, "init", "--quiet", "--initial-branch=main");
  const commits: readonly [string, string][] = [
    [SEAM7_SUBJECT, "feat: the first half of the thing this subject built"],
    [SEAM7_SUBJECT, "feat: the second half of it"],
    [SEAM7_FOREIGN[0], "feat: somebody else's commit under the same prefix"],
  ];
  for (const [i, [email, message]] of commits.entries()) {
    await writeFile(join(repo, `s15-${i}.txt`), message, "utf8");
    await seamGit(repo, "add", "-A");
    await seamGit(repo, "-c", "user.name=Seam Fifteen", "-c", `user.email=${email}`, "commit", "-m", message);
  }

  await withServer({ FOLIAGE_HARVEST: missing }, async (s) => {
    const queue = await s.get("/review");
    assert.equal(queue.status, 200, "a first run is not an error");

    assert.match(queue.body, /href="\/workflow#sources"/);
    assert.doesNotMatch(queue.body, /harvest\.mjs propose|not-created-yet\.json/);

    // The separate CLI still makes a bound draft from actual Git work.
    const { stdout } = await exec(process.execPath, [HARVEST, "propose", "--repo", repo, "--identity", SEAM7_SUBJECT, "--out", missing], {
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.match(stdout, /wrote /, `the CLI ran but wrote nothing: ${stdout}`);

    // And what it wrote is a real harvest document holding real candidates — through the same
    // gate the server reads it with, so "it ran" cannot stand in for "it produced something".
    const parsed = parseHarvestDocument(JSON.parse(await readFile(missing, "utf8")));
    assert.equal(parsed.ok, true, "the CLI produced a document the harvest gate refuses");
    if (!parsed.ok) throw new Error("unreachable");
    assert.ok(parsed.harvest.candidates.length > 0, "the CLI produced an empty queue on real history");

    // The identity flag did its job, checked against Git rather than against the
    // harvest: every drafted ref resolves to the declared address, so the third party's commit —
    // authored under the same prefix, deliberately — is absent from what the operator will review.
    for (const ref of parsed.harvest.candidates.flatMap((c) => c.evidence.map((e) => e.ref))) {
      const author = (await seamGit(repo, "log", "-1", "--format=%ae", ref)).trim();
      assert.equal(author, SEAM7_SUBJECT, `the CLI drafted a commit authored by ${author}`);
    }

    // Same server, no restart: the newly collected drafts appear on reload.
    const after = await s.get("/review");
    assert.equal(after.status, 200);
    assert.ok(!after.body.includes("No drafts yet"), "the queue is still absent after the fix");
    assert.match(after.body, /data-review-count=/, "and it must now render the queue it drafted");
  });
});

/**
 * Speak HTTP with these headers ON THE WIRE. `fetch` cannot: `Host` is a forbidden header name, and
 * undici drops it without an error, so a rebinding test written on `fetch` passes against a server
 * with no guard at all (.loop/STATUS.md X10).
 */
function speak(origin: string, path: string, headers: Record<string, string>, method = "GET", body = ""): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname, port, path, method, setHost: false, timeout: REQUEST_TIMEOUT_MS, headers: { ...headers, "content-length": Buffer.byteLength(body) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${method} ${path} timed out`)));
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * SEAM 16 — DNS REBINDING, with the attacker's exact headers. A page whose name re-resolves to
 * 127.0.0.1 sends `Host: foo.example:<port>` and a MATCHING `Origin`, so the Origin check passes
 * it; on 2026-10-08 this POST answered 303 and wrote the approval. The refusal has to come before
 * routing, on every method, and the file is the witness that nothing was written.
 */
test("SEAM 16: a rebound Host is refused 421 before routing, and nothing is read or written", async () => {
  const dir = await tempDir();
  const candidate = (id: string) => ({
    id,
    title: `a candidate to decide on (${id})`,
    evidence: [{ source: "git", ref: "abc1234", observedAt: "2026-08-16T09:00:00Z" }],
    extractor: "git-cluster",
    draftedAt: "2026-08-16T09:00:00Z",
    review: { state: "candidate" },
  });
  const harvestPath = await writeDoc(dir, "harvest.json", { candidates: [candidate("c1"), candidate("c2")] });
  const form = (id: string) => new URLSearchParams({ id, decision: "approve", by: "Rebinding probe" }).toString();
  const formHeaders = { "content-type": "application/x-www-form-urlencoded" };

  await withServer({ FOLIAGE_HARVEST: harvestPath }, async (s) => {
    const { port } = new URL(s.origin);
    const untouched = await readFile(harvestPath, "utf8");
    const rebound = { Host: `foo.example:${port}`, Origin: `http://foo.example:${port}` };
    for (const [method, path, body] of [
      ["GET", "/", ""],
      ["GET", "/review", ""],
      ["HEAD", "/", ""],
      ["POST", "/", ""], // must not reach the 405: no routing decision for a request that is not ours
      ["POST", "/review", form("c1")],
      ["POST", "/promote", ""],
    ] as const) {
      const res = await speak(s.origin, path, { ...rebound, ...(body ? formHeaders : {}) }, method, body);
      assert.equal(res.status, 421, `${method} ${path} answered ${res.status} to a rebound Host`);
      assert.doesNotMatch(res.body, /<html|<!doctype/i, `${method} ${path} refused and then served the page`);
      if (method !== "HEAD") assert.match(res.body, /misdirected: Host was "foo\.example:\d+"/);
    }
    assert.equal(await readFile(harvestPath, "utf8"), untouched, "a refused POST changed the review queue");

    // The control: the names a person on this machine types still read and write.
    for (const host of ["127.0.0.1", "localhost", "LOCALHOST"]) {
      const page = await speak(s.origin, "/review", { Host: `${host}:${port}` });
      assert.equal(page.status, 200, `Host: ${host}:${port} is a real way to reach this server, refused`);
      assert.match(page.body, /a candidate to decide on \(c1\)/);
    }
    for (const [host, id] of [["127.0.0.1", "c1"], ["localhost", "c2"]] as const) {
      const local = { Host: `${host}:${port}`, Origin: `http://${host}:${port}` };
      const posted = await speak(s.origin, "/review", { ...local, ...formHeaders }, "POST", form(id));
      assert.equal(posted.status, 303, `a same-origin POST at ${host} was refused: ${posted.body}`);
    }
    const decided = parseHarvestDocument(JSON.parse(await readFile(harvestPath, "utf8")));
    assert.ok(decided.ok);
    assert.deepEqual(decided.harvest.candidates.map((c) => c.review.state), ["approved", "approved"]);

    // Right name, wrong port: the authority is compared whole.
    assert.equal((await speak(s.origin, "/", { Host: `127.0.0.1:${Number(port) === 1 ? 2 : 1}` })).status, 421);
  });
});
