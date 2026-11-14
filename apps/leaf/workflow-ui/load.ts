/** A bounded read of the local workflow. Reading and retrying never issue a write. */
export type WorkflowFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** `detail` is a plain sentence about Sources; `technical` (an HTTP status or the browser's own error) belongs in Technical details. */
export type WorkflowRead<T> =
  | { ok: true; data: T }
  | { ok: false; detail: string; technical?: string };

export async function readWorkflowState<T>(
  request: WorkflowFetch = fetch,
  timeoutMs = 12_000,
): Promise<WorkflowRead<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request("/workflow/api", { signal: controller.signal });
    if (!response.ok) {
      const fallback = "Sources could not be read.";
      const technical = `HTTP ${response.status}`;
      try {
        const body: unknown = await response.json();
        const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error.trim()
          : "";
        return { ok: false, detail: detail || fallback, technical };
      } catch {
        return { ok: false, detail: fallback, technical };
      }
    }
    return { ok: true, data: await response.json() as T };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, detail: "Sources did not respond in time." };
    const technical = error instanceof Error ? error.message.trim() : "";
    return { ok: false, detail: "Sources could not be read.", ...(technical ? { technical } : {}) };
  } finally {
    clearTimeout(timer);
  }
}
