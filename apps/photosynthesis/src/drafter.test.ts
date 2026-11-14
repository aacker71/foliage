/**
 * THE DEFECT THESE TESTS PIN, and it was reproduced before it was believed.
 *
 * `mayDraftAgainst` checks the endpoint STRING. A 307 preserves method and body, so a checked
 * host is a claim about the FIRST HOP, and plain `fetch` follows the rest. Measured 2026-08-20
 * against the pre-fix file: the gate passed on a 127.0.0.1 endpoint, the redirect was followed,
 * and 872 bytes carrying a commit subject arrived at a second host while the caller saw NO error.
 *
 * This is the same defect X7 closed in apps/leaf/src/loopbackFetch.ts. It survived there because
 * this is a FOURTH model call site in a different app, and the ledger's own detection grep
 * ("exactly one fetch( call site") had already gone false without anyone re-running it.
 *
 * Both tests open REAL sockets. The refusal test asserts what the second host RECEIVED — not what
 * the caller was told — because the whole class of bug is the caller being told the wrong thing.
 * The second test is a POSITIVE CONTROL and is not optional: a guard that refuses everything would
 * pass the first test alone, and a suite of refusals cannot show that the feature still works.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { draftFromPhoto, draftWithLocalModel } from "./drafter.ts";

const MARKER = "a private commit subject that must never reach a second host";

const listen = async (handler: http.RequestListener): Promise<http.Server> => {
  const s = http.createServer(handler);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return s;
};
const portOf = (s: http.Server): number => (s.address() as { port: number }).port;

/** The minimum real shape the drafter reads: one cluster carrying one commit subject. */
const gather = {
  repo: "/tmp/drafter-test",
  identity: "subject@example.com",
  git: {
    ok: true as const,
    data: {
      clusters: [
        {
          key: "feat",
          commits: [
            { sha: "a".repeat(40), subject: MARKER, authoredAt: "2026-08-20T00:00:00Z", email: "subject@example.com" },
          ],
        },
      ],
      total: 1,
      observedAuthors: [{ email: "subject@example.com", count: 1 }],
    },
  },
  readme: { ok: false as const, cause: "absent", detail: "no README" },
  // deno-lint-ignore no-explicit-any -- the drafter reads only the fields above.
} as unknown as Parameters<typeof draftWithLocalModel>[0];

test("A 307 FROM THE DRAFTING ENDPOINT IS REFUSED AND THE SECOND HOST RECEIVES NOTHING", async () => {
  let secondHostBody: string | null = null;
  const second = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      secondHostBody = body;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { content: '{"candidates":[]}' } }));
    });
  });
  const first = await listen((req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${portOf(second)}${req.url}` });
    res.end();
  });

  const result = await draftWithLocalModel(gather, { baseUrl: `http://127.0.0.1:${portOf(first)}`, model: "m" });

  // The assertion that matters is about the WIRE, not about the return value.
  assert.equal(secondHostBody, null, "the material reached a host the caller never configured");
  // `redirected` keeps its own vocabulary: "the model is down" and "something on a port you
  // trusted is moving your material" call for opposite actions.
  assert.match(String(result.fallbackCause), /redirected/i);
  assert.match(String(result.fallbackCause), /307/);

  first.close();
  second.close();
});

test("POSITIVE CONTROL — an ordinary 200 still drafts, so the guard is not a blanket refusal", async () => {
  let reached = false;
  const model = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      reached = true;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({ candidates: [{ title: "A drafted candidate", summary: "One sentence.", cites: ["feat"] }] }),
          },
        }),
      );
    });
  });

  const result = await draftWithLocalModel(gather, { baseUrl: `http://127.0.0.1:${portOf(model)}`, model: "m" });

  assert.equal(reached, true, "the guard blocked a legitimate loopback endpoint");
  assert.equal(result.fallbackCause, undefined, `drafting fell back: ${result.fallbackCause}`);
  assert.equal(result.candidates.length, 1);

  model.close();
});

/**
 * THE SECOND DEFECT THESE TESTS PIN — the 12-factor audit (factor 4) reproduced a TypeError in
 * `draftFromPhoto` at apps/photosynthesis/src/drafter.ts:322-329. `JSON.parse` legally returns
 * `null`, a bare string, a bare number, or an array — a vision model replying with any of those
 * is not malformed JSON, so the existing "vision output was not JSON" catch never fired — and the
 * old code went straight to `parsed.title`, which THROWS on `null` (TypeError: Cannot read
 * properties of null). The drafter's own contract says it "NEVER falls back silently" for a photo
 * candidate — a failed vision call must become a named `cause`, never a crash.
 *
 * Each case below drives a REAL loopback HTTP server so the assertion is against what
 * `draftFromPhoto` actually returns for that exact wire reply, not a mocked function.
 */
const withPhoto = async (
  run: (photo: { path: string; digest: string; bytes: number }) => Promise<void>,
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-ps-photo-"));
  const path = join(dir, "shot.png");
  const bytes = Buffer.from("not a real png — only the drafter's JSON handling is under test");
  await writeFile(path, bytes);
  try {
    await run({ path, digest: "deadbeef", bytes: bytes.byteLength });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const visionReplying = async (
  value: unknown,
  photo: { path: string; digest: string; bytes: number },
): Promise<Awaited<ReturnType<typeof draftFromPhoto>>> => {
  const model = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { content: JSON.stringify(value) } }));
    });
  });
  try {
    return await draftFromPhoto(photo, { baseUrl: `http://127.0.0.1:${portOf(model)}`, model: "m" });
  } finally {
    model.close();
  }
};

test("DRAFTFROMPHOTO REFUSES BY NAME, NEVER THROWS, WHEN VISION OUTPUT PARSES TO NULL", async () => {
  await withPhoto(async (photo) => {
    const result = await visionReplying(null, photo);
    assert.equal(result.candidate, undefined, "null parse produced a candidate instead of a refusal");
    assert.match(String(result.cause), /vision output was not a JSON object \(got null\)/);
  });
});

test("DRAFTFROMPHOTO REFUSES BY NAME, NEVER THROWS, WHEN VISION OUTPUT PARSES TO A BARE STRING", async () => {
  await withPhoto(async (photo) => {
    const result = await visionReplying("just a string, legal JSON, no title or summary", photo);
    assert.equal(result.candidate, undefined, "bare-string parse produced a candidate instead of a refusal");
    assert.match(String(result.cause), /vision output was not a JSON object \(got string\)/);
  });
});

test("DRAFTFROMPHOTO REFUSES BY NAME, NEVER THROWS, WHEN VISION OUTPUT PARSES TO A BARE NUMBER", async () => {
  await withPhoto(async (photo) => {
    const result = await visionReplying(42, photo);
    assert.equal(result.candidate, undefined, "bare-number parse produced a candidate instead of a refusal");
    assert.match(String(result.cause), /vision output was not a JSON object \(got number\)/);
  });
});

test("DRAFTFROMPHOTO REFUSES BY NAME, NEVER THROWS, WHEN VISION OUTPUT PARSES TO A BARE ARRAY", async () => {
  await withPhoto(async (photo) => {
    const result = await visionReplying([], photo);
    assert.equal(result.candidate, undefined, "bare-array parse produced a candidate instead of a refusal");
    assert.match(String(result.cause), /vision output was not a JSON object \(got array\)/);
  });
});

test("POSITIVE CONTROL — A VALID VISION REPLY STILL DRAFTS A PHOTO CANDIDATE", async () => {
  // The four refusals above prove the guard fires; only this proves it doesn't fire always.
  // Untrimmed reply on purpose: the trim is part of the contract, not an accident.
  await withPhoto(async (photo) => {
    const result = await visionReplying(
      { title: "  A terminal running the test suite  ", summary: " One factual sentence about what is visible. " },
      photo,
    );
    assert.equal(result.cause, undefined, `a valid vision reply was refused: ${result.cause}`);
    const candidate = result.candidate;
    assert.ok(candidate, "a valid vision reply drafted no candidate");
    assert.match(candidate.id, /^ps-[0-9a-f]{8}$/);
    assert.equal(candidate.drafted.title, "A terminal running the test suite");
    assert.equal(candidate.drafted.summary, "One factual sentence about what is visible.");
    assert.deepEqual(candidate.evidence, [{ source: "photo", ref: `sha256:${photo.digest}`, excerpt: photo.path }]);
    assert.deepEqual(candidate.provenance, { method: "local_llm", model: "m", ranLocally: true });
    assert.equal(candidate.status, "proposed");
  });
});
