/** Actual tracked source bytes; temporary target has no invented portfolio work. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSourceConnections } from "./sourceConnections.ts";
import { sourceCatalog, type SourcePreview, type SourceItem } from "./sourceCatalog.ts";
import { reviewSubjectDigest } from "@foliage/photosynthesis";
async function setup(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "foliage-connections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const into = join(root, "leaf.json"), out = join(root, "harvest.json"), projects = join(root, "projects"), project = join(projects, "source-regression");
  await mkdir(project, { recursive: true });
  await writeFile(into, JSON.stringify({ id: "connection-regression", subject: "Connection regression", leaflets: [] }));
  const content = await readFile(new URL("./sourceCatalog.ts", import.meta.url), "utf8");
  await writeFile(join(project, "connection-source.txt"), content);
  const source = createSourceConnections({ FOLIAGE_LEAF: into, FOLIAGE_HARVEST: out, FOLIAGE_OPEN_DESIGN_ROOT: projects });
  return { root, into, out, project, content, source };
}
test("project discovery, selected-file preview and replay use existing private queue", async t => {
  const f = await setup(t), before = await readFile(f.into, "utf8");
  const projects = await f.source.command({ action: "projects" }) as { projects: SourceItem[] };
  const files = await f.source.command({ action: "files", project: projects.projects[0]!.id }) as { files: SourceItem[] };
  assert.equal(files.files[0]!.name, "connection-source.txt");
  const selected = () => f.source.command({ action: "preview-file", file: files.files[0]!.id }) as Promise<{ preview: SourcePreview }>;
  const preview = (await selected()).preview;
  assert.ok(preview.excerpt.includes(f.content));
  await assert.rejects(readFile(f.out), /ENOENT/);
  await assert.rejects(f.source.command({ action: "import", preview: preview.id }), /Preview the file first/);
  const saved = await f.source.command({ action: "import", preview: preview.id, confirm: true }) as { imported: number; inspectUrl: string; detail: string };
  assert.equal(saved.imported, 1);
  const harvest = await readFile(f.out, "utf8");
  assert.equal(JSON.parse(harvest).candidates[0].review.state, "candidate");
  assert.equal(saved.inspectUrl, `/scarlet/workspace?candidate=${encodeURIComponent(JSON.parse(harvest).candidates[0].id)}`);
  assert.equal(saved.detail, "Added to review");
  const again = await selected();
  const replay = await f.source.command({ action: "import", preview: again.preview.id, confirm: true }) as { unchanged: number; inspectUrl: string; detail: string };
  assert.equal(replay.unchanged, 1); assert.equal(replay.inspectUrl, saved.inspectUrl); assert.equal(replay.detail, "Already recorded");
  assert.equal(await readFile(f.out, "utf8"), harvest); assert.equal(await readFile(f.into, "utf8"), before);
});
test("selection rejects guessed paths, linked files, stale content and changed subject", async t => {
  const f = await setup(t);
  await assert.rejects(f.source.command({ action: "files", project: "../../outside" }), /Choose a project/);
  await symlink(f.into, join(f.project, "linked.txt"));
  const p = await f.source.command({ action: "projects" }) as { projects: SourceItem[] };
  const files = await f.source.command({ action: "files", project: p.projects[0]!.id }) as { files: SourceItem[] };
  assert.equal(files.files.length, 1);
  const preview = await f.source.command({ action: "preview-file", file: files.files[0]!.id }) as { preview: SourcePreview };
  await writeFile(join(f.project, "connection-source.txt"), f.content + "\n");
  await assert.rejects(f.source.command({ action: "import", preview: preview.preview.id, confirm: true }), /File changed/);
  const changed = await f.source.command({ action: "preview-file", file: files.files[0]!.id }) as { preview: SourcePreview };
  await writeFile(f.into, JSON.stringify({ id: "different-target", subject: "Different target", leaflets: [] }));
  await assert.rejects(f.source.command({ action: "import", preview: changed.preview.id, confirm: true }), /subject does not match/);
  await assert.rejects(readFile(f.out), /ENOENT/);
});
test("export selection is bounded, literal, cancellable and never an authenticated provider claim", async t => {
  const f = await setup(t);
  for (const name of ["../README.md", ".env", "binary.pdf"]) await assert.rejects(f.source.command({ action: "preview-export", provider: "figma", name, content: f.content }), /Unsupported file/);
  const preview = await f.source.command({ action: "preview-export", provider: "figma", name: "source.html", content: f.content }) as { preview: SourcePreview };
  await f.source.command({ action: "cancel", preview: preview.preview.id });
  await assert.rejects(f.source.command({ action: "import", preview: preview.preview.id, confirm: true }), /Preview the file first/);
  await assert.rejects(f.source.command({ action: "preview-export", provider: "unknown", name: "source.txt", content: f.content }), /Choose a source/);
});
test("legacy queue binding is explicit, preserves drafts and refuses a changed destination preview", async t => {
  const f = await setup(t);
  const selected = await f.source.command({ action: "preview-export", provider: "figma", name: "source.txt", content: f.content }) as { preview: SourcePreview };
  await f.source.command({ action: "import", preview: selected.preview.id, confirm: true });
  const { subject: _subject, leafId: _leafId, ...legacy } = JSON.parse(await readFile(f.out, "utf8"));
  assert.equal(legacy.candidates.length, 1);
  await writeFile(f.out, JSON.stringify(legacy));
  const review = await f.source.command({ action: "review-binding" }) as { binding: { digest: string } };
  await assert.rejects(f.source.command({ action: "bind-review", digest: review.binding.digest }), /changed/);
  await writeFile(f.out, JSON.stringify(legacy) + "\n");
  await assert.rejects(f.source.command({ action: "bind-review", digest: review.binding.digest, confirm: true }), /changed/);
  const current = await f.source.command({ action: "review-binding" }) as { binding: { digest: string } };
  await f.source.command({ action: "bind-review", digest: current.binding.digest, confirm: true });
  const bound = JSON.parse(await readFile(f.out, "utf8"));
  assert.deepEqual(bound.candidates, legacy.candidates); assert.equal(bound.leafId, "connection-regression");
  await writeFile(f.out, JSON.stringify({ ...bound, subject: "Another person" }));
  await assert.rejects(f.source.command({ action: "review-binding" }), /another portfolio/);
});
test("an absent record is a named first step for every export row, never a raw path", async t => {
  const f = await setup(t), leaf = await readFile(f.into, "utf8");
  await rm(f.into);
  const exports = sourceCatalog.filter(p => p.mode === "export").map(p => p.id);
  assert.deepEqual(exports, ["figma", "claude-design", "documents", "assistant", "other"]);
  for (const provider of exports) await assert.rejects(f.source.command({ action: "preview-export", provider, name: "source.txt", content: f.content }),
    (e: Error) => e.message === "Create your private record first at /leaf/setup. Nothing was imported." && !e.message.includes(f.root));
  await assert.rejects(f.source.command({ action: "projects" }), /Create your private record first/);
  await assert.rejects(readFile(f.out), /ENOENT/);
  await assert.rejects(readFile(f.into), /ENOENT/, "the refusal creates no record");
  // Once the record exists, the same choice previews.
  await writeFile(f.into, leaf);
  const preview = await f.source.command({ action: "preview-export", provider: "documents", name: "source.txt", content: f.content }) as { preview: SourcePreview };
  assert.equal(preview.preview.provider, "documents");
});
test("selected personal project files enter one private batch; replay keeps decisions and changed text gets a new draft", async t => {
  const f = await setup(t), leafBefore = await readFile(f.into, "utf8");
  const first = f.content, second = await readFile(new URL("../../../context/project-overview.md", import.meta.url), "utf8");
  const files = [{ name: "implementation.txt", content: first }, { name: "sources.md", content: second }];
  const selected = async (chosen = files) => f.source.command({ action: "preview-project-bundle", project: "Personal project", files: chosen }) as Promise<{
    bundlePreview: { id: string; title: string; files: readonly { name: string; text: string; state: string }[] };
  }>;
  const preview = (await selected()).bundlePreview;
  assert.deepEqual(preview.files.map(file => file.text), [first, second]);
  assert.deepEqual(preview.files.map(file => file.state), ["new", "new"]);
  await assert.rejects(readFile(f.out), /ENOENT/, "preview creates no review document");
  const imported = await f.source.command({ action: "import", preview: preview.id, confirm: true }) as { imported: number; unchanged: number; inspectUrl: string | null };
  assert.deepEqual([imported.imported, imported.unchanged, imported.inspectUrl], [2, 0, null]);
  const harvest = JSON.parse(await readFile(f.out, "utf8"));
  assert.deepEqual(harvest.candidates.map((candidate: { evidence: { excerpt: string }[] }) => candidate.evidence[0]!.excerpt), [first, second]);
  assert.ok(harvest.candidates.every((candidate: { review: { state: string } }) => candidate.review.state === "candidate"));
  harvest.candidates[0].review = { state: "approved", by: "Connection regression", at: new Date().toISOString(), subjectDigest: reviewSubjectDigest(harvest.candidates[0]) };
  await writeFile(f.out, JSON.stringify(harvest, null, 2) + "\n");
  const reviewedBytes = await readFile(f.out, "utf8");
  const replayPreview = (await selected()).bundlePreview;
  assert.deepEqual(replayPreview.files.map(file => file.state), ["already", "already"]);
  const replay = await f.source.command({ action: "import", preview: replayPreview.id, confirm: true }) as { imported: number; unchanged: number };
  assert.deepEqual([replay.imported, replay.unchanged], [0, 2]);
  assert.equal(await readFile(f.out, "utf8"), reviewedBytes);
  const revised = await selected([{ ...files[0]!, content: first + "\n" }, files[1]!]);
  assert.deepEqual(revised.bundlePreview.files.map(file => file.state), ["revised", "already"]);
  const update = await f.source.command({ action: "import", preview: revised.bundlePreview.id, confirm: true }) as { imported: number; unchanged: number };
  assert.deepEqual([update.imported, update.unchanged], [1, 1]);
  const next = JSON.parse(await readFile(f.out, "utf8"));
  assert.equal(next.candidates.length, 3);
  assert.deepEqual(next.candidates[0].review, harvest.candidates[0].review);
  assert.equal(next.candidates[2].review.state, "candidate");
  assert.equal(await readFile(f.into, "utf8"), leafBefore, "no Leaf or publication changed");
});
test("personal project batch rejects invalid selections and a changed Leaf without a partial write", async t => {
  const f = await setup(t);
  const valid = { name: "source.txt", content: f.content };
  const choose = (files: unknown, project = "Personal project") => f.source.command({ action: "preview-project-bundle", project, files });
  const selected = await choose([valid]) as { bundlePreview: { id: string } };
  await f.source.command({ action: "import", preview: selected.bundlePreview.id, confirm: true });
  const original = await readFile(f.out, "utf8");
  const badSelections: unknown[] = [
    [], Array(9).fill(valid), [valid, { ...valid, name: "SOURCE.TXT" }],
    [{ ...valid, name: "../source.txt" }], [{ ...valid, name: "source.pdf" }],
    [{ ...valid, content: "" }], [{ ...valid, content: "binary\u0000text" }],
    [{ ...valid, content: "x".repeat(15_001) }],
    Array.from({ length: 7 }, (_, i) => ({ name: `source-${i}.txt`, content: "x".repeat(15_000) })),
    [{ ...valid, credential: "not admitted" }],
  ];
  for (const files of badSelections) {
    await assert.rejects(choose(files));
    assert.equal(await readFile(f.out, "utf8"), original);
  }
  await assert.rejects(choose([valid], "../invalid"), /Project name/);
  const pending = await choose([{ ...valid, content: f.content + "\n" }]) as { bundlePreview: { id: string } };
  await writeFile(f.into, JSON.stringify({ id: "another-leaf", subject: "Another subject", leaflets: [] }));
  await assert.rejects(f.source.command({ action: "import", preview: pending.bundlePreview.id, confirm: true }), /subject does not match/);
  assert.equal(await readFile(f.out, "utf8"), original);
});
test("an edited Review title refuses replay of the matching personal-project revision as one batch", async t => {
  const f = await setup(t);
  const files = [{ name: "source.txt", content: f.content }, { name: "overview.md", content: await readFile(new URL("../../../context/project-overview.md", import.meta.url), "utf8") }];
  const choose = async () => f.source.command({ action: "preview-project-bundle", project: "Personal project", files }) as Promise<{ bundlePreview: { id: string } }>;
  await f.source.command({ action: "import", preview: (await choose()).bundlePreview.id, confirm: true });
  const pending = (await choose()).bundlePreview.id;
  const document = JSON.parse(await readFile(f.out, "utf8"));
  document.candidates[0].title = "Owner-edited review title";
  await writeFile(f.out, JSON.stringify(document, null, 2) + "\n");
  const edited = await readFile(f.out, "utf8");
  await assert.rejects(f.source.command({ action: "import", preview: pending, confirm: true }), /different material/);
  await assert.rejects(choose(), /different material/);
  assert.equal(await readFile(f.out, "utf8"), edited, "neither file was partially replayed");
});
