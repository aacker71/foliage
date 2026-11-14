/** End-to-end local publication protocol over an actual temporary Git commit. The account
 * explicitly describes this test protocol; nothing is sent to a garden or external service. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildPublishedDocument, documentDigest, parsePublishedDocument, reviewForPublication, toArtifactJson } from "@foliage/canopy";
import { loadLeafDocument } from "@foliage/leaf-app/leafDocument";
import { loadPublishPolicy } from "@foliage/leaf-app/policyDocument";
import { readStoryElement } from "@foliage/leaf-app/render";
import { esc, renderPublishedPage } from "./renderPublished.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../..", import.meta.url));
const selectedText = "Publication protocol: this temporary Git commit lets the test observe whether a person can choose one recorded explanation for a public reader.";
const unselectedText = "Private protocol account: this unselected contribution must remain on the local side of the narrative choice.";
const sensitiveText = "Private location protocol: the test-only note is at /Users/story-publication/private-notes.txt and must fail public narrative admission.";

test("saved personal context crosses the real share and narrative gates only after explicit selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-story-publication-"));
  const repo = join(directory, "source");
  const leafPath = join(directory, "leaf.json");
  const env = { FOLIAGE_LEAF: leafPath, FOLIAGE_POLICY: join(directory, "absent-policy.json") };
  try {
    await exec("git", ["init", "--initial-branch=main", repo]);
    await writeFile(join(repo, "publication-protocol.txt"), "Temporary source artifact used only to exercise explicit narrative publication.\n");
    await exec("git", ["-C", repo, "add", "publication-protocol.txt"]);
    await exec("git", ["-C", repo, "-c", "user.name=Story publication protocol", "-c", "user.email=story-publication@protocol.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-m", "test: exercise explicit story publication"]);
    const { stdout: commitOutput } = await exec("git", ["-C", repo, "rev-parse", "HEAD"]);
    const commit = commitOutput.trim();
    await exec(process.execPath, ["apps/leaf/intake.mjs", "--repo", repo, "--identity", "story-publication@protocol.invalid", "--subject", "Story publication protocol", "--out", leafPath], { cwd: root });

    // Invoke the actual private writer through its own module boundary; the Canopy app imports
    // only public package exports and never gains a production dependency on a private editor.
    const writer = `
      import { writeFile } from 'node:fs/promises';
      const [path, storyModule, revisionModule, loadModule, problem, contribution, decisions] = process.argv.slice(1);
      const { applyLeafletStory, storyEvidence } = await import(storyModule);
      const { revisionDigest } = await import(revisionModule);
      const { loadLeafDocument } = await import(loadModule);
      const loaded = await loadLeafDocument({ FOLIAGE_LEAF: path });
      if (!loaded.ok) throw new Error('Temporary intake could not be loaded');
      const record = loaded.leaf.leaflets.find(item => item.tier === 'pending' && item.provenance?.source === 'git');
      if (!record) throw new Error('Unsigned source did not produce pending Git evidence');
      const evidence = storyEvidence(record).findIndex(item => item.source === 'git');
      const next = applyLeafletStory(loaded.leaf, { leafId: loaded.leaf.id, leafletId: record.id, revision: revisionDigest(record) },
        [{ section: 'problem', text: problem, evidence }, { section: 'contribution', text: contribution, evidence }, { section: 'decisions', text: decisions, evidence }],
        'Story publication protocol', loaded.leaf.subject, new Date().toISOString());
      await writeFile(path, JSON.stringify(next));
      process.stdout.write(JSON.stringify({ id: record.id }));
    `;
    const { stdout: written } = await exec(process.execPath, ["--input-type=module", "-e", writer, leafPath,
      new URL("../../leaf/src/leafletStory.ts", import.meta.url).href,
      new URL("../../leaf/src/leafletRevision.ts", import.meta.url).href,
      new URL("../../leaf/src/leafDocument.ts", import.meta.url).href,
      selectedText, unselectedText, sensitiveText], { cwd: root });
    const { id } = JSON.parse(written) as { id: string };
    const privateLoad = await loadLeafDocument(env);
    const policy = await loadPublishPolicy(env);
    assert.ok(privateLoad.ok && policy.ok);
    const privateIndex = privateLoad.leaf.leaflets.findIndex(item => item.id === id);
    const privateRecord = privateLoad.leaf.leaflets[privateIndex]!;
    assert.equal(privateRecord.tier, "pending");
    assert.equal(privateRecord.visibility ?? "private", "private");
    const chosen = privateRecord.body![0]!;
    assert.equal(readStoryElement(chosen)?.text, selectedText);
    assert.equal(readStoryElement(chosen)?.supporting.ref, commit);
    const hidden = reviewForPublication({ leaf: privateLoad.leaf, declaredExample: privateLoad.source.declaredExample, policy: policy.policy,
      narrative: [{ leaflet: privateIndex, element: 0 }] });
    assert.equal(hidden.ok, false, "paragraph selection cannot override the Leaflet's private state");

    // Existing share command is the separate, explicit visibility decision, against only the
    // disposable intake document. It neither promotes pending attribution nor chooses prose.
    await exec(process.execPath, ["apps/leaf/share.mjs", "share", id, "--as", "public", "--leaf", leafPath], { cwd: root });
    const offered = await loadLeafDocument(env);
    assert.ok(offered.ok);
    const offeredIndex = offered.leaf.leaflets.findIndex(item => item.id === id);
    const request = { leaf: offered.leaf, declaredExample: offered.source.declaredExample, policy: policy.policy };
    const noSelection = reviewForPublication(request);
    assert.ok(noSelection.ok);
    assert.equal(noSelection.published.leaflets.find(item => item.id === id)?.narrative, undefined, "sharing a record alone selects no private paragraph");
    const sensitive = reviewForPublication({ ...request, narrative: [{ leaflet: offeredIndex, element: 2 }] });
    assert.equal(sensitive.ok, false);
    if (!sensitive.ok) assert.ok(sensitive.refusals.some(value => /local file location/.test(value.reason)), "actual privacy gate must reject the sensitive recorded account");

    const reviewed = reviewForPublication({ ...request, narrative: [{ leaflet: offeredIndex, element: 0 }] });
    assert.ok(reviewed.ok, reviewed.ok ? undefined : JSON.stringify(reviewed.refusals));
    assert.deepEqual(reviewed.published.leaflets.find(item => item.id === id)?.narrative, [{ text: chosen.text, provenance: chosen.provenance }]);
    const built = buildPublishedDocument({ review: reviewed, publishedAt: new Date().toISOString(), documentDigest: offered.source.documentDigest,
      documentBytes: offered.source.bytes, policyDigest: policy.policyDigest });
    assert.ok(built.ok, built.ok ? undefined : JSON.stringify(built.issues));
    const bytes = JSON.stringify(toArtifactJson(built.document));
    const parsed = parsePublishedDocument(JSON.parse(bytes));
    assert.ok(parsed.ok, parsed.ok ? undefined : JSON.stringify(parsed.issues));
    // Explicit test-only opt-in supports a local visual check of the admitted protocol artifact.
    const previewPath = process.env["FOLIAGE_STORY_PROTOCOL_PREVIEW"];
    if (previewPath) await writeFile(previewPath, `${bytes}\n`);
    assert.equal(parsed.document.leaf.leaflets.find(item => item.id === id)?.tier, "pending");
    assert.ok(bytes.includes(selectedText));
    assert.ok(!bytes.includes(unselectedText));
    assert.ok(!bytes.includes(sensitiveText));
    assert.ok(!bytes.includes(repo));

    const html = renderPublishedPage({ ok: true, id: String(parsed.document.leaf.id), document: parsed.document,
      source: { path: join(directory, "public-artifact-not-written.json"), bytes: Buffer.byteLength(bytes), artifactDigest: documentDigest(Buffer.from(bytes)), readAt: new Date().toISOString() } });
    assert.match(html, /<h3 class="pub-story-label">The problem<\/h3>/);
    const prose = html.match(/<p class="pub-paragraph-text">([\s\S]*?)<\/p>/)?.[1];
    assert.equal(prose, esc(selectedText));
    assert.doesNotMatch(prose!, /Supporting evidence:|Account recorded by:|&quot;source&quot;/);
    assert.match(html, /<details class="pub-paragraph-reference"><summary>Evidence<\/summary>/);
    assert.ok(html.includes(commit), "the chosen account's admitted supporting reference remains inspectable");
    assert.ok(!html.includes(unselectedText));
    assert.ok(!html.includes(sensitiveText));
    assert.ok(!html.includes(directory));
    assert.match(html, /data-pill-tier="pending"/);
    const saved = await readFile(leafPath, "utf8");
    assert.ok(saved.includes(unselectedText) && saved.includes(sensitiveText), "publication selection must leave private context intact");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
