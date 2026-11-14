#!/usr/bin/env node
/** Remove exactly one published artifact after the operator names its id. The local leaf remains. */

import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { DOCUMENT_DIGEST, PUBLISHED_ID, documentDigest } from "@foliage/canopy";

import { publishedPath } from "./src/publishedLeaf.ts";
import { withPublicationLock } from "./src/publicationMutation.mjs";

const USAGE = `Withdraw one public leaf without touching its local source.

  node apps/canopy/withdraw.mjs --from <dir> --id <id> [--expect-digest <digest>] --confirm <id>

The confirmation must repeat the exact public id. The one <id>.published.json file is removed;
the Compound Leaf on the user's machine is not read or changed.
`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      from: { type: "string" },
      id: { type: "string" },
      confirm: { type: "string" },
      "expect-digest": { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  process.exit(2);
}

if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const from = values.from?.trim();
const id = values.id?.trim();
const confirm = values.confirm?.trim();
const expectDigest = values["expect-digest"]?.trim() ?? null;
if (!from || !id || !confirm) {
  process.stderr.write(`withdraw: --from, --id and --confirm are required. Nothing was changed.\n\n${USAGE}`);
  process.exit(2);
}
if (!PUBLISHED_ID.test(id)) {
  process.stderr.write(`withdraw: ${JSON.stringify(id)} is not a published id. Nothing was changed.\n`);
  process.exit(1);
}
if (expectDigest !== null && !DOCUMENT_DIGEST.test(expectDigest)) {
  process.stderr.write(`withdraw: --expect-digest is not a sha256 digest. Nothing was changed.\n`);
  process.exit(2);
}
if (confirm !== id) {
  process.stderr.write(
    `withdraw: confirmation names ${JSON.stringify(confirm)}, not ${JSON.stringify(id)}. ` +
      `Nothing was changed.\n`,
  );
  process.exit(1);
}

const target = publishedPath(resolve(from), id);
const { mutationError: withdrawError, releaseWarning } = await withPublicationLock(target, async () => {
  if (expectDigest !== null) {
    const actualDigest = documentDigest(await readFile(target));
    if (actualDigest !== expectDigest) {
      const changed = Object.assign(
        new Error(`the public artifact changed after review (${expectDigest} → ${actualDigest}). Review it again`),
        { code: "ESTALEPUBLIC" },
      );
      throw changed;
    }
  }
  await unlink(target);
});

if (releaseWarning !== null) {
  process.stderr.write(
    `withdraw: WARNING — ${withdrawError === null ? "the public artifact was removed" : "withdrawal failed"}, but its lock could not be cleaned up: ` +
    `${releaseWarning instanceof Error ? releaseWarning.message : String(releaseWarning)}. ` +
    `Future changes may require inspecting ${target}.lock.\n`,
  );
}

if (withdrawError !== null) {
  const code = withdrawError !== null && typeof withdrawError === "object" && "code" in withdrawError
    ? String(withdrawError.code)
    : "UNKNOWN";
  if (code === "ENOENT") {
    process.stderr.write(`withdraw: nothing is published under ${JSON.stringify(id)}. Nothing was changed.\n`);
    process.exit(4);
  }
  process.stderr.write(
    `withdraw: could not remove ${target}: ${withdrawError instanceof Error ? withdrawError.message : String(withdrawError)} [${code}]. Nothing was changed.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `withdraw: WITHDRAWN ${id}\n` +
    `withdraw: the public artifact was removed. The local Compound Leaf was not read or changed.\n`,
);
