/**
 * The local brain's spawn rules, config file, lock and runtime checks, without a staged gbrain.
 * Nothing here starts gbrain or bun: the vendor directories below are SYNTHETIC stand-ins whose
 * "bun" is a text file, used only to exercise the digest and pin checks. The end-to-end proof
 * against the real staged runtime, offline inside a sandbox, is the brain offline gate
 * (`scripts/check-brain-offline.mjs`), which `pnpm check` runs.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  brainArchiveShips, BUN_PIN, EMPTY_BRAIN_BYTES, GBRAIN_PIN, hashVendorTree, parseVendorManifest, RELEASE_FILES, roomProblem, shippedBunProblem, verifyShippedBrain, verifyVendorTree,
} from "./brainVendor.ts";
import { IMPORT_DOCUMENT_BYTES } from "./integrationImport.ts";
import {
  acquireBrainLock, LocalBrainError, brainConfigText, brainDrift, brainFailure, brainGlance, brainLine, brainPaths, brainStatus, buildBrain, checkBrainConfig, gbrainArgs, gbrainEnvironment, installedRuntime, pathFree,
  NO_BRAIN, notInstalledAdvice, ownerFix, ownerGrow, ownerStatus, rebuildBrain, refreshBrain, refreshForSearch, removeBrain, runtimeRemedy, searchLocalBrain,
} from "./localBrain.ts";
import { brainUpkeep, startBrainRefresh, STOPPED_RETRY_MS } from "./brainUpkeep.ts";
import { searchLocalGarden } from "./localSearch.ts";
import { parseLeafDocument } from "@foliage/leaf";
import { brainManifestPage, brainProjection } from "@foliage/photosynthesis";

const temp = async (t: { after: (fn: () => Promise<unknown>) => void }, prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A SYNTHETIC vendor directory: right pins and digests, stand-in files that are never executed. */
async function syntheticVendor(dir: string, overrides: Record<string, unknown> = {}) {
  await mkdir(join(dir, "bun"), { recursive: true });
  await mkdir(join(dir, "gbrain", "src"), { recursive: true });
  const bun = "synthetic stand-in for bun; these tests never execute it\n";
  const cli = "// synthetic stand-in for gbrain's src/cli.ts\n";
  await writeFile(join(dir, "bun", "bun"), bun);
  await writeFile(join(dir, "gbrain", "src", "cli.ts"), cli);
  await writeFile(join(dir, "gbrain", "LICENSE"), "synthetic licence stand-in\n");
  const manifest = {
    schemaVersion: 1, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, gbrainIntegrity: GBRAIN_PIN.integrity,
    bunVersion: BUN_PIN.version, bunSha256: sha(bun), cliSha256: sha(cli), platform: process.platform, arch: process.arch,
    files: await hashVendorTree(dir), ...overrides,
  };
  await writeFile(join(dir, "brain.json"), JSON.stringify(manifest));
  return manifest;
}

test("every gbrain process gets an allowlisted environment and inherits nothing from Foliage's", () => {
  const planted = { OPENAI_API_KEY: "planted", ANTHROPIC_API_KEY: "planted", DATABASE_URL: "postgres://example.test/x",
    GBRAIN_DATABASE_URL: "postgres://example.test/y", OLLAMA_BASE_URL: "http://example.test", HTTPS_PROXY: "http://example.test:1",
    GBRAIN_SOURCE: "planted", GBRAIN_BRAIN_ID: "planted", NODE_OPTIONS: "--no-warnings", BUN_CONFIG_REGISTRY: "http://example.test", BUN_OPTIONS: "--preload /planted.js",
    GBRAIN_CONTRIBUTOR_MODE: "1" };
  const saved = Object.fromEntries(Object.keys(planted).map(key => [key, process.env[key]]));
  Object.assign(process.env, planted);
  try {
    const paths = brainPaths("/gardens/synthetic");
    assert.deepEqual(gbrainEnvironment(paths), {
      PATH: "/gardens/synthetic/brain/bin",
      HOME: "/gardens/synthetic/brain/home",
      GBRAIN_HOME: "/gardens/synthetic/brain/home",
      TMPDIR: "/gardens/synthetic/brain/home/tmp",
      GBRAIN_SELF_UPGRADE_MODE: "off",
      GBRAIN_SKIP_STARTUP_HOOKS: "1",
      GBRAIN_INIT_SKIP_EMBED_CHECK: "1",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  assert.throws(() => brainPaths("relative/garden"), /not absolute/);
});

test("only the allowed commands and ops are built; everything else is refused before anything starts", () => {
  const paths = brainPaths("/gardens/synthetic");
  assert.deepEqual(gbrainArgs(paths, { kind: "init" }), ["init", "--pglite", "--no-embedding", "--non-interactive", "--path", "/gardens/synthetic/brain/home/.gbrain/brain.pglite"]);
  assert.deepEqual(gbrainArgs(paths, { kind: "import" }), ["import", "/gardens/synthetic/brain/pages", "--no-embed", "--fresh", "--include-gitignored", "--source-id", "default"]);
  assert.deepEqual(gbrainArgs(paths, { kind: "config-set", key: "search.mode" }), ["config", "set", "search.mode", "conservative"]);
  assert.deepEqual(gbrainArgs(paths, { kind: "config-set", key: "facts.extraction_enabled" }), ["config", "set", "facts.extraction_enabled", "false", "--force"]);
  assert.deepEqual(gbrainArgs(paths, { kind: "config-get", key: "search.track_retrieval" }), ["config", "get", "search.track_retrieval"]);
  assert.deepEqual(gbrainArgs(paths, { kind: "config-unset", prefix: "provider_base_urls." }), ["config", "unset", "--pattern", "provider_base_urls."]);
  assert.deepEqual(gbrainArgs(paths, { kind: "call", op: "list_pages", params: { limit: 100 } }), ["call", "--source", "default", "list_pages", '{"limit":100}']);
  for (const op of ["query", "think", "put_page", "sync_brain", "submit_job"]) {
    assert.throws(() => gbrainArgs(paths, { kind: "call", op, params: {} }), (error: unknown) => error instanceof LocalBrainError && error.message.includes(op));
  }
  assert.throws(() => gbrainArgs(paths, { kind: "config-get", key: "openai_api_key" }), /not a setting Foliage reads or writes/);
  assert.throws(() => gbrainArgs(paths, { kind: "config-set", key: "search.mode=balanced" }), /not a setting/);
  assert.throws(() => gbrainArgs(paths, { kind: "config-unset", prefix: "search." }), /not a command Foliage runs/);
  for (const kind of ["sync", "serve", "upgrade", "check-update", "embed", "query"]) {
    assert.throws(() => gbrainArgs(paths, { kind } as never), /not a command Foliage runs/);
  }
});

test("config.json is Foliage's exact file; any other key is refused by name, never by value", async t => {
  const garden = await temp(t, "foliage-brain-config-");
  const paths = brainPaths(garden);
  assert.deepEqual(JSON.parse(brainConfigText(paths)), {
    engine: "pglite", database_path: join(garden, "brain", "home", ".gbrain", "brain.pglite"), schema_pack: "gbrain-base-v2",
    embedding_disabled: true, self_upgrade: { mode: "off" }, mcp: { publish_skills: false, publish_advisor: false }, eval: { capture: false },
  });
  await assert.rejects(checkBrainConfig(paths), /config.json is missing/);
  await mkdir(dirname(paths.config), { recursive: true });
  await writeFile(paths.config, brainConfigText(paths));
  await checkBrainConfig(paths);
  const exact = JSON.parse(brainConfigText(paths));
  for (const [key, value] of [["openai_api_key", "sk-planted-secret"], ["database_url", "postgres://example.test/planted-secret"], ["storage", { bucket: "planted-secret" }],
    ["remote_mcp", { url: "http://example.test/planted-secret" }], ["provider_base_urls", { ollama: "http://example.test/planted-secret" }]] as const) {
    await writeFile(paths.config, JSON.stringify({ ...exact, [key]: value }, null, 2));
    await assert.rejects(checkBrainConfig(paths), (error: unknown) => error instanceof LocalBrainError && error.state === "broken"
      && error.message === `config.json holds ${key}, which Foliage never writes` && !error.message.includes("planted-secret"));
  }
  await writeFile(paths.config, JSON.stringify({ ...exact, self_upgrade: { mode: "notify" } }, null, 2));
  await assert.rejects(checkBrainConfig(paths), /config.json self_upgrade differs from Foliage's/);
  const { eval: _, ...withoutEval } = exact;
  await writeFile(paths.config, JSON.stringify(withoutEval));
  await assert.rejects(checkBrainConfig(paths), /config.json is missing eval/);
  await writeFile(paths.config, JSON.stringify(exact));
  await assert.rejects(checkBrainConfig(paths), /not the file Foliage wrote/);
  await writeFile(paths.config, "{not json");
  await assert.rejects(checkBrainConfig(paths), /config.json is not JSON/);
  await unlink(paths.config);
  await writeFile(join(garden, "elsewhere.json"), brainConfigText(paths));
  await symlink(join(garden, "elsewhere.json"), paths.config);
  await assert.rejects(checkBrainConfig(paths), /not a regular file/);
});

test("the brain lock admits one holder; a live holder is waited for and then named busy", async t => {
  const dir = await temp(t, "foliage-brain-lock-");
  const path = join(dir, ".brain-lock");
  const first = await acquireBrainLock(path);
  // The lock is a symbolic link whose target is the holder's record: created whole, in one step.
  const held = JSON.parse(await readlink(path));
  assert.equal(held.pid, process.pid);
  assert.equal(typeof held.token, "string");
  assert.ok(!Number.isNaN(Date.parse(held.startedAt)));
  const started = Date.now();
  await assert.rejects(acquireBrainLock(path, { waitMs: 300, pollMs: 50 }), (error: unknown) => error instanceof LocalBrainError && error.state === "busy");
  assert.ok(Date.now() - started >= 300, "busy only after polling for the whole wait");
  await first.setChild(4242);
  assert.equal(JSON.parse(await readlink(path)).child, 4242);
  await first.setChild(null);
  assert.equal(JSON.parse(await readlink(path)).child, undefined);
  await first.release();
  assert.deepEqual(await readdir(dir), []);
  const second = await acquireBrainLock(path, { waitMs: 0 });
  await second.release();
});

/** A pid that existed and is gone: a child that has already exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise(resolve => child.once("exit", resolve));
  assert.ok(child.pid);
  return child.pid;
}

const LOCK_MODULE = fileURLToPath(new URL("./localBrain.ts", import.meta.url));

/** Another Foliage process holding the brain lock until it is killed; with `refreshing`, as a refresh holds it. */
async function holdLockInChild(path: string, refreshing = false) {
  const holder = spawn(process.execPath, ["--input-type=module", "-e",
    `const { acquireBrainLock } = await import(${JSON.stringify(LOCK_MODULE)}); const lock = await acquireBrainLock(${JSON.stringify(path)}); ${refreshing ? "await lock.setRefreshing(); " : ""}process.stdout.write("locked\\n"); setInterval(() => {}, 1000);`],
  { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise(resolve => holder.once("exit", resolve));
  await new Promise<void>((resolve, reject) => {
    holder.stdout.on("data", chunk => { if (String(chunk).includes("locked")) resolve(); });
    holder.once("exit", code => reject(new Error(`lock holder exited early (${code})`)));
  });
  return { pid: holder.pid, async kill() { holder.kill("SIGKILL"); await exited; } };
}

test("a lock held by a SIGKILLed Foliage process is reclaimed; a live recorded child, EPERM or an unreadable lock is not", async t => {
  const dir = await temp(t, "foliage-brain-reclaim-");
  const path = join(dir, ".brain-lock");
  const holder = await holdLockInChild(path);
  assert.equal(JSON.parse(await readlink(path)).pid, holder.pid);
  await assert.rejects(acquireBrainLock(path, { waitMs: 100 }), (error: unknown) => error instanceof LocalBrainError && error.state === "busy");
  await holder.kill();
  const reclaimed = await acquireBrainLock(path, { waitMs: 2_000 });
  assert.equal(JSON.parse(await readlink(path)).pid, process.pid);
  await reclaimed.release();
  assert.deepEqual(await readdir(dir), [], "nothing is left beside the lock");

  const gone = await deadPid();
  // The holder died but the gbrain child it recorded still runs: an orphan may still be writing.
  const plant = async (record: object) => { await rm(path, { force: true }); await symlink(JSON.stringify(record), path); };
  await plant({ pid: gone, token: "synthetic", startedAt: new Date().toISOString(), child: process.pid });
  await assert.rejects(acquireBrainLock(path, { waitMs: 100 }), /holds/);
  await plant({ pid: gone, token: "synthetic", startedAt: new Date().toISOString(), child: await deadPid() });
  await (await acquireBrainLock(path, { waitMs: 100 })).release();
  // pid 1 answers EPERM to an unprivileged signal 0 (or exists, as root): alive either way.
  await plant({ pid: 1, token: "synthetic", startedAt: new Date().toISOString() });
  await assert.rejects(acquireBrainLock(path, { waitMs: 100 }), /process 1 holds/);
  await rm(path);
  await writeFile(path, "not a lock record");
  await assert.rejects(acquireBrainLock(path, { waitMs: 100 }), /cannot be read, so it was left in place/);
  assert.equal(await readFile(path, "utf8"), "not a lock record");
});

test("the staged runtime is checked by pin and digest; any difference is named", async t => {
  const vendor = await temp(t, "foliage-brain-vendor-");
  const manifest = await syntheticVendor(vendor);
  await verifyVendorTree(vendor, parseVendorManifest(manifest));
  for (const [key, value, message] of [["gbrainCommit", "0".repeat(40), /another gbrain commit/], ["gbrainIntegrity", "sha512-planted", /another gbrain integrity/],
    ["gbrainVersion", "0.0.1", /another gbrain version/], ["bunVersion", "1.3.9", /another bun version/],
    ["platform", "plan9", /staged for plan9/], ["files", [], /no valid file list/]] as const) {
    assert.throws(() => parseVendorManifest({ ...manifest, [key]: value }), message);
  }
  await writeFile(join(vendor, "gbrain", "LICENSE"), "synthetic licence stand-in, one byte changed\n");
  await assert.rejects(verifyVendorTree(vendor, parseVendorManifest(manifest)), /vendor\/gbrain\/LICENSE differs from what was staged/);
  await writeFile(join(vendor, "gbrain", "LICENSE"), "synthetic licence stand-in\n");
  await writeFile(join(vendor, "gbrain", "planted.js"), "fetch('http://example.test')\n");
  await assert.rejects(verifyVendorTree(vendor, parseVendorManifest(manifest)), /vendor\/gbrain\/planted.js was not staged/);
  await unlink(join(vendor, "gbrain", "planted.js"));
  await unlink(join(vendor, "gbrain", "LICENSE"));
  await assert.rejects(verifyVendorTree(vendor, parseVendorManifest(manifest)), /vendor\/gbrain\/LICENSE is missing/);
});

test("in the owner's own terminal every fix is the whole command: node, this copy's launcher or installer by absolute path, and --garden; placeholders and the words around them stay", () => {
  // SYNTHETIC paths, one with a quote in it, so the quoting is the shell's.
  const at = { node: "/synthetic/node/bin/node", launcher: "/synthetic/foliage/foliage.mjs", root: "/synthetic/foliage", garden: "/synthetic/it's a garden" };
  const garden = "'/synthetic/it'\\''s a garden'";
  const brain = (words: string) => `'/synthetic/node/bin/node' '/synthetic/foliage/foliage.mjs' 'brain' ${words}`;
  for (const [fix, whole] of [
    ["foliage brain build", `${brain("'build'")} '--garden' ${garden}`],
    ["foliage brain rebuild", `${brain("'rebuild'")} '--garden' ${garden}`],
    ["foliage brain refresh", `${brain("'refresh'")} '--garden' ${garden}`],
    ["foliage brain embed --off", `${brain("'embed' '--off'")} '--garden' ${garden}`],
    ["ollama serve, or foliage brain embed --off", `ollama serve, or ${brain("'embed' '--off'")} '--garden' ${garden}`],
    ["ollama pull standin-a yourself if you want it, then foliage brain embed --local ollama:standin-a --port 11500",
      `ollama pull standin-a yourself if you want it, then ${brain("'embed' '--local' 'ollama:standin-a' '--port' '11500'")} '--garden' ${garden}`],
    ["foliage brain build once more disk is free", `${brain("'build'")} '--garden' ${garden} once more disk is free`],
    ["foliage brain build after you put that title on one line", `${brain("'build'")} '--garden' ${garden} after you put that title on one line`],
    ["foliage brain refresh after you move that out of brain/", `${brain("'refresh'")} '--garden' ${garden} after you move that out of brain/`],
    ["foliage brain status to see what it is", `${brain("'status'")} '--garden' ${garden} to see what it is`],
    // A fix that names its own garden keeps it: the garden in hand is the one that cannot be used.
    ["foliage brain remove --garden <your garden>", `${brain("'remove'")} '--garden' <your garden>`],
    ["foliage brain build --garden <a garden outside ~/brain and ~/.gbrain>", `${brain("'build'")} '--garden' <a garden outside ~/brain and ~/.gbrain>`],
    ["node install.mjs --add-brain <the vendor folder from the Foliage download> <this Foliage folder>",
      "'/synthetic/node/bin/node' '/synthetic/foliage/install.mjs' '--add-brain' <the vendor folder from the Foliage download> '/synthetic/foliage'"],
    ["node install.mjs --replace-brain <the vendor folder from the Foliage download> <this Foliage folder>",
      "'/synthetic/node/bin/node' '/synthetic/foliage/install.mjs' '--replace-brain' <the vendor folder from the Foliage download> '/synthetic/foliage'"],
    ["node tools/brain/stage-gbrain.mjs", "'/synthetic/node/bin/node' '/synthetic/foliage/tools/brain/stage-gbrain.mjs'"],
    // The extracted release's own installer, not this copy's: left as it is.
    ["node install.mjs <a new folder> from the extracted Foliage release, which holds no brain (none ships for synthetic/os yet)",
      "node install.mjs <a new folder> from the extracted Foliage release, which holds no brain (none ships for synthetic/os yet)"],
  ] as const) assert.equal(ownerFix(fix, at), whole, fix);
  // The fix brainLine names when a status carries none comes out whole too.
  assert.equal(ownerStatus({ state: "broken", cause: "synthetic" }, at).fix, `${brain("'rebuild'")} '--garden' ${garden}`, "broken's default fix");
  assert.equal(ownerStatus({ state: "behind" }, at).fix, `${brain("'refresh'")} '--garden' ${garden}`, "behind's default fix");
  assert.deepEqual(ownerStatus({ state: "behind", refreshing: true }, at), { state: "behind", refreshing: true }, "refreshing names no fix");
  assert.deepEqual(ownerStatus({ state: "current" }, at), { state: "current" });
  assert.equal(brainLine(ownerStatus({ state: "behind", cause: "synthetic cause" }, at)), `Brain: behind your record. Synthetic cause. Run ${brain("'refresh'")} '--garden' ${garden}`);
  assert.equal(ownerGrow(at), `'/synthetic/node/bin/node' '/synthetic/foliage/foliage.mjs' 'grow' '--repo' <your repository> '--garden' ${garden}`);
});

test("status and build name each state in the brain's own words, and start nothing without a runtime", async t => {
  const garden = await temp(t, "foliage-brain-states-");
  const nothing = await temp(t, "foliage-brain-no-vendor-");
  assert.deepEqual(await brainStatus({ garden, vendor: nothing }), { state: "not-installed", cause: "no brain is staged", fix: "node tools/brain/stage-gbrain.mjs" });
  await assert.rejects(buildBrain({ garden, vendor: nothing }), (error: unknown) => error instanceof LocalBrainError && error.state === "not-installed");
  assert.deepEqual(await readdir(garden), [], "a refused build creates nothing in the garden");
  // Turning local embeddings off with no brain has nothing to do, and says the runtime's state as every command does.
  const { embedBrain } = await import("./localBrain.ts");
  assert.deepEqual(await embedBrain({ garden, vendor: nothing }, null),
    { action: "none", embedding: null, brain: false, runtime: { state: "not-installed", cause: "no brain is staged", fix: "node tools/brain/stage-gbrain.mjs" } });
  assert.deepEqual(await readdir(garden), [], "embed --off without a brain makes nothing");

  const other = await temp(t, "foliage-brain-other-pin-");
  await syntheticVendor(other, { gbrainCommit: "0".repeat(40) });
  const otherPin = await brainStatus({ garden, vendor: other });
  assert.equal(otherPin.state, "broken");
  assert.equal(brainLine(otherPin), "Brain: broken: vendor/brain.json names another gbrain commit than Foliage pins. Run node tools/brain/stage-gbrain.mjs");

  const vendor = await temp(t, "foliage-brain-vendor-ok-");
  await syntheticVendor(vendor);
  await writeFile(join(vendor, "bun", "bun"), "a changed stand-in\n");
  assert.match(brainLine(await brainStatus({ garden, vendor })), /^Brain: broken: vendor\/bun\/bun differs from what was staged\. Run node tools\/brain\/stage-gbrain\.mjs$/);
  await syntheticVendor(vendor);
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "off" });
  await assert.rejects(buildBrain({ garden, vendor }), (error: unknown) => error instanceof LocalBrainError && error.state === "off" && /no leaf.json/.test(error.message));
  await assert.rejects(rebuildBrain({ garden, vendor }), (error: unknown) => error instanceof LocalBrainError && error.state === "off" && /no leaf.json/.test(error.message));
  assert.deepEqual(await readdir(garden), [], "a build refused for want of a leaf.json leaves no brain/ behind");
  // A record a brain is not built from is found only once brain/ is made: the empty folder goes again.
  await writeFile(join(garden, "leaf.json"), "not a Leaf");
  await assert.rejects(buildBrain({ garden, vendor }), (error: unknown) => error instanceof LocalBrainError && error.state === "broken" && error.message === "leaf.json is not valid JSON");
  assert.deepEqual(await readdir(garden), ["leaf.json"], "a refused build leaves no empty brain/ behind");
  await rm(join(garden, "leaf.json"));

  const paths = brainPaths(garden);
  await mkdir(paths.home, { recursive: true });
  assert.equal(brainLine(await brainStatus({ garden, vendor })), "Brain: broken: the last build did not finish. Run foliage brain rebuild");
  await writeFile(paths.refused, JSON.stringify({ cause: "the brain's database named provider_base_urls.ollama, now removed; it stays unused until rebuilt" }));
  assert.equal(brainLine(await brainStatus({ garden, vendor })),
    "Brain: broken: the brain's database named provider_base_urls.ollama, now removed; it stays unused until rebuilt. Run foliage brain rebuild");
  // A manifest says built but the brain's home is gone: a named cause, found before any process starts.
  await rm(paths.refused);
  await rm(paths.home, { recursive: true });
  await writeFile(paths.manifest, JSON.stringify({ schemaVersion: 2, leafId: "synthetic", subject: "Synthetic", leafSha256: "0".repeat(64),
    harvestSha256: null, mode: "keyword", gbrain: { ...GBRAIN_PIN }, pages: {} }));
  assert.equal(brainLine(await brainStatus({ garden, vendor })), "Brain: broken: the brain's home is missing. Run foliage brain rebuild");

  assert.equal(brainLine({ state: "current" }), "Brain: current");
  assert.equal(brainLine({ state: "behind" }), "Brain: behind your record. Run foliage brain refresh");
  assert.equal(brainLine({ state: "busy" }), "Brain: busy. Another Foliage process is using it; try again shortly");
  // An off brain's cause and fix join its one line only when asked (`foliage status`); `foliage brain` prints them apart.
  assert.equal(brainLine(NO_BRAIN), "Brain: off");
  assert.equal(brainLine(NO_BRAIN, { offCause: true }), "Brain: off. This garden has no brain yet. Run foliage brain build");
  assert.equal(brainLine({ state: "off", cause: "the garden does not exist" }, { offCause: true }), "Brain: off");
  for (const state of ["current", "behind", "not-installed", "off", "busy", "broken"] as const) {
    assert.ok(!/\d/.test(brainLine({ state })), "no count in the brain's line");
  }
});

test("an installed copy's runtime names the installer's fix, never the checkout's staging tool (build order item 7)", async t => {
  const garden = await temp(t, "foliage-brain-installed-garden-");
  // A SYNTHETIC installed copy: the main release's record and installer at its root, the brain beside them.
  const install = await temp(t, "foliage-brain-installed-");
  await writeFile(join(install, "release.json"), "{\"synthetic\":true}\n");
  await writeFile(join(install, "install.mjs"), "// synthetic stand-in for the installer\n");
  const vendor = join(install, "vendor");
  assert.equal(await installedRuntime(vendor), true);
  // Only where a brain archive is built does the fix name one (the next test covers the other platforms).
  const ships = brainArchiveShips(process.platform, process.arch);
  assert.deepEqual(await brainStatus({ garden, vendor }), ships
    ? { state: "not-installed", cause: "no brain is staged", fix: "node install.mjs --add-brain <the vendor folder from the Foliage download> <this Foliage folder>" }
    : { state: "not-installed", cause: `no brain archive ships for ${process.platform}/${process.arch} yet` });
  await syntheticVendor(vendor);
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "off" });
  await writeFile(join(vendor, "gbrain", "src", "cli.ts"), "// one changed byte\n");
  assert.equal(brainLine(await brainStatus({ garden, vendor })), ships
    ? "Brain: broken: vendor/gbrain/src/cli.ts differs from what was staged. Run node install.mjs --replace-brain <the vendor folder from the Foliage download> <this Foliage folder>"
    : `Brain: broken: vendor/gbrain/src/cli.ts differs from what was staged. Run node install.mjs <a new folder> from the extracted Foliage release, which holds no brain (none ships for ${process.platform}/${process.arch} yet)`);
  // A checkout has neither file at its root.
  assert.equal(await installedRuntime(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "vendor")), false);
});

test("an installed copy on a platform no brain archive is built for is told so, never sent to an archive that does not exist (build order item 7)", () => {
  const root = "/synthetic/foliage";
  assert.equal(brainArchiveShips("darwin", "arm64"), true);
  for (const [platform, arch] of [["linux", "x64"], ["linux", "arm64"], ["win32", "x64"], ["darwin", "x64"]] as const) {
    assert.equal(brainArchiveShips(platform, arch), false);
    const advice = notInstalledAdvice(true, root, platform, arch);
    assert.equal(advice, `No brain archive ships for ${platform}/${arch} yet, so search uses Foliage's own search.\n`);
    assert.doesNotMatch(advice, /--add-brain|foliage-brain-/);
    assert.deepEqual(runtimeRemedy("no brain is staged", true, true, platform, arch), { cause: `no brain archive ships for ${platform}/${arch} yet` });
    const changed = runtimeRemedy("vendor/gbrain/src/cli.ts differs from what was staged", false, true, platform, arch);
    assert.doesNotMatch(changed.fix ?? "", /--replace-brain|--add-brain/);
    // A checkout restages on any platform.
    assert.deepEqual(runtimeRemedy("no brain is staged", true, false, platform, arch), { cause: "no brain is staged", fix: "node tools/brain/stage-gbrain.mjs" });
    assert.equal(notInstalledAdvice(false, root, platform, arch), "Stage it in this checkout with: node tools/brain/stage-gbrain.mjs\n");
  }
  assert.equal(notInstalledAdvice(true, root, "darwin", "arm64"), "The brain comes in the Foliage download, in the vendor folder beside its runtime folder. Add it to this install:\n"
    + '  node "/synthetic/foliage/install.mjs" --add-brain /absolute/path/to/the/extracted/vendor "/synthetic/foliage"\n');
  assert.deepEqual(runtimeRemedy("no brain is staged", true, true, "darwin", "arm64"),
    { cause: "no brain is staged", fix: "node install.mjs --add-brain <the vendor folder from the Foliage download> <this Foliage folder>" });
});

test("a release's own files at the root of vendor/ are the release's to check; anywhere else they are refused (build order item 7)", async t => {
  const vendor = await temp(t, "foliage-brain-release-files-");
  const manifest = parseVendorManifest(await syntheticVendor(vendor));
  for (const name of RELEASE_FILES) await writeFile(join(vendor, name), "synthetic release file\n");
  await verifyVendorTree(vendor, manifest);
  await writeFile(join(vendor, "gbrain", "THIRD-PARTY-NOTICES"), "synthetic, in the wrong place\n");
  await assert.rejects(verifyVendorTree(vendor, manifest), /vendor\/gbrain\/THIRD-PARTY-NOTICES was not staged/);
});

test("only the bun bytes Foliage pins ship, and only where it pins them; a disk without room for an empty brain is named (build order item 7)", async t => {
  const pinned = BUN_PIN.shipped["darwin/arm64"] ?? "";
  assert.match(pinned, /^[a-f0-9]{64}$/);
  assert.equal(shippedBunProblem({ platform: "darwin", arch: "arm64", bunSha256: pinned }), null);
  assert.equal(shippedBunProblem({ platform: "darwin", arch: "arm64", bunSha256: "0".repeat(64) }), "vendor/bun/bun is not the bun Foliage ships");
  assert.equal(shippedBunProblem({ platform: "linux", arch: "x64", bunSha256: pinned }), "no brain ships for linux/x64: only macOS arm64 has passed the offline test");
  // A SYNTHETIC staged tree: right pins, a stand-in bun that is not the shipped bytes.
  const vendor = await temp(t, "foliage-brain-shipped-");
  await syntheticVendor(vendor, { platform: "darwin", arch: "arm64" });
  if (process.platform === "darwin" && process.arch === "arm64") await assert.rejects(verifyShippedBrain(vendor), /vendor\/bun\/bun is not the bun Foliage ships/);
  else await assert.rejects(verifyShippedBrain(vendor), /staged for darwin\/arm64/);
  assert.equal(roomProblem(EMPTY_BRAIN_BYTES, EMPTY_BRAIN_BYTES, "the garden's disk"), null);
  assert.equal(roomProblem(12 * 1024 * 1024, EMPTY_BRAIN_BYTES, "the garden's disk"), "the garden's disk has 12 MB free, and 42 MB is needed");
});

test("status while another process holds the lock is busy, not broken, though a build has removed the manifest", async t => {
  const garden = await temp(t, "foliage-brain-busy-");
  const vendor = await temp(t, "foliage-brain-busy-vendor-");
  await syntheticVendor(vendor);
  const paths = brainPaths(garden);
  // A build part-way through: its home made again, no manifest yet, the lock held by the builder.
  await mkdir(paths.home, { recursive: true });
  const builder = await holdLockInChild(paths.lock);
  const during = await brainStatus({ garden, vendor, waitMs: 300 });
  assert.equal(during.state, "busy", JSON.stringify(during));
  assert.equal(brainLine(during), "Brain: busy. Another Foliage process is using it; try again shortly");
  await builder.kill();
  // The builder is gone: its lock is reclaimed, and only now is the unfinished build named.
  assert.equal(brainLine(await brainStatus({ garden, vendor })), "Brain: broken: the last build did not finish. Run foliage brain rebuild");
  assert.equal(await lstat(paths.lock).then(() => true, () => false), false, "status released the lock it reclaimed");
});

test("a garden at, under or around the owner's own brain is refused before anything there is read, made, locked or removed", async t => {
  const vendor = await temp(t, "foliage-brain-owner-vendor-");
  await syntheticVendor(vendor);
  // SYNTHETIC stand-in for an owner's home: a ~/brain holding a note, a ~/.gbrain holding a config,
  // and leaf.json files that make each spot look like a garden.
  const fakeHome = await realpath(await temp(t, "foliage-brain-fake-home-"));
  for (const [path, text] of [["brain/pages/owner-note.md", "synthetic owner note\n"], ["brain/home/keep.txt", "synthetic\n"],
    [".gbrain/config.json", "{\"synthetic\": true}\n"], ["brain/inner-garden/leaf.json", "{}\n"], ["leaf.json", "{}\n"]] as const) {
    await mkdir(dirname(join(fakeHome, path)), { recursive: true });
    await writeFile(join(fakeHome, path), text);
  }
  const elsewhere = await temp(t, "foliage-brain-holds-home-");
  /** Every entry under a root with its bytes or link: any read-into-change, mkdir, lock or rm shows. */
  const snapshot = async (root: string): Promise<string[]> => {
    const lines: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { lines.push(`${path}/`); await walk(path); }
        else lines.push(`${path} ${entry.isSymbolicLink() ? await readlink(path) : sha(await readFile(path, "utf8"))}`);
      }
    };
    await walk(root);
    return lines;
  };
  const before = [await snapshot(fakeHome), await snapshot(elsewhere)];
  const savedHome = process.env["HOME"];
  const setHome = (value: string | undefined) => { if (value === undefined) delete process.env["HOME"]; else process.env["HOME"] = value; };
  t.after(() => setHome(savedHome));
  const refused = async (garden: string, label: string) => {
    const cause = `this garden's brain would be, sit under or hold the owner's own ${label}`;
    for (const update of [buildBrain, refreshBrain, rebuildBrain, removeBrain]) {
      await assert.rejects(update({ garden, vendor }), (error: unknown) => error instanceof LocalBrainError && error.state === "broken" && error.message === cause, update.name);
    }
    assert.equal(brainLine(await brainStatus({ garden, vendor })), `Brain: broken: ${cause}. Run foliage brain build --garden <a garden outside ~/brain and ~/.gbrain>`);
  };
  setHome(fakeHome);
  assert.equal(homedir(), fakeHome);
  await refused(fakeHome, "~/brain"); // the garden is ~: its brain would be ~/brain itself
  await refused(join(fakeHome, "brain", "inner-garden"), "~/brain"); // the garden lives inside ~/brain
  await refused(join(fakeHome, ".gbrain"), "~/.gbrain"); // the garden lives inside ~/.gbrain
  setHome(join(elsewhere, "brain", "home")); // the brain would hold the owner's home, and so ~/.gbrain
  await refused(elsewhere, "~/.gbrain");
  setHome(savedHome);
  assert.deepEqual([await snapshot(fakeHome), await snapshot(elsewhere)], before, "nothing there was changed, made, locked or removed");
});

test("no cause a failure names carries the garden's path", async t => {
  const garden = await temp(t, "foliage-brain-path-free-");
  const vendor = await temp(t, "foliage-brain-path-free-vendor-");
  await syntheticVendor(vendor);
  const paths = brainPaths(garden);
  const causes: string[] = [];
  const keep = (error: unknown) => { causes.push(error instanceof Error ? error.message : String(error)); };
  await mkdir(join(garden, "leaf.json")); // a record that is not a regular document
  await buildBrain({ garden, vendor }).then(() => assert.fail("built from a directory"), keep);
  assert.deepEqual(await readdir(garden), ["leaf.json"], "the refused build took away the empty brain/ it made");
  await mkdir(paths.brain);
  const held = await acquireBrainLock(paths.lock);
  causes.push((await brainStatus({ garden, vendor, waitMs: 50 })).cause ?? "no cause");
  await acquireBrainLock(paths.lock, { waitMs: 0 }).then(() => assert.fail("locked twice"), keep);
  await unlink(paths.lock);
  await held.setChild(4242).then(() => assert.fail("wrote a lock it no longer holds"), keep);
  await writeFile(paths.lock, "not a lock record");
  await acquireBrainLock(paths.lock, { waitMs: 0 }).then(() => assert.fail("took an unreadable lock"), keep);
  // gbrain's own last line, as runGbrain passes it on.
  causes.push(pathFree(`Error: ENOENT: no such file or directory, open '${paths.pages}/foliage/a.md' under ${await realpath(garden)}`));
  assert.deepEqual(causes.slice(0, 5), [
    `leaf.json is not a regular document within ${IMPORT_DOCUMENT_BYTES} bytes`,
    `process ${process.pid} holds the brain lock`,
    `process ${process.pid} holds the brain lock`,
    "the brain lock was taken from this process",
    "the brain lock cannot be read, so it was left in place",
  ]);
  for (const cause of causes) {
    assert.ok(!cause.includes(garden) && !cause.includes(await realpath(garden)) && !cause.includes(tmpdir()), cause);
  }
  assert.equal(causes[5], "Error: ENOENT: no such file or directory, open <path> under <path>");
  assert.equal(pathFree('Source "synthetic-source" not found'), 'Source "synthetic-source" not found');
});

test("three processes racing for a dead holder's lock take it one at a time, and leave nothing beside it", async t => {
  const dir = await temp(t, "foliage-brain-race-");
  const path = join(dir, ".brain-lock");
  // Each racer says it is ready, waits for one shared word, takes the lock, checks for 150 ms that
  // the lock still names it, then releases and reports its hold.
  const racer = `
    const { acquireBrainLock } = await import(${JSON.stringify(LOCK_MODULE)});
    const { readlink } = await import("node:fs/promises");
    process.stdout.write("ready\\n");
    await new Promise(resolve => process.stdin.once("data", resolve));
    const lock = await acquireBrainLock(${JSON.stringify(path)}, { waitMs: 30000, pollMs: 5 });
    const start = Date.now();
    let foreign = 0;
    while (Date.now() - start < 150) {
      if (JSON.parse(await readlink(${JSON.stringify(path)})).pid !== process.pid) foreign++;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    const end = Date.now();
    await lock.release();
    process.stdout.write(JSON.stringify({ start, end, foreign }) + "\\n");
    process.exit(0);`;
  for (let round = 0; round < 3; round++) {
    await rm(path, { force: true });
    await symlink(JSON.stringify({ pid: await deadPid(), token: `synthetic-dead-${round}`, startedAt: new Date().toISOString() }), path);
    const racers = Array.from({ length: 3 }, () => spawn(process.execPath, ["--input-type=module", "-e", racer], { stdio: ["pipe", "pipe", "inherit"] }));
    const outputs = racers.map(child => new Promise<string>((resolve, reject) => {
      let text = "";
      child.stdout.on("data", chunk => { text += String(chunk); });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve(text) : reject(new Error(`racer exited ${code}: ${text}`)));
    }));
    await Promise.all(racers.map(child => new Promise<void>(resolve => {
      const ready = (chunk: Buffer) => { if (String(chunk).includes("ready")) { child.stdout.off("data", ready); resolve(); } };
      child.stdout.on("data", ready);
    })));
    for (const child of racers) child.stdin.end("go\n");
    const holds = (await Promise.all(outputs)).map(text => JSON.parse(text.split("\n").filter(line => line.startsWith("{"))[0]!) as { start: number; end: number; foreign: number });
    assert.equal(holds.length, 3);
    assert.ok(holds.every(hold => hold.foreign === 0), `a racer saw the lock name another process while it held it (round ${round})`);
    holds.sort((a, b) => a.start - b.start);
    for (let i = 1; i < holds.length; i++) assert.ok(holds[i - 1]!.end <= holds[i]!.start, `two racers held the lock at once (round ${round})`);
    assert.deepEqual(await readdir(dir), [], "no lock, claim or temporary link is left behind");
  }
});

/** A SYNTHETIC garden record whose words the fallback search can find, with an excluded leaflet. */
async function syntheticGarden(garden: string): Promise<string> {
  const provenance = { source: "git", ref: "0000000000000000000000000000000000000001", observedAt: "2026-10-10T00:00:00Z" };
  const text = JSON.stringify({ id: "synthetic-brain-search", subject: "Synthetic subject", leaflets: [
    { id: "one", title: "Synthetic quillwort leaflet", tier: "verified", provenance, body: [{ provenance, text: "Synthetic quillwort notes." }] },
    { id: "outside", title: "Synthetic quillwort survey", tier: "excluded", reason: "Synthetic: another contributor wrote this.", provenance,
      body: [{ provenance, text: "Bodyonlyword, somebody else's synthetic work." }] },
  ] });
  await writeFile(join(garden, "leaf.json"), text);
  return text;
}

test("brain search checks the query first, then answers from Foliage's own search with the reason whenever the brain cannot", async t => {
  const garden = await temp(t, "foliage-brain-search-");
  const nothing = await temp(t, "foliage-brain-search-no-vendor-");
  // Foliage's own rules come before anything is read or started.
  await assert.rejects(searchLocalBrain({ garden: join(garden, "missing"), vendor: nothing }, "x".repeat(301)), /1–300 query characters/);
  await assert.rejects(searchLocalBrain({ garden, vendor: nothing }, "quillwort", 11), /limit must be 1–10/);
  assert.deepEqual(await searchLocalBrain({ garden, vendor: nothing }, "quillwort"), { state: "no-record", hits: [] });
  assert.deepEqual(await searchLocalBrain({ garden: join(garden, "missing"), vendor: nothing }, "quillwort"), { state: "no-record", hits: [] });
  const leafText = await syntheticGarden(garden);
  const vendor = await temp(t, "foliage-brain-search-vendor-");
  await syntheticVendor(vendor);
  const paths = brainPaths(await realpath(garden));
  const expectFallback = async (because: string, options: { vendor: string; waitMs?: number; readRefreshMs?: number }) => {
    const answer = await searchLocalBrain({ garden, ...options }, "quillwort", 5);
    assert.ok(!("state" in answer));
    assert.deepEqual({ ...answer, hits: answer.hits.map(hit => hit.id) }, { subject: { leafId: "synthetic-brain-search", name: "Synthetic subject" },
      retrieval: "foliage keyword", because, hits: ["leaflet:one", "leaflet:outside"] });
    const excluded = answer.hits.find(hit => hit.id === "leaflet:outside")!;
    assert.equal(excluded.snippet, "Synthetic: another contributor wrote this.");
    assert.equal(excluded.reason, "Synthetic: another contributor wrote this.");
    assert.ok(!JSON.stringify(answer).toLowerCase().includes("bodyonlyword") && !JSON.stringify(answer).includes(garden) && !JSON.stringify(answer).includes(tmpdir()));
    assert.deepEqual((await searchLocalBrain({ garden, ...options }, "Bodyonlyword", 5)).hits, [], "a word only in the excluded body finds nothing");
  };
  await expectFallback("Brain: not installed", { vendor: nothing });
  await expectFallback("Brain: off", { vendor });
  assert.deepEqual(await readdir(garden), ["leaf.json"], "a search makes no brain");
  await mkdir(paths.home, { recursive: true });
  await expectFallback("Brain: broken: the brain has no manifest. Run foliage brain rebuild", { vendor });
  const manifest = { schemaVersion: 2, leafId: "synthetic-brain-search", subject: "Synthetic subject", leafSha256: "0".repeat(64), harvestSha256: null,
    mode: "keyword", gbrain: { ...GBRAIN_PIN }, pages: {} };
  await writeFile(paths.manifest, JSON.stringify(manifest));
  // With a search's own refresh off (item 5 adds it), a brain behind the record says only that.
  await expectFallback("Brain: behind your record. Run foliage brain refresh", { vendor, readRefreshMs: 0 });
  // With it on, the search tries the brain first; one that is not usable is never rebuilt by a search.
  await expectFallback("Brain: broken: config.json is missing. Run foliage brain rebuild", { vendor });
  await writeFile(paths.refused, "{}");
  await expectFallback("Brain: broken: an earlier check refused this brain. Run foliage brain rebuild", { vendor });
  await rm(paths.refused);
  const holder = await holdLockInChild(paths.lock);
  try { await expectFallback("Brain: busy. Another Foliage process is using it; try again shortly", { vendor, waitMs: 200 }); }
  finally { await holder.kill(); }
  assert.equal(await readFile(join(garden, "leaf.json"), "utf8"), leafText, "a search never writes the record");
});

test("refresh never makes a brain, rebuild needs the runtime, and remove deletes the brain without one", async t => {
  const garden = await temp(t, "foliage-brain-remove-");
  await syntheticGarden(garden);
  const vendor = await temp(t, "foliage-brain-remove-vendor-");
  await syntheticVendor(vendor);
  const refused = await refreshBrain({ garden, vendor }).then(() => assert.fail("refresh made a brain"), (error: unknown) => error);
  assert.ok(refused instanceof LocalBrainError && refused.state === "off" && refused.message === "this garden has no brain yet" && refused.fix === "foliage brain build", String(refused));
  // What `foliage status` says of a garden with no brain is this refusal, in the same words.
  assert.deepEqual(brainFailure(refused), NO_BRAIN);
  const nothing = await temp(t, "foliage-brain-remove-no-vendor-");
  await assert.rejects(rebuildBrain({ garden, vendor: nothing }), (error: unknown) => error instanceof LocalBrainError && error.state === "not-installed");
  assert.deepEqual(await readdir(garden), ["leaf.json"], "neither made anything");
  await removeBrain({ garden });

  // SYNTHETIC leftovers of a brain, a killed rebuild's included.
  const paths = brainPaths(await realpath(garden));
  for (const file of [paths.manifest, join(paths.pages, "foliage", "synthetic.md"), join(paths.home, ".gbrain", "config.json"), join(paths.next, "home", "x"), join(paths.old, "pages", "y")]) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "synthetic\n");
  }
  const holder = await holdLockInChild(paths.lock);
  try {
    await assert.rejects(removeBrain({ garden, waitMs: 200 }), (error: unknown) => error instanceof LocalBrainError && error.state === "busy");
    assert.ok(await lstat(paths.manifest).then(() => true), "a held brain is left alone");
  } finally { await holder.kill(); }
  await removeBrain({ garden });
  assert.deepEqual(await readdir(garden), ["leaf.json"], "the whole brain is gone, the record stays");
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "off" });
});

/** A SYNTHETIC brain a refresh would update in place: Foliage's config, its directories and a manifest one record behind. */
async function behindBrain(garden: string) {
  const paths = brainPaths(await realpath(garden));
  for (const dir of [paths.tmp, dirname(paths.config), paths.work, paths.bin, join(paths.pages, "foliage")]) await mkdir(dir, { recursive: true });
  await writeFile(paths.config, brainConfigText(paths));
  await writeFile(paths.manifest, JSON.stringify({ schemaVersion: 2, leafId: "synthetic-brain-search", subject: "Synthetic subject", leafSha256: "0".repeat(64),
    harvestSha256: null, mode: "keyword", gbrain: { ...GBRAIN_PIN }, pages: {} }));
  return paths;
}

/** Names and bytes of everything under a folder, links named by their target. */
async function folderBytes(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), info = await lstat(path);
      if (info.isSymbolicLink()) out.push(`${path} -> ${await readlink(path)}`);
      else if (info.isDirectory()) { out.push(`${path}/`); await walk(path); }
      else out.push(`${path}: ${await readFile(path, "utf8")}`);
    }
  };
  await walk(root);
  return out;
}

test("a link where Foliage keeps a directory is refused before any page is written, swept or imported, and what it points to is untouched", async t => {
  const vendor = await temp(t, "foliage-brain-links-vendor-");
  await syntheticVendor(vendor);
  for (const place of ["pages/foliage", "pages", "home/.gbrain", "home/tmp", "work", "bin"]) {
    const garden = await temp(t, "foliage-brain-links-");
    await syntheticGarden(garden);
    const paths = await behindBrain(garden);
    // SYNTHETIC stand-in for somebody's notes, where the link points.
    const outside = await temp(t, "foliage-brain-links-outside-");
    await mkdir(join(outside, "people"));
    await writeFile(join(outside, "precious.md"), "Synthetic note that is not Foliage's.\n");
    await writeFile(join(outside, "people", "someone.md"), "Synthetic note about a person.\n");
    const before = await folderBytes(outside);
    const link = join(paths.brain, ...place.split("/"));
    await rm(link, { recursive: true, force: true });
    await symlink(outside, link);
    // The observe hook stops the run where a rebuild would start its first process: nothing here runs gbrain.
    const steps: string[] = [];
    await assert.rejects(refreshBrain({ garden, vendor }, { observe: step => { steps.push(step); if (step === "rebuild") throw new Error("synthetic stop"); } }), /synthetic stop/);
    assert.deepEqual(steps, ["rebuild"], `${place}: a linked directory goes straight to a rebuild, never to the in-place steps`);
    assert.deepEqual(await folderBytes(outside), before, `${place}: what the link points to is untouched`);
    const status = await brainStatus({ garden, vendor });
    assert.deepEqual([status.state, status.cause], ["broken", `brain/${place} is a symbolic link`], place);
    // And remove takes the link away, never what it points to.
    await removeBrain({ garden });
    assert.deepEqual(await readdir(garden), ["leaf.json"]);
    assert.deepEqual(await folderBytes(outside), before, `${place}: remove followed the link`);
  }
});

test("an unfinished refresh is never current: the manifest it leaves matches no record", async t => {
  const vendor = await temp(t, "foliage-brain-unfinished-vendor-");
  await syntheticVendor(vendor);
  const garden = await temp(t, "foliage-brain-unfinished-");
  await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  const before = JSON.parse(await readFile(paths.manifest, "utf8")) as { pages: object };
  // Stopped where the import would start: the pages are written, gbrain not yet started.
  await assert.rejects(refreshBrain({ garden, vendor }, { observe: step => { if (step === "import") throw new Error("synthetic stop"); } }), /synthetic stop/);
  const unfinished = JSON.parse(await readFile(paths.manifest, "utf8")) as { leafSha256: string; harvestSha256: string; pages: Record<string, { record: string; unconfirmed?: true }> };
  assert.deepEqual([unfinished.leafSha256, unfinished.harvestSha256], ["unfinished refresh", "unfinished refresh"]);
  assert.deepEqual(Object.values(unfinished.pages).map(page => page.record).sort(), ["leaflet:one", "leaflet:outside"], "every page it may have imported is named");
  assert.ok(Object.values(unfinished.pages).every(page => page.unconfirmed === true), "and none is taken as imported");
  assert.deepEqual(before.pages, {});
  assert.deepEqual((await readdir(join(paths.pages, "foliage"))).length, 2);
  // Nothing reads it as current: a search that does not refresh falls back, saying the brain is behind.
  const answer = await searchLocalBrain({ garden, vendor, readRefreshMs: 0 }, "quillwort", 5);
  assert.ok(!("state" in answer));
  assert.deepEqual([answer.retrieval, answer.because], ["foliage keyword", "Brain: behind your record. Run foliage brain refresh"]);
  // One that does (item 5) tries the refresh first; the stand-in bun cannot run, so it falls back with that cause.
  const refreshed = await searchLocalBrain({ garden, vendor }, "quillwort", 5);
  assert.ok(!("state" in refreshed));
  assert.deepEqual([refreshed.retrieval, refreshed.because], ["foliage keyword", "Brain: broken: gbrain import could not run: EACCES. Run foliage brain rebuild"]);
});

test("a page file Foliage did not write, beside or among the pages, sends a refresh to a rebuild before it imports anything", async t => {
  const vendor = await temp(t, "foliage-brain-strays-vendor-");
  await syntheticVendor(vendor);
  for (const stray of ["pages/notes.md", "pages/foliage/notes", "pages/foliage/alias.md"]) {
    const garden = await temp(t, "foliage-brain-strays-");
    await syntheticGarden(garden);
    const paths = await behindBrain(garden);
    const path = join(paths.brain, ...stray.split("/"));
    if (stray.endsWith("notes")) await mkdir(path);
    else if (stray.endsWith("alias.md")) {
      // A second name for a file outside the brain: a write or a removal through it would reach that file.
      const outside = await temp(t, "foliage-brain-strays-outside-");
      await writeFile(join(outside, "precious.md"), "Synthetic note that is not Foliage's.\n");
      await link(join(outside, "precious.md"), path);
    } else await writeFile(path, "# Synthetic stray page\n");
    const steps: string[] = [];
    await assert.rejects(refreshBrain({ garden, vendor }, { observe: step => { steps.push(step); if (step === "rebuild") throw new Error("synthetic stop"); } }), /synthetic stop/);
    assert.deepEqual(steps, ["pages", "rebuild"], `${stray}: refused before any page is written`);
    assert.deepEqual(await readdir(join(paths.pages, "foliage")), stray.startsWith("pages/foliage/") ? [stray.slice("pages/foliage/".length)] : [], `${stray}: nothing written`);
  }
});

test("a record whose title or reason holds a line break stops the brain with a cause that names it and a fix that can work", async t => {
  const vendor = await temp(t, "foliage-brain-linebreak-vendor-");
  await syntheticVendor(vendor);
  const garden = await temp(t, "foliage-brain-linebreak-");
  const provenance = { source: "git", ref: "0000000000000000000000000000000000000001", observedAt: "2026-10-10T00:00:00Z" };
  await writeFile(join(garden, "leaf.json"), JSON.stringify({ id: "synthetic-brain-linebreak", subject: "Synthetic subject", leaflets: [
    { id: "outside", title: "Synthetic leaflet", tier: "excluded", reason: "Synthetic first line.\nSynthetic second line.", provenance, body: [{ provenance, text: "Synthetic body." }] },
  ] }));
  const words = "Brain: broken: record \"leaflet:outside\" has a line break in its reason. Run foliage brain build after you put that reason on one line";
  // build first, which makes brain/, so refresh has one to refuse too; no process starts in any of them.
  for (const update of [buildBrain, refreshBrain, rebuildBrain]) {
    await assert.rejects(update({ garden, vendor }), (error: unknown) => error instanceof LocalBrainError && brainLine(brainFailure(error)) === words, update.name);
  }
});

test("remove deletes only a garden's brain, and only the names Foliage makes there", async t => {
  const garden = await temp(t, "foliage-brain-remove-only-");
  const paths = brainPaths(await realpath(garden));
  await mkdir(join(paths.pages, "foliage"), { recursive: true });
  await writeFile(paths.manifest, "synthetic\n");
  // No leaf.json: this brain/ may be somebody's own notes folder.
  await assert.rejects(removeBrain({ garden }), (error: unknown) => error instanceof LocalBrainError
    && brainLine(brainFailure(error)) === "Brain: broken: there is no leaf.json here, so this brain/ was left as it is. Run foliage brain remove --garden <your garden>");
  assert.deepEqual((await readdir(paths.brain)).sort(), ["manifest.json", "pages"]);
  await syntheticGarden(garden);
  await writeFile(join(paths.brain, "notes.md"), "Synthetic note the owner keeps here.\n");
  await assert.rejects(removeBrain({ garden }), (error: unknown) => error instanceof LocalBrainError
    && brainLine(brainFailure(error)) === "Brain: broken: brain/ holds \"notes.md\", which Foliage did not make, so nothing was removed. Run foliage brain remove after you move that out of brain/");
  assert.deepEqual((await readdir(paths.brain)).sort(), ["manifest.json", "notes.md", "pages"], "nothing was removed");
  assert.equal(await readFile(join(paths.brain, "notes.md"), "utf8"), "Synthetic note the owner keeps here.\n");
  await rm(join(paths.brain, "notes.md"));
  await removeBrain({ garden });
  assert.deepEqual(await readdir(garden), ["leaf.json"]);
});

/* ---- build order item 5: keeping the brain current ------------------------------------------- */

/** The SYNTHETIC garden's record as the brain sees it, for a manifest built from these exact bytes. */
async function manifestFor(garden: string, leafText: string, pages: Record<string, unknown> = {}) {
  const paths = brainPaths(await realpath(garden));
  await writeFile(paths.manifest, JSON.stringify({ schemaVersion: 2, leafId: "synthetic-brain-search", subject: "Synthetic subject", leafSha256: sha(leafText),
    harvestSha256: null, mode: "keyword", gbrain: { ...GBRAIN_PIN }, pages }));
  return paths;
}

test("a refresh that fails writes down why: the brain stays behind with that cause while the record is the one it tried, and an update that ends current clears it", async t => {
  const vendor = await temp(t, "foliage-brain-failure-vendor-");
  await syntheticVendor(vendor);
  const garden = await temp(t, "foliage-brain-failure-");
  const leafText = await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  // The stand-in bun cannot run, so the refresh stops at its import: the failure is the brain's, not the record's.
  await assert.rejects(refreshBrain({ garden, vendor }), (error: unknown) => error instanceof LocalBrainError && error.message === "gbrain import could not run: EACCES");
  const note = JSON.parse(await readFile(paths.refreshFailure, "utf8")) as Record<string, unknown>;
  assert.deepEqual([note["cause"], note["leafSha256"], note["harvestSha256"]], ["gbrain import could not run: EACCES", sha(leafText), null]);
  const stopped = "Brain: behind your record. The last refresh stopped: gbrain import could not run: EACCES. Run foliage brain refresh";
  assert.equal(brainLine(await brainGlance({ garden, vendor })), stopped);
  // Once the record moves on, the note no longer applies; put back, it does again.
  await writeFile(join(garden, "leaf.json"), leafText.replace("Synthetic quillwort notes.", "Synthetic quillwort notes, edited."));
  assert.equal(brainLine(await brainGlance({ garden, vendor })), "Brain: behind your record. Run foliage brain refresh");
  await writeFile(join(garden, "leaf.json"), leafText);
  assert.equal(brainLine(await brainGlance({ garden, vendor })), stopped);
  // A refresh that finds the brain built from these bytes ends current, and the note goes.
  await manifestFor(garden, leafText);
  assert.deepEqual(await refreshBrain({ garden, vendor }), { action: "none" });
  assert.equal(await lstat(paths.refreshFailure).then(() => true, () => false), false, "the note was cleared");
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "current" });
  // A record the page format refuses: the note keeps the fix that can work.
  const broken = leafText.replace("Synthetic: another contributor wrote this.", "Synthetic: another\\ncontributor wrote this.");
  await writeFile(join(garden, "leaf.json"), broken);
  await assert.rejects(refreshBrain({ garden, vendor }), LocalBrainError);
  assert.equal(brainLine(await brainGlance({ garden, vendor })),
    "Brain: behind your record. The last refresh stopped: record \"leaflet:outside\" has a line break in its reason. Run foliage brain build after you put that reason on one line");
  // Off and not installed say so themselves; neither writes a note.
  await rm(paths.refreshFailure);
  const nothing = await temp(t, "foliage-brain-failure-no-vendor-");
  await assert.rejects(refreshBrain({ garden, vendor: nothing }), (error: unknown) => error instanceof LocalBrainError && error.state === "not-installed");
  assert.equal(await lstat(paths.refreshFailure).then(() => true, () => false), false);
  assert.equal(await readFile(join(garden, "leaf.json"), "utf8"), broken, "no brain work wrote the record");
  // remove takes the note with the brain.
  await writeFile(paths.refreshFailure, "{}\n");
  await removeBrain({ garden });
  assert.deepEqual(await readdir(garden), ["leaf.json"]);
});

test("a lock held by a refresh reads as 'behind your record, refreshing' to the glance, status and search; any other holder is busy", async t => {
  const vendor = await temp(t, "foliage-brain-refreshing-vendor-");
  await syntheticVendor(vendor);
  const garden = await temp(t, "foliage-brain-refreshing-");
  const leafText = await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  const refreshing = await holdLockInChild(paths.lock, true);
  try {
    assert.equal(JSON.parse(await readlink(paths.lock)).refreshing, true, "the lock records the refresh");
    assert.deepEqual(await brainGlance({ garden, vendor }), { state: "behind", refreshing: true });
    assert.equal(brainLine(await brainStatus({ garden, vendor, waitMs: 200 })), "Brain: behind your record, refreshing");
    const answer = await searchLocalBrain({ garden, vendor, waitMs: 200 }, "quillwort", 5);
    assert.ok(!("state" in answer));
    assert.deepEqual([answer.retrieval, answer.because], ["foliage keyword", "Brain: behind your record, refreshing"]);
    // A refresh holding the lock of a brain already built from these bytes is only busy to status.
    await manifestFor(garden, leafText);
    assert.equal(brainLine(await brainStatus({ garden, vendor, waitMs: 200 })), "Brain: busy. Another Foliage process is using it; try again shortly");
  } finally { await refreshing.kill(); }
  await behindBrain(garden);
  const other = await holdLockInChild(paths.lock);
  try {
    assert.deepEqual(await brainGlance({ garden, vendor }), { state: "behind" }, "the glance never waits for the lock");
    assert.equal(brainLine(await brainStatus({ garden, vendor, waitMs: 200 })), "Brain: busy. Another Foliage process is using it; try again shortly");
    const answer = await searchLocalBrain({ garden, vendor, waitMs: 200 }, "quillwort", 5);
    assert.ok(!("state" in answer));
    assert.equal(answer.because, "Brain: busy. Another Foliage process is using it; try again shortly");
  } finally { await other.kill(); }
});

test("the glance reads the brain's state without starting a process or waiting: off, not installed, current, and the checks a process would make", async t => {
  const vendor = await temp(t, "foliage-brain-glance-vendor-");
  await syntheticVendor(vendor);
  const nothing = await temp(t, "foliage-brain-glance-no-vendor-");
  const garden = await temp(t, "foliage-brain-glance-");
  const leafText = await syntheticGarden(garden);
  assert.deepEqual(await brainGlance({ garden, vendor: nothing }), { state: "not-installed", cause: "no brain is staged", fix: "node tools/brain/stage-gbrain.mjs" });
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "off" });
  assert.equal(brainLine(await brainGlance({ garden: join(garden, "missing"), vendor })), "Brain: off");
  const paths = await behindBrain(garden);
  await manifestFor(garden, leafText);
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "current" });
  await writeFile(join(paths.work, ".env"), "SYNTHETIC=1\n");
  assert.equal((await brainGlance({ garden, vendor })).state, "broken", "a planted .env in work/ is caught at a glance too");
  await rm(join(paths.work, ".env"));
  await writeFile(paths.config, brainConfigText(paths).replace('"engine"', '"openai_api_key": "planted",\n  "engine"'));
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "broken", cause: "config.json holds openai_api_key, which Foliage never writes" });
  await writeFile(paths.config, brainConfigText(paths));
  await writeFile(paths.refused, JSON.stringify({ cause: "the brain's database named provider_base_urls.ollama, now removed; it stays unused until rebuilt" }));
  assert.equal(brainLine(await brainGlance({ garden, vendor })), "Brain: broken: the brain's database named provider_base_urls.ollama, now removed; it stays unused until rebuilt. Run foliage brain rebuild");
  assert.equal(await readFile(join(garden, "leaf.json"), "utf8"), leafText);
});

/**
 * A SYNTHETIC stand-in for bun that is a two-line shell script, never bun or gbrain: it notes that
 * it ran, then sleeps and exits 0 without a word, so an import "finishes" and the next op's answer
 * is not JSON. Its PATH is the brain's empty bin/, so it names every program by absolute path.
 */
async function sleepingVendor(dir: string, marker: string, seconds: number) {
  await scriptedVendor(dir, `/bin/echo ran >> '${marker}'\nexec /bin/sleep ${seconds}\n`);
}

/** A SYNTHETIC vendor whose "bun" is `/bin/sh` running `body`, staged with the right digests; never bun or gbrain. */
async function scriptedVendor(dir: string, body: string) {
  await syntheticVendor(dir);
  const script = `#!/bin/sh\n${body}`;
  await writeFile(join(dir, "bun", "bun"), script);
  await chmod(join(dir, "bun", "bun"), 0o755);
  const manifest = JSON.parse(await readFile(join(dir, "brain.json"), "utf8")) as Record<string, unknown>;
  await writeFile(join(dir, "brain.json"), JSON.stringify({ ...manifest, bunSha256: sha(script), files: await hashVendorTree(dir) }));
}

test("a search refreshes a brain behind its record in place within its bound, never starts a rebuild, and a refresh past the bound finishes behind the answer", async t => {
  const dir = await temp(t, "foliage-brain-bound-");
  const marker = join(dir, "stand-in-ran");
  const vendor = join(dir, "vendor");
  // Each stand-in process takes 3 s, so the refresh below outlives its bound by seconds, not milliseconds.
  await sleepingVendor(vendor, marker, 3);
  const garden = join(dir, "garden");
  await mkdir(garden);
  const leafText = await syntheticGarden(garden);
  // A leaflet newly excluded needs a rebuild, which a search never starts: it answers at once.
  // The brain was built while that leaflet was still the owner's.
  const earlier = JSON.parse(leafText) as { leaflets: { id: string; tier: string; reason?: string }[] };
  for (const leaflet of earlier.leaflets) if (leaflet.id === "outside") { leaflet.tier = "verified"; delete leaflet.reason; }
  const record = parseLeafDocument(earlier);
  assert.ok(record.ok);
  const before = record.leaf;
  const paths = await behindBrain(garden);
  await writeFile(paths.manifest, JSON.stringify({ ...JSON.parse(await readFile(paths.manifest, "utf8")),
    pages: Object.fromEntries(brainProjection({ leaf: before, harvest: null }).pages.map(page => [page.slug, brainManifestPage(page)])) }));
  const started = performance.now();
  const rebuild = await searchLocalBrain({ garden, vendor, readRefreshMs: 5_000 }, "quillwort", 5);
  assert.ok(!("state" in rebuild));
  assert.deepEqual([rebuild.retrieval, rebuild.because], ["foliage keyword",
    "Brain: behind your record. A search does not start a rebuild (a leaflet was newly excluded, so its earlier text must leave the brain). Run foliage brain refresh"]);
  assert.ok(performance.now() - started < 4_000, "it did not wait for its 5 s bound");
  assert.equal(await lstat(marker).then(() => true, () => false), false, "no process started");
  // An update in place that outlives the bound: the search answers at the bound, and the refresh
  // keeps the lock, says so, and finishes behind it (here it then fails, and says why).
  await writeFile(paths.manifest, JSON.stringify({ ...JSON.parse(await readFile(paths.manifest, "utf8")), pages: {} }));
  const late = performance.now();
  const answer = await searchLocalBrain({ garden, vendor, readRefreshMs: 300 }, "quillwort", 5);
  const waited = performance.now() - late;
  assert.ok(!("state" in answer));
  assert.deepEqual([answer.retrieval, answer.because, answer.hits.map(hit => hit.id)], ["foliage keyword", "Brain: behind your record, refreshing", ["leaflet:one", "leaflet:outside"]]);
  assert.ok(waited >= 300, `answered at the bound, not before it, after ${Math.round(waited)} ms`);
  // Answered before the refresh finished: it still holds the lock (ordering, not a wall-clock ceiling).
  assert.equal(JSON.parse(await readlink(paths.lock)).refreshing, true, "the refresh still holds the lock");
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "behind", refreshing: true });
  for (let waitedMs = 0; await lstat(paths.lock).then(() => true, () => false); waitedMs += 50) {
    assert.ok(waitedMs < 60_000, "the refresh never released the lock");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(brainLine(await brainGlance({ garden, vendor })), "Brain: behind your record. The last refresh stopped: gbrain list_pages did not answer in JSON. Run foliage brain refresh");
  assert.ok((await readFile(marker, "utf8")).split("\n").filter(Boolean).length >= 2, "the import, then list_pages, ran");
  assert.equal(await readFile(join(garden, "leaf.json"), "utf8"), leafText, "a search never writes the record");
});

/** The SYNTHETIC garden's record with the leaflet "outside" still the owner's: the record before it was excluded. */
function beforeExclusion(leafText: string): string {
  const earlier = JSON.parse(leafText) as { leaflets: { id: string; tier: string; reason?: string }[] };
  for (const leaflet of earlier.leaflets) if (leaflet.id === "outside") { leaflet.tier = "verified"; delete leaflet.reason; }
  return JSON.stringify(earlier);
}

/** Whether any file under a folder holds this word. */
async function holdsWord(root: string, word: string): Promise<boolean> {
  return (await folderBytes(root)).some(line => line.includes(word));
}

test("a search that read the record before a newer one was brought into the brain never rolls the brain back: it reads the record again under the lock and starts nothing", async t => {
  const dir = await temp(t, "foliage-brain-race-");
  const marker = join(dir, "stand-in-ran");
  const vendor = join(dir, "vendor");
  await sleepingVendor(vendor, marker, 1);
  const garden = join(dir, "garden");
  await mkdir(garden);
  // R2, the newer record, excludes the leaflet "outside"; R1, the one the search reads, was before that.
  const r2 = await syntheticGarden(garden);
  const r1 = beforeExclusion(r2);
  await writeFile(join(garden, "leaf.json"), r1);
  const paths = await behindBrain(garden);
  // Another refresh holds the lock; the search reads R1 and waits for it.
  const holder = await holdLockInChild(paths.lock, true);
  const searching = searchLocalBrain({ garden, vendor, waitMs: 20_000 }, "quillwort", 5);
  await sleep(1_500);
  // Meanwhile that refresh lands R2: the record, its pages (the excluded one as title and reason
  // only) and a manifest built from them. Then it lets go of the lock.
  await writeFile(join(garden, "leaf.json"), r2);
  const parsed = parseLeafDocument(JSON.parse(r2));
  assert.ok(parsed.ok);
  const projection = brainProjection({ leaf: parsed.leaf, harvest: null });
  for (const page of projection.pages) await writeFile(join(paths.pages, page.file), page.markdown);
  await manifestFor(garden, r2, Object.fromEntries(projection.pages.map(page => [page.slug, brainManifestPage(page)])));
  assert.equal(await holdsWord(paths.brain, "Bodyonlyword"), false, "control: R2's brain holds no excluded body");
  const landed = await readFile(paths.manifest, "utf8");
  await holder.kill();
  const answer = await searching;
  // Had the search read R2 instead, the brain would be current and the stand-in's search would have
  // failed with another cause, so this can only pass on the interleaving it names.
  assert.ok(!("state" in answer));
  assert.deepEqual([answer.retrieval, answer.because], ["foliage keyword", "Your record changed during the search"]);
  assert.equal(await readFile(paths.manifest, "utf8"), landed, "the manifest is still R2's");
  assert.equal(await holdsWord(paths.brain, "Bodyonlyword"), false, "the excluded body never came back");
  assert.equal(await lstat(paths.refreshFailure).then(() => true, () => false), false, "no failure was noted");
  assert.equal(await lstat(marker).then(() => true, () => false), false, "no process started");
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "current" });
});

test("a brain/ holding anything Foliage did not make is never locked, moved, removed or written: not by a trigger, a refresh, a build, a rebuild, a status or a search", async t => {
  const vendor = await temp(t, "foliage-brain-foreign-vendor-");
  await syntheticVendor(vendor);
  const garden = await temp(t, "foliage-brain-foreign-");
  await syntheticGarden(garden);
  const paths = brainPaths(await realpath(garden));
  // SYNTHETIC: the owner's own folder that happens to be called brain/, with names Foliage also uses.
  for (const [path, text] of [["old/owner-note.md", "Synthetic owner note.\n"], ["bin/owner-note.md", "Synthetic owner script note.\n"],
    ["people/someone.md", "Synthetic note about a person.\n"], ["manifest.json", JSON.stringify({ leafSha256: "0".repeat(64), harvestSha256: null })]] as const) {
    await mkdir(dirname(join(paths.brain, path)), { recursive: true });
    await writeFile(join(paths.brain, path), text);
  }
  const before = await folderBytes(paths.brain);
  assert.deepEqual(await brainDrift(garden), { behind: false });
  assert.equal(await startBrainRefresh(garden), false);
  const upkeep = brainUpkeep(garden, { vendor });
  upkeep.request();
  await upkeep.idle();
  const cause = "brain/ holds \"people\", which Foliage did not make, so it was left as it is";
  for (const [update, command] of [[buildBrain, "build"], [refreshBrain, "refresh"], [rebuildBrain, "rebuild"]] as const) {
    await assert.rejects(update({ garden, vendor }), (error: unknown) => error instanceof LocalBrainError
      && brainLine(brainFailure(error)) === `Brain: broken: ${cause}. Run foliage brain ${command} after you move that out of brain/`, command);
    await assert.rejects(update({ garden, vendor, unattended: true }), LocalBrainError);
  }
  const line = `Brain: broken: ${cause}. Run foliage brain build after you move that out of brain/`;
  assert.equal(brainLine(await brainStatus({ garden, vendor })), line);
  assert.equal(brainLine(await brainGlance({ garden, vendor })), line);
  // A search's answer may go to an agent, so it names nothing in the owner's folder (item 6); status does.
  const answer = await searchLocalBrain({ garden, vendor }, "quillwort", 5);
  assert.ok(!("state" in answer));
  assert.equal(answer.because, "Brain: broken: brain/ holds something Foliage did not make, so it was left as it is. Run foliage brain status to see what it is");
  assert.ok(!JSON.stringify(answer).includes("people"));
  await assert.rejects(removeBrain({ garden }), /so nothing was removed/);
  assert.deepEqual(await folderBytes(paths.brain), before, "byte for byte, with no lock, note or new folder");
});

test("the triggers refuse the owner's own ~/brain before anything there is read, though it looks like a brain one record behind", async t => {
  const vendor = await temp(t, "foliage-brain-owner-drift-vendor-");
  await syntheticVendor(vendor);
  /** SYNTHETIC: a home that is also a garden, whose brain/ looks like Foliage's, one record behind. */
  const layout = async (root: string) => {
    await syntheticGarden(root);
    for (const [path, text] of [["brain/manifest.json", JSON.stringify({ leafSha256: "0".repeat(64), harvestSha256: null })],
      ["brain/home/keep.txt", "synthetic\n"], ["brain/pages/foliage/owner-note.md", "Synthetic owner note.\n"]] as const) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
  };
  // Control: anywhere else this layout is behind, so only the owner rule keeps the triggers away.
  const elsewhere = await realpath(await temp(t, "foliage-brain-owner-drift-elsewhere-"));
  await layout(elsewhere);
  assert.deepEqual(await brainDrift(elsewhere), { behind: true });
  const fakeHome = await realpath(await temp(t, "foliage-brain-owner-drift-home-"));
  await layout(fakeHome);
  const before = await folderBytes(fakeHome);
  const savedHome = process.env["HOME"];
  t.after(() => { if (savedHome === undefined) delete process.env["HOME"]; else process.env["HOME"] = savedHome; });
  process.env["HOME"] = fakeHome;
  assert.equal(homedir(), fakeHome);
  assert.deepEqual(await brainDrift(fakeHome), { behind: false });
  assert.equal(await startBrainRefresh(fakeHome), false);
  let refreshed = 0;
  const upkeep = brainUpkeep(fakeHome, { vendor, refresh: async () => { refreshed += 1; } });
  upkeep.request();
  await upkeep.idle();
  assert.equal(refreshed, 0);
  if (savedHome === undefined) delete process.env["HOME"]; else process.env["HOME"] = savedHome;
  assert.deepEqual(await folderBytes(fakeHome), before, "nothing there was changed, made, locked or removed");
});

test("a refresh nobody asked for by name leaves a brain an earlier check refused for the owner to rebuild; the owner's own refresh still rebuilds it", async t => {
  const vendor = await temp(t, "foliage-brain-refused-vendor-");
  await syntheticVendor(vendor);
  const garden = await temp(t, "foliage-brain-refused-");
  await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  const cause = "the brain's database named provider_base_urls.ollama, now removed; it stays unused until rebuilt";
  await writeFile(paths.refused, `${JSON.stringify({ cause })}\n`);
  const before = await folderBytes(paths.brain);
  assert.deepEqual(await brainDrift(garden), { behind: false }, "no trigger starts one");
  await assert.rejects(refreshBrain({ garden, vendor, unattended: true }), (error: unknown) => error instanceof LocalBrainError && error.state === "broken" && error.message === cause);
  assert.deepEqual(await folderBytes(paths.brain), before, "nothing moved, removed or noted");
  assert.equal(brainLine(await brainGlance({ garden, vendor })), `Brain: broken: ${cause}. Run foliage brain rebuild`);
  // The owner's own refresh goes on to the rebuild, as before (stopped where its first process would start).
  const steps: string[] = [];
  await assert.rejects(refreshBrain({ garden, vendor }, { observe: step => { steps.push(step); if (step === "rebuild") throw new Error("synthetic stop"); } }), /synthetic stop/);
  assert.deepEqual(steps, ["rebuild"]);
});

test("a failed refresh's note names the record it tried, not one saved while it ran; a busy lock never holds the triggers back", async t => {
  const vendor = await temp(t, "foliage-brain-tried-vendor-");
  await syntheticVendor(vendor);
  const garden = await temp(t, "foliage-brain-tried-");
  const r1 = await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  const r2 = r1.replace("Synthetic quillwort notes.", "Synthetic quillwort notes, saved while the refresh ran.");
  // The stand-in bun cannot run, so the refresh stops at its import; the owner saves R2 just before.
  await assert.rejects(refreshBrain({ garden, vendor }, { observe: async step => { if (step === "import") await writeFile(join(garden, "leaf.json"), r2); } }),
    (error: unknown) => error instanceof LocalBrainError && error.message === "gbrain import could not run: EACCES");
  const note = JSON.parse(await readFile(paths.refreshFailure, "utf8")) as Record<string, unknown>;
  assert.deepEqual([note["state"], note["leafSha256"]], ["broken", sha(r1)]);
  assert.equal(brainLine(await brainGlance({ garden, vendor })), "Brain: behind your record. Run foliage brain refresh", "R2 has not been tried");
  assert.deepEqual(await brainDrift(garden), { behind: true }, "so a trigger tries it");
  await writeFile(join(garden, "leaf.json"), r1);
  assert.equal(brainLine(await brainGlance({ garden, vendor })), "Brain: behind your record. The last refresh stopped: gbrain import could not run: EACCES. Run foliage brain refresh");
  const drift = await brainDrift(garden);
  assert.ok(drift.behind && typeof drift.stoppedAt === "number", "R1's refresh stopped: the triggers hold back");
  const holder = await holdLockInChild(paths.lock);
  try { await assert.rejects(refreshBrain({ garden, vendor, waitMs: 200 }), (error: unknown) => error instanceof LocalBrainError && error.state === "busy"); }
  finally { await holder.kill(); }
  assert.equal((JSON.parse(await readFile(paths.refreshFailure, "utf8")) as Record<string, unknown>)["state"], "busy");
  assert.deepEqual(await brainDrift(garden), { behind: true }, "busy is tried again");
  assert.equal(await readFile(join(garden, "leaf.json"), "utf8"), r1, "no brain work wrote the record");
});

test("a one-shot search hands its refresh to another process and holds nothing while it runs; it answers through the brain when that finishes within the bound, and never starts one for a rebuild", async t => {
  const vendor = await temp(t, "foliage-brain-elsewhere-vendor-");
  await syntheticVendor(vendor);
  const garden = await temp(t, "foliage-brain-elsewhere-");
  const leafText = await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  let started = 0;
  // A detached refresh that brings the brain up to the record: the search then searches the brain
  // (the stand-in bun cannot run, which is the cause it gives).
  const caughtUp = async () => {
    started += 1;
    assert.equal(await lstat(paths.lock).then(() => true, () => false), false, "the search holds no lock while the refresh runs");
    await manifestFor(garden, leafText);
  };
  const answered = await searchLocalBrain({ garden, vendor, refreshElsewhere: caughtUp }, "quillwort", 5);
  assert.ok(!("state" in answered));
  assert.deepEqual([started, answered.because], [1, "Brain: broken: gbrain call search could not run: EACCES. Run foliage brain rebuild"]);
  // A detached refresh that stopped: the search names why.
  await behindBrain(garden);
  const stopped = async () => {
    await writeFile(paths.refreshFailure, `${JSON.stringify({ state: "broken", cause: "gbrain import exited 1", leafSha256: sha(leafText), harvestSha256: null, at: new Date().toISOString() })}\n`);
  };
  const named = await searchLocalBrain({ garden, vendor, refreshElsewhere: stopped }, "quillwort", 5);
  assert.ok(!("state" in named));
  assert.equal(named.because, "Brain: behind your record. The last refresh stopped: gbrain import exited 1. Run foliage brain refresh");
  // A brain that needs a rebuild: nothing is started, and the search answers at once.
  const before = beforeExclusion(leafText);
  const parsed = parseLeafDocument(JSON.parse(before));
  assert.ok(parsed.ok);
  await manifestFor(garden, "synthetic: an older record", Object.fromEntries(brainProjection({ leaf: parsed.leaf, harvest: null }).pages.map(page => [page.slug, brainManifestPage(page)])));
  started = 0;
  const rebuild = await searchLocalBrain({ garden, vendor, refreshElsewhere: caughtUp }, "quillwort", 5);
  assert.ok(!("state" in rebuild));
  assert.equal(started, 0);
  assert.equal(rebuild.because, "Brain: behind your record. A search does not start a rebuild (a leaflet was newly excluded, so its earlier text must leave the brain). Run foliage brain refresh");
});

test("a one-shot search exits at its bound while the refresh it handed off is still running", async t => {
  const vendor = await temp(t, "foliage-brain-exit-vendor-");
  await syntheticVendor(vendor);
  const garden = await temp(t, "foliage-brain-exit-");
  await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  // A SYNTHETIC stand-in for the detached refresh: a sleeper that refreshes nothing.
  const script = `
    const { spawn } = await import("node:child_process");
    const { searchLocalBrain } = await import(${JSON.stringify(LOCK_MODULE)});
    const answer = await searchLocalBrain({ garden: ${JSON.stringify(garden)}, vendor: ${JSON.stringify(vendor)}, readRefreshMs: 500,
      refreshElsewhere: () => new Promise(resolve => {
        const sleeper = spawn("/bin/sleep", ["30"], { detached: true, stdio: "ignore" });
        process.stdout.write("sleeper " + sleeper.pid + "\\n");
        sleeper.once("exit", resolve); sleeper.once("error", resolve); sleeper.unref();
      }) }, "quillwort", 5);
    process.stdout.write(JSON.stringify(answer) + "\\n");`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", chunk => { out += String(chunk); });
  const code = await new Promise(resolve => child.once("exit", resolve));
  const sleeper = Number(/sleeper (\d+)/.exec(out)?.[1]);
  t.after(() => { try { process.kill(sleeper, "SIGKILL"); } catch { /* already gone */ } });
  assert.equal(code, 0, out);
  assert.ok(Number.isSafeInteger(sleeper) && sleeper > 0, out);
  // Ordering, not a clock: the search's process has exited while the refresh it handed off still runs.
  assert.doesNotThrow(() => process.kill(sleeper, 0), "the handed-off refresh was still running when the search's process exited");
  const answer = JSON.parse(out.split("\n").filter(Boolean).at(-1)!) as { retrieval: string; because: string };
  assert.deepEqual([answer.retrieval, answer.because], ["foliage keyword", "Brain: behind your record, refreshing"]);
  assert.equal(await lstat(paths.lock).then(() => true, () => false), false, "and it left no lock behind");
});

/* ---- build order item 6: foliage search and foliage_search read the brain --------------------- */

/**
 * A SYNTHETIC stand-in for gbrain, run by `scriptedVendor`'s shell "bun", never bun or gbrain: it
 * notes each op and its pid in `marker`, then answers as told. An import exits `importExit`;
 * `list_pages` and `get_page` print the files named; `search` sleeps for 30 s. Anything else exits 1.
 */
function gbrainStandIn(marker: string, { importExit = 0, list, page }: { importExit?: number; list?: string; page?: string } = {}) {
  return `if [ "$6" = call ]; then op="$9"; else op="$6"; fi
/bin/echo "$op $$" >> '${marker}'
case "$op" in
  import) exit ${importExit} ;;
  list_pages) ${list === undefined ? "exit 1" : `exec /bin/cat '${list}'`} ;;
  get_page) ${page === undefined ? "exit 1" : `exec /bin/cat '${page}'`} ;;
  search) exec /bin/sleep 30 ;;
esac
exit 1
`;
}

/** The ops a `gbrainStandIn` was asked, in order, with their pids. */
async function standInRan(marker: string): Promise<{ op: string; pid: number }[]> {
  return (await readFile(marker, "utf8").catch(() => "")).split("\n").filter(Boolean).map(line => {
    const [op, pid] = line.split(" ");
    return { op: op!, pid: Number(pid) };
  });
}

/** The SYNTHETIC garden's pages as Foliage projects them, for a stand-in's `list_pages`. */
function syntheticPages(leafText: string) {
  const parsed = parseLeafDocument(JSON.parse(leafText));
  assert.ok(parsed.ok);
  return brainProjection({ leaf: parsed.leaf, harvest: null }).pages;
}

test("item 6: a search does not redo, on every call, a refresh of the same bytes that stopped, in process or detached; past the triggers' backoff it tries again", async t => {
  const dir = await temp(t, "foliage-brain-backoff-");
  const marker = join(dir, "stand-in-ran");
  const vendor = join(dir, "vendor");
  // The stand-in's import fails, so every refresh of this record stops at its import.
  await scriptedVendor(vendor, gbrainStandIn(marker, { importExit: 1 }));
  const garden = join(dir, "garden");
  await mkdir(garden);
  const leafText = await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  const ops = async () => (await standInRan(marker)).map(ran => ran.op);
  // The first search, in process as `foliage_search` runs it, tries the update in place.
  const first = await searchLocalBrain({ garden, vendor }, "quillwort", 5);
  assert.ok(!("state" in first));
  assert.deepEqual([first.retrieval, first.because], ["foliage keyword", "Brain: broken: gbrain import exited 1. Run foliage brain rebuild"]);
  assert.deepEqual(await ops(), ["import"]);
  // The next ones, in process and one-shot alike, start nothing and say why at once.
  const stopped = "Brain: behind your record. The last refresh stopped: gbrain import exited 1. Run foliage brain refresh";
  let handedOff = 0;
  for (const more of [{}, { refreshElsewhere: async () => { handedOff += 1; } }, {}]) {
    const again = await searchLocalBrain({ garden, vendor, ...more }, "quillwort", 5);
    assert.ok(!("state" in again));
    assert.deepEqual([again.retrieval, again.because, again.hits.map(hit => hit.id)], ["foliage keyword", stopped, ["leaflet:one", "leaflet:outside"]]);
  }
  assert.deepEqual([await ops(), handedOff], [["import"], 0], "no process started and no refresh was handed off");
  // The searches did not move the note on, so they never push the triggers' backoff back.
  const note = JSON.parse(await readFile(paths.refreshFailure, "utf8")) as Record<string, unknown>;
  const drift = await brainDrift(garden);
  assert.equal(drift.stoppedAt, Date.parse(String(note["at"])));
  // Past the backoff a search tries once more, and the record moving on is tried at once.
  await writeFile(paths.refreshFailure, JSON.stringify({ ...note, at: new Date(Date.now() - STOPPED_RETRY_MS - 1_000).toISOString() }));
  await searchLocalBrain({ garden, vendor }, "quillwort", 5);
  assert.deepEqual(await ops(), ["import", "import"]);
  await writeFile(join(garden, "leaf.json"), leafText.replace("Synthetic quillwort notes.", "Synthetic quillwort notes, edited."));
  await searchLocalBrain({ garden, vendor }, "quillwort", 5);
  assert.deepEqual(await ops(), ["import", "import", "import"]);
});

test("item 6: a search whose update in place ran and found it needs a rebuild writes that down, so the next search answers at once; the triggers still go on to the rebuild", async t => {
  const dir = await temp(t, "foliage-brain-needs-rebuild-");
  const marker = join(dir, "stand-in-ran");
  const garden = join(dir, "garden");
  await mkdir(garden);
  const leafText = await syntheticGarden(garden);
  // gbrain lists every page Foliage wrote, but one of them deleted: only a rebuild brings that back.
  const list = join(dir, "list.json");
  await writeFile(list, JSON.stringify(syntheticPages(leafText).map((page, index) => ({ slug: page.slug, deleted_at: index === 0 ? "2026-10-10T00:00:00Z" : null }))));
  const vendor = join(dir, "vendor");
  await scriptedVendor(vendor, gbrainStandIn(marker, { list }));
  const paths = await behindBrain(garden);
  const line = "Brain: behind your record. A search does not start a rebuild (a page the brain should hold was deleted by a refresh that did not finish). Run foliage brain refresh";
  const first = await searchLocalBrain({ garden, vendor }, "quillwort", 5);
  assert.ok(!("state" in first));
  assert.deepEqual([first.retrieval, first.because], ["foliage keyword", line]);
  assert.deepEqual((await standInRan(marker)).map(ran => ran.op), ["import", "list_pages"], "the update in place ran");
  assert.equal((JSON.parse(await readFile(paths.refreshFailure, "utf8")) as Record<string, unknown>)["state"], "behind");
  for (const more of [{}, { refreshElsewhere: async () => assert.fail("a search handed off a refresh it knows needs a rebuild") }]) {
    const again = await searchLocalBrain({ garden, vendor, ...more }, "quillwort", 5);
    assert.ok(!("state" in again));
    assert.deepEqual([again.retrieval, again.because], ["foliage keyword", line]);
  }
  assert.equal((await standInRan(marker)).length, 2, "no process started again");
  assert.equal(brainLine(await brainGlance({ garden, vendor })), line, "foliage status says the same");
  assert.deepEqual(await brainDrift(garden), { behind: true }, "the triggers are not held back: their refresh rebuilds");
  // The refresh a one-shot search hands off is the same: in place only, never a rebuild, and it says why.
  await rm(paths.refreshFailure);
  await assert.rejects(refreshForSearch({ garden, vendor }, { observe: step => { if (step === "rebuild") assert.fail("a search's refresh started a rebuild"); } }),
    (error: unknown) => error instanceof LocalBrainError && brainLine(brainFailure(error)) === line);
  assert.equal((JSON.parse(await readFile(paths.refreshFailure, "utf8")) as Record<string, unknown>)["state"], "behind");
  // The owner's own refresh goes on to the rebuild (stopped where its first process would start).
  const steps: string[] = [];
  await assert.rejects(refreshBrain({ garden, vendor }, { observe: step => { steps.push(step); if (step === "rebuild") throw new Error("synthetic stop"); } }), /synthetic stop/);
  assert.equal(steps.at(-1), "rebuild");
});

test("item 6: gbrain's own search has a short bound, so a stuck brain gives Foliage's own answer, not a two-minute wait", async t => {
  const dir = await temp(t, "foliage-brain-search-bound-");
  const marker = join(dir, "stand-in-ran");
  const vendor = join(dir, "vendor");
  // The stand-in's search sleeps for 30 s.
  await scriptedVendor(vendor, gbrainStandIn(marker));
  const garden = join(dir, "garden");
  await mkdir(garden);
  const leafText = await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  await manifestFor(garden, leafText);
  for (const [options, seconds] of [[{ readSearchMs: 1_000 }, 1], [{}, 5]] as const) {
    const answer = await searchLocalBrain({ garden, vendor, ...options }, "quillwort", 5);
    assert.ok(!("state" in answer));
    assert.deepEqual([answer.retrieval, answer.because, answer.hits.map(hit => hit.id)],
      ["foliage keyword", `Brain: broken: gbrain call search did not finish within ${seconds} s. Run foliage brain rebuild`, ["leaflet:one", "leaflet:outside"]]);
    // Ordering, not a clock: the 30-second search was stopped before the answer, and the lock let go.
    const search = (await standInRan(marker)).at(-1)!;
    assert.equal(search.op, "search");
    assert.throws(() => process.kill(search.pid, 0), (error: unknown) => (error as { code?: string }).code === "ESRCH", "the stuck search was stopped");
    assert.equal(await lstat(paths.lock).then(() => true, () => false), false);
  }
  assert.equal(await lstat(paths.refreshFailure).then(() => true, () => false), false, "a search of a current brain writes nothing to it");
});

test("item 6: no answer of a search through the brain names a page address or a garden path, though gbrain's own answers hold them, on the failure paths too", async t => {
  const dir = await temp(t, "foliage-brain-no-address-");
  const garden = join(dir, "garden");
  await mkdir(garden);
  const leafText = await syntheticGarden(garden);
  const pages = syntheticPages(leafText);
  const forbidden = /foliage\/[0-9a-f]{64}|"slug"|"score"|"page_id"/;
  // Each stand-in answers with gbrain's own fields and page addresses, then fails a different check.
  const cases = [
    { line: "Brain: broken: the brain holds another text of a page Foliage wrote. Run foliage brain rebuild",
      list: pages.map(page => ({ slug: page.slug, deleted_at: null, page_id: 7, score: 0.9 })),
      page: { slug: pages[0]!.slug, page_id: 7, score: 0.9, frontmatter: { foliage_digest: "0".repeat(64) } } },
    { line: "Brain: broken: the brain is missing 1 of the pages Foliage wrote. Run foliage brain rebuild",
      list: pages.slice(1).map(page => ({ slug: page.slug, deleted_at: null, page_id: 7, score: 0.9 })) },
  ];
  for (const [index, example] of cases.entries()) {
    const marker = join(dir, `stand-in-ran-${index}`), list = join(dir, `list-${index}.json`), page = join(dir, `page-${index}.json`);
    await writeFile(list, JSON.stringify(example.list));
    if (example.page) await writeFile(page, JSON.stringify(example.page));
    const vendor = join(dir, `vendor-${index}`);
    await scriptedVendor(vendor, gbrainStandIn(marker, { list, ...(example.page ? { page } : {}) }));
    const paths = await behindBrain(garden);
    await rm(paths.refreshFailure, { force: true });
    // As a process that stays up runs it, the refresh in process (the MCP server's path once local
    // embeddings bring foliage_search to the brain; in keyword mode only `foliage brain search` reads it).
    const answer = await searchLocalBrain({ garden, vendor }, "quillwort", 5);
    assert.ok(!("state" in answer));
    assert.deepEqual([answer.retrieval, answer.because], ["foliage keyword", example.line]);
    const text = JSON.stringify(answer);
    assert.doesNotMatch(text, forbidden);
    assert.ok(!text.includes(garden) && !text.includes(await realpath(garden)) && !text.includes(dir));
    // Control: gbrain's own answers did hold them.
    assert.match(await readFile(list, "utf8"), forbidden);
    // The note `foliage status` reads is free of them too.
    assert.doesNotMatch(await readFile(paths.refreshFailure, "utf8"), /foliage\/[0-9a-f]{64}/);
  }
});

test("item 6: --in-place belongs to brain refresh, and is refused before anything is read or started", async t => {
  const garden = await temp(t, "foliage-brain-in-place-flag-");
  const cli = fileURLToPath(new URL("../brain.mjs", import.meta.url));
  for (const action of ["build", "rebuild", "status", "remove"]) {
    const ran = await new Promise<{ code: number | null; stderr: string }>(resolve => {
      const child = spawn(process.execPath, [cli, action, "--in-place", "--garden", garden], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += String(chunk); });
      child.once("close", code => resolve({ code, stderr }));
    });
    assert.deepEqual(ran, { code: 1, stderr: "foliage brain: --in-place belongs to brain refresh.\n" }, action);
  }
  assert.deepEqual(await readdir(garden), [], "nothing was made");
});

test("keyword mode: foliage search and foliage_search answer from Foliage's own search beside a behind or busy brain, waiting for nothing and touching nothing under brain/", async t => {
  const garden = await temp(t, "foliage-brain-keyword-reads-");
  await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  const into = join(garden, "leaf.json"), out = join(garden, "harvest.json");
  const before = await folderBytes(paths.brain);
  const expected = { subject: { leafId: "synthetic-brain-search", name: "Synthetic subject" }, retrieval: "foliage keyword",
    because: "Keyword mode: Foliage's own keyword search answers here; foliage brain search searches the local brain", hits: ["leaflet:one", "leaflet:outside"] };
  const asked = async () => {
    const answer = await searchLocalGarden(into, out, "quillwort", 5);
    assert.ok(!("state" in answer));
    return { ...answer, hits: answer.hits.map(hit => hit.id) };
  };
  // A brain one record behind: a search through it would refresh it first. This one asks nothing of it.
  assert.deepEqual(await asked(), expected);
  // Another process holds the brain lock as a refresh does: a search through the brain would wait
  // for it, then answer "refreshing". This one answers while the lock is still held.
  const holder = await holdLockInChild(paths.lock, true);
  try {
    assert.deepEqual(await asked(), expected);
    assert.equal((JSON.parse(await readlink(paths.lock)) as { pid: number }).pid, holder.pid, "answered while the other process still held the lock");
  } finally { await holder.kill(); }
  await rm(paths.lock, { force: true });
  assert.deepEqual(await folderBytes(paths.brain), before, "no lock, note, page or manifest was written under brain/");
  // Control: a search through the brain (`foliage brain search`, here in process) does work on this
  // same brain: it starts the stand-in "bun" to bring the brain up to the record.
  const vendor = await temp(t, "foliage-brain-keyword-reads-vendor-");
  const marker = join(vendor, "stand-in-ran");
  await scriptedVendor(vendor, gbrainStandIn(marker, { importExit: 1 }));
  const throughBrain = await searchLocalBrain({ garden, vendor }, "quillwort", 5);
  assert.ok(!("state" in throughBrain));
  assert.deepEqual([throughBrain.retrieval, throughBrain.because], ["foliage keyword", "Brain: broken: gbrain import exited 1. Run foliage brain rebuild"]);
  assert.deepEqual((await standInRan(marker)).map(ran => ran.op), ["import"]);
});

test("every brain command checks the whole staged runtime as status does: a file changed, added or gone anywhere in vendor/ is refused by name, and a search answers from Foliage's own search naming it", async t => {
  const { embedBrain, runtimeStatus } = await import("./localBrain.ts");
  const garden = await temp(t, "foliage-brain-whole-runtime-");
  const leafText = await syntheticGarden(garden);
  const vendor = await temp(t, "foliage-brain-whole-runtime-vendor-");
  await syntheticVendor(vendor);
  // A brain current at a glance, so only the runtime check can stop a command.
  await behindBrain(garden);
  await manifestFor(garden, leafText);
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "current" });
  assert.deepEqual(await runtimeStatus(vendor), { state: "off" });
  const pristine = await readFile(join(vendor, "gbrain", "LICENSE"));
  // Files neither bun nor src/cli.ts: the 0.3.0 candidate checked only those two outside status.
  for (const [change, cause] of [
    [() => writeFile(join(vendor, "gbrain", "LICENSE"), "synthetic licence stand-in, one byte changed\n"), "vendor/gbrain/LICENSE differs from what was staged"],
    [() => writeFile(join(vendor, "gbrain", "planted.ts"), "// SYNTHETIC: a file nobody staged\n"), "vendor/gbrain/planted.ts was not staged"],
    [() => unlink(join(vendor, "gbrain", "LICENSE")), "vendor/gbrain/LICENSE is missing"],
  ] as const) {
    await change();
    const broken = { state: "broken", cause, fix: "node tools/brain/stage-gbrain.mjs" };
    assert.deepEqual(await brainStatus({ garden, vendor }), broken, cause);
    assert.deepEqual(await brainGlance({ garden, vendor }), broken, `${cause}, at a glance`);
    assert.deepEqual(await runtimeStatus(vendor), broken, `${cause}, after a remove`);
    for (const update of [buildBrain, refreshBrain, rebuildBrain, refreshForSearch]) {
      await assert.rejects(update({ garden, vendor }), (error: unknown) => error instanceof LocalBrainError && error.state === "broken" && error.message === cause,
        `${update.name}: ${cause}`);
    }
    // Turning local embeddings on checks the runtime before any embedder is asked.
    await assert.rejects(embedBrain({ garden, vendor }, { model: "synthetic-model", port: 9 }),
      (error: unknown) => error instanceof LocalBrainError && error.state === "broken" && error.message === cause);
    const answer = await searchLocalBrain({ garden, vendor }, "quillwort", 5);
    assert.ok(!("state" in answer));
    assert.deepEqual([answer.retrieval, answer.because, answer.hits.map(hit => hit.id)],
      ["foliage keyword", `Brain: broken: ${cause}. Run node tools/brain/stage-gbrain.mjs`, ["leaflet:one", "leaflet:outside"]]);
    await rm(join(vendor, "gbrain", "planted.ts"), { force: true });
    await writeFile(join(vendor, "gbrain", "LICENSE"), pristine);
  }
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "current" }, "the pinned tree put back is current again");
  assert.equal(await readFile(join(garden, "leaf.json"), "utf8"), leafText);
  assert.equal(await lstat(brainPaths(await realpath(garden)).refreshFailure).then(() => true, () => false), false, "a refused runtime notes no refresh failure in the garden");
});

/* ---- B3: status reads the settings back only when something other than Foliage opened the database ---- */

/**
 * A SYNTHETIC stand-in for gbrain, run by `scriptedVendor`'s shell "bun", never bun or gbrain: it
 * notes each command, and, as every PGLite process does, writes the database (one file's times).
 * `config get` answers Foliage's value, or for search.mode what `planted` holds; `config unset`
 * finds nothing; `search` answers an empty list.
 */
function settingsStandIn(marker: string, planted: string) {
  return `if [ "$6" = call ]; then op="$9"; else op="$6 $7 $8$9"; fi
/bin/echo "$op" >> '${marker}'
/usr/bin/touch "$GBRAIN_HOME/.gbrain/brain.pglite/pg_control"
case "$6 $7" in
  "config get") case "$8" in
    search.mode) if [ -f '${planted}' ]; then /bin/cat '${planted}'; else /bin/echo conservative; fi ;;
    search.mcp_keyword_only) /bin/echo true ;;
    *) /bin/echo false ;;
  esac; exit 0 ;;
  "config unset") /bin/echo "No keys match prefix \\"$9\\"."; exit 0 ;;
  "call --source") /bin/echo "[]"; exit 0 ;;
esac
exit 1
`;
}

test("B3: status reads every setting back once, then only after something other than Foliage has opened the database; Foliage's own processes keep the record; --deep always reads them", async t => {
  const dir = await realpath(await temp(t, "foliage-brain-settings-check-"));
  const marker = join(dir, "stand-in-ran"), planted = join(dir, "planted-search-mode");
  const vendor = join(dir, "vendor");
  await scriptedVendor(vendor, settingsStandIn(marker, planted));
  const garden = join(dir, "garden");
  await mkdir(garden);
  const leafText = await syntheticGarden(garden);
  const paths = await behindBrain(garden);
  await manifestFor(garden, leafText);
  await mkdir(paths.database, { recursive: true });
  await writeFile(join(paths.database, "pg_control"), "SYNTHETIC database file\n");
  const ran = async () => {
    const lines = (await readFile(marker, "utf8").catch(() => "")).split("\n").filter(Boolean);
    await rm(marker, { force: true });
    return lines;
  };
  const readBack = ["config get search.mode", "config get search.reranker.enabled", "config get search.mcp_keyword_only", "config get search.cache.enabled",
    "config get search.track_retrieval", "config get facts.extraction_enabled", "config get autopilot.auto_drain.enabled", "config get auto_link",
    "config get auto_timeline", "config unset --patternprovider_base_urls.", "config unset --patternmodels."];

  // No record yet: every setting is read back, and the database as it then is is recorded.
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "current" });
  assert.deepEqual(await ran(), readBack);
  const recorded = JSON.parse(await readFile(paths.settingsCheck, "utf8")) as Record<string, unknown>;
  assert.deepEqual([recorded["schemaVersion"], recorded["mode"], recorded["gbrain"], typeof recorded["database"]], [1, "keyword", GBRAIN_PIN.commit, "string"]);
  // Nothing has opened it since: status starts no process.
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "current" });
  assert.deepEqual(await ran(), []);
  // A search is Foliage's own process: it writes the database, and the record follows it.
  const searched = await searchLocalBrain({ garden, vendor }, "quillwort", 5);
  assert.ok(!("state" in searched) && searched.retrieval === "brain keyword", JSON.stringify(searched));
  assert.deepEqual(await ran(), ["search"]);
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "current" });
  assert.deepEqual(await ran(), [], "status after Foliage's own search starts nothing");
  // --deep reads them all back whatever the record says.
  assert.deepEqual(await brainStatus({ garden, vendor, deep: true }), { state: "current" });
  assert.deepEqual(await ran(), readBack);
  // Something else opened the database (here, its file's times moved): status reads every setting back.
  await writeFile(join(paths.database, "pg_control"), "SYNTHETIC database file\n");
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "current" });
  assert.deepEqual(await ran(), readBack);
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "current" });
  assert.deepEqual(await ran(), []);
  // Something else set a setting: it opened the database, so status reads back and names it, and nothing is recorded.
  await writeFile(planted, "balanced\n");
  await writeFile(join(paths.database, "pg_control"), "SYNTHETIC database file, written by another process\n");
  assert.equal(brainLine(await brainStatus({ garden, vendor })), "Brain: broken: the brain's search.mode setting does not read back as conservative. Run foliage brain rebuild");
  assert.deepEqual(await ran(), ["config get search.mode"]);
  assert.equal(await lstat(paths.settingsCheck).then(() => true, () => false), false, "a failed read-back leaves no record");
  assert.equal(brainLine(await brainStatus({ garden, vendor })), "Brain: broken: the brain's search.mode setting does not read back as conservative. Run foliage brain rebuild");
  assert.deepEqual(await ran(), ["config get search.mode"], "without a record every status reads back");
  // The checks a process would make still run when the record holds: a planted .env in work/ is named, with nothing started.
  await rm(planted);
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "current" });
  assert.deepEqual(await ran(), readBack);
  await writeFile(join(paths.work, ".env"), "SYNTHETIC=planted\n");
  assert.equal(brainLine(await brainStatus({ garden, vendor })), "Brain: broken: brain/work is not empty, and bun would read a .env or bunfig.toml there. Run foliage brain rebuild");
  assert.deepEqual(await ran(), []);
  await rm(join(paths.work, ".env"));
  // A record written for another gbrain, another mode or by hand is no record.
  await writeFile(paths.settingsCheck, `${JSON.stringify({ ...recorded, gbrain: "0".repeat(40) })}\n`);
  assert.deepEqual(await brainStatus({ garden, vendor }), { state: "current" });
  assert.deepEqual(await ran(), readBack);
  // remove takes the record with the brain.
  await removeBrain({ garden });
  assert.deepEqual(await readdir(garden), ["leaf.json"]);
});
