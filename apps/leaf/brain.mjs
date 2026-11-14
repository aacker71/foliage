#!/usr/bin/env node
/**
 * foliage brain build|refresh|rebuild|status|remove|search|embed — this garden's local brain (unit 38).
 * The root `foliage` command supplies --garden. The brain lives at <garden>/brain/ and runs the
 * gbrain and bun in vendor/ beside apps/: staged in a checkout (node tools/brain/stage-gbrain.mjs),
 * or installed with Foliage from its download, where it sits in vendor/ beside runtime/ (node
 * install.mjs installs it by default; --add-brain adds it to an install made without it).
 * Nothing here leaves this machine: with local embeddings on (`embed --local ollama:<model>`, build
 * order item 8) the only address asked is the owner's own embedder on 127.0.0.1, and no model is
 * ever downloaded.
 */
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { requireNodeFloor } from "./src/nodeFloor.mjs";
requireNodeFloor();

const VENDOR = fileURLToPath(new URL("../../vendor", import.meta.url));
/** This copy's folder: its launcher, its installer, and the vendor/ beside apps/. */
const ROOT = dirname(VENDOR);
const ACTIONS = ["build", "refresh", "rebuild", "status", "remove", "search", "embed"];
const USAGE = "Usage: foliage brain build|refresh|rebuild|status|remove [--garden <path>]\n"
  + "       foliage brain status --deep [--garden <path>]\n"
  + "       foliage brain search <words> [--limit 1–10] [--garden <path>]\n"
  + "       foliage brain embed --local ollama:<model> [--port <n>] | --off [--garden <path>]\n"
  + "build: makes this garden's brain from its record, or brings it up to date. refresh: brings an existing brain up to date.\n"
  + "refresh --background: what Foliage starts after a command that changes your record; it waits for another refresh to finish,\n"
  + "  and leaves a brain an earlier check refused for you to rebuild.\n"
  + "refresh --in-place: only an update in place, never a rebuild; what a search starts. A brain that needs a rebuild stays behind, saying why.\n"
  + "rebuild: makes a new brain beside the old one and swaps it in. status: one line saying whether it is current.\n"
  + "status --deep: also reads every database setting back with gbrain (several seconds), which status otherwise does\n"
  + "  only when something other than Foliage has opened the brain's database since its settings were last read back.\n"
  + "remove: deletes the brain. search: searches your record through the brain, or without it, saying why.\n"
  + "embed --local: turns on local embeddings with a model your own Ollama on this machine already holds (127.0.0.1, port 11434\n"
  + "  unless --port says otherwise). Foliage never downloads a model and refuses Ollama cloud models. foliage search and\n"
  + "  foliage_search then read the brain. embed --off: back to keyword search, the default. Either rebuilds the brain.\n"
  + "The brain is derived data at <garden>/brain/; deleting it loses nothing (and turns local embeddings off). Nothing leaves this machine.\n";

try {
  const parsed = parseArgs({ args: process.argv.slice(2), options: {
    garden: { type: "string" }, limit: { type: "string" }, background: { type: "boolean" }, "in-place": { type: "boolean" },
    local: { type: "string" }, port: { type: "string" }, off: { type: "boolean" }, deep: { type: "boolean" }, help: { type: "boolean", short: "h" },
  }, allowPositionals: true, strict: true, tokens: true });
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new Error(`Duplicate --${token.name} is refused.`);
    seen.add(token.name);
  }
  const [action, ...extra] = parsed.positionals;
  if (parsed.values.help || action === undefined) {
    process.stdout.write(USAGE);
    if (action === undefined && !parsed.values.help) process.exitCode = 2;
  } else {
    if (!ACTIONS.includes(action) || (action !== "search" && extra.length > 0)) {
      throw new Error(`Unknown brain command ${JSON.stringify([action, ...extra].join(" "))}. Use ${ACTIONS.join(", ")}.`);
    }
    if (parsed.values.limit !== undefined && action !== "search") throw new Error("--limit belongs to brain search.");
    if (parsed.values.background && action !== "refresh") throw new Error("--background belongs to brain refresh.");
    if (parsed.values["in-place"] && action !== "refresh") throw new Error("--in-place belongs to brain refresh.");
    if (parsed.values.deep && action !== "status") throw new Error("--deep belongs to brain status.");
    if ((parsed.values.local !== undefined || parsed.values.port !== undefined || parsed.values.off) && action !== "embed") throw new Error("--local, --port and --off belong to brain embed.");
    if (action === "embed" && (parsed.values.local === undefined) === !parsed.values.off) throw new Error("brain embed needs exactly one of --local ollama:<model> or --off.");
    if (parsed.values.off && parsed.values.port !== undefined) throw new Error("--port belongs to brain embed --local.");
    if (!parsed.values.garden?.trim()) throw new Error("An explicit --garden is required.");
    const garden = resolve(parsed.values.garden);
    const brain = await import("./src/localBrain.ts");
    const brainUpkeep = await import("./src/brainUpkeep.ts");
    // A background refresh runs behind a command that already answered, so it waits for another
    // refresh to finish instead of failing busy, and leaves a refused brain for the owner to
    // rebuild; its failure is written down in the brain either way.
    const options = { garden, vendor: VENDOR, ...(parsed.values.background ? { waitMs: brainUpkeep.BACKGROUND_LOCK_WAIT_MS, unattended: true } : {}) };
    // The owner's own terminal: in an installed copy, which puts no `foliage` on PATH, or under the
    // launcher that names itself (FOLIAGE_LAUNCHER, as `foliage watch` and the server are given it),
    // every fix and hint is printed as the whole command, node and this copy's foliage.mjs by
    // absolute path and --garden this garden, so it runs as printed from any directory. Run in a
    // checkout without it, the fixes keep their short form. A search's answer keeps it always: it
    // is the same answer foliage_search gives, and no garden path goes to an agent.
    const named = process.env["FOLIAGE_LAUNCHER"]?.trim();
    /** @type {import("./src/localBrain.ts").OwnerTerminal | null} */
    const terminal = named && isAbsolute(named) ? { node: process.execPath, launcher: named, root: ROOT, garden }
      : await brain.installedRuntime(VENDOR) ? { node: process.execPath, launcher: join(ROOT, "foliage.mjs"), root: ROOT, garden } : null;
    /** @param {string} fix */
    const fixFor = (fix) => terminal === null ? fix : brain.ownerFix(fix, terminal);
    /** The status line as the owner reads it. @param {import("./src/localBrain.ts").BrainStatus} status */
    const line = (status) => brain.brainLine(terminal === null ? status : brain.ownerStatus(status, terminal));
    /** Why a brain is off, and what makes one: its own fix, or growing the record first. @param {import("./src/localBrain.ts").BrainStatus} status */
    const offHint = (status) => {
      if (status.state !== "off" || !status.cause) return;
      process.stderr.write(status.fix ? `${status.cause}. Run ${fixFor(status.fix)}\n`
        : `${status.cause}. Grow it first: ${terminal === null ? "foliage grow" : brain.ownerGrow(terminal)}\n`);
    };
    if (action === "embed") {
      const { embedderPort, embeddingWords, localEmbedder, LocalEmbeddingRefusal } = await import("@foliage/photosynthesis");
      /** The brain and the owner's choice are as they were: say why, and change nothing. @param {Error & { fix?: string | undefined }} error */
      const unchanged = (error) => {
        process.stderr.write(`foliage brain: nothing changed: ${error.message}.${error.fix ? ` Run ${fixFor(error.fix)}` : ""}\n`);
        process.exitCode = 1;
      };
      /** @type {{ model: string, port: number } | null} */
      let want = null;
      try {
        // Refused before anything is asked: a provider other than ollama, a name Ollama gives its
        // cloud models, a port out of range. Pure (`brainEmbedding.ts`).
        if (!parsed.values.off) want = { model: localEmbedder(String(parsed.values.local)).model, port: embedderPort(parsed.values.port) };
      } catch (error) {
        if (!(error instanceof LocalEmbeddingRefusal)) throw error;
        unchanged(error);
      }
      if (process.exitCode !== 1) {
        /** @type {import("./src/localBrain.ts").BrainStatus | null} */
        let status = null;
        let words = "";
        try {
          const done = await brain.embedBrain(options, want);
          // Off with no usable runtime: the choice is gone all the same, and the line says why the brain was not rebuilt yet.
          status = done.runtime ?? (done.brain ? { state: "current" } : { state: "off" });
          words = done.embedding === null ? "Local embeddings: off. foliage search and foliage_search answer from Foliage's own search."
            : `Local embeddings: on (${embeddingWords(done.embedding)}). foliage search and foliage_search read the brain.`;
        } catch (error) {
          // Refused before anything was written (`EmbeddingRefused`): the embedder, the model or a cloud entry.
          if (error instanceof brain.EmbeddingRefused) unchanged(error);
          else if (error instanceof brain.LocalBrainError) status = brain.brainFailure(error);
          else throw error;
        }
        if (status !== null) {
          process.stdout.write(`${line(status)}\n`);
          if (words) process.stdout.write(`${words}\n`);
          // The same whole commands as every other brain command: an installed copy's --add-brain, a checkout's staging tool.
          if (status.state === "not-installed") process.stderr.write(brain.notInstalledAdvice(await brain.installedRuntime(VENDOR), ROOT));
          offHint(status);
          const turnedOff = want === null && words !== "" && (status.state === "not-installed" || (status.state === "off" && !status.cause));
          if (!(status.state === "current" || turnedOff)) process.exitCode = 1;
        }
      }
    } else if (action === "search") {
      const query = extra.join(" ").trim();
      if (!query) throw new Error("Search needs words.");
      const limit = parsed.values.limit === undefined ? 8 : Number(parsed.values.limit);
      // This command ends once it answers, so a brain behind the record is refreshed by a detached
      // process: the answer comes at the bound at the latest, and the refresh finishes on its own.
      const answer = await brain.searchLocalBrain({ ...options, refreshElsewhere: () => brainUpkeep.refreshDetached(garden) }, query, limit);
      process.stdout.write(`${JSON.stringify(answer, null, 2)}\n`);
    } else {
      /** @type {import("./src/localBrain.ts").BrainStatus} */
      let status;
      if (action === "status") status = await brain.brainStatus({ ...options, ...(parsed.values.deep ? { deep: true } : {}) });
      else {
        try {
          // Removing needs no runtime; the line after it says the runtime's state as status would.
          if (action === "remove") { await brain.removeBrain(options); status = await brain.runtimeStatus(VENDOR); }
          else {
            const update = action === "build" ? brain.buildBrain : action === "rebuild" ? brain.rebuildBrain
              : parsed.values["in-place"] ? brain.refreshForSearch : brain.refreshBrain;
            await update(options);
            status = { state: "current" };
          }
        } catch (error) {
          if (!(error instanceof brain.LocalBrainError)) throw error;
          status = brain.brainFailure(error);
        }
      }
      process.stdout.write(`${line(status)}\n`);
      // With local embeddings on, status says so on a line of its own; keyword mode, the default, adds nothing.
      if (action === "status") {
        const choice = await brain.localEmbeddingChoice(garden);
        if (choice.state === "on") process.stdout.write(`Local embeddings: on (${(await import("@foliage/photosynthesis")).embeddingWords(choice.choice)})\n`);
      }
      // The owner's own terminal, so the whole command, with this install's folder in it.
      if (status.state === "not-installed") process.stderr.write(brain.notInstalledAdvice(await brain.installedRuntime(VENDOR), ROOT));
      offHint(status);
      const fine = ["current", "behind"].includes(status.state)
        || ((action === "status" || action === "remove") && ["off", "not-installed"].includes(status.state));
      if (!fine) process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(`foliage brain: ${error instanceof Error ? error.message : "Brain command failed."}\n`);
  process.exitCode = 1;
}
