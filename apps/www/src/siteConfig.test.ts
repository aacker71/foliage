import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { bundledLocalRelease } from "./bundledLocalRelease.ts";
import { siteConfig } from "./siteConfig.ts";

function credentialUrl() { const url = new URL("https://example.org"); url.username = "protocol-test"; url.password = "not-a-secret"; return url.href; }

test("unconfigured hosting keeps only the checksum-pinned bundled download", () => {
  assert.deepEqual(siteConfig({}), { site: undefined, app: undefined, release: bundledLocalRelease });
  assert.match(bundledLocalRelease.url, /^\/downloads\/[a-z0-9.-]+\.tgz$/);
});
test("bundled download metadata matches the exact public archive", async t => {
  // The archive is a build product and is not committed (see .gitignore). Where it has not been
  // built into public/downloads, there are no bytes to check, so the test says so instead of passing.
  const bytes = await readFile(new URL(`../public${bundledLocalRelease.url}`, import.meta.url)).catch(() => undefined);
  if (bytes === undefined) { t.skip("the download archive is not built in this checkout"); return; }
  assert.equal(createHash("sha256").update(bytes).digest("hex"), bundledLocalRelease.checksum);
});
test("release refuses partial, credential-bearing and unsafe destinations", () => {
  for (const value of ["http://localhost:4174", "javascript:alert(1)", credentialUrl(), "https://example.org/path", "https://example.org/?token=x"]) {
    assert.throws(() => siteConfig({ FOLIAGE_HOSTED_ORIGIN: value }));
  }
  assert.throws(() => siteConfig({ FOLIAGE_DOWNLOAD_URL: "https://example.org/release.tgz" }));
  assert.throws(() => siteConfig({ FOLIAGE_DOWNLOAD_SHA256: "a".repeat(64) }));
});
test("complete release keeps the exact reviewed destination and checksum", () => {
  const c = siteConfig({ FOLIAGE_SITE_ORIGIN: "https://example.org/", FOLIAGE_HOSTED_ORIGIN: "https://app.example.org/", FOLIAGE_HOSTED_ACCEPTED: "1", FOLIAGE_DOWNLOAD_URL: "https://example.org/release.tgz", FOLIAGE_DOWNLOAD_SHA256: "a".repeat(64), FOLIAGE_RELEASE_VERSION: "0.1.0-rc.1" });
  assert.equal(c.app, "https://app.example.org");
  assert.equal(c.release?.checksum, "a".repeat(64));
});

test("hosted sign-in stays hidden until its live account flow is accepted", () => {
  assert.equal(siteConfig({ FOLIAGE_HOSTED_ORIGIN: "https://app.example.org" }).app, undefined);
  assert.throws(() => siteConfig({ FOLIAGE_HOSTED_ACCEPTED: "1" }));
});

test("restricted preview has its own validated destination", () => {
  assert.equal(siteConfig({ FOLIAGE_PREVIEW_ORIGIN: "https://preview.example.org" }).preview, "https://preview.example.org");
  assert.throws(() => siteConfig({ FOLIAGE_PREVIEW_ORIGIN: "http://localhost:3000" }));
});
