/**
 * GIT FIRST, everywhere Foliage reads a repository: `grow`, `watch`, `verify` and the /workflow
 * Sources API. A git that is not installed, or one that does not run, answers nothing about any
 * folder, so "is not a git repository" would send a person to choose another folder when git
 * itself is missing. A Mac without the Command Line Tools has a /usr/bin/git that only exits
 * non-zero, so a git that does not run counts as missing. Each surface asks once and says the same
 * sentence (`gitNeeded`).
 */
import { execFile, spawnSync } from "node:child_process";

/** Why git answers nothing here. */
export type GitAbsence = "git is not installed here" | "the git here does not run";

/** How a person gets git, on this platform. Pure. */
export function gitRemedy(platform: string = process.platform): string {
  return platform === "darwin"
    ? "on a Mac, git comes with the Xcode Command Line Tools: run 'xcode-select --install'"
    : "install git, then run this again";
}

/** The one sentence: `who` (grow, watch, verify, Foliage) needs git, why it has none, and the remedy. Pure. */
export function gitNeeded(who: string, absence: GitAbsence, platform: string = process.platform): string {
  return `${who} needs git to read your repository, and ${absence} (${gitRemedy(platform)}).`;
}

/** What `git --version` failing says about git. Pure. */
function absence(error: unknown): GitAbsence {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT" ? "git is not installed here" : "the git here does not run";
}

/** Whether git runs here, for a command line: `git --version`, bounded. Null when it does. */
export function gitAbsence(): GitAbsence | null {
  const ran = spawnSync("git", ["--version"], { encoding: "utf8", timeout: 30_000 });
  return ran.error === undefined && ran.status === 0 ? null : absence(ran.error);
}

/** `gitAbsence` for a server, which must not block while git answers. */
export function gitAbsenceAsync(): Promise<GitAbsence | null> {
  return new Promise(resolve => {
    execFile("git", ["--version"], { encoding: "utf8", timeout: 15_000 }, error => resolve(error === null ? null : absence(error)));
  });
}
