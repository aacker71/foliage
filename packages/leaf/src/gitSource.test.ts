import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitSourceScope, readGitMetadata } from "./gitSource.ts";

test("shared metadata reads preserve exact source text and linked-worktree identity", async () => {
  // Actual temporary Git objects; protocol inputs, never career claims or application seeds.
  const dir = mkdtempSync(join(tmpdir(), "foliage-git-source-"));
  const repo = join(dir, "repository");
  const linked = join(dir, "linked");
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=Protocol", "-c", "user.email=protocol@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  try {
    execFileSync("git", ["init", repo], { stdio: "pipe" });
    await assert.rejects(readGitMetadata(repo), /Git read failed/, "unborn history retains gather's explicit failure semantics");
    const subject = "capture: tab\tpipe|separator\x1funicode葉";
    git("commit", "--allow-empty", "-m", subject);
    const sha = git("rev-parse", "HEAD");
    git("config", "log.showSignature", "true");
    const single = await readGitMetadata(repo, sha);
    assert.equal(single.length, 1);
    assert.equal(single[0]?.subject, subject);
    assert.equal(single[0]?.email, "protocol@example.invalid");
    assert.deepEqual(await readGitMetadata(repo), single);
    git("worktree", "add", "--detach", linked, sha);
    assert.equal(await gitSourceScope(linked), await gitSourceScope(repo));
    assert.deepEqual(await readGitMetadata(linked, sha), single);
    await assert.rejects(readGitMetadata(repo, "HEAD"), /exact full/);
    await assert.rejects(readGitMetadata(repo, "0".repeat(40)), /Git read failed/);
    await assert.rejects(readGitMetadata(dir), /Git read failed/);
    git("commit", "--allow-empty", "--allow-empty-message", "-m", "");
    assert.equal((await readGitMetadata(repo, git("rev-parse", "HEAD")))[0]?.subject, "", "metadata does not invent an empty subject");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
