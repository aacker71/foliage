#!/usr/bin/env node
/**
 * Export ONE leaf as a folder of static files somebody else can host.
 *
 * WHY THIS EXISTS. Everything this product serves binds to 127.0.0.1, so a portfolio has never
 * been visible to anyone but the person who ran it. That is the whole gap between "it works on my
 * machine" and "a portfolio": measured 2026-08-20, zero people other than the owner had ever seen
 * one. The page turns out to already BE a static document — the served bytes carry no <script>
 * and no <form>, four same-origin stylesheets and one SVG — so closing that gap needs a file
 * writer, not a hosting plane.
 *
 *   node apps/leaf/export.mjs --out <dir> [--confirm]
 *
 * It uses the server's public `renderLeafPage` and `renderLeafletPage`. The export selects exactly
 * which records cross the public boundary; the existing readers render those records.
 *
 * Asset URLs become relative, the index links only to detail files it writes, and verified clean
 * media is copied only when an admitted body cites it. The public renderer omits local document
 * diagnostics. No server-only link survives.
 *
 * THE TITLE GATE. A leaflet title can be a copied commit subject containing somebody else's
 * address. The public renderer redacts identifier-shaped spans and removes the verbatim marker
 * from changed text. Export still refuses first and names the affected titles: --confirm is the
 * owner's acknowledgement that the published heading will differ from the retained source.
 *
 * CONSENT, WHICH USED TO BE ABSENT HERE ENTIRELY. Measured on a scratch garden grown from this
 * repository: 250 leaflets, 0 of them carrying any `visibility` — nobody offered anything — and
 * `foliage export` wrote every one of their titles into the page anyway, alongside a
 * verified/pending/excluded/total tally for the person. That was two defects: the page carried
 * leaflets nobody offered, and it carried a per-person tier TALLY, which `publicProjection.ts`
 * refuses in its own words ("per artifact the tier is a fact the reader needs; per person, summed,
 * it is a score"). Both are closed the same way canopy's public projection closes them: build ONE
 * projected document — the leaf, with its leaflets filtered to the set the person actually
 * crossed the outward line for — and hand THAT, whole, to the unchanged renderer. Nothing
 * downstream (rows, groups, the frond, the title gate above) may see a leaflet this file did not
 * decide belongs on the page.
 */
import { mkdir, writeFile, readFile, readdir, copyFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { requireNodeFloor } from "./src/nodeFloor.mjs";

// BEFORE the first .ts import: below the floor, linking a .ts module dies with a raw loader
// stack — this line is the last chance to say something human. See src/nodeFloor.mjs.
requireNodeFloor();

const { explainFailedWorkspaceImport } = await import("./src/preflight.ts");

const { loadLeafDocument, fabricationSignals } = await import("./src/leafDocument.ts").catch(explainFailedWorkspaceImport);
const { renderLeafPage, renderLeafletPage, findLeaflet } = await import("./src/render.ts").catch(explainFailedWorkspaceImport);
const { readMedia, mediaRootFromEnv } = await import("./src/mediaStore.ts").catch(explainFailedWorkspaceImport);
const { readVideo, videoRootFromEnv } = await import("./src/videoStore.ts").catch(explainFailedWorkspaceImport);
const { loadPublishPolicy } = await import("./src/policyDocument.ts").catch(explainFailedWorkspaceImport);
const { outwardStateOf } = await import("./src/policy.ts").catch(explainFailedWorkspaceImport);
const { detectRedactableSpans, isListedOnLeaf, isSubjectsOwnWork, leafletVisibility } = await import(
  "@foliage/leaf"
).catch(explainFailedWorkspaceImport);

const USAGE = `Export ONE leaf as a folder of static files somebody else can host.

  node apps/leaf/export.mjs --out <dir> [--confirm] [--video sha256:<digest>]
`;

// SAME PATTERN AS intake.mjs AND harvest.mjs: strict:true, so a mistyped flag is refused with
// a named error instead of silently doing nothing. The hand-rolled argv.indexOf this replaced
// had no such refusal — `--otu <dir>` left OUT undefined and `--cofirm` left the title gate
// engaged with no explanation, on the one command that hands a portfolio to somebody else.
let parsed;
try {
  parsed = parseArgs({
    options: {
      out: { type: "string" },
      confirm: { type: "boolean", default: false },
      video: { type: "string", multiple: true },
    },
    strict: true,
  });
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  process.exit(2);
}
const { values } = parsed;

const OUT = values.out;
if (OUT === undefined) {
  process.stderr.write(`export: --out <dir> is required.\n\n${USAGE}`);
  process.exit(2);
}

/**
 * The addresses in one title, by the ONE rule `packages/canopy/src/publish.ts` also redacts with
 * (`@foliage/leaf`'s `redaction.ts`). This file used to keep its own pattern without the
 * apostrophe, so the refusal named `brien@…` out of `o'brien@…` (F-021). Addresses only, as
 * before: a scoped package name (`@foliage/tokens`) is not personal data, and the gate's classes
 * are unchanged here.
 * @param {string} title
 */
const addressesIn = (title) =>
  detectRedactableSpans(title, ["email-address"]).map((s) => title.slice(s.start, s.end));

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const TOKENS_CSS = fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css"));
const TOKENS_DIR = dirname(TOKENS_CSS);

/** Exactly the files the rendered page asks for. Not a directory copy — an allow-list.
 * @type {readonly (readonly [string, string])[]} */
const ASSETS = [
  ["tokens.css", TOKENS_CSS],
  ["roles.css", join(TOKENS_DIR, "roles.css")],
  ["foliage.css", join(TOKENS_DIR, "foliage.css")],
  ["mark-icon.svg", join(TOKENS_DIR, "mark-icon.svg")],
  ["leaf.css", join(APP_DIR, "public", "leaf.css")],
  ["fonts/fraunces-var.woff2", join(TOKENS_DIR, "fonts", "fraunces-var.woff2")],
  ["fonts/instrument-sans-var.woff2", join(TOKENS_DIR, "fonts", "instrument-sans-var.woff2")],
  ["fonts/jbmono-400.woff2", join(TOKENS_DIR, "fonts", "jbmono-400.woff2")],
  ["fonts/jbmono-500.woff2", join(TOKENS_DIR, "fonts", "jbmono-500.woff2")],
];

const load = await loadLeafDocument();
if (!load.ok) {
  process.stderr.write(`export: no leaf to export — ${load.cause}: ${load.detail}\n`);
  process.exit(1);
}

// A bundled or declared example is never an owner's public record. A visual example band is
// useful in the local reader, but a static folder can be copied without that context.
const exampleSignals = fabricationSignals(load.source);
if (exampleSignals.length > 0) {
  process.stderr.write(`export: REFUSED — example material is not a publishable record (${exampleSignals.join("; ")}). Nothing was written.\n`);
  process.exit(2);
}

const policy = await loadPublishPolicy();
if (!policy.ok) {
  // REFUSED BY CAUSE, NAMED, EXIT 2, NOTHING WRITTEN — the same rail every server route already
  // stands on (`server.mjs`'s `policyRefusal`). Before this fix the failure object itself
  // (`{ok:false,cause,detail,...}`) was handed to the renderer as though it were a policy
  // (`policy.policy ?? policy`, which resolves to the whole failure object when `.policy` is
  // absent), and it died two files downstream inside `publishPolicy.ts`'s evaluator: "TypeError:
  // Cannot read properties of undefined (reading 'entries')" — a stack trace naming neither the
  // cause nor the file, on the one command with no server around it to print anything better.
  process.stderr.write(
    `export: REFUSED — the publish policy could not be read, so nothing was exported.\n` +
      `export: cause: ${policy.cause}\n${policy.detail}\n`,
  );
  if (policy.cause === "invalid") {
    for (const issue of policy.issues) process.stderr.write(`export:   ${issue.at}: ${issue.message}\n`);
  }
  process.exit(2);
}

// THE PROJECTION — built ONCE, here, and handed WHOLE to the unchanged renderer. Filtering rows
// inside `renderLeaf` would still leak: the frond draws one ellipse per leaflet IN THE DOCUMENT
// (frond.ts, render.ts) and the ledger counts the whole leaf, so a filtered ROW would still be
// counted and drawn. `crosses` asks three separate questions and all three are load-bearing:
//   isSubjectsOwnWork   whose work is this — structural, not a policy rule a person can drop.
//   isListedOnLeaf      did the person offer it — public means listed; unlisted is a LINK
//                       consent and belongs to nobody's browsed page (publicProjection.ts rule 3).
//   outwardStateOf      does the rail allow it — a deny beats even a public share.
// Everything downstream — rows, groups, frond, the count strip's own render.ts gate, and the
// title gate two lines below — sees this SAME set, because they all read this ONE document.
/** @param {import("@foliage/leaf").Leaflet} l */
const crosses = (l) =>
  isSubjectsOwnWork(l) &&
  isListedOnLeaf(leafletVisibility(l)) &&
  outwardStateOf(policy.policy, l).kind === "served";
const selectedVideoRefs = new Set(values.video ?? []);
if (selectedVideoRefs.size !== (values.video ?? []).length || selectedVideoRefs.size > 2 ||
    [...selectedVideoRefs].some(ref => !/^sha256:[0-9a-f]{64}$/.test(ref))) {
  process.stderr.write("export: REFUSED — select each SHA-256 video ref once, at most two. Nothing was written.\n");
  process.exit(2);
}
const admitted = load.leaf.leaflets.filter(crosses);
const videoOccurrences = new Map();
for (const leaflet of admitted) {
  for (const element of leaflet.body ?? []) {
    if (!("media" in element) || element.media.mediaType !== "video/mp4") continue;
    videoOccurrences.set(element.provenance.ref, (videoOccurrences.get(element.provenance.ref) ?? 0) + 1);
  }
}
if ([...selectedVideoRefs].some(ref => !videoOccurrences.has(ref))) {
  process.stderr.write("export: REFUSED — a selected clip is not in currently shared, policy-admitted work. Nothing was written.\n");
  process.exit(2);
}
// --video names one digest, so it cannot express which context to publish when that digest
// appears more than once. Refuse the ambiguous selection instead of widening consent to every
// Leaflet (or every caption) that happens to cite the same bytes.
if ([...selectedVideoRefs].some(ref => videoOccurrences.get(ref) !== 1)) {
  process.stderr.write("export: REFUSED — a selected clip appears more than once in shared work. Remove the duplicate or choose the exact Leaflet in Canopy. Nothing was written.\n");
  process.exit(2);
}
const selectedVideos = new Map();
const videoPosterRefs = new Map();
const selectedPosters = new Map();
for (const ref of selectedVideoRefs) {
  const video = await readVideo(videoRootFromEnv(), ref);
  if (!video.ok || video.bytes.length > 1024 * 1024) {
    process.stderr.write(`export: REFUSED — selected video ${ref} is unavailable or exceeds the 1 MiB public clip limit (${video.ok ? "too-large" : video.cause}). Nothing was written.\n`);
    process.exit(2);
  }
  const owningLeaflet = admitted.find(l => (l.body ?? []).some(e =>
    "media" in e && e.media.mediaType === "video/mp4" && e.provenance.ref === ref));
  const posterElement = owningLeaflet?.body?.find(e => "media" in e &&
    e.media.mediaType.startsWith("image/") && e.provenance.ref === video.metadata.posterRef);
  const poster = posterElement && await readMedia(mediaRootFromEnv(), video.metadata.posterRef);
  if (!posterElement || !poster?.ok) {
    process.stderr.write(`export: REFUSED — selected video ${ref} has no available reviewed still in the same shared work. Nothing was written.\n`);
    process.exit(2);
  }
  selectedVideos.set(ref, video.bytes);
  videoPosterRefs.set(ref, video.metadata.posterRef);
  selectedPosters.set(video.metadata.posterRef, poster);
}
// Sharing a Leaflet does not automatically share its clip. A separate --video selection is
// required, and no renderer downstream sees unselected video body elements.
const projected = admitted.map(l => ({ ...l, ...(l.body ? { body: l.body.filter(e =>
  !("media" in e && e.media.mediaType === "video/mp4") || selectedVideoRefs.has(e.provenance.ref)) } : {}) }));
const projectedLoad = { ...load, leaf: { ...load.leaf, leaflets: projected } };

// IDs can contain separators and can exceed filesystem component limits. Opaque, fixed-width
// names make one admitted record one address without exposing or interpreting the ID as a path.
/** @param {string} id */
const detailName = (id) => `${createHash("sha256").update(id).digest("hex")}.html`;
/** @type {Map<string, string>} */
const detailHrefs = new Map(projected.map((leaflet) => [leaflet.id, `leaflet/${detailName(leaflet.id)}`]));

// THE GATE. Read the titles off the PROJECTED DOCUMENT, not off the rendered HTML and not off the
// whole one: the page escapes what it carries (scanning markup would miss an address that
// HTML-encoded and pass it anyway), and a leaflet this export withholds for consent can never
// publish its title either — refusing an export over a title the page will never carry would be
// refusing to publish nothing.
const offenders = projected
  .map((l) => ({ id: l.id, title: String(l.title ?? ""), hits: addressesIn(String(l.title ?? "")) }))
  .filter((l) => l.hits.length > 0);

if (offenders.length > 0 && values.confirm !== true) {
  process.stderr.write(
    `export: REFUSED — ${offenders.length} leaflet title(s) carry an email address, and this ` +
      `export will display redacted titles on ${load.leaf.subject}'s portfolio.\n` +
      `export: NOTHING was written to ${OUT}.\n`,
  );
  for (const o of offenders) {
    process.stderr.write(`export:   ${o.id} — ${o.hits.join(", ")}\n`);
  }
  process.stderr.write(
    `export: re-run with --confirm to publish the redacted titles, or edit them in your\n` +
      `export:   private record first. Source words remain available there.\n`,
  );
  process.exit(3);
}

const out = resolve(OUT);
const MANIFEST = "foliage-export-manifest.json";
const generatedPath = /^(?:leaflet\/[0-9a-f]{64}\.html|media\/[0-9a-f]{64}\.(?:jpeg|png|gif|mp4))$/;
// A completed static folder is a release, not a mutable document. Rewriting it can leave
// withdrawn pages directly reachable after a crash even if its new index no longer links them.
// A fresh sibling folder can be inspected and installed by the host as one release instead.
/** @type {string[]} */
let existing = [];
try { existing = await readdir(out); }
catch (err) {
  if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) {
    process.stderr.write(`export: REFUSED — ${out} cannot be read as a directory. Nothing was written.\n`);
    process.exit(3);
  }
}
if (existing.includes("index.html") || (existing.length > 0 && !existing.includes(MANIFEST))) {
  process.stderr.write(
    `export: REFUSED — ${out} already contains ${existing.includes("index.html") ? "a published index" : "files without a recovery manifest"}.\n` +
    `export: Nothing was written. Choose a fresh --out directory, then switch the host to that finished export.\n`,
  );
  process.exit(3);
}
let previouslyGenerated = [];
try {
  const previous = JSON.parse(await readFile(join(out, MANIFEST), "utf8"));
  if (!Array.isArray(previous.files) || !previous.files.every(/** @param {unknown} file */ (file) => typeof file === "string" && generatedPath.test(file))) {
    throw new Error("the generated-file list is invalid");
  }
  previouslyGenerated = previous.files;
} catch (err) {
  if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) {
    process.stderr.write(`export: REFUSED — cannot safely replace the previous export manifest: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
}

await mkdir(join(out, "fonts"), { recursive: true });
await mkdir(join(out, "leaflet"), { recursive: true });
// The manifest is a write-ahead list. If this process stops after creating a new detail or
// media file but before finishing the export, the next run still knows which files to remove.
// Replace the manifest atomically so a killed write cannot destroy the previous cleanup list.
/** @param {string} name @param {string | Buffer} content */
const writeAtomically = async (name, content) => {
  const temp = join(out, `${name}.${process.pid}.tmp`);
  try {
    await writeFile(temp, content);
    await rename(temp, join(out, name));
  } finally { await rm(temp, { force: true }); }
};
/** @param {Iterable<string>} files */
const writeManifest = async (files) => writeAtomically(MANIFEST, JSON.stringify({ files: [...files] }, null, 2) + "\n");
const journal = new Set([...previouslyGenerated, ...detailHrefs.values()]);
await writeManifest(journal);
for (const file of previouslyGenerated) await rm(join(out, file), { force: true });

// Only media cited by an admitted Leaflet can enter the folder. readMedia checks the clean
// published bytes against the store manifest before this writer sees them. Missing or damaged
// media stays a named absence in the detail page, never a broken /media link.
/** @type {Map<string, string>} */
const mediaHrefs = new Map();
const generated = [];
const mediaRefs = new Set(projected.flatMap((leaflet) => (leaflet.body ?? [])
  .filter((element) => "media" in element && element.media.mediaType !== "video/mp4")
  .map((element) => element.provenance.ref)));
const mediaRoot = mediaRootFromEnv();
for (const ref of mediaRefs) {
  const media = selectedPosters.get(ref) ?? await readMedia(mediaRoot, ref);
  if (!media.ok) {
    process.stderr.write(`export: image ${ref} unavailable (${media.cause}); its Leaflet keeps the evidence ref.\n`);
    continue;
  }
  const file = `media/${ref.slice("sha256:".length)}.${media.format}`;
  journal.add(file);
  await writeManifest(journal);
  await mkdir(join(out, "media"), { recursive: true });
  await writeAtomically(file, media.bytes);
  generated.push(file);
  mediaHrefs.set(ref, `../${file}`);
}

const posterHrefs = new Map();
for (const [videoRef, posterRef] of videoPosterRefs) {
  const href = mediaHrefs.get(posterRef);
  if (!href) {
    process.stderr.write(`export: REFUSED — selected video ${videoRef} has no copied poster in the admitted export. Nothing was published.\n`);
    process.exit(2);
  }
  posterHrefs.set(videoRef, href);
}

for (const [ref, videoBytes] of selectedVideos) {
  const file = `media/${ref.slice("sha256:".length)}.mp4`;
  journal.add(file);
  await writeManifest(journal);
  await mkdir(join(out, "media"), { recursive: true });
  await writeAtomically(file, videoBytes);
  generated.push(file);
  mediaHrefs.set(ref, `../${file}`);
}

// A published server page has no static detail address. The exporter supplies only addresses
// for its own admitted projection, then writes each destination with the existing public reader.
// Assets walk up one directory in details; links in the index stay relative to index.html.
/** @param {string} html @param {string} prefix */
const staticPage = (html, prefix) => {
  const page = html
    .replace(/(href|src)="\/(tokens\.css|roles\.css|foliage\.css|leaf\.css|mark-icon\.svg)"/g, `$1="${prefix}$2"`)
    .replace(/<a class="leaf-source-link" href="\/review">[^<]*<\/a>/g, "");
  const absolute = [...page.matchAll(/(?:href|src)="(\/[^"#]*)"/g)].map((match) => match[1]);
  if (absolute.length > 0) throw new Error(`the static page retains server links: ${[...new Set(absolute)].join(", ")}`);
  return page;
};

for (const leaflet of projected) {
  const lookup = findLeaflet(projectedLoad.leaf, leaflet.id, policy.policy, "published");
  if (!lookup.ok) throw new Error(`the admitted Leaflet ${leaflet.id} was refused by its public reader`);
  const detail = staticPage(renderLeafletPage(lookup, load.source, "published", {
    backHref: "../index.html",
    mediaHrefs,
    posterHrefs,
  }), "../");
  const file = detailHrefs.get(leaflet.id);
  if (file === undefined) throw new Error(`the admitted Leaflet ${leaflet.id} has no static address`);
  await writeAtomically(file, detail);
  generated.push(file);
}

const page = staticPage(renderLeafPage(projectedLoad, policy.policy, "published", {}, (id) => detailHrefs.get(id) ?? null), "");

let copied = 0;
for (const [rel, src] of ASSETS) {
  try {
    await copyFile(src, join(out, rel));
    copied += 1;
  } catch (err) {
    // Both causes, ours and the filesystem's — a missing asset is a broken page, not a warning.
    process.stderr.write(`export: FAILED to copy ${rel} from ${src}: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

// Publish the new entrypoint only after every linked page, asset, and final journal exists.
// A partial index write cannot leave readers with truncated HTML.
await writeManifest(generated);
await writeAtomically("index.html", page);

// THE OWNER-FACING TALLY. This is the OWNER reading their own machine before they hand the folder
// to anyone, so counts are fine here — it is the PAGE that may carry none (publicProjection.ts:
// "per person, summed, it is a score"). Four questions over this person's OWN work only
// (`isSubjectsOwnWork`): did they list it (crossed into this export), did they share it by link
// only (not in this export), did they never offer it at all, or did they offer it and the rail
// withhold it anyway.
const ownWork = load.leaf.leaflets.filter(isSubjectsOwnWork);
const unlistedCount = ownWork.filter((l) => leafletVisibility(l) === "unlisted").length;
const privateCount = ownWork.filter((l) => leafletVisibility(l) === "private").length;
const withheldByRuleCount = ownWork.filter(
  (l) => isListedOnLeaf(leafletVisibility(l)) && outwardStateOf(policy.policy, l).kind === "withheld-by-rule",
).length;

process.stdout.write(
  `export: wrote ${out}/index.html (${Buffer.byteLength(page, "utf8")} bytes), ${projected.length} Leaflet page(s), and ${copied + mediaHrefs.size} asset(s)\n` +
    `export: ${projected.length} leaflet(s) for ${load.leaf.subject}\n` +
    `export: ${projected.length} listed · ${unlistedCount} unlisted (not in this export — reachable only at your own /leaflet/<id>)\n` +
    `export: ${privateCount} private · ${withheldByRuleCount} withheld by rule\n` +
    `export: ${offenders.length === 0 ? "no title carries an email address" : `${offenders.length} title(s) redacted under --confirm`}\n` +
    `export: no absolute links remain\n` +
    `export: open it with  open ${out}/index.html   — or host the folder as it is\n`,
);
