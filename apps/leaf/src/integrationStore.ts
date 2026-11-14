/** The CLI and assistant transport share one bounded, locked observation write path. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { parseLeafDocument } from "@foliage/leaf";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { parseHarvestDocument, type HarvestDocument } from "@foliage/photosynthesis";
import { IMPORT_DOCUMENT_BYTES, OBSERVATION_INPUT_BYTES, ObservationImportError, importObservationBatch, parseObservationBatch, refuseFutureObservations } from "./integrationImport.ts";

/** A selected document's exact bytes: never through a link, never from a FIFO or a device, never past `limit`. */
export async function boundedIntegrationBytes(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new ObservationImportError("Selected input/document must be a regular file.");
    if (info.size > limit) throw new ObservationImportError(`Selected input/document exceeds ${limit} bytes.`);
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > limit) throw new ObservationImportError(`Selected input/document exceeds ${limit} bytes.`);
    return buffer.subarray(0, size);
  } finally { await file.close(); }
}

/** A selected document's bytes as UTF-8 text; anything else is refused. */
export function integrationText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function boundedIntegrationFile(path: string, limit: number): Promise<string> {
  return integrationText(await boundedIntegrationBytes(path, limit));
}

/** Parser diagnostics never echo the selected document's content. */
export function integrationJson(bytes: string, label: string): unknown {
  try { return JSON.parse(bytes); }
  catch { throw new ObservationImportError(`${label} is not valid JSON; existing documents were preserved.`); }
}

/** The selected Leaf from its text: a valid real document, never an example or an inferred target. */
export function integrationTarget(text: string) {
  const target = parseLeafDocument(integrationJson(text, "Selected leaf"));
  if (!target.ok || target.declaredExample) throw new ObservationImportError("The selected leaf must be a valid real document; no example or inferred target is accepted.");
  return target.leaf;
}

export async function readIntegrationTarget(into: string) {
  return integrationTarget(await boundedIntegrationFile(into, IMPORT_DOCUMENT_BYTES));
}

/** No provider permission is inferred here. Admission is a local, selected snapshot only. */
export async function persistIntegrationObservations(value: unknown, into: string, out: string, importedAt = new Date()) {
  if (into === out) throw new ObservationImportError("The leaf and harvest must be different files.");
  if (Buffer.byteLength(JSON.stringify(value) ?? "") > OBSERVATION_INPUT_BYTES) throw new ObservationImportError("Observation input exceeds the byte limit; nothing was imported.");
  const batch = parseObservationBatch(value);
  refuseFutureObservations(batch, importedAt);
  return withDocumentLocks([into, out], async () => {
    const target = await readIntegrationTarget(into);
    let previous: HarvestDocument | null = null;
    try {
      const parsed = parseHarvestDocument(integrationJson(await boundedIntegrationFile(out, IMPORT_DOCUMENT_BYTES), "Existing harvest"));
      if (!parsed.ok) throw new ObservationImportError("Existing harvest is invalid; its bytes and decisions were preserved.");
      previous = parsed.harvest;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    const result = importObservationBatch(batch, target, previous);
    if (result.persisted.length > 0) {
      const serialized = `${JSON.stringify(result.document, null, 2)}\n`;
      if (Buffer.byteLength(serialized) > IMPORT_DOCUMENT_BYTES) throw new ObservationImportError("Merged harvest exceeds the document byte limit; prior bytes were preserved.");
      writeDocument(out, serialized, previous !== null);
    }
    return { status: "local-observations-imported", persisted: result.persisted, unchanged: result.unchanged,
      emptyBatch: batch.observations.length === 0,
      limits: "Declared, unverified source snapshots only. No provider connection, approval, sharing, publication, automatic supersession or revocation." };
  });
}
