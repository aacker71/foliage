#!/usr/bin/env node
/** Local-only cells. No model, network, automatic approval or publication. */
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync, realpathSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { parseLeafDocument } from "@foliage/leaf";
import { gitSourceScope, readGitMetadata } from "@foliage/leaf/git-source";
import { addCell, asanaObservation, draftFromCells, parseCellStore, migrateCellStore, requireCellSource, setCellSourcePermission, retractCell, checkCellDraft, parseHarvestDocument, promoteApproved } from "@foliage/photosynthesis";

const help = `Private evidence cells (local development slice)
  node apps/leaf/cells.mjs init --store /private/path/cells.json --subject NAME --leaf-id ID
  node apps/leaf/cells.mjs git --store PATH --repo PATH --identity EMAIL --commit SHA
  node apps/leaf/cells.mjs asana --store PATH --snapshot PATH --project GID
  node apps/leaf/cells.mjs list --store PATH
  node apps/leaf/cells.mjs migrate --store OLD_PATH --out NEW_PATH
  node apps/leaf/cells.mjs allow|deny --store PATH --source git|asana-import --scope SCOPE --reason TEXT
  node apps/leaf/cells.mjs retract --store PATH --cell ID --reason TEXT
  node apps/leaf/cells.mjs draft --store PATH --cells ID,ID --title TEXT --out NEW_PATH
  node apps/leaf/cells.mjs check --store PATH --candidate PATH
  node apps/leaf/cells.mjs promote --store PATH --candidate PATH --into LEAF_PATH --out NEW_PATH

Asana input is an explicitly supplied JSON task: gid, name, modified_at, completed,
assignee (null or {gid}), projects ([{gid}]). It is NOT remotely verified.
Draft output is unreviewed and never overwrites an existing file. No automatic grouping.
Keep store, imports and drafts outside repositories and published directories.
Git scope is its canonical common Git directory; Asana scope is the project ID.
Deny blocks capture and use, retaining private history. Retract removes local cell content
permanently and blocks reimport. Exported copies and published sites are not deleted.
`;
const options = Object.fromEntries(["store", "subject", "leaf-id", "repo", "identity", "commit", "snapshot", "project", "cells", "title", "out", "source", "scope", "reason", "cell", "candidate", "into"].map(k => [k, { type: /** @type {const} */ ("string") }]));
/** @param {Record<string, unknown>} v @param {string} key @returns {string} */
const requireValue = (v, key) => { const value = v[key]; if (typeof value !== "string" || !value.trim()) throw new Error(`Explicit --${key} required.`); return value; };
/** @param {string} path @returns {unknown} */
function json(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024) throw new Error("Expected a regular, non-aliased JSON file up to 8 MiB.");
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("Unreadable or malformed JSON; original file preserved."); }
}
/** @param {string} path */
function privateDestination(path) {
  const parent = realpathSync(dirname(path));
  if (statSync(parent).mode & 0o077) throw new Error("Choose an owner-only destination directory (mode 0700).");
  // Never put collected material or drafts in a checkout, even one ignored today.
  let repository;
  try { repository = execFileSync("git", ["-C", parent, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } }); }
  catch (error) {
    if (typeof error !== "object" || error === null || !("status" in error) || error.status !== 128 || !("stderr" in error) || !String(error.stderr).includes("not a git repository")) throw new Error("Could not establish whether the destination is outside a checkout.", { cause: error });
  }
  if (repository) throw new Error("Private cells and drafts must stay outside Git checkouts.");
}
async function main() {
  if (process.argv.length === 2 || process.argv.includes("--help")) { console.log(help); return; }
  const { values: v, positionals } = parseArgs({ options, allowPositionals: true, strict: true });
  const command = positionals[0];
  if (command === undefined || positionals.length !== 1 || !["init", "git", "asana", "list", "draft", "migrate", "allow", "deny", "retract", "check", "promote"].includes(command)) throw new Error("Unknown command. Use --help.");
  const path = resolve(requireValue(v, "store"));
  const out = ["draft", "migrate", "promote"].includes(command) ? resolve(requireValue(v, "out")) : null;
  const candidatePath = ["check", "promote"].includes(command) ? resolve(requireValue(v, "candidate")) : null;
  const into = command === "promote" ? resolve(requireValue(v, "into")) : null;
  if (out && [candidatePath, into].includes(out)) throw new Error("Output must be a new, separate file.");
  if (out === path) throw new Error("Draft destination must differ from the private store.");
  // Require pre-existing private directories: this write does not persist an ancestor mkdir chain.
  privateDestination(path);
  if (out) privateDestination(out);
  await withDocumentLocks([path, ...[out, candidatePath, into].filter(p => p !== null)], async () => {
    privateDestination(path);
    if (out) privateDestination(out);
    if (command === "init") {
      const store = parseCellStore({ version: 2, subject: requireValue(v, "subject"), leafId: requireValue(v, "leaf-id"), cells: [], permissions: [], retractions: [] });
      writeDocument(path, JSON.stringify(store) + "\n", false, true);
      console.log("Private empty cell store created. Nothing collected.");
      return;
    }
    if (command === "migrate") {
      if (!out) throw new Error("Explicit --out required.");
      writeDocument(out, JSON.stringify(migrateCellStore(json(path))) + "\n", false, true);
      console.log("Migrated to a new private store with no source permissions. Original preserved.");
      return;
    }
    const store = parseCellStore(json(path));
    const now = new Date().toISOString();
    /** @param {import("@foliage/photosynthesis").CellStore} next */
    const save = next => {
      const bytes = JSON.stringify(next) + "\n";
      if (Buffer.byteLength(bytes) > 8 * 1024 * 1024) throw new Error("Cell store capacity reached; nothing changed.");
      writeDocument(path, bytes, true, true);
    };
    if (["allow", "deny"].includes(command)) {
      save(setCellSourcePermission(store, requireValue(v, "source"), requireValue(v, "scope"), command === "allow", now, requireValue(v, "reason")));
      console.log("Local source permission recorded. Exported copies and hosted publication are unchanged.");
      return;
    }
    if (command === "retract") {
      const next = retractCell(store, requireValue(v, "cell"), now, requireValue(v, "reason"));
      if (next !== store) save(next);
      console.log("Cell retracted: local content removed and reimport blocked. External copies remain; no undo in this store.");
      return;
    }
    if (candidatePath) {
      const parsed = parseHarvestDocument(json(candidatePath));
      if (!parsed.ok) throw new Error("Candidate document failed its existing format/review gate.");
      checkCellDraft(store, parsed.harvest);
      if (!into) { console.log("Selected cell revisions and local source permissions are current. This is not approval or verified authorship."); return; }
      const leaf = parseLeafDocument(json(into));
      if (!leaf.ok) throw new Error("Target leaf failed its existing document gate.");
      const result = promoteApproved(parsed.harvest, leaf.leaf, new Set(), store);
      if (!result.ok) throw new Error(`Promotion refused: ${result.cause}`);
      if (!result.promoted.length) throw new Error("No approved, eligible candidate to promote. Nothing written.");
      if (!out) throw new Error("Explicit --out required.");
      writeDocument(out, JSON.stringify(result.leaf, null, 2) + "\n", false, true);
      console.log(`Promoted ${result.promoted.length} approved candidate(s) to a new private leaf, pending only. Nothing published.`);
      return;
    }
    if (command === "list") {
      console.log(JSON.stringify(store, null, 2));
      return;
    }
    if (command === "draft") {
      if (!out) throw new Error("Explicit --out required.");
      const draft = draftFromCells(store, requireValue(v, "cells").split(","), requireValue(v, "title"), now);
      writeDocument(out, JSON.stringify(draft, null, 2) + "\n", false, true);
      console.log("Unreviewed candidate written. No leaflet changed or published.");
      return;
    }
    /** @type {Parameters<typeof addCell>[1]} */
    let observation;
    if (command === "asana") {
      requireCellSource(store, "asana-import", requireValue(v, "project"));
      observation = asanaObservation(json(resolve(requireValue(v, "snapshot"))), requireValue(v, "project"));
    } else {
      const repo = realpathSync(requireValue(v, "repo"));
      const scope = await gitSourceScope(repo);
      requireCellSource(store, "git", scope);
      const commit = requireValue(v, "commit");
      const identity = requireValue(v, "identity").trim().toLowerCase();
      const [metadata] = await readGitMetadata(repo, commit);
      if (!metadata) throw new Error("No commit metadata returned; nothing imported.");
      const { sha, authoredAt: occurredAt, email: actor, subject } = metadata;
      if (actor.trim().toLowerCase() !== identity) throw new Error("Commit does not match the declared identity; this is not proof of authorship.");
      if (!subject.trim()) throw new Error("This first cell adapter requires a nonempty commit subject; nothing invented or imported.");
      observation = { source: "git", scope,
        object: sha, sourceRevision: sha, occurredAt, actor, text: subject };
    }
    const next = addCell(store, observation, now);
    if (next !== store) {
      save(next);
    }
    console.log(next === store ? "Already captured; nothing changed." : "Source observation captured privately. Attribution and outcomes remain unverified.");
  });
}
main().catch(error => { console.error(`cells: ${error.message}`); process.exitCode = 1; });
