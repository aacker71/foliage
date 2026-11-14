/**
 * A throwaway git repository with a realistic, deterministic history, for tests that exercise
 * intake and publication against real `git log` output.
 *
 * Several suites used to read this repository's own commits. A fresh checkout that carries no
 * history (a release snapshot, a shallow clone) then failed with "HEAD^ does not exist". These
 * commits are synthetic test input, built here and labelled as such; they describe no real
 * person or work. Subjects follow the conventional `prefix: sentence` shape that real histories use,
 * so commits cluster by prefix; a few name a version (`v2`, `v3`). They contain no paths or addresses,
 * so they pass the publication disclosure check.
 * Built once per process under the OS temp directory and removed when the process exits.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const TEST_AUTHOR = Object.freeze({ name: "Test Author", email: "test-author@example.invalid" });
const COMMITS = 90;
const PREFIXES = ["feat", "fix", "docs", "test", "refactor", "chore", "perf", "build", "ci", "style", "revert", "release"];
const QUALIFIERS = ["for large inputs", "when the file is empty", "after a restart", "on slow disks", "with a clearer message", "behind a flag", "for the first run", "without extra copies", "on retry", "in the background", "for older records"];
const AREAS = ["parser", "exporter", "importer", "scheduler", "renderer", "cache", "config loader", "retry logic", "audit log", "search index"];
const VERBS = ["Add", "Fix", "Speed up", "Simplify", "Document", "Cover with tests", "Rework", "Bound"];
const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 5, 12, 0, 0);

/** @type {string | undefined} */
let built;

/** @returns {string} the repository path. Synchronous, so it can sit at the top of a test file. */
export function testRepository() {
  if (built) return built;
  const directory = mkdtempSync(join(tmpdir(), "foliage-test-repository-"));
  process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
  /** @param {string} when */
  const env = (when) => ({ ...process.env, GIT_AUTHOR_NAME: TEST_AUTHOR.name, GIT_AUTHOR_EMAIL: TEST_AUTHOR.email, GIT_COMMITTER_NAME: TEST_AUTHOR.name, GIT_COMMITTER_EMAIL: TEST_AUTHOR.email, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" });
  /** @param {string} when @param {string[]} args */
  const git = (when, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd: directory, env: env(when), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(new Date(START).toISOString(), "init", "--quiet");
  for (let index = 0; index < COMMITS; index += 1) {
    const when = new Date(START + index * 3 * DAY).toISOString();
    const area = AREAS[index % AREAS.length] ?? "parser";
    const file = join(directory, "src", area.replace(/ /g, "-"), `part-${Math.floor(index / AREAS.length)}.txt`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${area} change ${index}\n`);
    git(when, "add", "--all");
    git(when, "commit", "--quiet", "-m", `${PREFIXES[index % PREFIXES.length]}: ${VERBS[index % VERBS.length]} the ${area} ${QUALIFIERS[index % QUALIFIERS.length]}${index % 9 === 4 ? ` for v${2 + Math.floor(index / 9)}` : ""}`);
  }
  built = directory;
  return built;
}
