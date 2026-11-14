import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import { loadLeafDocument } from "./leafDocument.ts";
import { firstRecord } from "./recordStart.ts";

/** Create only an absent private record. A changed or unreadable file is never replaced. */
export async function createFirstLeaf(
  env: Readonly<Record<string, string | undefined>>,
  fields: URLSearchParams,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if ([...fields.keys()].some(key => key !== "action" && key !== "subject") ||
      fields.getAll("action").length !== 1 || fields.get("action") !== "create" ||
      fields.getAll("subject").length !== 1) {
    return { ok: false, message: "Reopen Portfolio and enter your name again." };
  }
  const first = firstRecord(fields.get("subject") ?? "");
  if (!first.ok) return first;
  const document = { id: first.id, subject: first.subject, leaflets: [] };
  const initial = await loadLeafDocument(env);
  if (initial.ok || initial.cause !== "absent") {
    return { ok: false, message: "A record already exists or cannot be read. Reopen Portfolio before trying again." };
  }
  try {
    return await withDocumentLocks([initial.path], async () => {
      const latest = await loadLeafDocument(env);
      if (latest.ok || latest.cause !== "absent" || latest.path !== initial.path) {
        return { ok: false, message: "The record changed. Reopen Portfolio before trying again." };
      }
      writeDocument(initial.path, `${JSON.stringify(document, null, 2)}\n`, false, true);
      return { ok: true };
    });
  } catch {
    return { ok: false, message: "The private record could not be created. Check local storage access and retry." };
  }
}
