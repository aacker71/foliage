/** Transport harness only: scripted provider responses are not hosted-storage or customer evidence. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { documentDigest, parsePublishedDocument, toArtifactJson } from "@foliage/canopy";
import { MAX_ADDRESSES_PER_ACCOUNT, addressLimitError, createHostedStore, PUBLICATION_BUCKET, type PublishOperation } from "./hostedStore.ts";
import { checkVideoBytes, combinedMediaTransferIssue, decodeVideoTransfer } from "./publicationVideos.ts";

const execFileAsync = promisify(execFile);

const actor = { id: "10000000-0000-4000-8000-000000000001" };
const revision = "20000000-0000-4000-8000-000000000001";
const sourceBytes = Buffer.from("transport harness input, not portfolio evidence");
const payload = {
  artifact: "foliage/published-leaf", artifactVersion: 3, publishedAt: "2026-09-08T00:00:00.000Z",
  source: { documentDigest: documentDigest(sourceBytes), documentBytes: sourceBytes.length,
    policyDigest: documentDigest(Buffer.from("transport harness policy")) },
  leaf: { id: "storage-harness", subject: "Storage harness", subjectRedacted: false, leaflets: [] },
  withheld: { count: 0, kinds: [] },
};
const parsed = parsePublishedDocument(payload);
assert.ok(parsed.ok);
const canonical = JSON.stringify(toArtifactJson(parsed.document));
const digest = documentDigest(Buffer.from(canonical));
const operation: PublishOperation = {
  operationId: "transport-operation", subjectId: "storage-harness", expectedRevisionId: null, expectedGeneration: 0,
  document: payload, admission: {
    actorId: actor.id, operationId: "transport-operation", subjectId: "storage-harness",
    expectedRevisionId: null, expectedGeneration: 0, artifactDigest: digest,
    policyDigest: payload.source.policyDigest,
    admissionId: documentDigest(Buffer.from("transport admission")), consentId: documentDigest(Buffer.from("transport consent")),
  },
};
interface Call { url: URL; init: RequestInit; body: Record<string, unknown> }
type Step = (call: Call) => Response | Promise<Response>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function harness(steps: Step[]) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const call = { url, init, body }; calls.push(call);
    const step = steps.shift(); assert.ok(step, `unexpected request ${url.pathname}`);
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer transport-test-credential");
    assert.equal(new Headers(init.headers).get("cache-control"), "no-store");
    return step(call);
  };
  return { calls, steps, store: createHostedStore({ supabaseUrl: "https://storage.example", serviceRoleKey: "transport-test-credential", fetch: fetcher }) };
}
const absent: Step = call => { assert.equal(call.url.pathname, "/rest/v1/rpc/foliage_get_operation"); return json(null); };
const bucket: Step = call => { assert.equal(call.url.pathname, `/storage/v1/bucket/${PUBLICATION_BUCKET}`); return json({ id: PUBLICATION_BUCKET, public: false }); };
const uploaded: Step = call => {
  assert.equal(call.init.method, "POST");
  assert.equal(new Headers(call.init.headers).get("x-upsert"), "false");
  assert.equal(call.init.body, canonical);
  return json({ Key: call.url.pathname }, 201);
};
function saved(call: Call, overrides: Record<string, unknown> = {}) {
  return { requestHash: call.body["p_request_hash"], replayed: false,
    receipt: { operationId: operation.operationId, subjectId: operation.subjectId, kind: "publish",
      revisionId: call.body["p_revision"], generation: 1, committedAt: "2026-09-08T00:00:00.000Z" },
    current: { subjectId: operation.subjectId, revisionId: call.body["p_revision"], generation: 1, visible: true }, ...overrides };
}
const publicHead = {
  subjectId: operation.subjectId, revisionId: revision, generation: 1, visible: true,
  objectKey: `${actor.id}/${operation.subjectId}/${revision}.json`, artifactDigest: digest, artifactBytes: Buffer.byteLength(canonical),
};

test("combined photo and demo transfer is refused before crossing the 4 MiB hosted request limit", () => {
  const doc = parsed.document;
  const encoded = (bytes: number) => "A".repeat(Math.ceil(bytes / 3) * 4);
  assert.equal(combinedMediaTransferIssue(doc, encoded(512 * 1024), encoded(1024 * 1024)), null);
  assert.match(combinedMediaTransferIssue(doc, encoded(4 * 512 * 1024), encoded(2 * 1024 * 1024)) ?? "", /Choose fewer items/);
});

test("publish stages exact private bytes after receipt lookup and binds the verified actor", async () => {
  const h = harness([absent, bucket, uploaded, call => {
    assert.equal(call.url.pathname, "/rest/v1/rpc/foliage_commit_publication");
    assert.equal(call.body["p_actor"], actor.id);
    assert.equal(call.body["p_artifact_digest"], digest);
    assert.equal(call.body["p_artifact_bytes"], Buffer.byteLength(canonical));
    assert.equal(call.body["p_expected_revision"], null);
    assert.equal(call.body["p_expected_generation"], 0);
    assert.deepEqual(call.body["p_admission"], operation.admission);
    return json(saved(call));
  }]);
  const result = await h.store.publish(actor, operation);
  assert.equal(result.replayed, false); assert.equal(result.current.visible, true);
  assert.equal(h.steps.length, 0);
});

test("matching retry returns its original receipt and current withdrawn visibility without staging", async () => {
  let receipt: unknown;
  const h = harness([absent, bucket, uploaded, call => { receipt = saved(call); return json(receipt); }]);
  const first = await h.store.publish(actor, operation);
  h.steps.push(call => {
    assert.equal(call.url.pathname, "/rest/v1/rpc/foliage_get_operation");
    return json({ ...(receipt as object), replayed: true,
      current: { subjectId: operation.subjectId, revisionId: null, generation: 2, visible: false } });
  });
  const replay = await h.store.publish(actor, { ...operation, admission: undefined as never });
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(replay.replayed, true); assert.equal(replay.current.visible, false);
  assert.equal(h.calls.length, 5);
});

test("changed logical input conflicts before object staging", async () => {
  const h = harness([() => json({ requestHash: documentDigest(Buffer.from("a different operation")), replayed: true,
    receipt: { operationId: operation.operationId, subjectId: operation.subjectId, kind: "publish", revisionId: revision,
      generation: 1, committedAt: "2026-09-08T00:00:00.000Z" }, current: publicHead })]);
  await assert.rejects(h.store.publish(actor, operation), { code: "conflict" });
  assert.equal(h.calls.length, 1);
});

test("missing or mismatched server admission cannot stage a structurally valid document", async () => {
  for (const admission of [undefined, { ...operation.admission, actorId: "10000000-0000-4000-8000-000000000002" },
    { ...operation.admission, consentId: "unverified request claim" }, { ...operation.admission, expectedGeneration: 4 }]) {
    const h = harness([absent]);
    await assert.rejects(h.store.publish(actor, { ...operation, admission: admission as never }), { code: "forbidden" });
    assert.equal(h.calls.length, 1);
  }
});

test("public bucket configuration refuses upload", async () => {
  const h = harness([absent, () => json({ id: PUBLICATION_BUCKET, public: true })]);
  await assert.rejects(h.store.publish(actor, operation), { code: "forbidden" });
  assert.equal(h.calls.length, 2);
});

test("failed upload cannot attempt an authority commit", async () => {
  const h = harness([absent, bucket, () => json({ error: "transport harness storage failure" }, 503)]);
  await assert.rejects(h.store.publish(actor, operation), { code: "unavailable" });
  assert.equal(h.calls.length, 3);
});

test("lost commit acknowledgement remains unknown and never deletes staged bytes", async () => {
  const h = harness([absent, bucket, uploaded, () => { throw new Error("transport harness lost response"); }]);
  await assert.rejects(h.store.publish(actor, operation), { code: "outcome_unknown" });
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls.some(call => call.init.method === "DELETE"), false);
});

test("definitive database conflict remains a refusal rather than unknown success", async () => {
  const h = harness([absent, bucket, uploaded, () => json({ message: "foliage_conflict" }, 400)]);
  await assert.rejects(h.store.publish(actor, operation), { code: "conflict" });
  assert.equal(h.calls.some(call => call.init.method === "DELETE"), false);
});

test("withdrawal never contacts object storage and uses the verified actor", async () => {
  const h = harness([absent, call => {
    assert.equal(call.body["p_actor"], actor.id); assert.equal(call.body["p_kind"], "withdraw");
    assert.equal(call.body["p_revision"], null); assert.equal(call.body["p_admission"], null);
    return json(saved(call, { receipt: { operationId: operation.operationId, subjectId: operation.subjectId,
      kind: "withdraw", revisionId: null, generation: 2, committedAt: "2026-09-08T00:00:00.000Z" },
      current: { subjectId: operation.subjectId, revisionId: null, generation: 2, visible: false } }));
  }]);
  assert.equal((await h.store.withdraw(actor, { ...operation, expectedRevisionId: revision, expectedGeneration: 1 })).current.visible, false);
  assert.equal(h.calls.length, 2);
});

test("a public read verifies bytes and current authority without returning object URLs", async () => {
  const h = harness([() => json(publicHead), bucket, call => {
    assert.equal(call.url.pathname, `/storage/v1/object/authenticated/${PUBLICATION_BUCKET}/${publicHead.objectKey}`);
    return new Response(canonical);
  }, () => json(publicHead)]);
  const read = await h.store.readPublic(operation.subjectId);
  assert.ok(read); assert.equal(read.artifactDigest, digest);
  assert.equal("objectKey" in read, false); assert.equal("url" in read, false);
  assert.deepEqual(toArtifactJson(read.document), payload);
});

test("withdrawn authority avoids object reads; revocation during a read prevents returning bytes", async () => {
  const absentRead = harness([() => json(null)]);
  assert.equal(await absentRead.store.readPublic(operation.subjectId), null);
  const changed = harness([() => json(publicHead), bucket, () => new Response(canonical), () => json(null)]);
  assert.equal(await changed.store.readPublic(operation.subjectId), null);
});

test("the health ping is one read-only head lookup for an address no subject can have", async () => {
  const h = harness([call => { assert.equal(call.url.pathname, "/rest/v1/rpc/foliage_publication_head"); assert.deepEqual(call.body, { p_subject: "" }); return json(null); }]);
  assert.equal(await h.store.ping(), undefined); assert.equal(h.calls.length, 1);
  const paused = harness([() => new Response(JSON.stringify({ message: "project paused" }), { status: 503 })]);
  await assert.rejects(paused.store.ping(), { code: "unavailable" });
  await assert.rejects(harness([() => { throw new TypeError("fetch failed"); }]).store.ping(), { code: "unavailable" });
});

test("missing or corrupt committed bytes fail closed without head/receipt writes or fallback", async () => {
  for (const response of [new Response("missing", { status: 404 }), new Response("corrupted object")]) {
    const h = harness([() => json(publicHead), bucket, () => response]);
    await assert.rejects(h.store.readPublic(operation.subjectId), error =>
      typeof error === "object" && error !== null && "code" in error && ["unavailable", "corrupt"].includes(String(error.code)));
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls.some(call => call.url.pathname.endsWith("foliage_commit_publication")), false);
  }
});

test("the database address cap reaches the app as the plain limit refusal, at the migrated number", async () => {
  const h = harness([call => { assert.equal(call.url.pathname, "/rest/v1/rpc/foliage_reserve_subject"); return json({ message: "foliage_address_limit" }, 400); }]);
  await assert.rejects(h.store.reserveSubject(actor, "cap-four"), { code: "address-limit", message: addressLimitError().message });
  assert.match(addressLimitError().message, new RegExp(`already has ${MAX_ADDRESSES_PER_ACCOUNT} portfolio addresses.*Contact support to raise the limit\\.$`));
  const sql = await readFile(new URL("../../../supabase/migrations/202610090001_address_cap.sql", import.meta.url), "utf8");
  assert.deepEqual([...sql.matchAll(/where owner_id = p_actor\) >= (\d+) then/g)].map(m => Number(m[1])), [MAX_ADDRESSES_PER_ACCOUNT]);
});

test("foreign inventory ownership and credential-bearing provider URLs refuse", async () => {
  const h = harness([() => json([{ ...publicHead, actorId: "10000000-0000-4000-8000-000000000002" }])]);
  await assert.rejects(h.store.listOwned(actor), { code: "corrupt" });
  const credentialUrl = new URL("https://storage.example");
  credentialUrl.username = "user"; credentialUrl.password = "secret";
  assert.throws(() => createHostedStore({ supabaseUrl: credentialUrl.href, serviceRoleKey: "test" }), { code: "invalid" });
  assert.throws(() => createHostedStore({ supabaseUrl: "http://storage.example", serviceRoleKey: "test" }), { code: "invalid" });
});

function imageOperation() {
  // Container transport input only; no customer photo or storage service is fabricated.
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=", "base64");
  const imageDigest = documentDigest(image);
  const document = { ...payload, artifactVersion: 6, leaf: { ...payload.leaf, leaflets: [{ id: "image-transport", title: "Image transport contract", tier: "pending", titleRedacted: false,
    photos: [{ sourceRef: imageDigest, renditionDigest: imageDigest, bytes: image.length, format: "png", alt: "Container regression pixel" }] }] } };
  const parsed = parsePublishedDocument(document); assert.ok(parsed.ok);
  const canonical = JSON.stringify(toArtifactJson(parsed.document)), digest = documentDigest(Buffer.from(canonical));
  return { image, imageDigest, canonical, digest, operation: { ...operation, document, photos: JSON.stringify([{ digest: imageDigest, base64: image.toString("base64") }]), admission: { ...operation.admission, artifactDigest: digest } } };
}

test("photo publish stages immutable account/subject/revision bytes before the artifact transaction; exact retry cannot reattach withdrawn images", async () => {
  const p = imageOperation(); let imageKey = "", receipt: Record<string, unknown> | undefined;
  const h = harness([absent, bucket, call => {
    imageKey = call.url.pathname;
    assert.match(imageKey, new RegExp(`/${actor.id}/${operation.subjectId}/[0-9a-f-]{36}/${p.imageDigest.slice(7)}\\.png$`));
    assert.deepEqual(Buffer.from(call.init.body as ArrayBuffer), p.image);
    assert.equal(new Headers(call.init.headers).get("content-type"), "image/png");
    assert.equal(new Headers(call.init.headers).get("x-upsert"), "false");
    return json({}, 201);
  }, call => { assert.equal(call.init.body, p.canonical); assert.ok(imageKey.includes(String(call.url.pathname.split("/").at(-1)).replace(".json", "/"))); return json({}, 201); }, call => {
    assert.equal(call.body["p_artifact_digest"], p.digest);
    assert.equal((call.body["p_admission"] as Record<string, unknown>)["artifactDigest"], p.digest);
    receipt = saved(call); return json(receipt);
  }]);
  const first = await h.store.publish(actor, p.operation); assert.equal(first.current.visible, true);
  h.steps.push(() => json({ ...receipt, replayed: true, current: { subjectId: operation.subjectId, revisionId: null, generation: 2, visible: false } }));
  const second = await h.store.publish(actor, p.operation); assert.equal(second.replayed, true); assert.equal(second.current.visible, false); assert.equal(h.calls.length, 6);
});

test("missing, tampered and foreign-account photo requests cannot stage or commit", async () => {
  const p = imageOperation();
  for (const input of [{ ...p.operation, photos: "[]" }, { ...p.operation, photos: p.operation.photos.replace("iVBOR", "jVBOR") }]) {
    const h = harness([absent]); await assert.rejects(h.store.publish(actor, input)); assert.equal(h.calls.length, 1);
  }
  const h = harness([absent]);
  await assert.rejects(h.store.publish({ id: "10000000-0000-4000-8000-000000000002" }, p.operation), (e: any) => e.code === "forbidden");
  assert.equal(h.calls.length, 1);
  const interrupted = harness([absent, bucket, () => json({}, 503)]);
  await assert.rejects(interrupted.store.publish(actor, p.operation), /no publication commit/); assert.equal(interrupted.calls.length, 3);
});

test("image reads require the exact current artifact and selected digest, and recheck withdrawal after byte reading", async () => {
  const p = imageOperation(), head = { ...publicHead, artifactDigest: p.digest, artifactBytes: Buffer.byteLength(p.canonical) };
  const steps = () => [() => json(head), bucket, () => new Response(p.canonical), () => json(head), () => json(head)] satisfies Step[];
  const h = harness([...steps(), call => {
    assert.equal(call.url.pathname, `/storage/v1/object/authenticated/${PUBLICATION_BUCKET}/${actor.id}/${operation.subjectId}/${revision}/${p.imageDigest.slice(7)}.png`);
    return new Response(p.image);
  }, () => json(head)]);
  assert.deepEqual((await h.store.readPhoto(operation.subjectId, p.digest, p.imageDigest))?.bytes, p.image); assert.equal(h.steps.length, 0);
  const withdrawn = harness([...steps(), () => new Response(p.image), () => json(null)]);
  assert.equal(await withdrawn.store.readPhoto(operation.subjectId, p.digest, p.imageDigest), null);
  const removed = harness([() => json(publicHead), bucket, () => new Response(canonical), () => json(publicHead)]);
  assert.equal(await removed.store.readPhoto(operation.subjectId, p.digest, p.imageDigest), null); assert.equal(removed.calls.length, 4);
  const absentPhoto = harness([...steps(), () => json(null, 404)]);
  await assert.rejects(absentPhoto.store.readPhoto(operation.subjectId, p.digest, p.imageDigest), /unavailable/);
  const corruptPhoto = harness([...steps(), () => new Response(Buffer.alloc(p.image.length))]);
  await assert.rejects(corruptPhoto.store.readPhoto(operation.subjectId, p.digest, p.imageDigest), /byte and metadata/);
});

async function videoOperation(t: { skip: (reason: string) => void; after: (fn: () => Promise<unknown>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "foliage-video-transport-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "protocol.mp4");
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=32x32:d=1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path]);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") { t.skip("ffmpeg is unavailable"); return null; }
    throw error;
  }
  const base = imageOperation(), clip = await readFile(path), clipDigest = documentDigest(clip);
  const document = { ...base.operation.document as typeof payload, artifactVersion: 7,
    leaf: { ...payload.leaf, leaflets: [{ ...((base.operation.document as { leaf: { leaflets: Record<string, unknown>[] } }).leaf.leaflets[0] ?? {}),
      videos: [{ sourceRef: clipDigest, bytes: clip.length, durationSeconds: 1, posterRef: base.imageDigest }] }] } };
  const parsed = parsePublishedDocument(document); assert.ok(parsed.ok);
  const canonical = JSON.stringify(toArtifactJson(parsed.document)), digest = documentDigest(Buffer.from(canonical));
  const videos = JSON.stringify([{ digest: clipDigest, base64: clip.toString("base64") }]);
  const operationWithVideo = { ...base.operation, document, videos,
    admission: { ...base.operation.admission, artifactDigest: digest } };
  return { ...base, clip, clipDigest, canonical, digest, videos, operation: operationWithVideo };
}

test("video transfer requires exactly selected H.264 bytes and stages them before the authority commit", async t => {
  const p = await videoOperation(t); if (!p) return;
  const parsed = parsePublishedDocument(p.operation.document); assert.ok(parsed.ok);
  assert.deepEqual(decodeVideoTransfer(parsed.document, p.videos)[0]?.bytes, p.clip);
  const video = parsed.document.leaf.leaflets[0]?.videos?.[0]; assert.ok(video);
  checkVideoBytes(video, p.clip);
  for (const transfer of ["[]", p.videos.replace("base64", "extra"), JSON.stringify([...JSON.parse(p.videos), ...JSON.parse(p.videos)]),
    JSON.stringify([{ digest: p.clipDigest, base64: p.clip.toString("base64") + "\n" }])]) {
    assert.throws(() => decodeVideoTransfer(parsed.document, transfer));
  }
  const h = harness([absent, bucket, call => {
    assert.match(call.url.pathname, new RegExp(`${p.imageDigest.slice(7)}\\.png$`));
    assert.deepEqual(Buffer.from(call.init.body as ArrayBuffer), p.image); return json({}, 201);
  }, call => {
    assert.match(call.url.pathname, new RegExp(`${p.clipDigest.slice(7)}\\.mp4$`));
    assert.equal(new Headers(call.init.headers).get("content-type"), "video/mp4");
    assert.deepEqual(Buffer.from(call.init.body as ArrayBuffer), p.clip); return json({}, 201);
  }, call => { assert.equal(call.init.body, p.canonical); return json({}, 201); },
  call => { assert.equal(call.body["p_artifact_digest"], p.digest); return json(saved(call)); }]);
  assert.equal((await h.store.publish(actor, p.operation)).current.visible, true);
  assert.equal(h.steps.length, 0);
  for (const transfer of ["[]", p.videos.replace("base64", "extra")]) {
    const refused = harness([absent]);
    await assert.rejects(refused.store.publish(actor, { ...p.operation, videos: transfer }));
    assert.equal(refused.calls.length, 1, "invalid clips cannot reach private storage");
  }
});

test("video reads require the exact current artifact and stop on withdrawal after byte reading", async t => {
  const p = await videoOperation(t); if (!p) return;
  const head = { ...publicHead, artifactDigest: p.digest, artifactBytes: Buffer.byteLength(p.canonical) };
  const steps = () => [() => json(head), bucket, () => new Response(p.canonical), () => json(head), () => json(head)] satisfies Step[];
  const live = harness([...steps(), call => {
    assert.equal(call.url.pathname, `/storage/v1/object/authenticated/${PUBLICATION_BUCKET}/${actor.id}/${operation.subjectId}/${revision}/${p.clipDigest.slice(7)}.mp4`);
    return new Response(p.clip);
  }, () => json(head)]);
  assert.deepEqual((await live.store.readVideo(operation.subjectId, p.digest, p.clipDigest))?.bytes, p.clip);
  const withdrawn = harness([...steps(), () => new Response(p.clip), () => json(null)]);
  assert.equal(await withdrawn.store.readVideo(operation.subjectId, p.digest, p.clipDigest), null);
  const wrongArtifact = harness([() => json(head), bucket, () => new Response(p.canonical), () => json(head)]);
  assert.equal(await wrongArtifact.store.readVideo(operation.subjectId, documentDigest(Buffer.from("previous artifact")), p.clipDigest), null);
  const corrupt = harness([...steps(), () => new Response(Buffer.alloc(p.clip.length))]);
  await assert.rejects(corrupt.store.readVideo(operation.subjectId, p.digest, p.clipDigest), { code: "corrupt" });
});
