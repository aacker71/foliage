/** Executable format/transport inputs, never a person's portfolio or provider acceptance. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { leafId, leafletId, type Leaf } from "@foliage/leaf";
import { documentDigest, parsePublishedDocument, toArtifactJson, diffPublications, reviewForPublication, MAX_PUBLIC_PHOTO_BYTES, type PublishedPhoto } from "@foliage/canopy";
import { putImage } from "@foliage/leaf-app/mediaStore";
import { checkPhotoBytes, decodePhotoTransfer } from "./publicationPhotos.ts";
import { selectLocalPhotos, localPhotoChoices } from "./localPublicationPhotos.ts";
import { publicationView } from "./publicationView.ts";

// A decodable 1x1 PNG exercises the container; it is not displayed as portfolio content.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=", "base64");
const source = await readFile(fileURLToPath(import.meta.url));
const photo: PublishedPhoto = { sourceRef: documentDigest(png), renditionDigest: documentDigest(png), bytes: png.length, format: "png", alt: "Container regression pixel" };
function rawPhotoDocument() {
  return { artifact: "foliage/published-leaf", artifactVersion: 6, publishedAt: "2026-09-09T00:00:00Z",
    source: { documentDigest: documentDigest(source), documentBytes: source.length, policyDigest: documentDigest(Buffer.from("photo contract policy")) },
    leaf: { id: "photo-contract", subject: "Photo contract", subjectRedacted: false, leaflets: [{ id: "container", title: "Container regression", tier: "pending", titleRedacted: false, photos: [{ ...photo }] }] },
    withheld: { count: 0, kinds: [] } };
}
const document = () => { const parsed = parsePublishedDocument(rawPhotoDocument()); assert.ok(parsed.ok); return parsed.document; };
const transfer = JSON.stringify([{ digest: photo.renditionDigest, base64: png.toString("base64") }]);

test("photo v6 round-trips closed fields; v5 remains closed and image changes are visible in the diff", () => {
  const raw = rawPhotoDocument(), doc = document();
  assert.deepEqual(toArtifactJson(doc), raw);
  assert.equal(parsePublishedDocument({ ...raw, artifactVersion: 5 }).ok, false);
  const previous = { ...raw, artifactVersion: 4, leaf: { ...raw.leaf, leaflets: raw.leaf.leaflets.map(({ photos: _photos, ...l }) => l) } };
  const parsed = parsePublishedDocument(previous); assert.ok(parsed.ok);
  assert.deepEqual(toArtifactJson(parsed.document), previous);
  const change = diffPublications(parsed.document, doc); assert.equal(change.identical, false); assert.equal(change.changed[0]?.photosChanged, true);
  assert.equal(diffPublications(doc, parsed.document).changed[0]?.photosChanged, true);
  for (const patch of [{ url: "https://external.invalid/image" }, { score: 1 }, { alt: "" }, { alt: "Email owner@example.invalid" }, { caption: "/Users/private/photo.jpg" }, { sourceRef: [photo.sourceRef] }, { bytes: MAX_PUBLIC_PHOTO_BYTES + 1 }, { format: "svg" }]) {
    const candidate = rawPhotoDocument(); Object.assign(candidate.leaf.leaflets[0]!.photos[0]!, patch);
    assert.equal(parsePublishedDocument(candidate).ok, false, JSON.stringify(patch));
  }
  const many = rawPhotoDocument(); many.leaf.leaflets[0]!.photos = Array(5).fill(photo); assert.equal(parsePublishedDocument(many).ok, false);
});

test("byte admission refuses missing, extra, repeated, altered, noncanonical and metadata-bearing renditions", () => {
  checkPhotoBytes(photo, png);
  const admitted = decodePhotoTransfer(document(), transfer); assert.deepEqual(admitted[0]?.bytes, png);
  for (const raw of ["[]", "{}", transfer.replace("base64", "unrecognized"), JSON.stringify([{ digest: photo.renditionDigest, base64: png.toString("base64") + "\n" }]), JSON.stringify(JSON.parse(transfer).concat(JSON.parse(transfer)))]) assert.throws(() => decodePhotoTransfer(document(), raw));
  const changed = Buffer.from(png); changed[40] = (changed[40] ?? 0) ^ 1;
  assert.throws(() => decodePhotoTransfer(document(), JSON.stringify([{ digest: photo.renditionDigest, base64: changed.toString("base64") }])));
  const trailing = Buffer.concat([png, Buffer.from("private trailing metadata")]);
  assert.throws(() => checkPhotoBytes({ ...photo, bytes: trailing.length, renditionDigest: documentDigest(trailing) }, trailing), /metadata|structure/);
  assert.throws(() => checkPhotoBytes({ ...photo, format: "jpeg" }, png), /container/);
});

test("local selection strips first, starts empty, binds preview digest and keeps caption choice separate", async t => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-photo-contract-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "container.png"), original = Buffer.concat([png, Buffer.from("metadata removed by the existing local store")]);
  await writeFile(sourcePath, original);
  const stored = await putImage({ root: join(dir, "media"), sourcePath, sourceDigest: documentDigest(original).slice(7), sourceFormat: "png", sipsRuns: false }); assert.ok(stored.ok);
  assert.notEqual(stored.manifest.ref, stored.manifest.publishedDigest);
  const leaf: Leaf = { id: leafId("photo-contract"), subject: "Photo contract", leaflets: [{ id: leafletId("container"), title: "Container regression", tier: "pending", visibility: "public", body: [{ provenance: { source: "photo", ref: stored.ref, observedAt: "2026-09-09T00:00:00Z" }, text: "Explicit caption input", media: { mediaType: "image/png", dimensions: { known: false, why: "Container-only contract" } } }] }] };
  const review = reviewForPublication({ leaf, declaredExample: false }); assert.ok(review.ok);
  const env = { FOLIAGE_MEDIA: join(dir, "media") };
  const choice = { leaflet: 0, element: 0, digest: stored.manifest.publishedDigest, alt: "Container regression pixel", caption: false };
  const options = await localPhotoChoices(leaf, review, env); assert.equal(options[0]?.photo?.renditionDigest, stored.manifest.publishedDigest);
  const none = await selectLocalPhotos(leaf, review, env, []); assert.equal(none.review.published.leaflets[0]?.photos, undefined); assert.equal(none.transfer, "[]");
  const selected = await selectLocalPhotos(leaf, review, env, [choice]); assert.equal(selected.review.published.leaflets[0]?.photos?.[0]?.caption, undefined);
  const captioned = await selectLocalPhotos(leaf, review, env, [{ ...choice, caption: true }]); assert.equal(captioned.review.published.leaflets[0]?.photos?.[0]?.caption, "Explicit caption input");
  await assert.rejects(selectLocalPhotos(leaf, review, env, [{ ...choice, digest: documentDigest(original) }]), /changed/);
  await assert.rejects(selectLocalPhotos(leaf, review, env, [choice, choice]), /once/);
  const privateReview = { ...review, published: { ...review.published, leaflets: [] } };
  await assert.rejects(selectLocalPhotos(leaf, privateReview, env, [choice]), /offered/);
});

test("reader uses escaped accessible figures and an artifact-bound same-origin media path", async () => {
  const raw = rawPhotoDocument(); raw.leaf.leaflets[0]!.photos[0]!.alt = 'A <pixel> with "quotes"';
  const parsed = parsePublishedDocument(raw); assert.ok(parsed.ok);
  const digest = documentDigest(Buffer.from(JSON.stringify(toArtifactJson(parsed.document))));
  const html = await publicationView(parsed.document, digest);
  assert.ok(html.includes(`/leaf/photo-contract/media/${digest.slice(7)}/${photo.renditionDigest.slice(7)}`));
  assert.match(html, /alt="A &lt;pixel&gt; with &quot;quotes&quot;"/);
  assert.doesNotMatch(html, /<figcaption>|data:image|storage\/v1/);
});
