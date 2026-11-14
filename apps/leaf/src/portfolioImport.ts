/** Selected authored portfolio text is a source account, never proof of its claims. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { parseHarvestDocument } from "@foliage/photosynthesis";
import { boundedIntegrationFile, integrationJson, readIntegrationTarget } from "./integrationStore.ts";
import { importObservationBatch, parseObservationBatch, ObservationImportError, IMPORT_DOCUMENT_BYTES } from "./integrationImport.ts";

export interface PortfolioImportInput { title: string; source: string; text: string }
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function previewPortfolioImport(input: PortfolioImportInput) {
  if (!input.title.trim() || input.title.length > 200) throw new ObservationImportError("Name this portfolio in 200 characters or fewer.");
  if (!input.source.trim() || input.source.length > 500) throw new ObservationImportError("Add its original filename or page address in 500 characters or fewer.");
  if (!input.text.trim() || input.text.length > 100_000) throw new ObservationImportError("Choose a text or Markdown portfolio up to 100,000 characters.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text)) throw new ObservationImportError("This file contains binary or unsupported control characters. Export it as text or Markdown first.");
  const sections = input.text.split(/(?=^#{1,2} .+$)/m).filter(text => text.trim()).map((text, index) => ({
    title: text.match(/^#{1,2} (.+)$/m)?.[1]?.trim() ?? input.title,
    text, index,
  }));
  if (sections.length > 100 || sections.some(s => s.text.length + input.source.length + 80 > 16_000)) throw new ObservationImportError("Split long work descriptions with Markdown headings. Each section must be under 15,000 characters, with at most 100 sections.");
  return { title: input.title, source: input.source, sections, digest: hash(JSON.stringify(input)) };
}

export async function importPortfolio(input: PortfolioImportInput, into: string, out: string, expectedSubject?: {leafId:string;name:string}) {
  if (!into.trim() || !out.trim() || resolve(into) === resolve(out)) throw new ObservationImportError("Choose separate configured Leaf and draft documents before importing.");
  const preview = previewPortfolioImport(input);
  return withDocumentLocks([resolve(into), resolve(out)], async () => {
    const target = await readIntegrationTarget(into);
    if (expectedSubject && (target.id !== expectedSubject.leafId || target.subject !== expectedSubject.name)) throw new ObservationImportError("The selected Leaf identity changed. Restart the connection.");
    let previous = null;
    try {
      const parsed = parseHarvestDocument(integrationJson(await boundedIntegrationFile(out, IMPORT_DOCUMENT_BYTES), "Existing drafts"));
      if (!parsed.ok) throw new ObservationImportError("Existing drafts could not be read. They were preserved.");
      previous = parsed.harvest;
    } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const importedAt = new Date().toISOString();
    const observations = preview.sections.map(section => {
      const recordId = hash(JSON.stringify([input.source, section.index]));
      const revision = hash(JSON.stringify([section.title, section.text]));
      const ref = `integration-record:${JSON.stringify(["portfolio-import", null, "owner-selected", recordId, revision])}`;
      const prior = previous?.candidates.find(c => c.evidence[0]?.ref === ref);
      return { recordId, revision, title: section.title,
        excerpt: `Imported portfolio account · ${input.source}\nClaims supplied by the portfolio author; not independently verified.\n\n${section.text}`,
        observedAt: prior?.evidence[0]?.observedAt ?? importedAt };
    });
    const batch = parseObservationBatch({ format: "foliage-observations", version: 1,
      subject: { leafId: String(target.id), name: target.subject },
      source: { provider: "portfolio-import", tenantId: null, accountId: "owner-selected" },
      completion: "complete", deletedRecordIds: [], observations });
    const result = importObservationBatch(batch, target, previous);
    if (result.persisted.length) {
      const bytes = JSON.stringify(result.document, null, 2) + "\n";
      if (Buffer.byteLength(bytes) > IMPORT_DOCUMENT_BYTES) throw new ObservationImportError("The draft document is full. Existing work was preserved.");
      writeDocument(out, bytes, previous !== null);
    }
    return { imported: result.persisted.length, unchanged: result.unchanged.length, candidateIds: [...result.persisted, ...result.unchanged] };
  });
}
