import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_DOCUMENT_PATH,
  DOCUMENT_ENV,
  EXAMPLE_DOCUMENT_PATH,
  fabricationSignals,
  httpStatusFor,
  loadLeafDocument,
  type LeafLoad,
} from "./leafDocument.ts";

/**
 * These tests do REAL filesystem I/O against real temporary files. Nothing is mocked: the
 * whole value of this loader is how it behaves against an actual disk — a missing file, a
 * directory where a file was expected, a byte-order mark, a permission bit. A mocked fs would
 * prove only that the mock agrees with itself.
 *
 * Every document written here is a loader input pinning one outcome. None of it is portfolio
 * content and none of it is rendered as anyone's evidence.
 */

async function tmp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "foliage-leaf-"));
}

/** Load with FOLIAGE_LEAF pointed at `path`, and nothing else in the environment. */
function loadFrom(path: string): Promise<LeafLoad> {
  return loadLeafDocument({ [DOCUMENT_ENV]: path });
}

function causeOf(load: LeafLoad): string {
  return load.ok ? "ok" : load.cause;
}

const valid = {
  id: "leaf-under-test",
  subject: "Loader Input",
  leaflets: [
    {
      id: "a",
      title: "verified item",
      tier: "verified",
      provenance: { source: "git", ref: "e3b4489", observedAt: "2026-08-13T00:00:00Z" },
    },
    { id: "b", title: "pending item", tier: "pending" },
    { id: "c", title: "excluded item", tier: "excluded", reason: "different author identity" },
  ],
};

test("a valid document loads, and the source records path, bytes and read time", async () => {
  const dir = await tmp();
  const path = join(dir, "leaf.json");
  const text = JSON.stringify(valid);
  await writeFile(path, text, "utf8");

  const load = await loadFrom(path);
  assert.equal(causeOf(load), "ok");
  if (!load.ok) return;

  assert.equal(load.leaf.subject, "Loader Input");
  assert.equal(load.leaf.leaflets.length, 3);
  assert.equal(load.source.path, path);
  assert.equal(load.source.bytes, Buffer.byteLength(text, "utf8"));
  assert.equal(load.source.documentDigest, `sha256:${createHash("sha256").update(text).digest("hex")}`);
  assert.match(load.source.readAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test("ABSENT AND EMPTY ARE DIFFERENT OUTCOMES — the distinction this row turns on", async () => {
  // If these two ever collapse, the page tells a first user "no document found" about a
  // document that is sitting there, valid, and simply has nothing in it yet. That is the
  // `commitCount: 0` failure wearing a different hat.
  const dir = await tmp();

  const missing = await loadFrom(join(dir, "nope.json"));
  assert.equal(causeOf(missing), "absent");

  const emptyPath = join(dir, "empty.json");
  await writeFile(emptyPath, JSON.stringify({ id: "l", subject: "Loader Input", leaflets: [] }));
  const empty = await loadFrom(emptyPath);

  assert.equal(causeOf(empty), "ok", "a valid document with no leaflets must LOAD");
  if (!empty.ok) return;
  assert.equal(empty.leaf.leaflets.length, 0);
  assert.equal(empty.leaf.subject, "Loader Input", "the subject is still known and nameable");
});

test("absent names the exact path it searched", async () => {
  const dir = await tmp();
  const path = join(dir, "nowhere.json");
  const load = await loadFrom(path);
  assert.equal(causeOf(load), "absent");
  if (load.ok) return;
  assert.equal(load.path, path);
  assert.ok(load.detail.includes(path), "the detail must name the path, not just 'not found'");
});

test("with nothing configured, the default path is searched and named", async () => {
  // The invariant is WHICH PATH gets searched, not what happens to be sitting at it. The
  // repository never ships a leaf.json, but DEFAULT_DOCUMENT_PATH is where a self-hoster's
  // own document goes — leafDocument.ts says so — so on a machine where this app has
  // actually been used, the file IS there. An earlier version of this test asserted
  // `absent` unconditionally and so could only pass on a machine that had never run the
  // product; it went red the moment the intake path wrote a real document to that path.
  //
  // The expected outcome is therefore read off the disk FIRST and then required. Accepting
  // whichever result turns up would assert nothing at all.
  const present = await stat(DEFAULT_DOCUMENT_PATH).then(
    () => true,
    () => false,
  );

  const load = await loadLeafDocument({});

  if (!present) {
    assert.equal(causeOf(load), "absent", "no file at the default path must report absent");
    if (load.ok) return;
    assert.equal(load.path, DEFAULT_DOCUMENT_PATH);
    assert.ok(load.detail.includes(DOCUMENT_ENV), "it must say how to point somewhere else");
    return;
  }

  // A document IS at the default path. It must have been the one read — never the example,
  // and never some other path — and it must not be mistaken for a missing one.
  assert.notEqual(causeOf(load), "absent", "a file at the default path is not an absent one");
  assert.equal(
    load.ok ? load.source.path : load.path,
    DEFAULT_DOCUMENT_PATH,
    "the unconfigured load must resolve the default path, whatever verdict it reaches",
  );
});

test("set-but-blank is `unconfigured`, NOT a silent fallback to the default", async () => {
  // `FOLIAGE_LEAF= node server.mjs` must not answer "no document at <default>" to someone
  // staring at the variable they think they set.
  for (const blank of ["", "   ", "\t"]) {
    const load = await loadLeafDocument({ [DOCUMENT_ENV]: blank });
    assert.equal(causeOf(load), "unconfigured", `blank ${JSON.stringify(blank)}`);
    if (load.ok) continue;
    assert.equal(load.path, null);
    assert.ok(load.detail.includes(DOCUMENT_ENV));
  }
});

test("a directory where a file was expected is `unreadable` with its real errno", async () => {
  // Not ENOENT. Reporting this as "not found" would send someone hunting for a path that is
  // right there — the exact error-masking this project keeps paying for.
  const dir = await tmp();
  const asDir = join(dir, "leaf.json");
  await mkdir(asDir);

  const load = await loadFrom(asDir);
  assert.equal(causeOf(load), "unreadable");
  if (load.ok || load.cause !== "unreadable") return;
  assert.equal(load.errno, "EISDIR");
  assert.ok(load.detail.includes("EISDIR"), "the errno must reach the page, not just the log");
});

test("an unreadable file reports EACCES rather than being flattened to not-found", async () => {
  const dir = await tmp();
  const path = join(dir, "leaf.json");
  await writeFile(path, JSON.stringify(valid));
  await chmod(path, 0o000);

  const load = await loadFrom(path);
  await chmod(path, 0o600); // restore so the temp dir can be cleaned up
  assert.equal(causeOf(load), "unreadable");
  if (load.ok || load.cause !== "unreadable") return;
  assert.equal(load.errno, "EACCES");
});

test("invalid JSON is `malformed` and locates the fault WHEN THE PARSER GIVES A LOCATION", async () => {
  // V8 emits two shapes and we control neither. "Expected X in JSON at position N (line L
  // column C)" carries a location; "Unexpected token 'x', ...snippet..." carries none at all.
  // Both must be usable, and the one with no location must SAY it has none rather than let the
  // reader assume the snippet is a position.
  const dir = await tmp();

  const located = join(dir, "located.json");
  await writeFile(located, '{\n  "id": "l",\n  "subject": "S"\n  "leaflets": []\n}');
  const a = await loadFrom(located);
  assert.equal(causeOf(a), "malformed");
  if (!a.ok) {
    assert.match(a.detail, /line \d+/, "a reported location must reach the page");
    assert.match(a.detail, /column \d+/);
  }

  const unlocated = join(dir, "unlocated.json");
  await writeFile(unlocated, '{ "id": "l", "subject": "S", "leaflets": [ }');
  const b = await loadFrom(unlocated);
  assert.equal(causeOf(b), "malformed");
  if (!b.ok) {
    assert.match(b.detail, /Unexpected token/, "the offending token is always identified");
    assert.match(
      b.detail,
      /reported no position/,
      "when there is no location, say so — do not let a snippet read as one",
    );
    assert.doesNotMatch(b.detail, /line \d+/, "and never invent one");
  }
});

test("a byte-order mark does not become a mystery parse error at position 0", async () => {
  const dir = await tmp();
  const path = join(dir, "leaf.json");
  await writeFile(path, "﻿" + JSON.stringify(valid), "utf8");

  const load = await loadFrom(path);
  assert.equal(causeOf(load), "ok", "a BOM is an editor artifact, not a malformed document");
});

test("valid JSON that is not a leaf is `invalid`, naming the field and leaflet index", async () => {
  const dir = await tmp();
  const path = join(dir, "leaf.json");
  await writeFile(
    path,
    JSON.stringify({
      id: "l",
      subject: "Loader Input",
      leaflets: [{ id: "a", title: "no reason", tier: "excluded" }],
    }),
  );

  const load = await loadFrom(path);
  assert.equal(causeOf(load), "invalid");
  if (load.ok || load.cause !== "invalid") return;
  assert.deepEqual(
    load.issues.map((i) => i.at),
    ["leaflets[0].reason"],
  );
  assert.ok(load.detail.includes("leaflets[0].reason"));
});

test("the invalid summary states an EXACT count even when it truncates the list", async () => {
  const dir = await tmp();
  const path = join(dir, "leaf.json");
  await writeFile(
    path,
    JSON.stringify({
      leaflets: [
        { title: "no id", tier: "bogus" },
        { id: "x", title: "y", tier: "excluded" },
      ],
    }),
  );

  const load = await loadFrom(path);
  assert.equal(causeOf(load), "invalid");
  if (load.ok || load.cause !== "invalid") return;
  assert.ok(load.issues.length > 3, `expected >3 issues, got ${load.issues.length}`);
  assert.ok(
    load.detail.includes(`${load.issues.length} problems`),
    `the summary must state the real total: ${load.detail}`,
  );
  assert.match(load.detail, /and \d+ more/, "and must say that it truncated");
});

test("the five not-ok causes are five distinct values", async () => {
  // The evidence that nothing is masked: one run, five inputs, five different answers.
  const dir = await tmp();
  const asDir = join(dir, "dir.json");
  await mkdir(asDir);
  const bad = join(dir, "bad.json");
  await writeFile(bad, "{oops");
  const notLeaf = join(dir, "notleaf.json");
  await writeFile(notLeaf, JSON.stringify({ id: "l", subject: "s" }));

  const causes = [
    causeOf(await loadLeafDocument({ [DOCUMENT_ENV]: "" })),
    causeOf(await loadFrom(join(dir, "missing.json"))),
    causeOf(await loadFrom(asDir)),
    causeOf(await loadFrom(bad)),
    causeOf(await loadFrom(notLeaf)),
  ];
  assert.deepEqual(causes, ["unconfigured", "absent", "unreadable", "malformed", "invalid"]);
  assert.equal(new Set(causes).size, 5);
});

test("fabrication is flagged by EITHER signal, and both are reported when both hold", async () => {
  const dir = await tmp();

  // Declared, but not the bundled path.
  const declared = join(dir, "declared.json");
  await writeFile(declared, JSON.stringify({ ...valid, example: true }));
  const a = await loadFrom(declared);
  assert.equal(causeOf(a), "ok");
  if (a.ok) {
    assert.deepEqual(fabricationSignals(a.source), ['the document declares "example": true']);
  }

  // Neither: an ordinary document at an ordinary path.
  const plain = join(dir, "plain.json");
  await writeFile(plain, JSON.stringify(valid));
  const b = await loadFrom(plain);
  if (b.ok) assert.deepEqual(fabricationSignals(b.source), []);

  // Both: the bundled example document, which declares itself.
  const c = await loadFrom(EXAMPLE_DOCUMENT_PATH);
  assert.equal(causeOf(c), "ok", "the shipped example document must be a valid leaf document");
  if (c.ok) {
    assert.equal(fabricationSignals(c.source).length, 2, "both signals, both reported");
    assert.equal(c.source.declaredExample, true);
    assert.equal(c.source.bundledExample, true);
  }
});

test("the example document is never loaded unless it is named explicitly", async () => {
  const load = await loadLeafDocument({});
  assert.notEqual(
    load.ok ? load.source.path : null,
    EXAMPLE_DOCUMENT_PATH,
    "no default may ever resolve to fabricated content",
  );
});

test("first-run states answer 200; a document the owner must repair answers 409", async () => {
  const dir = await tmp();
  const bad = join(dir, "bad.json");
  await writeFile(bad, "{oops");

  assert.equal(httpStatusFor(await loadLeafDocument({ [DOCUMENT_ENV]: "" })), 200);
  assert.equal(httpStatusFor(await loadFrom(join(dir, "missing.json"))), 200);
  // A 200 here would tell every uptime check the portfolio is fine while it is dark; a 500 would
  // blame this app for a file on disk that needs the owner's repair.
  assert.equal(httpStatusFor(await loadFrom(bad)), 409);
});
