/** Actual temporary Git + Photosynthesis evidence through the publication gate and reader. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLeafDocument, parsePublishPolicy } from "@foliage/leaf";
import { diffPublications, documentDigest, projectLeaf, toArtifactJson } from "@foliage/canopy";
import { loadManageState } from "./manageState.ts";
import { publicationView } from "./publicationView.ts";

test("public gates and the compound leaf preserve admitted owner order without disclosing other choices", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-curation-public-")), repo = join(directory, "repo");
  await mkdir(repo);
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const identity = "public-order-protocol@foliage.invalid";
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    FOLIAGE_LEAF: join(directory, "leaf.json"), FOLIAGE_POLICY: join(directory, "absent-policy.json"), FOLIAGE_PUBLISHED: join(directory, "publication") };
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { env, encoding: "utf8" }).trim();
  const cli = (...args: string[]) => execFileSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 15_000 });
  const load = async () => { const result = parseLeafDocument(JSON.parse(await readFile(env.FOLIAGE_LEAF, "utf8"))); assert.ok(result.ok); return result.leaf; };
  try {
    git("init", "--quiet", "--initial-branch=main");
    for (const [index, title] of ["feat: prepare public order inspection", "feat: retain the selected source", "fix: inspect admitted order", "fix: retain private protocol evidence", "docs: another actor's protocol record"].entries()) {
      await writeFile(join(repo, "order.txt"), `${title}\n`); git("add", "order.txt");
      git("-c", "user.name=Publication order protocol", "-c", `user.email=${index === 4 ? "other-actor@foliage.invalid" : identity}`, "commit", "--quiet", "-m", title);
    }
    cli("apps/leaf/intake.mjs", "--repo", repo, "--identity", identity, "--subject", "Publication order protocol", "--out", env.FOLIAGE_LEAF);
    const initial = await load(), own = initial.leaflets.filter(record => record.tier !== "excluded");
    const excluded = initial.leaflets.find(record => record.tier === "excluded")!;
    assert.equal(own.length, 4);
    const harvestPath = join(directory, "harvest.json");
    cli("apps/leaf/harvest.mjs", "propose", "--repo", repo, "--identity", identity, "--into", env.FOLIAGE_LEAF, "--out", harvestPath);
    const harvest = JSON.parse(await readFile(harvestPath, "utf8")) as { candidates: { id: string }[] };
    const promotedId = harvest.candidates[0]!.id;
    cli("apps/leaf/harvest.mjs", "approve", promotedId, "--by", "Publication order protocol", "--doc", harvestPath);
    cli("apps/leaf/harvest.mjs", "promote", "--doc", harvestPath, "--into", env.FOLIAGE_LEAF, "--force");
    const rest = own[0]!, featured = own[1]!, privateRecord = own[2]!, unlisted = own[3]!;
    for (const id of [rest.id, featured.id, promotedId]) cli("apps/leaf/share.mjs", "share", id, "--as", "public", "--leaf", env.FOLIAGE_LEAF);
    cli("apps/leaf/share.mjs", "share", unlisted.id, "--as", "unlisted", "--leaf", env.FOLIAGE_LEAF);
    const offered = await load(), promotedIndex = offered.leaflets.findIndex(record => record.id === promotedId);
    const originalParagraph = offered.leaflets[promotedIndex]!.body![0]!;
    assert.ok(originalParagraph.text);
    const selection = [{ leaflet: promotedIndex, element: 0 }];
    const before = await loadManageState(env, selection); assert.equal(before.kind, "ready"); if (before.kind !== "ready") return;
    const priorBytes = JSON.stringify(toArtifactJson(before.preview));
    const curated = { ...offered, curation: { featured: [privateRecord.id, featured.id, unlisted.id, promotedId, excluded.id, "missing-protocol-choice"] } };
    assert.ok(parseLeafDocument(curated).ok);
    await writeFile(env.FOLIAGE_LEAF, JSON.stringify(curated, null, 2) + "\n");
    const after = await loadManageState(env, selection); assert.equal(after.kind, "ready"); if (after.kind !== "ready") return;
    const expected = [featured.id, promotedId, rest.id];
    assert.deepEqual(after.preview.leaf.leaflets.map(record => record.id), expected);
    assert.deepEqual(after.preview.leaf.leaflets.find(record => record.id === promotedId)?.narrative, [{ text: originalParagraph.text, provenance: originalParagraph.provenance }], "source-index selection stays bound to its original paragraph before reordering");
    assert.equal(JSON.stringify(toArtifactJson(before.preview)), priorBytes, "preparing new order cannot mutate an existing publication");
    assert.equal(diffPublications(before.preview, after.preview).leafletOrderChanged, true);
    assert.deepEqual(after.preview.withheld, before.preview.withheld, "curation adds no private-choice counts or new disclosures");
    const wire = JSON.stringify(toArtifactJson(after.preview));
    assert.ok(!wire.includes('"curation"'));
    for (const id of [privateRecord.id, unlisted.id, excluded.id, "missing-protocol-choice"]) assert.ok(!wire.includes(id));
    const policy = parsePublishPolicy({ rules: [] }); assert.ok(policy.ok);
    const parsed = parseLeafDocument(curated); assert.ok(parsed.ok);
    const live = projectLeaf(parsed.leaf, policy.policy); assert.equal(live.state, "listed");
    if (live.state === "listed") assert.deepEqual(live.listed.map(record => record.id), expected);
    const html = await publicationView(after.preview, documentDigest(Buffer.from(wire)));
    const rendered = [...html.matchAll(/<li class="pub-leaflet lp-record" data-leaflet="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(rendered, expected, "mixed Git / Photosynthesis / Git sources do not regroup away the admitted order");
    assert.equal((html.match(/data-portfolio-panel/g) ?? []).length, 3);
    assert.match(html, /<span class="lp-source">Photosynthesis<\/span>/);
    assert.ok(html.includes(after.preview.leaf.leaflets.find(record => record.id === promotedId)!.provenance!.source), "the exact admitted source remains inspectable beside the friendly source label");

    const preview = await publicationView(after.preview, documentDigest(Buffer.from(wire)), undefined, {
      kind: "local-hosted", csrf: 'csrf"<&', operationId: "preview-operation", subjectId: String(after.preview.leaf.id), replacing: false,
    });
    assert.match(preview, /data-published-state="private-preview"/);
    assert.match(preview, /<b>Private preview<\/b>/);
    assert.doesNotMatch(preview, /<b>Published leaf<\/b>|data-fact="publishedAt"|href="\/leaflet\//);
    assert.match(preview, /name="csrf" value="csrf&quot;&lt;&amp;"/);
    assert.match(preview, /name="operationId" value="preview-operation"/);
    assert.match(preview, new RegExp(`name="confirm" value="${after.preview.leaf.id}"`));
    assert.ok(preview.indexOf('data-record-id="') < preview.indexOf('action="/hosted/publish"'), "work precedes the publication decision");
    assert.ok(preview.indexOf('action="/hosted/publish"') < preview.indexOf("</main>"), "the decision belongs to the reading frame");
    assert.ok(preview.indexOf('action="/hosted/publish"') < preview.indexOf('class="pub-publication-detail"'), "technical details follow the decision");
    assert.match(preview, /Anyone with the link can read this once published\./);
    assert.match(preview, /class="fol-button fol-button-primary[^\"]*"[^>]*>Publish<\/button>/);
    assert.match(await publicationView(after.preview, documentDigest(Buffer.from(wire)), undefined, {
      kind: "local-hosted", csrf: "csrf", operationId: "replacement-operation", subjectId: String(after.preview.leaf.id), replacing: true,
    }), /Replaces the public version in full; anyone with the link can read these changes\.[\s\S]*Publish changes<\/button>/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
