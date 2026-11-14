/** Merge owns ATS authorization; Foliage binds its hosted Link flow to a verified actor.
 * This module never reads candidate data, exchanges account tokens or grants delivery consent.
 */
import type { HostedActor } from "./hostedIdentity.ts";
import { HostedNangoError } from "./hostedNango.ts";

interface RecruitingConnection {
  readonly id: string;
  readonly organization: string;
  readonly integration: string;
  readonly state: "connected" | "incomplete" | "reconnect" | "idle";
}
export interface RecruitingConnections {
  readonly label: string;
  list(actor: HostedActor): Promise<readonly RecruitingConnection[]>;
  connect(actor: HostedActor, input: { email: string; organization: string }): Promise<string>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const label = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 500 && !/[\u0000-\u001f\u007f]/.test(v);
const fail = (): never => { throw new HostedNangoError("provider-unavailable", "Merge could not confirm the connection. Return to ATS accounts and check its status before starting again."); };
const regions = { us: "https://api.merge.dev", eu: "https://api-eu.merge.dev", ap: "https://api-ap.merge.dev" } as const;
export function createMergeConnections(config: { apiKey: string; region: string; fetch?: typeof fetch }): RecruitingConnections {
  if (!config.apiKey.trim() || /[\r\n]/.test(config.apiKey) || !Object.hasOwn(regions, config.region)) throw new Error("Invalid Merge connection configuration.");
  const origin = regions[config.region as keyof typeof regions];
  const send = config.fetch ?? fetch;
  function actorId(actor: HostedActor) {
    if (!uuid(actor.id)) throw new HostedNangoError("invalid-request", "Sign in before connecting an ATS account.");
    return `foliage:ats:${actor.id}`;
  }
  async function request(path: string, body?: unknown) {
    try {
      const init: RequestInit & { cache: "no-store" } = { method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${config.apiKey}`, accept: "application/json", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
      const response = await send(`${origin}/api/ats/v1/${path}`, init);
      if (!response.ok || response.redirected) { await response.body?.cancel(); return fail(); }
      const reader = response.body?.getReader(); if (!reader) return fail();
      const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength; if (size > 512_000) { await reader.cancel(); return fail(); } chunks.push(part.value);
      } } finally { reader.releaseLock(); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!object(value)) return fail();
      return value;
    } catch { return fail(); } // Never expose provider error bodies, tokens or contact details.
  }
  async function list(actor: HostedActor): Promise<readonly RecruitingConnection[]> {
    const owner = actorId(actor), rows = new Map<string, RecruitingConnection>(), seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ category: "ats", end_user_origin_id: owner, page_size: "100", ...(cursor ? { cursor } : {}) });
      const value = await request(`linked-accounts?${query}`);
      if (!Array.isArray(value["results"]) || value["results"].length > 100) return fail();
      for (const raw of value["results"]) {
        if (!object(raw) || raw["end_user_origin_id"] !== owner || raw["category"] !== "ats") throw new HostedNangoError("forbidden", "Merge returned a connection outside this account. No connection details were shown.");
        if (!uuid(raw["id"]) || !label(raw["end_user_organization_name"])) return fail();
        const states = { COMPLETE: "connected", INCOMPLETE: "incomplete", RELINK_NEEDED: "reconnect", IDLE: "idle" } as const;
        if (typeof raw["status"] !== "string" || !Object.hasOwn(states, raw["status"]) || rows.has(raw["id"])) return fail();
        const integration = raw["integration"];
        const integrationName = object(integration) && label(integration["name"]) ? integration["name"] : null;
        if (!integrationName && !["INCOMPLETE", "IDLE"].includes(raw["status"])) return fail();
        rows.set(raw["id"], { id: raw["id"], organization: raw["end_user_organization_name"], integration: integrationName ?? "ATS setup", state: states[raw["status"] as keyof typeof states] });
      }
      const next = value["next"];
      if (next === null || next === undefined) return [...rows.values()];
      // Merge documents opaque cursors, not URLs. Never follow a provider-supplied address.
      if (typeof next !== "string" || !/^[A-Za-z0-9_+=/-]{1,2048}$/.test(next) || seen.has(next)) return fail();
      seen.add(next); cursor = next;
    }
    return fail();
  }
  return {
    label: "Merge", list,
    async connect(actor, input) {
      const owner = actorId(actor);
      const email = input.email.trim(), organization = input.organization.trim();
      if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email) || !label(organization)) throw new HostedNangoError("invalid-request", "Enter your work email and organization name.");
      const value = await request("link-token", { end_user_origin_id: owner, end_user_email_address: email,
        end_user_organization_name: organization, categories: ["ats"], are_syncs_disabled: true, should_create_magic_link_url: true, link_expiry_mins: 30 });
      if (typeof value["magic_link_url"] !== "string" || value["magic_link_url"].length > 4096) return fail();
      let url: URL;
      try { url = new URL(value["magic_link_url"]); } catch { return fail(); }
      if (url.origin !== "https://link.merge.dev" || url.username || url.password || url.hash) return fail();
      return url.href;
    },
  };
}
