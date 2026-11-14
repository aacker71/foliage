/** A dated local observation of hosting, never authority to publish or serve a portfolio. */
import { boundedIntegrationFile } from "./integrationStore.ts";
export interface HostedStatus {
  version: 1; origin: string; subjectId: string; observedAt: string; visible: boolean;
  revisionId: string | null; generation: number; documentDigest: string | null; policyDigest: string | null;
}
export async function readHostedStatus(path: string | undefined, subjectId: string): Promise<{ observation: HostedStatus | null; detail: string }> {
  const empty = { observation: null, detail: "Hosting not checked" };
  if (!path) return empty;
  try {
    const value = JSON.parse(await boundedIntegrationFile(path, 16 * 1024));
    const url = new URL(value.origin);
    if (value.version === 1 && value.reason === "account-changed" && Object.keys(value).length === 3 && url.protocol === "https:" && url.origin === value.origin && !url.username && !url.password) {
      return { observation: null, detail: "Canopy account changed. Check hosting again." };
    }
    const digest = (v: unknown) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
    if (value.version !== 1 || value.subjectId !== subjectId || url.protocol !== "https:" || url.origin !== value.origin || url.username || url.password ||
      typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt)) || !Number.isSafeInteger(value.generation) || value.generation < 0 ||
      typeof value.visible !== "boolean" || (value.visible ? typeof value.revisionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.revisionId) || !digest(value.documentDigest) || !digest(value.policyDigest) : value.revisionId !== null || value.documentDigest !== null || value.policyDigest !== null)) throw new Error("Invalid hosting observation");
    return { observation: value as HostedStatus, detail: "Last observed state" };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return empty;
    return { observation: null, detail: "Hosting record unreadable or for another Leaf · no status inferred" };
  }
}
