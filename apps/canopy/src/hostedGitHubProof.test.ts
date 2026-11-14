/**
 * Protocol tests only. Commit SHA/message/email come from real temporary git objects.
 * These UNSIGNED local objects have never been uploaded to GitHub. Provider verdict/signature
 * fields below are explicit test doubles, not cryptography, cloud proof, or portfolio evidence.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { documentDigest, PUBLISHED_ARTIFACT, parsePublishedDocument, redactPublicationText, toArtifactJson } from "@foliage/canopy";
import { admitPublication, HostedAdmissionError } from "./hostedAdmission.ts";
import { createHostedGitHubProof, HostedGitHubProofError, isHostedGitHubVerification } from "./hostedGitHubProof.ts";

const ACTOR = { id: "00000000-0000-4000-8000-000000000001" };
const EMAIL = "protocol@example.invalid";
const AT = "2026-09-08T00:00:00Z";
const repo = mkdtempSync(join(tmpdir(), "foliage-hosted-proof-protocol-"));
after(() => rmSync(repo, { recursive: true, force: true }));
const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=Protocol test", "-c", `user.email=${EMAIL}`, "-c", "commit.gpgsign=false", ...args], {
  encoding: "utf8", stdio: "pipe", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
}).trimEnd();
git("init");
function fixture(message = "Protocol test commit") {
  git("commit", "--allow-empty", "--allow-empty-message", "--cleanup=verbatim", "-m", message);
  const [sha, email, subject] = git("show", "-s", "--format=%H%x00%ae%x00%s", "HEAD").split("\0") as [string, string, string];
  assert.equal(git("cat-file", "-t", sha), "commit");
  return { sha, email, subject, message: git("show", "-s", "--format=%B", "HEAD") };
}
const source = fixture();
function provider(over: Record<string, unknown> = {}, record = source) {
  return { sha: record.sha, author: { email: record.email }, committer: { email: record.email }, message: record.message,
    verification: { verified: true, reason: "valid", verified_at: AT,
      signature: "-----BEGIN PGP SIGNATURE-----\nTEST-ONLY-PROVIDER-DOUBLE-NOT-A-SIGNATURE\n-----END PGP SIGNATURE-----" }, ...over };
}
function artifact(record = source) {
  const subject = record.subject.trim() || "(commit recorded with no message)";
  const title = redactPublicationText(subject);
  return { artifact: PUBLISHED_ARTIFACT, artifactVersion: 3, publishedAt: AT,
    source: { documentDigest: documentDigest(Buffer.from(record.message)), documentBytes: Buffer.byteLength(record.message), policyDigest: documentDigest(Buffer.from("test-only-policy")) },
    leaf: { id: "proof-protocol", subject: "Protocol test", subjectRedacted: false,
      leaflets: [{ id: `git:${record.sha}`, title, tier: "verified", titleRedacted: title !== subject,
        provenance: { source: "git", ref: record.sha, observedAt: AT } }] },
    withheld: { count: 0, kinds: [] } };
}
const user = () => ({ id: ACTOR.id, aud: "authenticated", role: "authenticated", is_anonymous: false, email: EMAIL, email_confirmed_at: AT });
const evidence = (record = source) => [{ leafletId: `git:${record.sha}`, owner: "protocol-test", repo: "not-uploaded", ref: record.sha }];
const input = (record = source) => ({ actor: ACTOR, accessToken: "test-only-session", document: artifact(record), evidence: evidence(record) });
const rejects = (code: HostedGitHubProofError["code"]) => (error: unknown) => {
  assert.ok(error instanceof HostedGitHubProofError);
  assert.equal(error.code, code);
  assert.doesNotMatch(String(error), /protocol@example|private-provider-detail|test-only-session/);
  return true;
};
function verifier(commit: unknown = provider(), auth: unknown = user()) {
  return createHostedGitHubProof({ getUser: async () => auth, fetch: async () => Response.json(commit) });
}

test("provider protocol binds a real local object's exact publication and actor without asserting cloud proof", async () => {
  let calls = 0;
  const verify = createHostedGitHubProof({ getUser: async token => { assert.equal(token, "test-only-session"); return user(); },
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, `https://api.github.com/repos/protocol-test/not-uploaded/git/commits/${source.sha}`);
      assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
      const headers = new Headers(init?.headers); assert.equal(headers.get("authorization"), null);
      return Response.json(provider());
    } });
  const request = input();
  const result = await verify(request);
  const parsed = parsePublishedDocument(request.document); assert.ok(parsed.ok);
  assert.equal(result.artifactDigest, documentDigest(Buffer.from(JSON.stringify(toArtifactJson(parsed.document)))));
  assert.equal(result.actorId, ACTOR.id); assert.equal(result.items[0]?.verifiedAt, AT);
  assert.ok(isHostedGitHubVerification(result)); assert.ok(!isHostedGitHubVerification(JSON.parse(JSON.stringify(result))));
  assert.ok(!isHostedGitHubVerification({ ...result }));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.items) && Object.isFrozen(result.items[0]));
  assert.deepEqual(await verify(input()), result); assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(result), /protocol@example|SIGNATURE|test-only-session/);
  request.document.leaf.leaflets[0]!.title = "changed";
  await assert.rejects(verify(request), rejects("verification-required"));
});

test("git %s, intake's empty title, and publication redaction match actual Git metadata", async () => {
  for (const message of ["", "  Leading and trailing  ", "First line\nsecond line\n\nBody", "Contact protocol@example.invalid now", "\n\nFirst\tline  \ncontinued\n\nBody"]) {
    const record = fixture(message);
    const result = await verifier(provider({}, record))(input(record));
    assert.equal(result.items[0]?.ref, record.sha);
  }
  const record = fixture("Contact protocol@example.invalid now");
  const changed = input(record); changed.document.leaf.leaflets[0]!.titleRedacted = false;
  await assert.rejects(verifier(provider({}, record))(changed), rejects("verification-required"));
});

test("signature validity never substitutes for signer-author binding or confirmed session identity", async () => {
  for (const over of [{ author: { email: "foreign@example.invalid" } }, { committer: { email: "foreign@example.invalid" } },
    { sha: "a".repeat(40) }, { message: "Different public title" }]) {
    await assert.rejects(verifier(provider(over))(input()), rejects("verification-required"));
  }
  for (const over of [{ id: "00000000-0000-4000-8000-000000000002" }, { email: "foreign@example.invalid" },
    { aud: "anon" }, { role: "anon" }, { is_anonymous: true }, { email_confirmed_at: null, confirmed_at: AT, phone_confirmed_at: AT },
    { email_confirmed_at: "not-a-date", user_metadata: { email_verified: true } }]) {
    const expected = "email" in over ? "verification-required" : "identity-required";
    await assert.rejects(verifier(provider(), { ...user(), ...over })(input()), rejects(expected));
  }
  let fetched = false;
  await assert.rejects(createHostedGitHubProof({ getUser: async () => { throw new Error("private-provider-detail"); }, fetch: async () => { fetched = true; return Response.json(provider()); } })(input()), rejects("identity-required"));
  assert.equal(fetched, false);
});

test("every non-valid verdict, unsupported signature and missing historical verification time refuses", async () => {
  for (const reason of ["unsigned", "invalid", "bad_email", "unverified_email", "no_user", "unknown_key", "expired_key", "gpgverify_error", "gpgverify_unavailable", "new-provider-reason"]) {
    await assert.rejects(verifier(provider({ verification: { ...provider().verification, reason } }))(input()), rejects("verification-required"));
  }
  for (const over of [{ verified: false }, { verified: "true" }, { signature: "-----BEGIN SSH SIGNATURE-----\nTEST-ONLY" },
    { signature: null }, { verified_at: null }, { verified_at: "invalid" }]) {
    await assert.rejects(verifier(provider({ verification: { ...provider().verification, ...over } }))(input()), rejects("verification-required"));
  }
});

test("separate exact coordinate envelope refuses extras, private tokens, refs, duplicates and unsupported sources before network", async () => {
  let calls = 0;
  const verify = createHostedGitHubProof({ getUser: async () => { calls++; return user(); }, fetch: async () => { calls++; return Response.json(provider()); } });
  for (const supplied of [[], [...evidence(), ...evidence()], [{ ...evidence()[0], token: "private-provider-detail" }],
    [{ ...evidence()[0], owner: "evil.example/path" }], [{ ...evidence()[0], repo: "../private" }],
    [{ ...evidence()[0], ref: "HEAD" }], [{ ...evidence()[0], ref: "a".repeat(40) }], [{ ...evidence()[0], leafletId: "other" }]]) {
    await assert.rejects(verify({ ...input(), evidence: supplied }), rejects("invalid-evidence"));
  }
  for (const change of [{ source: "upload" }, { ref: "HEAD" }]) {
    const request = input(); Object.assign(request.document.leaf.leaflets[0]!.provenance, change);
    await assert.rejects(verify(request), rejects("invalid-evidence"));
  }
  for (const version of [1, 2, 6]) await assert.rejects(verify({ ...input(), document: { ...artifact(), artifactVersion: version } }), rejects("invalid-evidence"));
  await assert.rejects(verify({ ...input(), document: { ...artifact(), signature: "client-device-signature" } }), rejects("invalid-evidence"));
  assert.equal(calls, 0);
});

test("a failed item refuses the entire publication, and more than 20 verified items never fetch", async () => {
  const request = input();
  request.document.leaf.leaflets.push({ ...request.document.leaf.leaflets[0]!, id: "second-test-item" });
  request.evidence.push({ ...request.evidence[0]!, leafletId: "second-test-item" });
  let calls = 0;
  const verify = createHostedGitHubProof({ getUser: async () => user(), fetch: async () => Response.json(provider(++calls === 2 ? { message: "wrong" } : {})) });
  await assert.rejects(verify(request), rejects("verification-required")); assert.equal(calls, 2);
  for (let i = 2; i < 21; i++) {
    request.document.leaf.leaflets.push({ ...request.document.leaf.leaflets[0]!, id: `item-${i}` });
    request.evidence.push({ ...request.evidence[0]!, leafletId: `item-${i}` });
  }
  await assert.rejects(verify(request), rejects("invalid-evidence")); assert.equal(calls, 2);
});

test("provider failures, redirects, malformed JSON and oversized streamed bodies fail without leaking bodies", async () => {
  const responses = [() => new Response("private-provider-detail", { status: 404 }), () => new Response(null, { status: 302, headers: { Location: "https://private.invalid" } }),
    () => new Response("private-provider-detail", { status: 200 }), () => new Response("x".repeat(128 * 1024 + 1))];
  for (const response of responses) await assert.rejects(createHostedGitHubProof({ getUser: async () => user(), fetch: async () => response() })(input()), rejects("provider-unavailable"));
  await assert.rejects(createHostedGitHubProof({ getUser: async () => user(), fetch: async () => { throw new Error("private-provider-detail"); } })(input()), rejects("provider-unavailable"));
});

test("publication and coordinate snapshots survive mutation while server identity is being fetched", async () => {
  const request = input();
  const verify = createHostedGitHubProof({ getUser: async () => {
    request.document.leaf.leaflets[0]!.title = "mutated while awaiting";
    request.evidence[0]!.repo = "mutated-repo";
    return user();
  }, fetch: async url => { assert.ok(String(url).includes("/not-uploaded/")); return Response.json(provider()); } });
  const receipt = await verify(request);
  assert.equal(receipt.items[0]?.repo, "not-uploaded");
  assert.notEqual(receipt.artifactDigest, documentDigest(Buffer.from(JSON.stringify(request.document))));
});


test("a stalled provider is aborted within the fixed request deadline", async () => {
  // The fault double deliberately stalls and honors native fetch's AbortSignal contract.
  let aborted = false;
  const keepAlive = setTimeout(() => {}, 7000);
  try {
    const verify = createHostedGitHubProof({ getUser: async () => user(), fetch: async (_url, init) => {
      assert.ok(init?.signal);
      return await new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("private-provider-detail")); }, { once: true });
      });
    } });
    await assert.rejects(verify(input()), rejects("provider-unavailable"));
    assert.equal(aborted, true);
  } finally { clearTimeout(keepAlive); }
});


test("admission consumes only the minted proof for this exact actor and publication", async () => {
  const request = input();
  const proof = await verifier()(request);
  const consent = { intent: "publish" as const, operationId: "00000000-0000-4000-8000-000000000008", subjectId: request.document.leaf.id,
    artifactDigest: proof.artifactDigest, policyDigest: request.document.source.policyDigest,
    expectedRevisionId: null, expectedGeneration: 0 };
  const admission = { actor: ACTOR, owner: { actorId: ACTOR.id, subjectId: request.document.leaf.id }, document: request.document, consent };
  const accepted = admitPublication({ ...admission, verification: proof });
  assert.equal(accepted.document.leaf.leaflets[0]?.tier, "verified");
  assert.deepEqual(accepted.admission.sourceVerification, proof);
  const refused = (error: unknown) => error instanceof HostedAdmissionError && error.code === "verification-required";
  assert.throws(() => admitPublication(admission), refused);
  assert.throws(() => admitPublication({ ...admission, verification: structuredClone(proof) }), refused);
  const changed = structuredClone(request.document); changed.leaf.subject = "Changed test subject";
  const parsed = parsePublishedDocument(changed); assert.ok(parsed.ok);
  const digest = documentDigest(Buffer.from(JSON.stringify(toArtifactJson(parsed.document))));
  assert.throws(() => admitPublication({ ...admission, document: changed, consent: { ...consent, artifactDigest: digest }, verification: proof }), refused);
});
