/** Explicit local selection into the existing observation importer. No background source scan. */
import { createHash, randomUUID } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { boundedIntegrationFile, integrationJson, persistIntegrationObservations, readIntegrationTarget } from "./integrationStore.ts";
import { importObservationBatch, IMPORT_DOCUMENT_BYTES, isImportedObservationCandidate, parseObservationBatch, type ObservationBatch } from "./integrationImport.ts";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { parseHarvestDocument, type HarvestDocument } from "@foliage/photosynthesis";
import { RATING_SHAPED } from "@foliage/leaf";
import { mediaRootFromEnv, publishedFormatOf, stripKnownContainer } from "./mediaStore.ts";
import { queueSelectedDesignImage } from "./captureReview.ts";
import { dribbbleShotReference } from "./designImageReference.ts";
import { sourceCatalog, type SourceItem, type SourcePreview, type SourceBundlePreview, type SourceImagePreview } from "./sourceCatalog.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const MAX_FILE = 256 * 1024, EXCERPT = 15_000, TTL = 15 * 60_000;
// A bundle imports every chosen byte, without the single-file excerpt behavior.
const BUNDLE_FILES = 8, BUNDLE_FILE_BYTES = 15_000, BUNDLE_TOTAL_BYTES = 96_000;
const DESIGN_IMAGE_BYTES = 4 * 1024 * 1024;
const EXTENSION = /\.(?:md|txt|html?|svg|csv)$/i;
const safeName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 512 && !/[\u0000-\u001f\\/]/.test(v) && !v.startsWith(".");
const unsafeText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function personalName(value: unknown, max: number, label: string): string {
  if (!safeName(value) || value.length > max || !value.trim()) throw new Error(`${label} is missing or contains an unsupported character.`);
  return value.trim().normalize("NFC");
}
export function createSourceConnections(env: Readonly<Record<string, string | undefined>>) {
  const designRoot = resolve(env["FOLIAGE_OPEN_DESIGN_ROOT"] || join(homedir(), "Library/Application Support/Open Design/namespaces/release-stable/data/projects"));
  const projects = new Map<string, string>(), files = new Map<string, { path: string; root: string; label: string }>();
  const previews = new Map<string, { at: number; batch: ObservationBatch; view: SourcePreview | SourceBundlePreview; local?: { path: string; root: string; digest: string } }>();
  const imagePreviews = new Map<string, { at: number; raw: Buffer; clean: Buffer; view: SourceImagePreview;
    format: "png" | "jpeg"; leafId: string; subject: string }>();
  const into = env["FOLIAGE_LEAF"]?.trim(), out = env["FOLIAGE_HARVEST"]?.trim();
  const target = async () => {
    if (!into || !out) throw new Error("Choose a portfolio first.");
    try { return await readIntegrationTarget(into); }
    catch (error) {
      // A first run has no record yet: name the next step, never a raw ENOENT with a local path.
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw new Error("Create your private record first at /leaf/setup. Nothing was imported.");
      throw error;
    }
  };
  const expire = () => {
    for (const [id, p] of previews) if (Date.now() - p.at > TTL) previews.delete(id);
    for (const [id, p] of imagePreviews) if (Date.now() - p.at > TTL) imagePreviews.delete(id);
  };
  async function contained(path: string, root: string) {
    const actual = await realpath(path), base = await realpath(root);
    if (actual !== resolve(path) || !actual.startsWith(base + sep)) throw new Error("Choose a file inside the project.");
    return actual;
  }
  async function preview(provider: string, name: string, content: string, namespace: string, local?: { path: string; root: string; digest: string }) {
    expire();
    if (previews.size >= 20) throw new Error("Too many open previews. Cancel one.");
    if (!safeName(name) || !EXTENSION.test(name)) throw new Error("Unsupported file name or type. Use TXT, Markdown, HTML, SVG or CSV.");
    if (!content.trim() || Buffer.byteLength(content) > MAX_FILE || content.includes("\0")) throw new Error("Empty, over 256 KiB, or not plain UTF-8 text.");
    const leaf = await target(), id = randomUUID(), digest = hash(content), truncated = content.length > EXCERPT;
    const excerpt = content.slice(0, EXCERPT);
    const batch = parseObservationBatch({ format: "foliage-observations", version: 1,
      subject: { leafId: String(leaf.id), name: leaf.subject },
      source: { provider: `${provider}-local-export`, tenantId: null, accountId: hash(String(leaf.id)) },
      completion: "complete", deletedRecordIds: [], observations: [{ recordId: hash(namespace), revision: digest,
        title: name, excerpt: `Selected local file: ${name}\n${truncated ? 'Excerpt only; remaining text was not imported.\n' : ''}\n${excerpt}`, observedAt: new Date().toISOString() }] });
    const view = { id, provider, title: name, excerpt: batch.observations[0]!.excerpt, truncated, bytes: Buffer.byteLength(content) };
    previews.set(id, { at: Date.now(), batch, view, ...(local ? { local } : {}) });
    return { preview: view };
  }
  return {
    catalog: sourceCatalog,
    async previewDesignImage(input: Record<string, unknown>): Promise<{ imagePreview: SourceImagePreview }> {
      expire();
      if (imagePreviews.size >= 3) throw new Error("Three images are already open. Cancel one before choosing another.");
      if (Object.keys(input).sort().join(",") !== "base64,name,origin,project,referenceUrl,title") throw new Error("Choose one image and its project details.");
      const project = personalName(input["project"], 120, "Project name");
      const title = personalName(input["title"], 160, "Image title");
      if (`${project} · ${title}`.length > 200 || RATING_SHAPED.test(project) || RATING_SHAPED.test(title))
        throw new Error("Use a shorter project and title without rating-shaped text.");
      const name = personalName(input["name"], 255, "Image file name");
      if (!/\.(?:png|jpe?g)$/i.test(name)) throw new Error("Choose a PNG or JPEG image.");
      const origin = input["origin"];
      if (origin !== "figma-export" && origin !== "local-image") throw new Error("Choose how this local image was made.");
      const referenceUrl = dribbbleShotReference(input["referenceUrl"]);
      const base64 = input["base64"];
      if (typeof base64 !== "string" || base64.length === 0 || base64.length > Math.ceil(DESIGN_IMAGE_BYTES / 3) * 4 + 4)
        throw new Error("Image must be at most 4 MiB.");
      const raw = Buffer.from(base64, "base64");
      if (raw.length === 0 || raw.length > DESIGN_IMAGE_BYTES || raw.toString("base64") !== base64)
        throw new Error("Image bytes were incomplete or over 4 MiB.");
      const format = publishedFormatOf(raw);
      if ((format !== "png" && format !== "jpeg") ||
          (format === "png" ? !/\.png$/i.test(name) : !/\.jpe?g$/i.test(name))) throw new Error("File name and PNG/JPEG bytes disagree.");
      const stripped = stripKnownContainer(raw);
      if (!stripped?.ok) throw new Error("Image could not be safely prepared for preview. Nothing was saved.");
      const leaf = await target(), id = randomUUID();
      const view: SourceImagePreview = { id, provider: "design-image", title, project, name, bytes: raw.length,
        imageUrl: `/sources/image-preview/${encodeURIComponent(id)}`, origin, referenceUrl };
      imagePreviews.set(id, { at: Date.now(), raw, clean: Buffer.from(stripped.bytes), view, format, leafId: String(leaf.id), subject: leaf.subject });
      return { imagePreview: view };
    },
    async imagePreview(id: string): Promise<{ bytes: Buffer; type: "image/png" | "image/jpeg" } | null> {
      expire();
      const preview = imagePreviews.get(id);
      if (!preview) return null;
      try {
        const leaf = await target();
        if (String(leaf.id) !== preview.leafId || leaf.subject !== preview.subject) return null;
      } catch { return null; }
      return { bytes: preview.clean, type: preview.format === "png" ? "image/png" : "image/jpeg" };
    },
    async command(input: Record<string, unknown>): Promise<unknown> {
      if (input["action"] === "review-binding" || input["action"] === "bind-review") {
        await target();
        return withDocumentLocks([into!, out!], async () => {
          const leaf = await target(), bytes = await boundedIntegrationFile(out!, 8 * 1024 * 1024);
          const parsed = parseHarvestDocument(JSON.parse(bytes));
          if (!parsed.ok) throw new Error("Review queue invalid.");
          const h = parsed.harvest;
          if (h.subject !== undefined && h.subject !== leaf.subject || h.leafId !== undefined && h.leafId !== leaf.id) throw new Error("Queue belongs to another portfolio.");
          const digest = hash(JSON.stringify([hash(bytes), String(leaf.id), leaf.subject]));
          if (input["action"] === "review-binding") return { binding: { digest, subject: leaf.subject, leafId: String(leaf.id), titles: h.candidates.map(c => c.title), bound: h.subject === leaf.subject && h.leafId === leaf.id } };
          if (input["confirm"] !== true || input["digest"] !== digest) throw new Error("Queue changed. Review it again.");
          writeDocument(out!, JSON.stringify({ ...h, subject: leaf.subject, leafId: String(leaf.id) }, null, 2) + "\n", true);
          return { detail: "Queue linked. Choose the file again." };
        });
      }
      if (input["action"] === "projects") {
        // Connecting grants only this metadata listing; content needs a separate file selection.
        await target(); projects.clear(); files.clear();
        let entries;
        try { entries = await readdir(designRoot, { withFileTypes: true }); }
        catch { throw new Error("Open Design projects unavailable."); }
        const items: SourceItem[] = [];
        const canonicalRoot = await realpath(designRoot);
        for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
          if (!entry.isDirectory() || !safeName(entry.name)) continue;
          if (items.length === 200) throw new Error("Too many projects.");
          const path = await contained(join(canonicalRoot, entry.name), canonicalRoot);
          let name = entry.name;
          try {
            const metadata = JSON.parse(await boundedIntegrationFile(join(path, "package.json"), 16_384));
            if (typeof metadata.name === "string" && metadata.name.length < 100 && !/[\u0000-\u001f]/.test(metadata.name)) name = `${metadata.name} · ${entry.name}`;
          } catch { /* Optional package metadata is not a project/read authority. Directory names remain explicit. */ }
          const id = hash(entry.name); projects.set(id, path); items.push({ id, name });
        }
        return { projects: items };
      }
      if (input["action"] === "files") {
        const root = projects.get(String(input["project"]));
        if (!root) throw new Error("Choose a project.");
        files.clear(); const items: SourceItem[] = []; let examined = 0;
        const walk = async (dir: string, depth: number) => {
          for (const e of await readdir(dir, { withFileTypes: true })) {
            if (++examined > 2000) throw new Error("Project too large. Choose an export.");
            if (e.name.startsWith(".") || ["node_modules", "vendor", "dist", "build"].includes(e.name)) continue;
            const path = join(dir, e.name);
            if (e.isDirectory() && depth < 3) await walk(path, depth + 1);
            else if (e.isFile() && EXTENSION.test(e.name)) {
              await contained(path, root);
              const label = relative(root, path), id = hash(path);
              files.set(id, { path, root, label }); items.push({ id, name: label });
              if (items.length > 200) throw new Error("Over 200 files. Choose an export.");
            }
          }
        };
        await walk(root, 0);
        return { files: items.sort((a,b) => a.name.localeCompare(b.name)) };
      }
      if (input["action"] === "preview-file") {
        const file = files.get(String(input["file"]));
        if (!file) throw new Error("Choose a file.");
        const path = await contained(file.path, file.root), content = await boundedIntegrationFile(path, MAX_FILE);
        return preview("open-design", basename(path), content, `${file.root}/${file.label}`, { path, root: file.root, digest: hash(content) });
      }
      if (input["action"] === "preview-export") {
        const provider = sourceCatalog.find(p => p.id === input["provider"] && p.mode === "export");
        if (!provider || typeof input["name"] !== "string" || typeof input["content"] !== "string") throw new Error("Choose a source and a file.");
        return preview(provider.id, input["name"], input["content"], `${provider.id}/${input["name"]}`);
      }
      if (input["action"] === "preview-project-bundle") {
        expire();
        if (previews.size >= 20) throw new Error("Too many open previews. Cancel one.");
        if (Object.keys(input).sort().join(",") !== "action,files,project") throw new Error("Choose a project name and selected files only.");
        const project = personalName(input["project"], 120, "Project name");
        const selected = input["files"];
        if (!Array.isArray(selected) || selected.length < 1 || selected.length > BUNDLE_FILES) throw new Error("Choose 1–8 project files.");
        const files: { name: string; text: string; bytes: number }[] = [];
        const seen = new Set<string>();
        let totalBytes = 0;
        for (const raw of selected) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).sort().join(",") !== "content,name") throw new Error("Each selected file needs a name and plain text only.");
          const file = raw as Record<string, unknown>;
          const name = personalName(file["name"], 255, "File name");
          if (!EXTENSION.test(name)) throw new Error("Unsupported file type. Use TXT, Markdown, HTML, SVG or CSV.");
          const key = name.toLowerCase();
          if (seen.has(key)) throw new Error("Two selected files have the same name. Choose distinct files.");
          seen.add(key);
          const content = file["content"];
          if (typeof content !== "string" || !content.trim() || unsafeText.test(content)) throw new Error("A selected file is empty, binary or not plain text. Nothing was imported.");
          const bytes = Buffer.byteLength(content);
          totalBytes += bytes;
          if (bytes > BUNDLE_FILE_BYTES || totalBytes > BUNDLE_TOTAL_BYTES) throw new Error("Selected files exceed the 15 KB per-file or 96 KB batch limit. Nothing was imported.");
          files.push({ name, text: content, bytes });
        }
        const leaf = await target(), id = randomUUID();
        const batch = parseObservationBatch({ format: "foliage-observations", version: 1,
          subject: { leafId: String(leaf.id), name: leaf.subject },
          source: { provider: "personal-project-local-export", tenantId: null, accountId: hash(String(leaf.id)) },
          completion: "complete", deletedRecordIds: [], observations: files.map(file => ({
            recordId: hash(JSON.stringify([project, file.name])), revision: hash(file.text),
            title: `${project} · ${file.name}`,
            excerpt: file.text,
            observedAt: new Date().toISOString(),
          })) });
        let previous: HarvestDocument | null = null;
        try {
          const parsed = parseHarvestDocument(integrationJson(await boundedIntegrationFile(out!, IMPORT_DOCUMENT_BYTES), "Existing review"));
          if (!parsed.ok) throw new Error("Private review is unavailable. Repair its document before importing.");
          previous = parsed.harvest;
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        }
        // An earlier owner edit to the same snapshot can make the whole import refuse.
        // Surface that refusal at preview too; the locked writer repeats this check.
        importObservationBatch(batch, leaf, previous);
        const revisions = new Map<string, Set<string>>();
        for (const candidate of previous?.candidates ?? []) {
          if (!isImportedObservationCandidate(candidate)) continue;
          const evidence = candidate.evidence[0];
          if (evidence?.source !== "integration:personal-project-local-export" || !evidence.ref.startsWith("integration-record:")) continue;
          let namespace: unknown;
          try { namespace = JSON.parse(evidence.ref.slice("integration-record:".length)); } catch { continue; }
          if (!Array.isArray(namespace) || namespace.length !== 5 || namespace[0] !== batch.source.provider || namespace[1] !== null || namespace[2] !== batch.source.accountId || typeof namespace[3] !== "string" || typeof namespace[4] !== "string") continue;
          const values = revisions.get(namespace[3]) ?? new Set<string>();
          values.add(namespace[4]); revisions.set(namespace[3], values);
        }
        const view: SourceBundlePreview = { id, provider: "personal-project", title: project, bytes: totalBytes,
          files: files.map((file, index) => {
            const observation = batch.observations[index]!;
            const prior = revisions.get(observation.recordId);
            return { ...file, state: prior?.has(observation.revision) ? "already" : prior ? "revised" : "new" };
          }) };
        previews.set(id, { at: Date.now(), batch, view });
        return { bundlePreview: view };
      }
      if (input["action"] === "cancel") { previews.delete(String(input["preview"])); imagePreviews.delete(String(input["preview"])); return { cancelled: true }; }
      if (input["action"] === "import") {
        const image = imagePreviews.get(String(input["preview"]));
        if (image) {
          expire();
          if (!imagePreviews.has(String(input["preview"]))) throw new Error("Image preview expired. Choose it again.");
          if (input["confirm"] !== true) throw new Error("Preview the image first.");
          const result = await queueSelectedDesignImage({
            bytes: image.raw, format: image.format, project: image.view.project, title: image.view.title,
            origin: image.view.origin, referenceUrl: image.view.referenceUrl,
            leafPath: into!, harvestPath: out!, mediaRoot: mediaRootFromEnv({ ...env, FOLIAGE_LEAF: into! }),
            expectedLeaf: { id: image.leafId, subject: image.subject },
          });
          imagePreviews.delete(image.view.id);
          return { imported: result.queued ? 1 : 0, unchanged: result.queued ? 0 : 1,
            reviewUrl: "/review", inspectUrl: null,
            detail: result.queued ? "Added to review" : "Already in review" };
        }
        expire(); const p = previews.get(String(input["preview"]));
        if (!p || input["confirm"] !== true) throw new Error("Preview the file first.");
        if (p.local) {
          const path = await contained(p.local.path, p.local.root);
          if (hash(await boundedIntegrationFile(path, MAX_FILE)) !== p.local.digest) throw new Error("File changed. Choose it again.");
        }
        await target();
        const result = await persistIntegrationObservations(p.batch, into!, out!);
        previews.delete(p.view.id);
        const candidate = result.persisted[0] ?? result.unchanged[0];
        return { imported: result.persisted.length, unchanged: result.unchanged.length, reviewUrl: "/review",
          inspectUrl: p.view.provider === "personal-project" ? null : candidate ? `/scarlet/workspace?candidate=${encodeURIComponent(candidate)}` : null,
          detail: p.view.provider === "personal-project"
            ? `${result.persisted.length} added to review · ${result.unchanged.length} already present`
            : result.persisted.length ? "Added to review" : "Already recorded" };
      }
      throw new Error("Unknown action.");
    },
  };
}
