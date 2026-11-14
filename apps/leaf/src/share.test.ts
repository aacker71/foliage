/**
 * THE SHARE SEAM — the writer, the document it writes, and the route that answers differently
 * afterwards, checked as one chain against a real server process.
 *
 * WHY THIS FILE EXISTS. `leaf.test.ts` proves `leafletVisibility` applies the right default and
 * `isLinkShareable` answers the right two states. `render.test.ts` proves the route refuses a
 * private leaflet. Every one of those passed while the product had NO USER PATH TO SHARING AT
 * ALL: measured on the running server, intake plus promote produced 40 leaflets and
 * `GET /leaflet/<id>` answered 404 for all 40, because nothing in the tree wrote the field.
 * A green suite over a capability nobody can reach is the exact shape of failure this project
 * keeps writing down, so the test that matters is the one that runs the command a person runs
 * and then asks the SERVER whether anything changed.
 *
 * Three properties, and the middle one is the one isolated tests cannot see:
 *
 *   1. The command refuses what it should refuse, by NAMED CAUSE, and writes nothing when it does.
 *   2. `share` flips a real route on a real running server from 404 to 200, with NO RESTART —
 *      and `unshare` flips it back. The document is the only thing that moved.
 *   3. The edit preserves every key the file held, INCLUDING `example`. `parseLeafDocument`
 *      drops that key from its returned `Leaf`, so a writer that round-tripped through the
 *      parser would silently delete the marker that bands a document as a fabricated
 *      illustration. This test is what stops that regression from being invisible.
 *
 * DISCIPLINE, taken from seam.test.ts: every wait has a deadline, every child dies in a
 * `finally`. A check may fail; it must never hang.
 */

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseLeafDocument } from "@foliage/leaf";

import { isVisibility, setVisibility, visibilityRows } from "./share.ts";

const SHARE = fileURLToPath(new URL("../share.mjs", import.meta.url));
const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../example/leaf.example.json", import.meta.url));

const exec = promisify(execFile);

const BOOT_DEADLINE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 4_000;

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-share-"));
  tmpRoots.push(dir);
  return dir;
}

/** A real leaf document on disk, with two leaflets and one distinguishing extra key. */
async function writeLeaf(dir: string, extra: Record<string, unknown> = {}): Promise<string> {
  const path = join(dir, "leaf.json");
  await writeFile(
    path,
    `${JSON.stringify(
      {
        id: "leaf-share-test",
        subject: "A Real Person",
        ...extra,
        leaflets: [
          {
            id: "one",
            title: "the first artifact",
            tier: "pending",
            provenance: { source: "git", ref: "abc123", observedAt: "2026-08-19T00:00:00.000Z" },
          },
          {
            id: "two",
            title: "the second artifact",
            tier: "pending",
            provenance: { source: "git", ref: "def456", observedAt: "2026-08-19T00:00:00.000Z" },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return path;
}

/** Run the real CLI. Never throws on a non-zero exit — the exit code is part of the contract. */
async function share(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [SHARE, ...args], {
      timeout: 20_000,
      env,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** `process.env` with FOLIAGE_LEAF deliberately absent — never blank, genuinely unset. */
function envWithoutLeaf(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["FOLIAGE_LEAF"];
  return env;
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

/** Start the real server against a real document and always kill it. */
async function withServer(
  leafPath: string,
  body: (get: (p: string) => Promise<number>, read: (p: string) => Promise<{ status: number; body: string }>) => Promise<void>,
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

  const read = async (p: string): Promise<{ status: number; body: string }> => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text() };
  };
  const get = async (p: string): Promise<number> => (await read(p)).status;

  try {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let lastError = "never attempted";
    for (;;) {
      if (exited !== null) {
        throw new Error(`server exited before serving: ${exited}\nstderr:\n${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`server did not answer within ${BOOT_DEADLINE_MS}ms: ${lastError}`);
      }
      try {
        await get("/");
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await body(get, read);
  } finally {
    child.kill("SIGKILL");
    if (exited === null) await new Promise<void>((r) => child.once("exit", () => r()));
  }
}

/* ------------------------------------------------------------------- the transformation ---- */

test("isVisibility asks the domain's own list rather than re-spelling it", () => {
  assert.equal(isVisibility("private"), true);
  assert.equal(isVisibility("unlisted"), true);
  assert.equal(isVisibility("public"), true);
  assert.equal(isVisibility("shared"), false);
  assert.equal(isVisibility(""), false);
});

test("visibilityRows separates what the document STATES from what the default supplies", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir);
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;

  const before = visibilityRows(raw);
  assert.equal(before.ok, true);
  if (!before.ok) return;
  assert.deepEqual(
    before.rows.map((r) => [r.id, r.visibility, r.shared, r.stated]),
    [
      ["one", "private", false, undefined],
      ["two", "private", false, undefined],
    ],
  );

  const set = setVisibility(raw, "one", "unlisted");
  assert.equal(set.ok, true);
  if (!set.ok) return;
  const after = visibilityRows(set.document);
  assert.equal(after.ok, true);
  if (!after.ok) return;
  // "private by default" and "unlisted, stated" are different facts, and the row says which.
  assert.deepEqual(after.rows[0], {
    id: "one",
    title: "the first artifact",
    visibility: "unlisted",
    shared: true,
    stated: "unlisted",
  });
});

test("unsharing DELETES the key — the default has exactly one spelling, which is absence", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir);
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;

  const shared = setVisibility(raw, "one", "unlisted");
  assert.equal(shared.ok, true);
  if (!shared.ok) return;
  const unshared = setVisibility(shared.document, "one", null);
  assert.equal(unshared.ok, true);
  if (!unshared.ok) return;

  const leaflet = (unshared.document as { leaflets: Record<string, unknown>[] }).leaflets[0];
  assert.equal("visibility" in (leaflet as object), false);
  assert.equal(unshared.from, "unlisted");
  assert.equal(unshared.to, "private");
  assert.equal(unshared.changed, true);
});

test("setting the state a leaflet is already in is a SUCCESS that changed nothing", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir);
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const noop = setVisibility(raw, "one", null);
  assert.equal(noop.ok, true);
  if (!noop.ok) return;
  // Not a refusal: asking for the state you are in is not an error. But `changed` is false, so
  // the caller cannot report a write it did not make.
  assert.equal(noop.changed, false);
  assert.equal(noop.from, "private");
});

test("a missing leaflet is refused BY NAME and carries the ids that do exist", async () => {
  const dir = await tempDir();
  const raw = JSON.parse(await readFile(await writeLeaf(dir), "utf8")) as unknown;
  const out = setVisibility(raw, "three", "unlisted");
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.cause, "no-such-leaflet");
  if (out.cause !== "no-such-leaflet") return;
  assert.equal(out.id, "three");
  assert.deepEqual([...out.known], ["one", "two"]);
});

test("a document that is not a leaf is refused before any edit is attempted", () => {
  const out = setVisibility({ id: "x", subject: "y" }, "one", "unlisted");
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.cause, "not-a-leaf");
  if (out.cause !== "not-a-leaf") return;
  assert.ok(out.issues.length > 0, "a refusal with no issues would name no cause");
});

test("the input document is never mutated — a refused caller still holds what it had", async () => {
  const dir = await tempDir();
  const raw = JSON.parse(await readFile(await writeLeaf(dir), "utf8")) as unknown;
  const snapshot = JSON.stringify(raw);
  setVisibility(raw, "one", "public");
  assert.equal(JSON.stringify(raw), snapshot);
});

/* ------------------------------------------------------------------------ the CLI on disk ---- */

test("the CLI writes the real document, and every other key survives the edit", async () => {
  const dir = await tempDir();
  // `example: true` is the marker that bands a document as a fabricated illustration, and
  // `parseLeafDocument` does NOT carry it into the Leaf it returns. A writer that round-tripped
  // through the parser would delete it here, silently, while every other assertion passed.
  const path = await writeLeaf(dir, { example: true });

  const out = await share(["share", "one", "--leaf", path]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /private → unlisted/u);

  const after = JSON.parse(await readFile(path, "utf8")) as {
    example?: unknown;
    leaflets: Record<string, unknown>[];
  };
  assert.equal(after.example, true, "the fabrication marker was dropped by an edit to a sibling");
  assert.equal(after.leaflets[0]?.["visibility"], "unlisted");
  assert.equal("visibility" in (after.leaflets[1] as object), false, "an untouched leaflet moved");
  assert.equal(parseLeafDocument(after).ok, true, "the CLI wrote a document it could not load");
});

test("the CLI refuses --as private, and says which command actually does that", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir);
  const before = await readFile(path, "utf8");

  const out = await share(["share", "one", "--as", "private", "--leaf", path]);
  assert.equal(out.code, 2, "a usage mistake is not the same exit as a real failure");
  assert.match(out.stderr, /unshare one/u);
  assert.equal(await readFile(path, "utf8"), before, "a refusal wrote to the file");
});

test("the CLI names an absent document rather than reporting an empty leaf", async () => {
  const dir = await tempDir();
  const out = await share(["list", "--leaf", join(dir, "nothing-here.json")]);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /no leaf document at/u);
  // "there is no file" must never render as "you have no leaflets".
  assert.doesNotMatch(out.stdout, /0 leaflet/u);
});

test("`list` prints an address only for a leaflet that HAS one", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir);

  const before = await share(["list", "--leaf", path]);
  assert.equal(before.code, 0, before.stderr);
  assert.doesNotMatch(before.stdout, /\/leaflet\//u, "an address was printed for a private leaflet");
  assert.match(before.stdout, /0 of 2 leaflet\(s\) have a working address/u);

  assert.equal((await share(["share", "two", "--leaf", path])).code, 0);
  const after = await share(["list", "--leaf", path]);
  assert.match(after.stdout, /two {2}— {2}unlisted {2}\/leaflet\/two/u);
  assert.match(after.stdout, /1 of 2 leaflet\(s\) have a working address/u);
});

/* --------------------------------------------------------------------------- F-025 sweep ---- */

test("F-025: `share` with neither --leaf nor FOLIAGE_LEAF refuses BY NAME before any I/O", async () => {
  const out = await share(["share", "one"], envWithoutLeaf());
  assert.equal(out.code, 2, "a config mistake is a usage error, not a runtime failure");
  assert.match(out.stderr, /missing required argument: --leaf/u);
  assert.match(out.stderr, /FOLIAGE_LEAF/u);
  // `requiredDocumentPath` calls `fail` (→ `process.exit`) before `readRaw`/`writeBack` run at
  // all — no document, real or default, was ever opened. A stdout claiming success would be the
  // one thing that could falsify that; there is none.
  assert.doesNotMatch(out.stdout, /wrote /u);
});

test("F-025: `unshare` with neither --leaf nor FOLIAGE_LEAF refuses the same way", async () => {
  const out = await share(["unshare", "one"], envWithoutLeaf());
  assert.equal(out.code, 2);
  assert.match(out.stderr, /missing required argument: --leaf/u);
  assert.doesNotMatch(out.stdout, /wrote /u);
});

test("F-025 control: `list` is a READ and still defaults with neither --leaf nor FOLIAGE_LEAF set", async () => {
  // The fix is scoped to the WRITE subcommands. `list` never touches `requiredDocumentPath`,
  // so it must still resolve *some* document (its own default) rather than refuse — proving
  // this round did not turn a documented read-time convenience into a hazard it never was.
  const out = await share(["list"], envWithoutLeaf());
  assert.doesNotMatch(out.stderr, /missing required argument: --leaf/u);
});

test("F-025 control: `share` succeeds from FOLIAGE_LEAF alone, with no --leaf flag at all", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir);
  const env = { ...process.env, FOLIAGE_LEAF: path };

  const out = await share(["share", "one"], env);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /private → unlisted/u);

  const after = JSON.parse(await readFile(path, "utf8")) as { leaflets: Record<string, unknown>[] };
  assert.equal(after.leaflets[0]?.["visibility"], "unlisted");
});

test("the bundled example document is a real file this command can read", async () => {
  // Not a fixture written by this test: the document the app actually ships and serves.
  const rows = visibilityRows(JSON.parse(await readFile(EXAMPLE, "utf8")));
  assert.equal(rows.ok, true);
  if (!rows.ok) return;
  assert.ok(rows.rows.length > 0);
  assert.deepEqual(
    rows.rows.filter((r) => r.shared),
    [],
    "the shipped example shares a leaflet by default, which would make private not the default",
  );
});

/* ------------------------------------------------------------------------------ the seam ---- */

test("SEAM: `share` flips a live route from 404 to 200 with no restart, and `unshare` back", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir);

  await withServer(path, async (get) => {
    // The route refuses before anything is shared. This is the state EVERY document written by
    // intake or promote is in, and it is correct rather than broken.
    assert.equal(await get("/leaflet/one"), 404);

    const shared = await share(["share", "one", "--leaf", path]);
    assert.equal(shared.code, 0, shared.stderr);

    // SAME PROCESS. Nothing was restarted, no cache was invalidated — the server re-reads the
    // document per request, so the command and the route are the same fact seen twice.
    assert.equal(await get("/leaflet/one"), 200);
    // The decision is per leaflet: sharing one must not open the compound.
    assert.equal(await get("/leaflet/two"), 404);

    const unshared = await share(["unshare", "one", "--leaf", path]);
    assert.equal(unshared.code, 0, unshared.stderr);
    assert.equal(await get("/leaflet/one"), 404);
  });
});

test("SEAM: a shared title redacts an address while the owner can still read the source words", async () => {
  const dir = await tempDir();
  const path = await writeLeaf(dir);
  const document = JSON.parse(await readFile(path, "utf8")) as { leaflets: { title: string }[] };
  document.leaflets[0]!.title = "Contact o'brien@my-domain.example.com about the work";
  await writeFile(path, `${JSON.stringify(document)}\n`, "utf8");

  await withServer(path, async (get, read) => {
    assert.equal(await get("/leaflet/one"), 404);
    const shared = await share(["share", "one", "--leaf", path]);
    assert.equal(shared.code, 0, shared.stderr);
    const publicPage = await read("/leaflet/one");
    assert.equal(publicPage.status, 200);
    assert.doesNotMatch(publicPage.body, /o(?:'|&#39;)brien@my-domain\.example\.com/);
    assert.match(publicPage.body, /data-title-redacted="true"/);
    assert.match(publicPage.body, /\[withheld: email address\]/);
    const ownerPage = await read("/my/leaflet/one");
    assert.equal(ownerPage.status, 200);
    assert.match(ownerPage.body, /o&#39;brien@my-domain\.example\.com/);
  });
});
