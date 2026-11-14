/** One local installation pairs with its Leaf app. This is not hosted account authentication. */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { previewWorkflowImport } from "./workflowImport.ts";
import { assessmentModel, inferenceReady } from "./ladybugInference.ts";
import { type AssessmentPacket } from "./ladybugAssessment.ts";
export function createAssessmentCompanion(env: Readonly<Record<string, string | undefined>>) {
  const secret = env["FOLIAGE_COMPANION_KEY"]?.trim();
  const pending = new Map<string, { packet: AssessmentPacket; at: number }>();
  const expire = () => { for (const [id, p] of pending) if (Date.now() - p.at > 15 * 60_000) pending.delete(id); };
  return {
    authorize(authorization: string | undefined, origin: string | undefined) {
      const actual = authorization?.replace(/^Bearer /, "");
      return origin === undefined && !!secret && /^[a-f0-9]{64}$/.test(secret) && !!actual && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(secret), Buffer.from(actual));
    },
    command(action: string, value: unknown) {
      if (action === "status") return { service: "foliage-assessment-companion", version: 1, ready: inferenceReady(env), model: assessmentModel(env) };
      if (action !== "prepare") throw new Error("Unsupported companion action.");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose evidence from the connected workspace.");
      const v = value as Record<string, unknown>, subject = v["subject"] as { id?: unknown; name?: unknown } | undefined;
      if (!subject || typeof subject.id !== "string" || typeof subject.name !== "string") throw new Error("A selected portfolio is required.");
      const packet = previewWorkflowImport(JSON.stringify(v["transfer"]), subject.id, subject.name);
      expire(); if (pending.size >= 20) throw new Error("Finish an existing assessment preview before preparing another.");
      const id = randomUUID(); pending.set(id, { packet, at: Date.now() });
      return { reviewPath: `/connection/review/${id}` };
    },
    review(id: string) { expire(); return pending.get(id)?.packet ?? null; },
  };
}
