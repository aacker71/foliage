/**
 * SYNTHESIZE — the ONLY model call in photosynthesis.
 *
 * Two layers, ported as a design from the Coeadapt line and reimplemented fresh:
 *
 *   1. draftDeterministic() — pure, no model, ALWAYS works. One candidate per commit
 *      cluster, prose assembled from counts and verbatim prefixes only. This is the
 *      floor the product stands on when ollama is down, and its provenance says so:
 *      method "deterministic", no model name, ever.
 *
 *   2. draftWithLocalModel() — best-effort enhancement against ollama on loopback.
 *      Falls back to (1) on ANY failure — endpoint down, timeout, malformed output —
 *      and the fallback is reported as what it is, never dressed as AI output.
 *
 * THE GROUNDING GATE IS MECHANICAL, NOT PROMPTED. The model is asked to cite evidence
 * (cluster keys / photo digests) for every candidate it drafts. It is not TRUSTED to:
 * after parsing, every cited ref is checked against the gather result, and a candidate
 * citing anything unknown is DROPPED with a counted reason. A model that hallucinates
 * evidence produces fewer candidates, not wronger ones. (Ported discipline: prose that
 * traces to nothing is deleted, not decorated.)
 *
 * PHOTOS. gemma4:12b on this machine reports vision capability, so a photo becomes a
 * candidate the same way: the image goes to the model (loopback — it never leaves the
 * machine), the drafted caption comes back, and the evidence ref is the file's sha256
 * digest. The drafted text is machine prose ABOUT the photo; the photo itself is the
 * evidence. A photo candidate with a failed vision call simply does not exist — there
 * is no deterministic caption, and inventing one would be fake data.
 *
 * NO SCORE. The model is explicitly told not to rate, and anything score-shaped it
 * emits anyway dies at parseHarvestDocument. Belt and refused-by-name braces.
 */

import { readFile } from "node:fs/promises";

import type { CommitCluster, GatherResult, GatheredPhoto } from "./gather.ts";
import type { Candidate, DraftProvenance, EvidenceRef } from "./harvestDocument.ts";
import { mayDraftAgainst, type ConsentRecord } from "./policy.ts";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_MODEL = "gemma4:12b";

/**
 * Per-call budget. The Coeadapt line measured a local 8B at 35–63s per draft and set
 * 75s; a 12B drafting a batch gets more. This is a CLI, not a request handler — a
 * slow honest draft beats a fast fake one, but a hang is reported, not waited out.
 */
const DRAFT_TIMEOUT_MS = 180_000;
const MAX_CANDIDATES = 8;
const MAX_CLUSTERS_TO_MODEL = 10;
const MAX_SUBJECTS_PER_CLUSTER = 12;

export interface DraftResult {
  readonly candidates: readonly Candidate[];
  readonly provenance: DraftProvenance;
  /** Candidates the grounding gate dropped, counted with the reason. Never silent. */
  readonly dropped: readonly string[];
  /** Present when the model path failed and the deterministic floor was used. */
  readonly fallbackCause?: string;
}

function candidateId(seed: string): string {
  // Deterministic from content, so a re-run proposes the SAME ids and review
  // decisions (including rejections) survive re-harvesting.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return `ps-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function clusterEvidence(cluster: CommitCluster): EvidenceRef[] {
  // Up to three commits as verbatim evidence — enough to check the prose against,
  // small enough for the review page to show whole.
  return cluster.commits.slice(0, 3).map((c) => ({
    source: "git",
    ref: c.sha,
    excerpt: c.subject,
  }));
}

/** Layer 1: the floor. Counts and verbatim prefixes only — no interpretation at all. */
export function draftDeterministic(gather: GatherResult): DraftResult {
  const candidates: Candidate[] = [];
  if (gather.git.ok) {
    for (const cluster of gather.git.data.clusters.slice(0, MAX_CANDIDATES)) {
      if (cluster.commits.length < 2) continue; // one commit is a commit, not a body of work
      candidates.push({
        id: candidateId(`det:${gather.repo}:${cluster.key}`),
        drafted: {
          title: `${cluster.key} — ${cluster.commits.length} commits`,
          summary:
            `${cluster.commits.length} commits under the "${cluster.key}" prefix between ` +
            `${cluster.commits[cluster.commits.length - 1]?.authoredAt.slice(0, 10)} and ` +
            `${cluster.commits[0]?.authoredAt.slice(0, 10)}. Drafted without a model: ` +
            `counts and verbatim prefixes only.`,
        },
        evidence: clusterEvidence(cluster),
        provenance: { method: "deterministic" },
        status: "proposed",
      });
    }
  }
  return { candidates: Object.freeze(candidates), provenance: { method: "deterministic" }, dropped: [] };
}

interface ModelDraft {
  readonly title: string;
  readonly summary: string;
  readonly cites: readonly string[];
}

function parseModelJson(text: string): ModelDraft[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const list = (value as { candidates?: unknown })?.candidates;
  if (!Array.isArray(list)) return null;
  const out: ModelDraft[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { title, summary, cites } = item as Record<string, unknown>;
    if (typeof title !== "string" || title.trim() === "") continue;
    if (typeof summary !== "string") continue;
    if (!Array.isArray(cites) || !cites.every((c) => typeof c === "string")) continue;
    out.push({ title: title.trim(), summary: summary.trim(), cites: cites as string[] });
  }
  return out;
}

/**
 * THE SOCKET, NOT THE STRING. `mayDraftAgainst` checks the endpoint you TYPED. A 307 preserves
 * method AND body, so a checked host is a claim about the FIRST HOP only, and plain `fetch`
 * follows it.
 *
 * Reproduced here 2026-08-20, both call sites below: the gate passed on a 127.0.0.1 endpoint,
 * `fetch` followed a 307, and 872 bytes carrying a commit subject arrived at a second host while
 * the caller saw no error at all. The photo path is worse — it carries the image itself, base64.
 *
 * `redirect: "manual"` makes the hop impossible, and a 3xx gets its OWN cause: "the model is down"
 * and "something on a port you trusted is trying to move your material" call for opposite actions,
 * so they must never share a message. Same decision, same reason, as apps/leaf/src/loopbackFetch.ts
 * — this is the fourth model call site in the tree and it was not covered by that guard.
 */
async function postToModel(baseUrl: string, body: string, signal: AbortSignal): Promise<Response> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal,
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      `drafting endpoint redirected (${res.status} to ${res.headers.get("location") ?? "an unnamed location"}) ` +
        `— refusing to follow it; nothing reached the second host`,
    );
  }
  return res;
}

async function ollamaChat(
  baseUrl: string,
  model: string,
  messages: unknown[],
  signal: AbortSignal,
): Promise<string> {
  const res = await postToModel(
    baseUrl,
    JSON.stringify({ model, messages, stream: false, format: "json", options: { temperature: 0.2 } }),
    signal,
  );
  if (!res.ok) throw new Error(`ollama answered ${res.status}`);
  const body = (await res.json()) as { message?: { content?: string } };
  const content = body.message?.content;
  if (typeof content !== "string" || content.trim() === "") throw new Error("ollama returned an empty draft");
  return content;
}

/** Layer 2: the local model, grounded mechanically, falling back to the floor. */
export async function draftWithLocalModel(
  gather: GatherResult,
  opts: {
    readonly baseUrl?: string;
    readonly model?: string;
    readonly mode?: string;
    readonly consent?: ConsentRecord | null;
  } = {},
): Promise<DraftResult> {
  const baseUrl = opts.baseUrl ?? DEFAULT_OLLAMA_URL;
  const model = opts.model ?? DEFAULT_MODEL;

  // THE POLICY GATE. For the prototype this endpoint is loopback and always passes;
  // the gate still runs on every call so a future frontier endpoint cannot slip past.
  const verdict = mayDraftAgainst(baseUrl, opts.mode ?? "unset", opts.consent ?? null);
  if (!verdict.allowed) {
    const floor = draftDeterministic(gather);
    return { ...floor, fallbackCause: `drafting endpoint refused by policy: ${verdict.reason}` };
  }

  const clusters = gather.git.ok ? gather.git.data.clusters.slice(0, MAX_CLUSTERS_TO_MODEL) : [];
  const knownRefs = new Map<string, EvidenceRef[]>();
  for (const c of clusters) knownRefs.set(c.key, clusterEvidence(c));

  const clusterLines = clusters
    .map(
      (c) =>
        `- key="${c.key}" (${c.commits.length} commits): ` +
        c.commits.slice(0, MAX_SUBJECTS_PER_CLUSTER).map((x) => JSON.stringify(x.subject)).join(", "),
    )
    .join("\n");
  const readmeBlock = gather.readme.ok
    ? `README headings: ${gather.readme.data.headings.slice(0, 15).join(" | ")}\nREADME excerpt:\n${gather.readme.data.excerpt.slice(0, 2000)}`
    : `README unavailable: ${gather.readme.cause}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
  try {
    const content = await ollamaChat(
      baseUrl,
      model,
      [
        {
          role: "system",
          content:
            "You draft career-evidence candidates from a developer's real git history. " +
            "Reply ONLY with JSON: {\"candidates\":[{\"title\":…,\"summary\":…,\"cites\":[cluster keys]}]}. " +
            "Rules: title ≤ 80 chars, summary 1-3 sentences, plain and factual. Every candidate MUST cite " +
            "at least one cluster key from the input, verbatim, in \"cites\". Never invent numbers, users, " +
            "impact, or outcomes not present in the input. Never rate, rank, or express confidence.",
        },
        {
          role: "user",
          content:
            `Repository: ${gather.repo}\nAuthor identity: ${gather.identity}\n\nCommit clusters:\n${clusterLines}\n\n` +
            `${readmeBlock}\n\nDraft up to ${MAX_CANDIDATES} candidates describing distinct bodies of work.`,
        },
      ],
      controller.signal,
    );

    const drafts = parseModelJson(content);
    if (drafts === null) throw new Error("model output was not the required JSON shape");

    const dropped: string[] = [];
    const candidates: Candidate[] = [];
    const provenance: DraftProvenance = { method: "local_llm", model, ranLocally: true };
    for (const d of drafts.slice(0, MAX_CANDIDATES)) {
      // THE GROUNDING GATE: every cite must name a real cluster from THIS gather.
      const evidence = d.cites.flatMap((key) => knownRefs.get(key) ?? []);
      const unknown = d.cites.filter((key) => !knownRefs.has(key));
      if (evidence.length === 0) {
        dropped.push(`"${d.title}" cited nothing that exists (${JSON.stringify(d.cites)})`);
        continue;
      }
      if (unknown.length > 0) {
        dropped.push(`"${d.title}" partly ungrounded — unknown cites ${JSON.stringify(unknown)} ignored`);
      }
      candidates.push({
        id: candidateId(`llm:${gather.repo}:${d.title}`),
        drafted: { title: d.title, summary: d.summary },
        evidence: Object.freeze(evidence),
        provenance,
        status: "proposed",
      });
    }
    return { candidates: Object.freeze(candidates), provenance, dropped: Object.freeze(dropped) };
  } catch (err) {
    const floor = draftDeterministic(gather);
    return { ...floor, fallbackCause: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A photo becomes a candidate only through the vision model; there is no deterministic
 * caption and inventing one would be fake data. Failure per-photo is reported per-photo.
 */
export async function draftFromPhoto(
  photo: GatheredPhoto,
  opts: {
    readonly baseUrl?: string;
    readonly model?: string;
    readonly mode?: string;
    readonly consent?: ConsentRecord | null;
  } = {},
): Promise<{ readonly candidate?: Candidate; readonly cause?: string }> {
  const baseUrl = opts.baseUrl ?? DEFAULT_OLLAMA_URL;
  const model = opts.model ?? DEFAULT_MODEL;
  // Threaded, not hardcoded: the text path already did this, and a hardcoded "unset"
  // here would permanently deny a future frontier vision endpoint even with valid consent.
  const verdict = mayDraftAgainst(baseUrl, opts.mode ?? "unset", opts.consent ?? null);
  if (!verdict.allowed) {
    return { cause: `vision endpoint refused by policy: ${verdict.reason}` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
  try {
    const bytes = await readFile(photo.path);
    const res = await postToModel(
      baseUrl,
      JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
        messages: [
          {
            role: "system",
            content:
              'You describe a screenshot of a developer\'s work. Reply ONLY with JSON {"title":…,"summary":…}. ' +
              "Title ≤ 80 chars. Summary 1-2 factual sentences about what is VISIBLE. Never guess at outcomes, " +
              "never rate, never invent text you cannot read.",
          },
          { role: "user", content: "Describe this screenshot as a career-evidence candidate.", images: [bytes.toString("base64")] },
        ],
      }),
      controller.signal,
    );
    if (!res.ok) return { cause: `ollama answered ${res.status}` };
    const body = (await res.json()) as { message?: { content?: string } };
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.message?.content ?? "");
    } catch {
      return { cause: "vision output was not JSON" };
    }
    // JSON.parse legally returns null, a string, a number, or an array — the type annotation
    // this used to carry (`{ title?: unknown; summary?: unknown }`) asserted an object shape
    // that nothing checked at runtime, and `parsed.title` on `null` THROWS (TypeError: Cannot
    // read properties of null), crashing the drafter instead of refusing by name. Reproduced by
    // the 12-factor audit (factor 4) against this exact line range. Same family of trap as the
    // loop's own `usable()` guard (.claude/workflows/foliage-loop.js) and
    // apps/photosynthesis/src/promote.ts:173 — a non-object parse result is refused the same
    // way a shape-mismatched object already is below: named cause, no candidate, never a throw.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      const shape = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
      return { cause: `vision output was not a JSON object (got ${shape})` };
    }
    const { title, summary } = parsed as { title?: unknown; summary?: unknown };
    if (typeof title !== "string" || title.trim() === "" || typeof summary !== "string") {
      return { cause: "vision output missing title/summary" };
    }
    return {
      candidate: {
        id: candidateId(`photo:${photo.digest}`),
        drafted: { title: title.trim(), summary: summary.trim() },
        evidence: [{ source: "photo", ref: `sha256:${photo.digest}`, excerpt: photo.path }],
        provenance: { method: "local_llm", model, ranLocally: true },
        status: "proposed",
      },
    };
  } catch (err) {
    return { cause: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
