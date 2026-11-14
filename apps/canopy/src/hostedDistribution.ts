/** Exact-preview, one-time destination delivery over the existing publication authority. */
import { distributionMarkdown, distributionProjection, documentDigest } from "@foliage/canopy";
import { HostedStoreError, type HostedStore } from "./hostedStore.ts";
import type { HostedActor } from "./hostedIdentity.ts";
import type { createDistributionStore, DistributionReceipt } from "./distributionStore.ts";
import type { DistributionAdapter, DistributionTarget } from "./distributionAdapter.ts";
const digest = (text: string) => documentDigest(Buffer.from(text));
export function createHostedDistribution(config: {
  origin: string; store: HostedStore; receipts: ReturnType<typeof createDistributionStore>; adapter: DistributionAdapter;
}) {
  const { store, receipts, adapter } = config;
  const marker = (actor: HostedActor, operation: string) => `Foliage delivery: ${digest(JSON.stringify([actor.id, operation]))}`;
  async function content(actor: HostedActor, r: Pick<DistributionReceipt, "operationId" | "subjectId" | "revisionId" | "generation">) {
    const current = await store.readPublic(r.subjectId);
    if (!current || current.revisionId !== r.revisionId || current.generation !== r.generation) throw new HostedStoreError("conflict", "The publication changed or was withdrawn. Review its current version before sharing.");
    const view = distributionProjection(current.document, config.origin);
    const text = `${distributionMarkdown(view)}\n${marker(actor, r.operationId)}\n`;
    if (Buffer.byteLength(text) > 100_000) throw new HostedStoreError("invalid", "This portfolio exceeds the destination note limit. Share its live link instead.");
    return text;
  }
  async function read(actor: HostedActor, operation: string) {
    const r = await receipts.read(actor, operation);
    if (!r) throw new HostedStoreError("forbidden", "This delivery is unavailable to this account.");
    return r;
  }
  function available(r: DistributionReceipt) {
    if (r.adapterKey !== adapter.bindingKey) throw new HostedStoreError("conflict", "The destination configuration changed. This saved operation cannot be sent through a different connection configuration.");
  }
  return {
    label: adapter.label, capabilities: adapter.capabilities,
    connections: adapter.connections, search: adapter.search,
    connect: (actor: HostedActor) => adapter.connect(actor),
    read, list: receipts.list, cancel: receipts.cancel,
    async prepare(actor: HostedActor, input: DistributionTarget & { subjectId: string; operationId: string }) {
      // Resolve existing operation before any new external reads. A changed target never reuses it.
      const previous = await receipts.read(actor, input.operationId);
      if (previous) {
        available(previous);
        if (previous.subjectId !== input.subjectId || previous.connectionId !== input.connectionId || previous.candidateId !== input.candidateId) throw new HostedStoreError("conflict", "This delivery identifier already belongs to another destination.");
        return previous;
      }
      const publication = await store.readPublic(input.subjectId);
      if (!publication) throw new HostedStoreError("conflict", "Publish the work you want to share first.");
      const candidate = await adapter.candidate(actor, input);
      const draft = { ...input, revisionId: publication.revisionId, generation: publication.generation,
        candidateName: candidate.name, adapterKey: adapter.bindingKey };
      const text = await content(actor, draft);
      return receipts.prepare(actor, { ...draft, payloadDigest: digest(text) });
    },
    async preview(actor: HostedActor, r: DistributionReceipt) {
      available(r);
      const text = await content(actor, r);
      if (digest(text) !== r.payloadDigest) throw new HostedStoreError("conflict", "The rendered delivery changed. Prepare a new review.");
      return text;
    },
    async send(actor: HostedActor, operation: string, reviewedDigest: string) {
      const r = await read(actor, operation); available(r);
      if (r.payloadDigest !== reviewedDigest) throw new HostedStoreError("conflict", "Review this exact delivery before sending.");
      if (r.status !== "prepared") return r; // Never retry an uncertain remote write.
      const candidate = await adapter.candidate(actor, r);
      if (candidate.name !== r.candidateName) throw new HostedStoreError("conflict", "The destination candidate changed. Review it again before sending.");
      const text = await content(actor, r);
      if (digest(text) !== r.payloadDigest) throw new HostedStoreError("conflict", "The delivery content changed. Review it again.");
      const dispatch = await receipts.start(actor, operation, reviewedDigest);
      if (!dispatch.dispatchId) return dispatch.receipt;
      let outcome: Awaited<ReturnType<DistributionAdapter["deliver"]>>;
      try { await content(actor, r); }
      catch { return receipts.finish(actor, operation, dispatch.dispatchId, { status: "rejected", reason: "authority-changed" }); }
      try { outcome = await adapter.deliver(actor, r, text); }
      catch { outcome = { status: "unknown", reason: "destination-unavailable" }; }
      // If saving acknowledgement fails, durable sending ages into unknown, not eligible for resend.
      try { return await receipts.finish(actor, operation, dispatch.dispatchId, outcome); }
      catch (cause) { throw new HostedStoreError("outcome_unknown", "The destination outcome could not be saved. Check this delivery before any new attempt.", { cause }); }
    },
    async reconcile(actor: HostedActor, operation: string) {
      const r = await read(actor, operation); available(r);
      if (r.status !== "unknown") return r;
      const reference = await adapter.reconcile(actor, r, marker(actor, operation));
      return reference ? receipts.reconcile(actor, operation, reference) : r;
    },
  };
}
