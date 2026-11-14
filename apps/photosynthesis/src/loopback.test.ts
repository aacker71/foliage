/**
 * ONE TABLE, THREE GATES. The guard for F-009.
 *
 * WHAT F-009 WAS. Three files in this repository decided, independently, what "on this machine"
 * means, and two of them disagreed. `apps/photosynthesis/src/policy.ts` accepted
 * `127.0.0.1`/`::1`/`[::1]`/`localhost`. `apps/cos/src/localModel.ts` accepted all of
 * `127.0.0.0/8` plus `::1` plus `localhost`. `apps/leaf/src/loopbackFetch.ts` accepted the single
 * literal `127.0.0.1` and argued for it in its own header. So `http://127.0.0.2:11434` was
 * loopback to one gate and not to another, in a product whose central claim is that boundary —
 * and nothing failed when they drifted, because each copy passed its own tests.
 *
 * WHY THIS IS A TEST AND NOT A SHARED MODULE. It should have been a shared module; it cannot be,
 * and the reason is mechanical rather than a matter of taste. `apps/cos/tsconfig.json` sets
 * `rootDir: "src"` and `apps/photosynthesis/tsconfig.json` sets `rootDir: "."`, so a relative
 * import of another app's source is `TS6059 — File … is not under 'rootDir'`. MEASURED with the
 * repo's own tsc 5.9.3 on 2026-08-28, in both directions, not assumed:
 *
 *     apps/cos           importing ../../leaf/src/loopbackFetch.ts  → TS6059
 *     apps/photosynthesis importing ../../cos/src/localModel.ts     → TS6059 (×2, transitively)
 *
 * `@foliage/cos-app` and `@foliage/photosynthesis-app` also share no workspace package that
 * either could put the rule in without editing a third package. So the rule is written out three
 * times, and THIS FILE is what makes that survivable: the three are not kept in step by a comment
 * asking a future reader to remember — they are kept in step by a table that fails.
 *
 * HOW THE OTHER TWO GATES ARE REACHED. In a CHILD PROCESS, which is the honest way round the same
 * `rootDir` wall: `node` strips types and imports the real modules by absolute path, so what is
 * exercised is the shipped code and not a copy of it. A computed import specifier would have
 * dodged tsc too, and it would also have dodged `scripts/check-public-boundary.mjs`, whose own
 * header says a specifier behind an expression is invisible to it. A repository that enforces its
 * boundaries statically should not teach itself to hide imports from the enforcer.
 *
 * NO NETWORK. Every gate here is pure and total; nothing in this file opens a socket. The hosts
 * in the table are reserved, private, or loopback by design — the addresses a refusal test is
 * allowed to name (`public-boundary.json`'s `$egressComment` says which and why).
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { isLoopbackUrl, LOOPBACK_HOST } from "./policy.ts";

const exec = promisify(execFile);

/** The gates that live in other apps, by absolute path. Read-only to this lane; imported, never edited. */
const COS_GATE = fileURLToPath(new URL("../../cos/src/localModel.ts", import.meta.url));
const RECORD_GATE = fileURLToPath(new URL("../../leaf/src/loopbackFetch.ts", import.meta.url));

/**
 * THE TABLE. One column of truth: may this product open a socket to this URL believing it stays
 * on this machine? Every gate in the repository must answer exactly this, for every row.
 *
 * The rows are chosen for the four distinct ways a loopback check has gone wrong here before:
 * the disagreement itself (`127.0.0.2`), the names and spellings that are genuinely loopback and
 * are refused ON PURPOSE, the obfuscated IPv4 forms that defeat a `^127\.` string test and must
 * still be ACCEPTED because that is the address they name, and the strings whose leftmost label
 * looks like loopback and whose real host is somebody else's.
 */
const TABLE: readonly (readonly [url: string, loopback: boolean, why: string])[] = [
  ["http://127.0.0.1:11434", true, "the literal, at the port a local runtime uses"],
  ["https://127.0.0.1:11434", true, "scheme does not change the host"],
  ["http://127.0.0.1", true, "no port"],

  /* THE F-009 ADDRESS. Loopback per RFC 1122 and refused anyway — deliberately, because the
     definition of record refuses it and one definition beats a correct-but-second one. */
  ["http://127.0.0.2:11434", false, "F-009: genuinely loopback, refused so all three agree"],
  ["http://127.1.2.3", false, "the rest of 127.0.0.0/8, same decision"],
  ["http://localhost:11434", false, "a NAME — resolved by a file and a resolver we do not control"],
  ["http://[::1]:11434", false, "IPv6 loopback, refused for the same reason as 127.0.0.2"],

  /* Normalised by the WHATWG parser to 127.0.0.1 BEFORE any gate sees a host. These are the
     standard bypasses for a string prefix test, and the parse is what makes strictness free:
     refusing them would be wrong, and no gate here does. */
  ["http://2130706433", true, "decimal form, normalised to 127.0.0.1"],
  ["http://0x7f.0.0.1", true, "hex form, normalised to 127.0.0.1"],
  ["http://127.1", true, "short form, normalised to 127.0.0.1"],
  ["http://127.0.0.01", true, "leading zero, normalised to 127.0.0.1"],

  /* The host is somebody else's. A prefix test on the string says loopback for the first two. */
  ["http://127.0.0.1.evil.com/", false, "five labels — a domain name, not an address"],
  ["http://127.0.0.1@evil.com/", false, "the loopback literal is USERINFO; the host is evil.com"],
  ["http://localhost.example", false, "leftmost label looks local; RFC 2606 reserved domain"],

  ["http://192.168.1.10:11434", false, "private range, still off this machine"],
  ["http://192.0.2.1:11434", false, "TEST-NET-1 (RFC 5737) — reserved to never route"],
  ["http://0.0.0.0:11434", false, "a bind address, not a destination"],

  /* Unparseable and empty. Refused, never crashed: the failure direction that declines to draft. */
  ["http://127.0.0.256", false, "octet out of range — the URL parser itself throws"],
  ["not a url", false, "not a URL at all"],
  ["", false, "empty"],
];

/** Runs the two other gates over the table, in their own process. Fails loudly; never skips. */
async function verdictsFromOtherGates(): Promise<
  ReadonlyMap<string, { readonly cos: boolean; readonly record: boolean }>
> {
  /* Absolute file URLs, so nothing here depends on the child's cwd. The specifiers are
     interpolated rather than written as literals ONLY because they must be absolute — the
     imports themselves are ordinary static ones, resolvable by anyone reading the string. */
  const script = [
    `import { inspectLoopback } from ${JSON.stringify(COS_GATE)};`,
    `import { loopbackHostOf } from ${JSON.stringify(RECORD_GATE)};`,
    `const urls = JSON.parse(process.env.FOLIAGE_LOOPBACK_TABLE);`,
    `const out = urls.map((u) => [u, inspectLoopback(u).state === "loopback", loopbackHostOf(u).ok === true]);`,
    `process.stdout.write(JSON.stringify(out));`,
  ].join("\n");

  const { stdout } = await exec(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { env: { ...process.env, FOLIAGE_LOOPBACK_TABLE: JSON.stringify(TABLE.map(([u]) => u)) } },
  );

  const rows = JSON.parse(stdout) as [string, boolean, boolean][];
  return new Map(rows.map(([url, cos, record]) => [url, { cos, record }]));
}

test("F-009: all three loopback gates return the same verdict for every address in one table", async () => {
  const other = await verdictsFromOtherGates();
  assert.equal(other.size, TABLE.length, "the child process did not report on every address");

  for (const [url, expected, why] of TABLE) {
    const seen = other.get(url);
    assert.ok(seen !== undefined, `no verdict for ${JSON.stringify(url)}`);

    assert.equal(
      isLoopbackUrl(url),
      expected,
      `apps/photosynthesis/src/policy.ts disagrees about ${JSON.stringify(url)} — ${why}`,
    );
    assert.equal(
      seen.cos,
      expected,
      `apps/cos/src/localModel.ts disagrees about ${JSON.stringify(url)} — ${why}`,
    );
    assert.equal(
      seen.record,
      expected,
      `apps/leaf/src/loopbackFetch.ts disagrees about ${JSON.stringify(url)} — ${why}`,
    );
  }
});

/**
 * The constant, not just the behaviour. A gate could agree on this table while naming a different
 * literal, and the next reader would find two constants and no way to tell which is the decision.
 */
test("F-009: the accepted host is the same literal in every gate", async () => {
  assert.equal(LOOPBACK_HOST, "127.0.0.1");

  const script = [
    `import { LOOPBACK_HOST as cos } from ${JSON.stringify(COS_GATE)};`,
    `import { LOOPBACK_HOST as record } from ${JSON.stringify(RECORD_GATE)};`,
    `process.stdout.write(JSON.stringify([cos, record]));`,
  ].join("\n");
  const { stdout } = await exec(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    script,
  ]);

  assert.deepEqual(JSON.parse(stdout), ["127.0.0.1", "127.0.0.1"]);
});

/**
 * THE ONE REMAINING DIFFERENCE, ASSERTED RATHER THAN LEFT TO BE REDISCOVERED.
 *
 * `apps/cos/src/localModel.ts` also refuses a non-http(s) scheme, with its own named cause
 * `unsupported-scheme`; the other two read the host and nothing else. That is a NARROWING. The
 * property worth having is not that the three are identical functions — it is that no gate is
 * ever WIDER than the definition of record, because a wider gate is the one that leaks. So the
 * direction is what is checked, and this test is where a future edit that inverts it fails.
 */
test("F-009: a gate may be stricter than the definition of record, never looser", async () => {
  const url = "ftp://127.0.0.1/";

  /* Reading the host alone, this IS the loopback literal — so the record accepts it, and so does
     the drafter's gate, which is written to be exactly the record. Nothing dials it: `fetch`
     itself refuses a non-http scheme. */
  assert.equal(isLoopbackUrl(url), true);

  const script = [
    `import { inspectLoopback } from ${JSON.stringify(COS_GATE)};`,
    `import { loopbackHostOf } from ${JSON.stringify(RECORD_GATE)};`,
    `const i = inspectLoopback(${JSON.stringify(url)});`,
    `process.stdout.write(JSON.stringify([i.state, i.state === "refused" ? i.reason : null, loopbackHostOf(${JSON.stringify(url)}).ok]));`,
  ].join("\n");
  const { stdout } = await exec(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    script,
  ]);

  assert.deepEqual(JSON.parse(stdout), ["refused", "unsupported-scheme", true]);
});
