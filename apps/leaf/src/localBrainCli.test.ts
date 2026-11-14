/**
 * `foliage brain` as an installed copy runs it, from a SYNTHETIC install: stand-ins for the main
 * release's record and installer at its root, this checkout's `apps/leaf/brain.mjs` copied in (so its
 * vendor/ is the install's own) with the sources and packages it imports linked, and a brain added or
 * not. Nothing here starts gbrain or bun: the vendor/ below is a SYNTHETIC stand-in whose "bun" is a
 * text file, and every command is refused, or answered, before any process would start.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { brainArchiveShips, BUN_PIN, GBRAIN_PIN, hashVendorTree } from "./brainVendor.ts";

const LEAF = fileURLToPath(new URL("..", import.meta.url));
const SHIPS = brainArchiveShips(process.platform, process.arch);

const temp = async (t: { after: (fn: () => Promise<unknown>) => void }, prefix: string) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

/** A SYNTHETIC installed copy with no brain added. */
async function installedCopy(dir: string): Promise<string> {
  const root = join(dir, "foliage");
  await mkdir(join(root, "apps", "leaf"), { recursive: true });
  await writeFile(join(root, "release.json"), "{\"synthetic\":true}\n");
  await writeFile(join(root, "install.mjs"), "// SYNTHETIC stand-in for the installer\n");
  await copyFile(join(LEAF, "brain.mjs"), join(root, "apps", "leaf", "brain.mjs"));
  await symlink(join(LEAF, "src"), join(root, "apps", "leaf", "src"));
  await symlink(join(LEAF, "node_modules"), join(root, "apps", "leaf", "node_modules"));
  return root;
}

/** A SYNTHETIC brain added to it: Foliage's pins, stand-in files that are never executed. */
async function addedBrain(root: string): Promise<string> {
  const vendor = join(root, "vendor");
  await mkdir(join(vendor, "bun"), { recursive: true });
  await mkdir(join(vendor, "gbrain", "src"), { recursive: true });
  const bun = "SYNTHETIC stand-in for bun; never executed\n", cli = "// SYNTHETIC stand-in for gbrain's src/cli.ts\n";
  await writeFile(join(vendor, "bun", "bun"), bun);
  await writeFile(join(vendor, "gbrain", "src", "cli.ts"), cli);
  await writeFile(join(vendor, "gbrain", "LICENSE"), "SYNTHETIC licence stand-in\n");
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  await writeFile(join(vendor, "brain.json"), JSON.stringify({
    schemaVersion: 1, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, gbrainIntegrity: GBRAIN_PIN.integrity,
    bunVersion: BUN_PIN.version, bunSha256: sha(bun), cliSha256: sha(cli), platform: process.platform, arch: process.arch, files: await hashVendorTree(vendor),
  }));
  return vendor;
}

/** A SYNTHETIC record: invented, about nobody. */
async function syntheticGarden(garden: string): Promise<void> {
  const provenance = { source: "git", ref: "0000000000000000000000000000000000000001", observedAt: "2026-10-10T00:00:00Z" };
  await writeFile(join(garden, "leaf.json"), JSON.stringify({ id: "synthetic-brain-cli", subject: "Synthetic subject", leaflets: [
    { id: "one", title: "Synthetic quillwort leaflet", tier: "verified", provenance, body: [{ provenance, text: "Synthetic quillwort notes." }] },
  ] }));
}

/** A shell word as `foliage.mjs` quotes one. */
const word = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/** `foliage brain …` of the copy at `root`, with a HOME of its own and nothing else in the environment. */
function brain(root: string, home: string, args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "apps", "leaf", "brain.mjs"), ...args], {
      env: { HOME: home, PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
  });
}

test("an installed copy with no brain added: embed and remove say 'not installed' and print the installer's --add-brain command, as status and build do, never the checkout's staging tool", async t => {
  const dir = await temp(t, "foliage-brain-cli-no-brain-");
  const root = await installedCopy(dir);
  const home = join(dir, "home"), garden = join(dir, "garden");
  await mkdir(home);
  await mkdir(garden);
  const advice = SHIPS
    ? "The brain comes in the Foliage download, in the vendor folder beside its runtime folder. Add it to this install:\n"
      + `  node ${JSON.stringify(join(root, "install.mjs"))} --add-brain /absolute/path/to/the/extracted/vendor ${JSON.stringify(root)}\n`
    : `No brain archive ships for ${process.platform}/${process.arch} yet, so search uses Foliage's own search.\n`;
  for (const [args, code] of [
    [["status"], 0], [["build"], 1], [["refresh"], 1],
    // Turning local embeddings on needs the runtime before any embedder is asked.
    [["embed", "--local", "ollama:synthetic-model"], 1],
    // Removing needs no runtime, so it succeeds; its line is the runtime's state, as status says it.
    [["remove"], 0],
  ] as const) {
    const ran = await brain(root, home, [...args, "--garden", garden]);
    assert.deepEqual(ran, { code, stdout: "Brain: not installed\n", stderr: advice }, args.join(" "));
  }
  // Turning local embeddings off needs no runtime and has nothing to do here; its line says the runtime's state all the same.
  assert.deepEqual(await brain(root, home, ["embed", "--off", "--garden", garden]),
    { code: 0, stdout: "Brain: not installed\nLocal embeddings: off. foliage search and foliage_search answer from Foliage's own search.\n", stderr: advice }, "embed --off");
  assert.deepEqual(await readdir(garden), [], "nothing was made in the garden");
  assert.deepEqual(await readdir(home), [], "nothing was written under HOME");
});

test("an installed copy whose brain has a changed file: build and refresh refuse naming it, search answers from Foliage's own search naming it, and remove says it after removing", async t => {
  const dir = await temp(t, "foliage-brain-cli-changed-");
  const root = await installedCopy(dir);
  const vendor = await addedBrain(root);
  const home = join(dir, "home"), garden = join(dir, "garden");
  await mkdir(home);
  await mkdir(garden);
  await syntheticGarden(garden);
  const leafText = await readFile(join(garden, "leaf.json"), "utf8");
  assert.deepEqual(await brain(root, home, ["remove", "--garden", garden]), { code: 0, stdout: "Brain: off\n", stderr: "" }, "remove with the brain unchanged");
  // One changed byte in a file neither bun nor src/cli.ts, the case the 0.3.0 candidate let through.
  await writeFile(join(vendor, "gbrain", "LICENSE"), "SYNTHETIC licence stand-in, one byte changed\n");
  // The owner's terminal prints this copy's installer by absolute path, run by the node that ran it; a search's answer keeps the short form.
  const fix = SHIPS ? `${word(process.execPath)} ${word(join(root, "install.mjs"))} '--replace-brain' <the vendor folder from the Foliage download> ${word(root)}`
    : `node install.mjs <a new folder> from the extracted Foliage release, which holds no brain (none ships for ${process.platform}/${process.arch} yet)`;
  const short = SHIPS ? "node install.mjs --replace-brain <the vendor folder from the Foliage download> <this Foliage folder>" : fix;
  const line = `Brain: broken: vendor/gbrain/LICENSE differs from what was staged. Run ${fix}\n`;
  for (const action of ["status", "build", "refresh", "rebuild"]) {
    assert.deepEqual(await brain(root, home, [action, "--garden", garden]), { code: 1, stdout: line, stderr: "" }, action);
  }
  // A garden with a brain/ directory, so a search gets as far as the runtime check.
  await mkdir(join(garden, "brain"));
  const searched = await brain(root, home, ["search", "quillwort", "--garden", garden]);
  assert.equal(searched.code, 0, searched.stderr);
  const answer = JSON.parse(searched.stdout) as { retrieval: string; because?: string; hits: { id: string }[] };
  assert.deepEqual([answer.retrieval, answer.because, answer.hits.map(hit => hit.id)],
    ["foliage keyword", `Brain: broken: vendor/gbrain/LICENSE differs from what was staged. Run ${short}`, ["leaflet:one"]]);
  const removed = await brain(root, home, ["remove", "--garden", garden]);
  assert.deepEqual(removed, { code: 1, stdout: line, stderr: "" }, "remove deletes the brain, then names the changed runtime");
  assert.deepEqual(await readdir(garden), ["leaf.json"], "the brain/ directory is gone, the record stays");
  assert.equal(await readFile(join(garden, "leaf.json"), "utf8"), leafText);
  assert.deepEqual(await readdir(home), [], "nothing was written under HOME");
});

test("an installed copy prints every fix and hint as the whole command, runnable as printed from anywhere: node and this copy's foliage.mjs by absolute path, and --garden", async t => {
  const dir = await temp(t, "foliage-brain-cli-whole-");
  const root = await installedCopy(dir);
  await addedBrain(root);
  const home = join(dir, "home"), garden = join(dir, "garden");
  await mkdir(home);
  await mkdir(garden);
  const launch = (...words: string[]) => [process.execPath, join(root, "foliage.mjs"), ...words].map(word).join(" ");
  // No leaf.json: the build is refused before brain/ is made, and says how to grow one.
  for (const action of ["build", "rebuild"]) {
    assert.deepEqual(await brain(root, home, [action, "--garden", garden]), { code: 1, stdout: "Brain: off\n",
      stderr: `this garden has no leaf.json yet. Grow it first: ${launch("grow", "--repo")} <your repository> ${word("--garden")} ${word(garden)}\n` }, action);
  }
  assert.deepEqual(await readdir(garden), [], "a refused build leaves no brain/ behind");
  assert.deepEqual(await brain(root, home, ["refresh", "--garden", garden]),
    { code: 1, stdout: "Brain: off\n", stderr: `this garden has no brain yet. Run ${launch("brain", "build", "--garden", garden)}\n` });
  // brain/ without a leaf.json beside it: remove names the garden to give, not this one.
  await mkdir(join(garden, "brain"));
  assert.deepEqual(await brain(root, home, ["remove", "--garden", garden]), { code: 1,
    stdout: `Brain: broken: there is no leaf.json here, so this brain/ was left as it is. Run ${launch("brain", "remove", "--garden")} <your garden>\n`, stderr: "" });
  // Something Foliage did not make in brain/: the fix names the command to run once it is moved out.
  await syntheticGarden(garden);
  await writeFile(join(garden, "brain", "notes.md"), "SYNTHETIC: the owner's own note\n");
  assert.deepEqual(await brain(root, home, ["build", "--garden", garden]), { code: 1,
    stdout: `Brain: broken: brain/ holds "notes.md", which Foliage did not make, so it was left as it is. Run ${launch("brain", "build", "--garden", garden)} after you move that out of brain/\n`, stderr: "" });
  // A search's answer is the same one foliage_search gives an agent: no garden path in it.
  const searched = JSON.parse((await brain(root, home, ["search", "quillwort", "--garden", garden])).stdout) as { because?: string };
  assert.equal(searched.because, "Brain: broken: brain/ holds something Foliage did not make, so it was left as it is. Run foliage brain status to see what it is");
  assert.deepEqual(await readdir(home), [], "nothing was written under HOME");
});

test("--deep belongs to brain status, and is refused anywhere else before anything is read or started", async t => {
  const dir = await temp(t, "foliage-brain-cli-deep-");
  const root = await installedCopy(dir);
  const home = join(dir, "home"), garden = join(dir, "garden");
  await mkdir(home);
  await mkdir(garden);
  for (const action of ["build", "refresh", "rebuild", "remove"]) {
    assert.deepEqual(await brain(root, home, [action, "--deep", "--garden", garden]), { code: 1, stdout: "", stderr: "foliage brain: --deep belongs to brain status.\n" }, action);
  }
  assert.deepEqual(await brain(root, home, ["status", "--deep", "--garden", garden]).then(ran => [ran.code, ran.stdout]), [0, "Brain: not installed\n"]);
  assert.deepEqual(await readdir(garden), []);
});
