/**
 * THE ROSTER'S LINKS, AND THE FAILURE LIST'S ABSENCE OF THEM — the exact split `/tree` draws.
 *
 * Every leaf that RESOLVES TO A PUBLIC PROJECTION — every entry `loadTreeDocument` actually put
 * in `tree.leaves` — gets a real, working `<a href="/leaf/<id>">` on its roster row. `projectTree`
 * never fails on a leaf that is IN the tree (`PublicLeaf.state` is `listed`,
 * `nothing-offered` or `nothing-publishable`, and all three are real, 200-answering pages —
 * `renderPublic.test.ts`'s `theRosterOnTreeLinksEveryPersonIncludingThoseWhoPublishedNothing`
 * covers that differential across all three states with real signed evidence).
 *
 * A leaf that does NOT resolve at all — a manifest entry that failed to load, so it is not in
 * `tree.leaves` and `projectTree` never saw it — is a different thing entirely, and this file is
 * the differential for THAT split: it never gets a link (there is no address for something that
 * was never read), and it says why, in the EXISTING failure idiom (`data-entry-failure`, the
 * `CAUSE_LABEL` wording) rather than a new one.
 *
 * No git, no signing: which state a loaded person's row is in is not this file's question — only
 * whether a row exists and whether it is linked — so a minimal but genuinely valid leaf document
 * (the same shape `treeDocument.test.ts` and `renderCanopy.test.ts` both use) is enough.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { renderTreePage } from "./renderTree.ts";
import { TREE_ENV, loadTreeDocument } from "./treeDocument.ts";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-canopy-roster-links-"));
  tmpRoots.push(dir);
  return dir;
}

function leafDoc(id: string, subject: string): string {
  return JSON.stringify({ id, subject, leaflets: [] }, null, 2);
}

/** One roster row's own markup, by the same `data-roster-row` contract `renderTree.test.ts` uses. */
function rosterRowsOf(html: string): string[] {
  return html
    .split(/<li[^>]*\bdata-roster-row="true"/)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("</li>")));
}

/** One failure entry's own markup, by its own stable hook. */
function failureRowsOf(html: string): string[] {
  return html
    .split(/<li class="cell tree-failure" data-entry-failure="/)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("</li>")));
}

test("loadedLeavesGetARealLeafLinkAndFailedEntriesGetNoneWithTheReasonInstead", async () => {
  const dir = await tempDir();
  await writeFile(join(dir, "present-one.leaf.json"), leafDoc("present-one", "Present One"));
  await writeFile(join(dir, "present-two.leaf.json"), leafDoc("present-two", "Present Two"));
  await writeFile(join(dir, "broken.leaf.json"), "{ this is not json");
  // "never-written.leaf.json" is named by the manifest and does not exist: the `absent` cause.

  const manifestPath = join(dir, "tree.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      id: "split-tree",
      company: "Split Company",
      leaves: [
        "present-one.leaf.json",
        "present-two.leaf.json",
        "broken.leaf.json",
        "never-written.leaf.json",
      ],
    }),
  );

  const load = await loadTreeDocument({ [TREE_ENV]: manifestPath });
  assert.equal(load.ok, true);
  assert.equal(load.ok === true && load.failures.length, 2, "sanity: expected exactly two failures");

  const html = renderTreePage(load);

  // THE ROSTER: exactly the two leaves that loaded, each with a real, correctly-addressed link.
  const rows = rosterRowsOf(html);
  assert.equal(rows.length, 2, `expected 2 roster rows, found ${rows.length}`);
  const rosterLinks = rows.map((row) => row.match(/<a href="([^"]+)">/)?.[1]);
  assert.deepEqual(
    rosterLinks.sort(),
    ["/leaf/present-one", "/leaf/present-two"].sort(),
    "every loaded leaf must carry a real /leaf/<id> link, addressed at its own id",
  );

  // THE FAILURE LIST: exactly the two entries that did NOT load, and neither carries a link at
  // all — there is no address for a document this server never read.
  const failures = failureRowsOf(html);
  assert.equal(failures.length, 2, `expected 2 failure entries, found ${failures.length}`);
  for (const failure of failures) {
    assert.doesNotMatch(
      failure,
      /<a href=/,
      "a manifest entry that failed to load must not carry a link — there is nothing behind it",
    );
  }

  // And each failure says WHY, in the existing idiom — the cause is named, not just the fact of
  // failure.
  const causes = failures.map((f) => f.match(/^([a-z-]+)"/)?.[1]).sort();
  assert.deepEqual(causes, ["absent", "malformed"]);
  assert.ok(html.includes("No document at that path"), "the absent cause has no human wording");
  assert.ok(html.includes("Not valid JSON"), "the malformed cause has no human wording");
  assert.ok(html.includes("never-written.leaf.json"), "the absent entry does not name itself");
  assert.ok(html.includes("broken.leaf.json"), "the malformed entry does not name itself");
});
