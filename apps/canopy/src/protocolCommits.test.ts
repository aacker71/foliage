/** The commit walk that feeds renderer protocol tests: one test over actual temporary Git with fixture-named subjects, one over self-evidently fixture log lines. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { publicNarrativeIssue } from "@foliage/canopy";
import { PROTOCOL_COMMIT_WINDOW, pickProtocolCommits, recentProtocolCommits } from "../test-support/protocolCommits.ts";

const observedAt = new Date().toISOString();
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { env, encoding: "utf8" }).trim();

test("the walk passes over subjects the disclosure check refuses and keeps the newest admitted commits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foliage-protocol-commits-")), repo = join(directory, "repo");
  try {
    git(directory, "init", "--quiet", "--initial-branch=main", repo);
    for (const subject of ["fixture: oldest protocol subject", "fixture: older protocol subject", "fixture: names @fixture-handle", "fixture: names ~/fixture/leaf.json"]) {
      git(repo, "-c", "user.name=Fixture Person", "-c", "user.email=fixture-person@foliage.invalid", "commit", "--quiet", "--allow-empty", "-m", subject);
    }
    const picked = recentProtocolCommits(2, observedAt, repo);
    assert.deepEqual(picked.map(commit => commit.text), ["fixture: older protocol subject", "fixture: oldest protocol subject"]);
    assert.deepEqual(recentProtocolCommits(1, observedAt, repo).map(commit => commit.text), ["fixture: older protocol subject"], "the walk stops once it has enough");
    for (const commit of picked) {
      assert.equal(git(repo, "show", "-s", "--format=%s", commit.ref), commit.text, "each pick is an actual commit, ref and subject together");
      assert.equal(publicNarrativeIssue({ text: commit.text, provenance: { source: "git", ref: commit.ref, observedAt } }), null);
    }
    const shallow = join(directory, "shallow");
    git(directory, "clone", "--quiet", "--depth", "1", pathToFileURL(repo).href, shallow);
    assert.throws(() => recentProtocolCommits(2, observedAt, shallow), /^Error: This checkout is shallow: HEAD\^ does not exist/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a short history and an exhausted window each fail in plain words without quoting a refused subject", () => {
  const line = (index: number, subject: string) => `${String(index).padStart(40, "0")}\x1f${subject}\n`;
  const lone = pickProtocolCommits(line(1, "fixture: only protocol subject"), 2, observedAt, false);
  assert.ok(!lone.ok);
  assert.match(lone.reason, /^HEAD\^ does not exist: this repository has only 1 commit/);
  assert.doesNotMatch(lone.reason, /shallow/);

  const empty = pickProtocolCommits("", 2, observedAt, false);
  assert.ok(!empty.ok);
  assert.match(empty.reason, /^No commits can be read here/);

  const refused = Array.from({ length: PROTOCOL_COMMIT_WINDOW }, (_, index) => line(index, `fixture: names ~/fixture/${index}.json`)).join("");
  const exhausted = pickProtocolCommits(refused, 2, observedAt, false);
  assert.ok(!exhausted.ok);
  assert.match(exhausted.reason, new RegExp(`^Only 0 of the last ${PROTOCOL_COMMIT_WINDOW} commits have subjects the publication disclosure check admits`));
  assert.match(exhausted.reason, /local file location/);
  assert.doesNotMatch(exhausted.reason, /~\/fixture/);
});
