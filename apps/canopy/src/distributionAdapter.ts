/** Closed-plane destination contract. It does not confer publication or sending authority. */
import type { HostedActor } from "./hostedIdentity.ts";
export interface DistributionTarget { readonly connectionId: string; readonly candidateId: string }
interface DestinationCandidate { readonly id: string; readonly name: string }
export interface DistributionAdapter {
  readonly id: string;
  readonly label: string;
  readonly bindingKey: string;
  readonly version: string;
  readonly capabilities: { readonly createNote: boolean; readonly reconcile: boolean; readonly replace: boolean; readonly retract: boolean };
  connections(actor: HostedActor): Promise<readonly { id: string; available: boolean }[]>;
  search(actor: HostedActor, connectionId: string, name: string): Promise<{ candidates: readonly DestinationCandidate[]; more: boolean }>;
  connect(actor: HostedActor): Promise<string>;
  candidate(actor: HostedActor, target: DistributionTarget): Promise<DestinationCandidate>;
  deliver(actor: HostedActor, target: DistributionTarget, text: string): Promise<{ status: "accepted"; reference: string } | { status: "rejected" | "unknown"; reason: string }>;
  reconcile(actor: HostedActor, target: DistributionTarget, marker: string): Promise<string | null>;
}
