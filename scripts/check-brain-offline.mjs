#!/usr/bin/env node
/**
 * THE BRAIN OFFLINE GATE — the local brain reaches nothing outside this machine (unit 38, build
 * order item 4; spec PR #201). `pnpm check` runs it, in CI and on a developer's machine alike.
 *
 *   node tools/brain/stage-gbrain.mjs     # once per checkout: stages the pinned gbrain and bun
 *   node scripts/check-brain-offline.mjs
 *
 * It runs `foliage brain build|status|search|refresh|remove`, the real `foliage` launcher (its
 * actions, `foliage up`, MCP sessions, `foliage search`) and gbrain's own read ops against the
 * staged, pinned gbrain, with a throwaway HOME, GBRAIN_HOME and gardens and every network switch
 * planted: the offline proofs of build order items 2 to 6 (`tools/brain/offline-proofs.mjs`) and 8
 * (`tools/brain/offline-embeddings.mjs`: local embeddings on and off through a loopback stand-in
 * embedder, each such step allowed one 127.0.0.1 port and nothing else, macOS only). It
 * watches from inside a sandbox: on macOS `sandbox-exec` (measured on arm64), on Linux an empty
 * network namespace under `strace` (measured green on CI's ubuntu-latest in #212, about 54
 * minutes against about 15 on macOS arm64). Two loopback servers (`foliage up`, a private-brain session) run on macOS only. It
 * fails on any network attempt, any other program started, any process that
 * does not end as its step expects or outlives it, and any config drift. On macOS it also kills
 * and fails on any write under the owner's own `~/.gbrain` and `~/brain`; on Linux only the size
 * and modification time of `~/.gbrain/config.json` and `brain.pglite` are compared. The harness is
 * `tools/brain/offline-gate.mjs`.
 *
 * A missing vendor/ or sandbox tool fails red with the command that fixes it; it is never skipped.
 * CI's `egress-gate-is-real` job plants a fetch and a name lookup in the staged gbrain
 * (`tools/brain/plant-egress-probe.mjs`) and requires this gate to fail with a NETWORK ATTEMPT line.
 *
 * `--only 8` (or `--only 2,6`) runs only those phases, plus the controls and the closing checks:
 * a developer's shortcut while working on one item. Its green line says PARTIAL; `pnpm check`
 * never passes it and runs every phase.
 */
import { parseArgs } from "node:util";
import { PHASES, runOfflineGate } from "../tools/brain/offline-gate.mjs";

const { values } = parseArgs({ options: { only: { type: "string" } }, strict: true });
const phases = values.only === undefined ? PHASES : values.only.split(",").map(item => item.trim());
const unknown = phases.filter(item => !PHASES.includes(item));
if (unknown.length > 0 || phases.length === 0) {
  process.stderr.write(`check-brain-offline: --only takes build order items from ${PHASES.join(", ")} ("2" is items 2 and 4), not ${JSON.stringify(values.only)}\n`);
  process.exitCode = 2;
} else process.exitCode = (await runOfflineGate({ phases })) ? 0 : 1;
