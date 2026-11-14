/** Distribution receipts share the hosted store's authenticated RPC transport and authority. */
import type { HostedActor } from "./hostedIdentity.ts";
import { HostedStoreError } from "./hostedStore.ts";
export interface DistributionReceipt {
  operationId: string; subjectId: string; revisionId: string; generation: number;
  adapterKey: string; connectionId: string; candidateId: string; candidateName: string; payloadDigest: string;
  status: "prepared" | "sending" | "accepted" | "rejected" | "unknown" | "cancelled";
  providerReference: string | null; reason: string | null; updatedAt: string; current: boolean; visible: boolean;
}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function checked(actor: HostedActor, operation: string) {
  if (!uuid(actor.id) || !uuid(operation)) throw new HostedStoreError("invalid", "A verified account and delivery identifier are required.");
  return { p_actor: actor.id, p_operation: operation };
}
function receipt(v: unknown): DistributionReceipt {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HostedStoreError("corrupt", "Delivery receipt is unavailable.");
  const r = v as Record<string, unknown>;
  if (![r["operationId"], r["revisionId"], r["candidateId"]].every(uuid) ||
    typeof r["subjectId"] !== "string" || !/^[a-z0-9-]{1,64}$/.test(r["subjectId"]) ||
    !Number.isSafeInteger(r["generation"]) || Number(r["generation"]) < 0 ||
    typeof r["adapterKey"] !== "string" || r["adapterKey"].length > 256 ||
    typeof r["connectionId"] !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(r["connectionId"]) ||
    typeof r["candidateName"] !== "string" || r["candidateName"].length > 500 ||
    typeof r["payloadDigest"] !== "string" || !/^sha256:[0-9a-f]{64}$/.test(r["payloadDigest"]) ||
    !["prepared", "sending", "accepted", "rejected", "unknown", "cancelled"].includes(String(r["status"])) ||
    !(r["providerReference"] === null || uuid(r["providerReference"])) || !(r["reason"] === null || typeof r["reason"] === "string") ||
    typeof r["updatedAt"] !== "string" || !Number.isFinite(Date.parse(r["updatedAt"])) ||
    typeof r["current"] !== "boolean" || typeof r["visible"] !== "boolean") throw new HostedStoreError("corrupt", "Delivery receipt failed validation.");
  return r as unknown as DistributionReceipt;
}
export function createDistributionStore(rpc: (name: string, params: Record<string, unknown>) => Promise<unknown>) {
  async function saved(name: string, actor: HostedActor, operation: string, params = {}) {
    const r = receipt(await rpc(name, { ...checked(actor, operation), ...params }));
    if (r.operationId !== operation) throw new HostedStoreError("corrupt", "Delivery receipt belongs to another operation.");
    return r;
  }
  return {
    async read(actor: HostedActor, operation: string) {
      const raw = await rpc("foliage_distribution_read", checked(actor, operation));
      if (raw === null) return null;
      const r = receipt(raw); if (r.operationId !== operation) throw new HostedStoreError("corrupt", "Delivery receipt mismatch."); return r;
    },
    async list(actor: HostedActor, subject: string) {
      if (!uuid(actor.id) || !/^[a-z0-9-]{1,64}$/.test(subject)) throw new HostedStoreError("invalid", "Select your published portfolio.");
      const rows = await rpc("foliage_distribution_list", { p_actor: actor.id, p_subject: subject });
      if (!Array.isArray(rows) || rows.length > 50) throw new HostedStoreError("corrupt", "Delivery history is unavailable.");
      return rows.map(row => { const r = receipt(row); if (r.subjectId !== subject) throw new HostedStoreError("corrupt", "Delivery history mismatch."); return r; });
    },
    prepare(actor: HostedActor, r: Pick<DistributionReceipt, "operationId" | "subjectId" | "revisionId" | "generation" | "adapterKey" | "connectionId" | "candidateId" | "candidateName" | "payloadDigest">) {
      return saved("foliage_distribution_prepare", actor, r.operationId, { p_subject: r.subjectId, p_revision: r.revisionId,
        p_generation: r.generation, p_adapter: r.adapterKey, p_connection: r.connectionId, p_candidate: r.candidateId,
        p_name: r.candidateName, p_digest: r.payloadDigest });
    },
    async start(actor: HostedActor, operation: string, digest: string) {
      const raw = await rpc("foliage_distribution_start", { ...checked(actor, operation), p_digest: digest });
      if (!raw || typeof raw !== "object" || !("dispatchId" in raw) || !(raw.dispatchId === null || uuid(raw.dispatchId)) || !("receipt" in raw)) throw new HostedStoreError("corrupt", "Delivery authorization could not be confirmed. Check its receipt before retrying.");
      const r = receipt(raw.receipt); if (r.operationId !== operation) throw new HostedStoreError("corrupt", "Delivery authorization mismatch.");
      return { dispatchId: raw.dispatchId, receipt: r };
    },
    finish(actor: HostedActor, operation: string, dispatchId: string, outcome: { status: "accepted"; reference: string } | { status: "rejected" | "unknown"; reason: string }) {
      return saved("foliage_distribution_finish", actor, operation, { p_dispatch: dispatchId, p_status: outcome.status,
        p_reference: outcome.status === "accepted" ? outcome.reference : null, p_reason: outcome.status === "accepted" ? null : outcome.reason });
    },
    reconcile: (actor: HostedActor, operation: string, reference: string) => saved("foliage_distribution_reconcile", actor, operation, { p_reference: reference }),
    cancel: (actor: HostedActor, operation: string) => saved("foliage_distribution_cancel", actor, operation),
  };
}
