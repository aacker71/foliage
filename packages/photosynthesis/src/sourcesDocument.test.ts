/**
 * The sources document, tested as the thing it is: the format that makes an UNATTENDED harvest
 * possible. Every assertion below is about a failure that would otherwise happen at 03:00 with
 * nobody watching, which is why the messages matter as much as the refusals.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_SOURCES,
  WATCHED_SOURCE_KINDS,
  addSource,
  parseSourcesDocument,
  removeSource,
  type WatchedSource,
} from "./sourcesDocument.ts";

const source = (over: Partial<WatchedSource> = {}): Record<string, unknown> => ({
  kind: "git",
  path: "/home/someone/work/repo",
  subject: "Someone Real",
  identities: ["someone@example.com"],
  addedAt: "2026-09-04T10:00:00.000Z",
  ...over,
});

const issuesAt = (value: unknown, at: string): readonly string[] => {
  const parsed = parseSourcesDocument(value);
  assert.equal(parsed.ok, false, `expected a refusal, got a valid document`);
  return parsed.ok ? [] : parsed.issues.filter((i) => i.at === at).map((i) => i.message);
};

test("a well-formed document parses, and the parsed value is frozen", () => {
  const parsed = parseSourcesDocument({ sources: [source()] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.sources.length, 1);
  assert.equal(parsed.document.sources[0]!.subject, "Someone Real");
  assert.deepEqual([...parsed.document.sources[0]!.identities], ["someone@example.com"]);
  assert.throws(() => (parsed.document.sources as WatchedSource[]).push(source() as unknown as WatchedSource));
});

test("a garden watching nothing is a VALID document, not a malformed one", () => {
  // The distinction the format exists to keep: "nothing watched yet" is the state every new
  // install is in, and it must not be reported as a broken file.
  const parsed = parseSourcesDocument({ sources: [] });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.document.sources.length, 0);

  // …whereas an ABSENT sources key is malformed, so the two answers stay apart.
  const absent = parseSourcesDocument({});
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.match(absent.issues[0]!.message, /empty array, never as an absent field/);
});

test("a relative path is REFUSED — the defect this whole format exists to remove", () => {
  // A scheduled run has no meaningful working directory, so a relative path would resolve against
  // whatever launchd woke up in and silently watch the wrong tree, or nothing.
  const messages = issuesAt({ sources: [source({ path: "./repo" } as Partial<WatchedSource>)] }, "sources[0].path");
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /ABSOLUTE path, got "\.\/repo"/);
  assert.match(messages[0]!, /working directory the scheduler happened to have/);
});

test("subject and identities are REQUIRED, because a scheduled harvest cannot prompt", () => {
  // `foliage grow` falls back to `git config` and exits 2 with a prompt. That is a fine answer to
  // a person at a terminal and a silent death in the middle of the night, so the format refuses to
  // represent a source that would reach that prompt.
  const noSubject = issuesAt({ sources: [{ ...source(), subject: "" }] }, "sources[0].subject");
  assert.equal(noSubject.length, 1);
  assert.match(noSubject[0]!, /scheduled harvest has nobody to ask/);

  const noIds = issuesAt({ sources: [{ ...source(), identities: [] }] }, "sources[0].identities");
  assert.equal(noIds.length, 1);
  assert.match(noIds[0]!, /non-empty array/);

  // A list, not a string: one person commits under several addresses.
  const oneString = issuesAt({ sources: [{ ...source(), identities: "a@b.c" }] }, "sources[0].identities");
  assert.equal(oneString.length, 1);
});

test("a score-shaped key is refused BY NAME, from the same list the other two documents use", () => {
  // The posture, one layer earlier: ordering sources by a number ranks a person's work by where it
  // came from. `SCORE_SHAPED` is imported from @foliage/leaf so the three gates cannot drift.
  for (const key of ["score", "rating", "rank", "confidence", "weight"]) {
    const parsed = parseSourcesDocument({ sources: [{ ...source(), [key]: 1 }] });
    assert.equal(parsed.ok, false, `"${key}" was accepted`);
    if (parsed.ok) continue;
    const named = parsed.issues.filter((i) => i.at === `sources[0].${key}`);
    assert.equal(named.length, 1, `"${key}" produced ${named.length} issues at its own address`);
    assert.match(named[0]!.message, /refused by name: no rating of any kind/);
  }
});

test("an unknown field is refused rather than ignored, so a misspelling is heard", () => {
  const messages = issuesAt({ sources: [{ ...source(), identites: ["typo@example.com"] }] }, "sources[0].identites");
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /unknown field "identites"/);
});

test("one path may be watched once — a second entry would harvest the same history twice", () => {
  const parsed = parseSourcesDocument({ sources: [source(), source()] });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const dup = parsed.issues.filter((i) => i.at === "sources[1].path");
  assert.equal(dup.length, 1);
  // Reported against the LATER entry and naming the earlier: the message says which line to delete.
  assert.match(dup[0]!.message, /already watched at sources\[0\]/);
});

test("every issue is collected, not just the first", () => {
  const parsed = parseSourcesDocument({ sources: [{ kind: "svn", path: "rel", subject: "", identities: [] }] });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const addresses = parsed.issues.map((i) => i.at).sort();
  // kind, path, subject, identities, addedAt — someone hand-editing wants all of it at once.
  assert.deepEqual(addresses, [
    "sources[0].addedAt",
    "sources[0].identities",
    "sources[0].kind",
    "sources[0].path",
    "sources[0].subject",
  ]);
});

test("the kind list is the single source of truth for what a source may be", () => {
  assert.deepEqual([...WATCHED_SOURCE_KINDS], ["git"]);
  const messages = issuesAt({ sources: [{ ...source(), kind: "svn" }] }, "sources[0].kind");
  // The message ENUMERATES the kinds rather than restating them, so adding one updates the error.
  assert.equal(messages.length, 1);
  for (const k of WATCHED_SOURCE_KINDS) assert.ok(messages[0]!.includes(`"${k}"`), `${k} missing from the message`);
});

test("addSource returns a NEW document and never mutates the one given", () => {
  const one = addSource(NO_SOURCES, source() as unknown as WatchedSource);
  assert.equal(one.ok, true);
  if (!one.ok) return;
  assert.equal(one.document.sources.length, 1);
  // The input is untouched — the whole point of returning a value rather than editing in place.
  assert.equal(NO_SOURCES.sources.length, 0);

  const again = addSource(one.document, source() as unknown as WatchedSource);
  assert.equal(again.ok, false);
  if (!again.ok) assert.match(again.reason, /already watching \/home\/someone\/work\/repo \(added 2026-09-04/);
});

test("removeSource says so when nothing was removed, because that is a typo and not a success", () => {
  const one = addSource(NO_SOURCES, source() as unknown as WatchedSource);
  assert.ok(one.ok);
  if (!one.ok) return;

  const gone = removeSource(one.document, "/home/someone/work/repo");
  assert.equal(gone.ok, true);
  if (gone.ok) assert.equal(gone.document.sources.length, 0);

  const miss = removeSource(one.document, "/home/someone/work/other");
  assert.equal(miss.ok, false);
  if (!miss.ok) assert.match(miss.reason, /not watching \/home\/someone\/work\/other/);
});

test("a document that round-trips through JSON parses back to the same thing", () => {
  // The document is written to disk and read by a different process, so the format has to survive
  // serialisation exactly — this is the property the CLI edge depends on.
  const built = addSource(NO_SOURCES, source() as unknown as WatchedSource);
  assert.ok(built.ok);
  if (!built.ok) return;
  const reparsed = parseSourcesDocument(JSON.parse(JSON.stringify(built.document)));
  assert.equal(reparsed.ok, true);
  if (reparsed.ok) assert.deepEqual(reparsed.document, built.document);
});


test("addedAt is held to the CANONICAL instant rule, not a loose Date.parse", () => {
  // The review found this as a fourth reimplementation of one domain rule. `Date.parse` accepts all
  // of these; none is an ISO 8601 instant, which is what the message promises. The rule now comes
  // from @foliage/leaf, so a change there reaches here without a second edit.
  for (const loose of ["2026", "2026-09-04", "September 4 2026", "Fri Sep 04 2026", "2026-09-04T10:00:00"]) {
    const messages = issuesAt({ sources: [{ ...source(), addedAt: loose }] }, "sources[0].addedAt");
    assert.equal(messages.length, 1, `"${loose}" was accepted as an ISO instant`);
    assert.match(messages[0]!, /an ISO 8601 instant/);
  }
  // …and a real instant still parses, with and without fractional seconds and with an offset.
  for (const good of ["2026-09-04T10:00:00Z", "2026-09-04T10:00:00.123Z", "2026-09-04T10:00:00+02:00"]) {
    const parsed = parseSourcesDocument({ sources: [{ ...source(), addedAt: good }] });
    assert.equal(parsed.ok, true, `"${good}" should be a valid instant`);
  }
});

test("one repository has ONE spelling — the write edge normalizes before it dedupes", () => {
  // Reproduced by the review through the real CLI: `watch /p/repo` then `watch /p/repo/` recorded
  // the same tree twice, because both the parser and addSource dedupe on string equality. A
  // trailing slash is what tab-completion types. The document itself cannot fix this — it never
  // sees the un-normalized string — so this test pins the invariant the CLI must preserve.
  const one = addSource(NO_SOURCES, source() as unknown as WatchedSource);
  assert.ok(one.ok);
  if (!one.ok) return;
  const again = addSource(one.document, { ...(source() as unknown as WatchedSource) });
  assert.equal(again.ok, false, "the same normalized path must be refused");
});
