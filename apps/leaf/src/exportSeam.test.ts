/**
 * The export seam, driven through the real CLI — because the export is the one artifact that
 * LEAVES the machine, and until 2026-08-23 nothing in this suite exercised it at all.
 *
 * THE CORPSE THIS PINS. The exported footer shipped the document's ABSOLUTE PATH —
 * `/Users/<name>/.foliage/leaf.json`, the owner's username and home layout, visible on the page.
 * The public renderer now omits that operator-only footer altogether. The export must carry
 * neither the path nor its byte/read-time diagnostics.
 *
 * Each test spawns `export.mjs` exactly as a user runs it, against a document written in a temp
 * dir. Fixture documents are test scaffolding, never product data, and everything is deleted.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { putImage, readMedia } from "./mediaStore.ts";

const EXPORT_CLI = fileURLToPath(new URL("../export.mjs", import.meta.url));

/**
 * A minimal valid leaf document with the given leaflet titles.
 *
 * `visibility` defaults to absent — the domain's own default, `private` — because most of what
 * this file tests (the public footer boundary, the byte count, the title gate) has nothing to do with
 * consent. The two tests that need a leaflet to actually CROSS into the export pass
 * `"public"` explicitly; that is a fixture correction, not a weaker assertion — see the header of
 * the two tests below that pass it.
 */
const leafDoc = (titles: readonly string[], visibility?: "public" | "unlisted") =>
  JSON.stringify({
    id: "leaf:seam",
    subject: "Export Seam",
    leaflets: titles.map((title, i) => ({
      id: `git:${String(i).padStart(4, "0")}${"a".repeat(36)}`,
      title,
      tier: "pending",
      provenance: { source: "git", ref: `${String(i).padStart(4, "0")}${"a".repeat(36)}`, observedAt: "2026-08-20T00:00:00.000Z" },
      ...(visibility === undefined ? {} : { visibility }),
    })),
  });

const runExport = (leafPath: string, outDir: string, extra: readonly string[] = [], policyPath?: string) =>
  spawnSync(process.execPath, [EXPORT_CLI, "--out", outDir, ...extra], {
    encoding: "utf8",
    env: {
      ...process.env,
      FOLIAGE_LEAF: leafPath,
      ...(policyPath === undefined ? {} : { FOLIAGE_POLICY: policyPath }),
    },
  });

test("a malformed policy refuses export before any output directory is created", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-export-policy-"));
  try {
    const leaf = join(dir, "leaf.json");
    const policy = join(dir, "policy.json");
    const out = join(dir, "site");
    writeFileSync(leaf, leafDoc([]));
    writeFileSync(policy, "{broken");
    const r = spawnSync(process.execPath, [EXPORT_CLI, "--out", out], {
      encoding: "utf8",
      env: { ...process.env, FOLIAGE_LEAF: leaf, FOLIAGE_POLICY: policy },
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /export: REFUSED/);
    assert.match(r.stderr, /nothing was exported/);
    assert.doesNotMatch(r.stderr, /TypeError/);
    assert.equal(existsSync(out), false);
    assert.equal(readFileSync(policy, "utf8"), "{broken");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the exported page omits local document diagnostics and the absolute path", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportseam-"));
  try {
    const leafPath = join(dir, "leaf.json");
    writeFileSync(leafPath, leafDoc(["intake: a plain title"]), "utf8");
    const r = runExport(leafPath, join(dir, "site"));
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(dir, "site", "index.html"), "utf8");
    assert.doesNotMatch(html, /<footer class="leaf-source">|\b602 bytes\b|<span class="fol-label">Document<\/span>/);
    // The temp dir's absolute path — the stand-in for /Users/<name> — must not appear anywhere.
    assert.ok(!html.includes(dir), `the export leaked the machine path ${dir}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the logged byte count IS the written file's size, multi-byte characters included (F-033)", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportseam-"));
  try {
    const leafPath = join(dir, "leaf.json");
    // An em dash is one UTF-16 code unit but three UTF-8 bytes — the exact gap F-033 measured
    // (246237 logged vs 246359 on disk, one byte short per multi-byte character).
    writeFileSync(leafPath, leafDoc(["canopy: three Pending badges — and not one word"]), "utf8");
    const out = join(dir, "site");
    const r = runExport(leafPath, out);
    assert.equal(r.status, 0, r.stderr);
    const logged = r.stdout.match(/index\.html \((\d+) bytes\)/);
    assert.ok(logged !== null, `the byte-count line is missing from: ${r.stdout}`);
    const written = statSync(join(out, "index.html")).size;
    assert.equal(Number(logged[1]), written, "the log claims a measurement it did not make");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a title carrying an email address refuses with exit 3, names it, and writes NOTHING", () => {
  // `visibility: "public"` here is a FIXTURE CORRECTION, not a weaker assertion: this test is
  // about the title gate, not about consent, and since PR-C the gate only ever sees the set the
  // person actually offered — a never-shared row would never reach it and this test would be
  // asserting nothing. The sibling test below (a never-shared title) pins the other half.
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportseam-"));
  try {
    const leafPath = join(dir, "leaf.json");
    writeFileSync(leafPath, leafDoc(["fix: thanks to colleague@else.example for the report"], "public"), "utf8");
    const out = join(dir, "site");
    const r = runExport(leafPath, out);
    assert.equal(r.status, 3, `expected the title gate's exit 3, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /colleague@else\.example/, "the refusal must name the address");
    assert.equal(existsSync(join(out, "index.html")), false, "REFUSED must mean nothing was written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--confirm acknowledges redacted public titles and says so — consent, not silence", () => {
  // Same fixture correction as above: `visibility: "public"` so the row crosses into the export
  // at all, which is what makes --confirm's effect on it observable.
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportseam-"));
  try {
    const leafPath = join(dir, "leaf.json");
    writeFileSync(leafPath, leafDoc(["fix: thanks to colleague@else.example for the report"], "public"), "utf8");
    const out = join(dir, "site");
    const r = runExport(leafPath, out, ["--confirm"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /redacted under --confirm/, "the output must state what --confirm did");
    const html = readFileSync(join(out, "index.html"), "utf8");
    assert.doesNotMatch(html, /colleague@else\.example/, "the public index must not repeat the address");
    assert.match(html, /\[withheld: email address\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a never-shared leaflet with an email in its title neither refuses the export nor appears in it", () => {
  // THE OTHER HALF OF THE GATE'S FIXTURE CORRECTION ABOVE. A leaflet nobody offered never reaches
  // the title gate at all — consent is enforced before the gate ever sees a row — so this is not
  // the same case as the email refusal above wearing a different visibility. `--confirm` lets the
  // person acknowledge a redacted public title; it has no opinion about a leaflet they never
  // offered, and neither does this command.
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportseam-"));
  try {
    const leafPath = join(dir, "leaf.json");
    writeFileSync(leafPath, leafDoc(["fix: thanks to colleague@else.example for the report"]), "utf8");
    const out = join(dir, "site");
    const r = runExport(leafPath, out);
    assert.equal(r.status, 0, `a never-shared leaflet must not trip the title gate: ${r.stderr}`);
    const html = readFileSync(join(out, "index.html"), "utf8");
    assert.ok(!html.includes("colleague@else.example"), "the never-shared title must not reach the page either");
    assert.match(html, /Nothing published yet/);
    assert.doesNotMatch(html, /data-audience="published"/, "a zero-admission export must not carry a published badge");
    assert.doesNotMatch(html, /nothing in it yet|Add a leaflet|reload\.<\/p>/,
      "a populated private document is not an empty document, and a stranger cannot edit it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CONSENT AT THE EDGE: a leaflet nobody offered carries neither its id nor its title, and the page carries no per-tier tally", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportseam-"));
  try {
    const leafPath = join(dir, "leaf.json");
    writeFileSync(
      leafPath,
      JSON.stringify({
        id: "leaf:consent",
        subject: "Export Seam",
        leaflets: [
          {
            id: "git:offered0000000000000000000000000000",
            title: "feat: the one leaflet this person offered",
            tier: "pending",
            provenance: {
              source: "git",
              ref: "offered0000000000000000000000000000",
              observedAt: "2026-08-20T00:00:00.000Z",
            },
            visibility: "public",
          },
          {
            id: "git:kept0back00000000000000000000000000",
            title: "fix: an entry this person never offered to anyone",
            tier: "pending",
            provenance: {
              source: "git",
              ref: "kept0back00000000000000000000000000",
              observedAt: "2026-08-20T00:00:00.000Z",
            },
          },
        ],
      }),
      "utf8",
    );
    const out = join(dir, "site");
    const r = runExport(leafPath, out);
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(out, "index.html"), "utf8");
    assert.ok(html.includes("the one leaflet this person offered"), "the offered leaflet must still cross");
    assert.ok(
      !html.includes("an entry this person never offered to anyone"),
      "the never-shared leaflet's title must not reach the page",
    );
    assert.ok(!html.includes("git:kept0back"), "nor its id, anywhere in the bytes");
    // THE SCORE. A per-person verified/pending/excluded/total tally is exactly what
    // publicProjection.ts refuses on a page an employer might hold ("per person, summed, it is a
    // score") — this page has a person on it, so it must carry none.
    assert.ok(!html.includes("data-count="), "a published page carries no per-tier tally at all");
    const label = html.match(/class="leaf-frond"[^>]*aria-label="([^"]+)"/)?.[1];
    assert.ok(label, "the offered work retains an accessible graphic description");
    assert.doesNotMatch(label, /\d/, "accessible text must obey the same no-aggregate rule");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export independently requires listed consent, attribution, and a policy that does not deny", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-exportseam-"));
  try {
    const leafPath = join(dir, "leaf.json");
    const policyPath = join(dir, "policy.json");
    const inputs = [
      { id: "public-control", title: "Public positive control", tier: "pending", visibility: "public" },
      { id: "unlisted-control", title: "Link-only consent control", tier: "pending", visibility: "unlisted" },
      { id: "excluded-control", title: "Attribution negative control", tier: "excluded", visibility: "public", reason: "Attribution is absent in this test input." },
      { id: "denied-control", title: "Policy denial control", tier: "pending", visibility: "public" },
    ];
    writeFileSync(leafPath, JSON.stringify({
      id: "leaf:projection-controls",
      subject: "Export Seam",
      leaflets: inputs.map((input) => ({
        ...input,
        provenance: { source: "git", ref: "a".repeat(40), observedAt: "2026-08-20T00:00:00.000Z" },
      })),
    }));
    // No default deny-excluded rule: attribution must bind structurally even without it.
    writeFileSync(policyPath, JSON.stringify({ rules: [{
      id: "deny-control", effect: "deny", match: { kind: "id-prefix", prefix: "denied-" },
      reason: "Policy exclusion test input.",
    }] }));
    const out = join(dir, "site");
    const result = runExport(leafPath, out, [], policyPath);
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(join(out, "index.html"), "utf8");
    assert.ok(html.includes(inputs[0]!.title), "the listed, attributed control must cross");
    for (const withheld of inputs.slice(1)) {
      assert.ok(!html.includes(withheld.id), `${withheld.id} leaked its id`);
      assert.ok(!html.includes(withheld.title), `${withheld.id} leaked its title`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each admitted Leaflet opens a static body and its individual evidence, with no withheld page or dangling link", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-export-detail-"));
  try {
    const leafPath = join(dir, "leaf.json");
    const policyPath = join(dir, "policy.json");
    const out = join(dir, "site");
    const provenance = (ref: string) => ({ source: "git", ref, observedAt: "2026-08-20T00:00:00.000Z" });
    writeFileSync(leafPath, JSON.stringify({
      id: "leaf:detail-controls",
      subject: "Export Seam",
      leaflets: [
        { id: "public-control", title: "Recorded delivery", tier: "pending", visibility: "public", provenance: provenance("a".repeat(40)),
          body: [
            { text: "The first inspected contribution.", provenance: provenance("b".repeat(40)) },
            { text: "The second inspected contribution.", provenance: provenance("c".repeat(40)) },
          ] },
        { id: "private-control", title: "Private control", tier: "pending", provenance: provenance("d".repeat(40)) },
        { id: "unlisted-control", title: "Unlisted control", tier: "pending", visibility: "unlisted", provenance: provenance("e".repeat(40)) },
        { id: "excluded-control", title: "Excluded control", tier: "excluded", visibility: "public", reason: "Not attributed", provenance: provenance("f".repeat(40)) },
        { id: "denied-control", title: "Denied control", tier: "pending", visibility: "public", provenance: provenance("0".repeat(40)) },
      ],
    }));
    writeFileSync(policyPath, JSON.stringify({ rules: [{ id: "deny-control", effect: "deny", match: { kind: "id-prefix", prefix: "denied-" }, reason: "Not approved" }] }));
    const result = runExport(leafPath, out, [], policyPath);
    assert.equal(result.status, 0, result.stderr);
    const indexPath = join(out, "index.html");
    const index = readFileSync(indexPath, "utf8");
    const href = index.match(/href="(leaflet\/[0-9a-f]{64}\.html)"/)?.[1];
    assert.ok(href, "the admitted row must link to its own static reader");
    const detailPath = join(out, href);
    const detail = readFileSync(detailPath, "utf8");
    assert.match(detail, /The first inspected contribution/);
    assert.match(detail, /The second inspected contribution/);
    assert.ok(detail.includes("b".repeat(40)) && detail.includes("c".repeat(40)), "both body elements keep their own refs");
    assert.match(detail, /href="\.\.\/index\.html"[^>]*>All work<\/a>/);
    assert.deepEqual(readdirSync(join(out, "leaflet")), [href.slice("leaflet/".length)], "only the admitted Leaflet gets a detail page");
    for (const [path, html] of [[indexPath, index], [detailPath, detail]] as const) {
      assert.doesNotMatch(html, /(?:href|src)="\//, `${path} retained a server-root link`);
      for (const link of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const target = link[1]!;
        if (target.startsWith("#")) continue;
        assert.ok(existsSync(resolve(dirname(path), target)), `${path} has a dangling link to ${target}`);
      }
      for (const withheld of ["Private control", "Unlisted control", "Excluded control", "Denied control"]) {
        assert.ok(!html.includes(withheld), `${path} leaked ${withheld}`);
      }
      assert.ok(!html.includes(dir), `${path} leaked a local machine path`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a published destination stays byte-identical on refused re-export; a fresh release omits withdrawn work", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-export-withdraw-"));
  try {
    const leafPath = join(dir, "leaf.json");
    const out = join(dir, "site");
    const record = { id: "withdraw-control", title: "Work later withdrawn", tier: "pending", visibility: "public",
      provenance: { source: "git", ref: "a".repeat(40), observedAt: "2026-08-20T00:00:00.000Z" } };
    writeFileSync(leafPath, JSON.stringify({ id: "leaf:withdraw", subject: "Export Seam", leaflets: [record] }));
    assert.equal(runExport(leafPath, out).status, 0);
    const detail = join(out, "leaflet", `${createHash("sha256").update(record.id).digest("hex")}.html`);
    assert.equal(existsSync(detail), true);
    const snapshot = () => Object.fromEntries(readdirSync(out, { recursive: true, encoding: "utf8" }).filter(file => statSync(join(out, file)).isFile())
      .sort().map(file => [file, readFileSync(join(out, file)).toString("base64")]));
    const original = snapshot();
    writeFileSync(leafPath, JSON.stringify({ id: "leaf:withdraw", subject: "Export Seam", leaflets: [{ ...record, visibility: "private" }] }));
    const refused = runExport(leafPath, out);
    assert.equal(refused.status, 3, refused.stderr);
    assert.match(refused.stderr, /Choose a fresh --out directory/);
    assert.deepEqual(snapshot(), original, "a failed in-place re-export must never break old index links or mutate its files");
    assert.ok(readFileSync(join(out, "index.html"), "utf8").includes(`leaflet/${createHash("sha256").update(record.id).digest("hex")}.html`));
    assert.equal(existsSync(detail), true);

    const next = join(dir, "site-next");
    const replacement = runExport(leafPath, next);
    assert.equal(replacement.status, 0, replacement.stderr);
    assert.ok(!readFileSync(join(next, "index.html"), "utf8").includes(record.title));
    assert.deepEqual(readdirSync(join(next, "leaflet")), [], "the new release has no withdrawn detail address");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an interrupted export journals detail files before writing them, so the next run removes them", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-export-interrupted-"));
  try {
    const leafPath = join(dir, "leaf.json");
    const out = join(dir, "site");
    const record = { id: "interrupted-control", title: "Work in an interrupted export", tier: "pending", visibility: "public",
      provenance: { source: "git", ref: "a".repeat(40), observedAt: "2026-08-20T00:00:00.000Z" } };
    writeFileSync(leafPath, JSON.stringify({ id: "leaf:interrupted", subject: "Export Seam", leaflets: [record] }));
    // A prior incomplete run has a valid journal but no index. The collision forces a
    // second interruption after the detail page is written; only this state may be retried.
    mkdirSync(join(out, "leaf.css"), { recursive: true });
    writeFileSync(join(out, "foliage-export-manifest.json"), JSON.stringify({ files: [] }));
    const failed = runExport(leafPath, out);
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stderr, /FAILED to copy leaf\.css/);
    const file = `leaflet/${createHash("sha256").update(record.id).digest("hex")}.html`;
    assert.equal(existsSync(join(out, file)), true);
    const journal = JSON.parse(readFileSync(join(out, "foliage-export-manifest.json"), "utf8"));
    assert.ok(journal.files.includes(file), "a failed run must retain the cleanup address");
    assert.equal(existsSync(join(out, "index.html")), false, "no incomplete index should be published");

    rmSync(join(out, "leaf.css"), { recursive: true });
    writeFileSync(leafPath, JSON.stringify({ id: "leaf:interrupted", subject: "Export Seam", leaflets: [{ ...record, visibility: "private" }] }));
    const recovered = runExport(leafPath, out);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(join(out, file)), false, "the restarted export must remove the earlier public page");
    assert.deepEqual(JSON.parse(readFileSync(join(out, "foliage-export-manifest.json"), "utf8")).files, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("example documents refuse export before writing a page", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-export-example-"));
  try {
    const leafPath = join(dir, "leaf.json");
    const out = join(dir, "site");
    writeFileSync(leafPath, JSON.stringify({ id: "leaf:example-control", subject: "Example control", example: true, leaflets: [] }));
    const result = runExport(leafPath, out);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /example material is not a publishable record/);
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the static reader carries verified clean media and never links to missing media", async () => {
  const dir = mkdtempSync(join(tmpdir(), "foliage-export-media-"));
  try {
    // This is an already-public product screenshot, used only as a real media-store input.
    const sourcePath = fileURLToPath(new URL("../../www/public/product/presentation-mobile.png", import.meta.url));
    const sourceDigest = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    const root = join(dir, "media");
    const stored = await putImage({ root, sourcePath, sourceDigest, sourceFormat: "png", sipsRuns: false });
    assert.equal(stored.ok, true, stored.ok ? "" : stored.detail);
    if (!stored.ok) return;
    const leafPath = join(dir, "leaf.json");
    const out = join(dir, "site");
    const missingRef = `sha256:${"0".repeat(64)}`;
    writeFileSync(leafPath, JSON.stringify({ id: "leaf:media-control", subject: "Export Seam", leaflets: [{
      id: "media-control", title: "Published media control", tier: "pending", visibility: "public",
      body: [stored.ref, missingRef].map((ref) => ({ provenance: { source: "photo", ref, observedAt: "2026-08-20T00:00:00.000Z" },
        media: { mediaType: "image/png", dimensions: { known: false, why: "Not measured" } } })),
    }] }));
    const result = runExport(leafPath, out);
    assert.equal(result.status, 0, result.stderr);
    const detailName = `${createHash("sha256").update("media-control").digest("hex")}.html`;
    const detail = readFileSync(join(out, "leaflet", detailName), "utf8");
    const href = detail.match(/src="(\.\.\/media\/[0-9a-f]{64}\.png)"/)?.[1];
    assert.ok(href, "a verified media object must be copied and linked relatively");
    const exported = readFileSync(resolve(out, "leaflet", href));
    const held = await readMedia(root, stored.ref);
    assert.equal(held.ok, true);
    if (held.ok) assert.deepEqual(exported, held.bytes, "the export copies the store's verified published bytes");
    assert.match(detail, /Image unavailable in this export/);
    assert.doesNotMatch(detail, /(?:href|src)="\/media\//);
    assert.deepEqual(readdirSync(join(out, "media")), [`${sourceDigest}.png`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
