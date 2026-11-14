/**
 * F-021 through the real export CLI: the title gate finds the WHOLE address, using the same rule
 * the publication gate redacts with.
 *
 * Before the shared rule, `export.mjs` kept its own pattern without the apostrophe. Measured on
 * `fix: contact o'brien@my-domain.example.com about it`, the refusal named
 * `brien@my-domain.example.com` — part of an address, so the person reading it was told less was
 * at stake than actually was. The gate still refuses with exit 3 and writes nothing. Confirming
 * allows export with the affected public headings redacted, including on detail pages.
 *
 * Fixture documents are invented test scaffolding under reserved names (RFC 2606/6761), written
 * to a temp dir and deleted. Each run spawns `export.mjs` the way a person runs it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const EXPORT_CLI = fileURLToPath(new URL("../export.mjs", import.meta.url));

/** One offered (public) leaflet per title, so every title reaches the gate. */
const leafDoc = (titles: readonly string[]) =>
  JSON.stringify({
    id: "leaf:redaction-rule",
    subject: "Redaction Rule",
    leaflets: titles.map((title, i) => {
      const ref = `${String(i).padStart(4, "0")}${"b".repeat(36)}`;
      return {
        id: `git:${ref}`,
        title,
        tier: "pending",
        provenance: { source: "git", ref, observedAt: "2026-08-20T00:00:00.000Z" },
        visibility: "public",
      };
    }),
  });

function exportTitles(titles: readonly string[], extra: readonly string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "foliage-export-rule-"));
  const leafPath = join(dir, "leaf.json");
  const out = join(dir, "site");
  writeFileSync(leafPath, leafDoc(titles), "utf8");
  const env: NodeJS.ProcessEnv = { ...process.env, FOLIAGE_LEAF: leafPath };
  for (const k of ["FOLIAGE_GARDEN", "FOLIAGE_HARVEST", "FOLIAGE_POLICY", "FOLIAGE_WORKFLOW_DIR"]) delete env[k];
  const r = spawnSync(process.execPath, [EXPORT_CLI, "--out", out, ...extra], { encoding: "utf8", env });
  const page = join(out, "index.html");
  const html = existsSync(page) ? readFileSync(page, "utf8") : null;
  const detailDir = join(out, "leaflet");
  const detailHtml = existsSync(detailDir)
    ? readdirSync(detailDir).filter((name) => name.endsWith(".html")).map((name) => readFileSync(join(detailDir, name), "utf8"))
    : [];
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, html, detailHtml };
}

/** The addresses the refusal names, one per `export:   <id> — <hits>` line. */
const named = (stderr: string): readonly string[] =>
  [...stderr.matchAll(/^export: {3}git:\S+ — (.+)$/gm)].flatMap((m) => m[1]!.split(", "));

test("F-021: an apostrophe address is named whole by the refusal, not as a fragment", () => {
  const r = exportTitles(["fix: contact o'brien@my-domain.example.com about it"]);
  assert.equal(r.status, 3, `expected the title gate's exit 3, got ${r.status}: ${r.stderr}`);
  assert.deepEqual(named(r.stderr), ["o'brien@my-domain.example.com"]);
  assert.equal(r.html, null, "REFUSED must still mean nothing was written");
});

test("a hyphenated, multi-label domain is named whole", () => {
  const r = exportTitles(["ping d'angelo@sub.my-domain.example.org today"]);
  assert.equal(r.status, 3, r.stderr);
  assert.deepEqual(named(r.stderr), ["d'angelo@sub.my-domain.example.org"]);
});

test("an address in the middle of a title is found, and only the address is named", () => {
  const r = exportTitles(["docs: route billing questions to help.desk@eu.billing.example.org before release"]);
  assert.equal(r.status, 3, r.stderr);
  assert.deepEqual(named(r.stderr), ["help.desk@eu.billing.example.org"]);
});

test("clean titles export; a typo'd address refuses; --confirm exports redacted index and detail headings", () => {
  const clean = exportTitles(["chore: bump npm@1.2.3 and @foliage/leaf"]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /no title carries an email address/);

  const typo = exportTitles(["mail rowan@northwind..invalid now"]);
  assert.equal(typo.status, 3, "the shared rule must not narrow what the export already caught");
  assert.deepEqual(named(typo.stderr), ["rowan@northwind..invalid"]);

  const confirmed = exportTitles(["fix: contact o'brien@my-domain.example.com about it"], ["--confirm"]);
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.match(confirmed.stdout, /1 title\(s\) redacted under --confirm/);
  assert.equal(confirmed.detailHtml.length, 1, "the export writes one admitted detail page");
  for (const page of [confirmed.html, ...confirmed.detailHtml]) {
    assert.ok(page, "both exported pages must exist");
    assert.doesNotMatch(page, /o(?:'|&#39;)brien@my-domain\.example\.com/, "no exported page may repeat the address");
    assert.match(page, /\[withheld: email address\]/);
  }
});
