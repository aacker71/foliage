/** Local, owner-invoked Ollama model selection for one garden. GET never probes a runtime. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { DOCUMENT_ENV } from "./leafDocument.ts";
import { loopbackFetch } from "./loopbackFetch.ts";
import { LOCAL_MODEL_BASE_URL_ENV, LOCAL_MODEL_DEFAULT_BASE_URL } from "./scarletModel.ts";

const FILE = "scarlet-model.json";
const MAX_FILE_BYTES = 4096;
const MAX_TAGS_BYTES = 64 * 1024;
const MAX_MODELS = 100;
const MODEL_NAME_MAX = 128;

export type SavedModel =
  | { readonly kind: "none" }
  | { readonly kind: "selected"; readonly name: string }
  | { readonly kind: "unavailable"; readonly detail: string };

export type ModelDiscovery =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly cause: "connection" | "runtime" | "response"; readonly detail: string };

/** No ambient default: a direct server with no selected garden cannot save model choice. */
export function modelFileFor(env: Readonly<Record<string, string | undefined>>): string | null {
  const leaf = (env[DOCUMENT_ENV] ?? "").trim();
  return leaf === "" ? null : join(dirname(resolve(leaf)), FILE);
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    value.length <= MODEL_NAME_MAX && !/[\u0000-\u001f\u007f]/.test(value);
}

export async function readSavedModel(file: string | null): Promise<SavedModel> {
  if (file === null) return { kind: "none" };
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { kind: "unavailable", detail: "Saved model settings are not a small regular file." };
    const parsed: unknown = JSON.parse(await handle.readFile({ encoding: "utf8" }));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
        !Object.hasOwn(parsed, "model") || !validName(Reflect.get(parsed, "model")) ||
        Object.keys(parsed).length !== 1) {
      return { kind: "unavailable", detail: "Saved model settings have an invalid shape." };
    }
    return { kind: "selected", name: Reflect.get(parsed, "model") as string };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "unavailable", detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await handle?.close();
  }
}

export async function saveSelectedModel(file: string | null, name: string): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (file === null) return { ok: false, detail: "Start Foliage with a selected garden before saving a model." };
  if (!validName(name)) return { ok: false, detail: "The selected model name is invalid." };
  const temp = join(dirname(file), `.${FILE}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ model: name }) + "\n", "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, file);
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await handle?.close();
    await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

/** GET /api/tags is made only by an owner POST. Redirects and non-loopback URLs are refused. */
export async function discoverInstalledModels(env: Readonly<Record<string, string | undefined>>): Promise<ModelDiscovery> {
  const base = (env[LOCAL_MODEL_BASE_URL_ENV] ?? "").trim().replace(/\/+$/, "") || LOCAL_MODEL_DEFAULT_BASE_URL;
  const result = await loopbackFetch(`${base}/api/tags`, { method: "GET", signal: AbortSignal.timeout(5_000) });
  if (!result.ok) return { ok: false,
    cause: result.failure.cause === "unreachable" ? "runtime" : "connection", detail: result.failure.detail };
  if (!result.response.ok) return { ok: false, cause: "runtime", detail: `Local model service answered HTTP ${result.response.status}.` };
  if (result.response.body === null) return { ok: false, cause: "response", detail: "Local model service returned no model list." };
  const reader = result.response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_TAGS_BYTES) return { ok: false, cause: "response", detail: "Local model list exceeded the response limit." };
      chunks.push(part.value);
    }
  } catch (error) {
    return { ok: false, cause: "response", detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await reader.cancel().catch(() => {});
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return { ok: false, cause: "response", detail: "Local model list was not JSON." };
  }
  const entries = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? Reflect.get(parsed, "models") : null;
  if (!Array.isArray(entries) || entries.length > MAX_MODELS || !entries.every((entry) =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry) && validName(Reflect.get(entry, "name")))) {
    return { ok: false, cause: "response", detail: "Local model list had an invalid shape." };
  }
  return { ok: true, names: [...new Set(entries.map((entry) => Reflect.get(entry, "name") as string))] };
}
