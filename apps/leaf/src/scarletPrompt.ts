/**
 * WHAT SCARLET IS TOLD, AND NOTHING ELSE — the grounding derived from the real leaf, the role it is
 * held to, and the chat messages that carry both to a local model.
 *
 * Pure: a leaf and its source in, text out. No file, no clock, no model here.
 *
 * DEFAULT GROUNDING IS THREE INTEGERS, THE REASONS, AND THE TITLES. `attributionLedger` already refuses
 * to hand out a ratio, and this module keeps that posture in prose: the three tier counts are
 * stated separately with the sentence that they are a grouping, not an order, and may not be
 * combined into any figure. Every exclusion reason is quoted verbatim, because "3 excluded" without
 * the reasons is a number the model would be free to explain by guessing. Titles go in document
 * order up to `GROUNDING_TITLE_LIMIT`, and the count left out is said out loud — in the prompt and
 * on the wire — so an answer built from 120 titles is never mistaken for one built from all of them.
 *
 * A workspace selection replaces the title sweep with a bounded read-only tool result: selected
 * text, references, and explicit omissions. Its tier counts describe that supplied selection.
 *
 * THE ROLE IS PROPOSE-ONLY, and the wording is not what enforces it: nothing a run emits is executed
 * by the server — tools are read-only and selected by the user, and no write route reads a run's output. The sentence is there so
 * the model says so when asked, rather than inventing an approval it cannot give.
 *
 * NO TIER VOCABULARY beyond the three names (F-004): `verified`, `pending`, `excluded` are the words
 * the leaf uses, and the model is given no synonym it could rank them with.
 */

import { attributionLedger, type Leaf, type ProofTier } from "@foliage/leaf";

import type { RunInputMessage } from "./agui.ts";
import { fabricationSignals, type LeafSource } from "./leafDocument.ts";
import { contextPrompt, type ScarletContext } from "./scarletTools.ts";

/**
 * How many titles the grounding lists. An assumption about what a small local model's context
 * holds comfortably, to be measured on a full-size leaf; the remainder line keeps it honest
 * whatever the number is. Exported for its test.
 */
export const GROUNDING_TITLE_LIMIT = 120;

/** Exported for its test. */
export const SCARLET_SYSTEM_PROMPT =
  `You are Photosynthesis, an assistant that answers questions about one person's Foliage leaf — the ` +
  `portfolio document you are given below. ` +
  `You propose. You cannot approve, reject, promote, publish, share or change policy; say so if ` +
  `asked. Do not rate, rank or score the person or the work; do not produce percentages or N-of-M ` +
  `figures about them. Answer from the leaf you were given; say plainly when it does not contain ` +
  `the answer.`;

interface GroundingTitle {
  readonly title: string;
  readonly tier?: ProofTier;
}

export interface Grounding {
  readonly context?: ScarletContext;
  readonly subject: string;
  /** True whenever the page would show the fabrication band: the document says so, or it is the bundled example. */
  readonly declaredExample: boolean;
  readonly verified: number;
  readonly pending: number;
  readonly excluded: number;
  readonly exclusionReasons: readonly string[];
  /** Document order, the first `GROUNDING_TITLE_LIMIT`. */
  readonly titles: readonly GroundingTitle[];
  /** How many the ceiling left out; 0 when none. */
  readonly notListed: number;
}

export function groundingFor(leaf: Leaf, source: LeafSource, context?: ScarletContext): Grounding {
  const selected = context === undefined ? leaf.leaflets : context.tool.name === "read_candidate" ? [] : leaf.leaflets.filter((l) => context.documents.some((d) => d.id === l.id));
  const ledger = attributionLedger({ ...leaf, leaflets: selected });
  const listed = selected.slice(0, GROUNDING_TITLE_LIMIT);
  return {
    ...(context === undefined ? {} : { context }),
    subject: context?.subject ?? leaf.subject,
    declaredExample: fabricationSignals(source).length > 0,
    verified: ledger.verified,
    pending: ledger.pending,
    excluded: ledger.excluded,
    exclusionReasons: context === undefined ? ledger.exclusionReasons : context.documents.flatMap((d) => d.reason === undefined ? [] : [d.reason]),
    titles: (context === undefined ? listed : context.documents).map((l) => ({ title: l.title, ...(l.tier === undefined ? {} : { tier: l.tier }) })),
    notListed: context === undefined ? leaf.leaflets.length - listed.length : context.omitted,
  };
}

/** Workflow packets have no proof tiers and do not depend on a portfolio document. */
export function workflowGrounding(context: ScarletContext): Grounding {
  return { context, subject: context.subject!, declaredExample: false,
    verified: 0, pending: 0, excluded: 0, exclusionReasons: [],
    titles: context.documents.map((d) => ({ title: d.title })), notListed: context.omitted };
}

/** The sentence a fabricated document earns, in the prompt as on the page. */
const EXAMPLE_SENTENCE =
  "This leaf is an example document: its contents are fabricated illustrations, not evidence about " +
  "a real person. Say so whenever you answer from it.";

/** The text block that becomes the system message, after the role. Exported for its test and for `scarletPage.ts`'s disclosure, which shows the same text. */
export function renderGrounding(g: Grounding): string {
  const lines: string[] = [`Subject: ${g.subject}`];
  if (g.declaredExample) lines.push(EXAMPLE_SENTENCE);
  if (g.context?.tool.name === "read_workflow") lines.push("This is a private workflow packet, not a Leaf. No proof tiers or portfolio claims are supplied.");
  else lines.push(
    `Leaflets by tier — verified: ${g.verified}; pending: ${g.pending}; excluded: ${g.excluded}. ` +
      `The three tiers are a grouping, not an order, and may not be combined into any single figure.`,
  );
  if (g.exclusionReasons.length > 0) {
    lines.push(g.context === undefined ? "Exclusion reasons, verbatim:" : "Recorded exclusion reasons (shortening is disclosed in context notes):", ...g.exclusionReasons.map((reason) => `- ${reason}`));
  }
  if (g.titles.length === 0) {
    lines.push("The leaf holds no leaflets.");
  } else {
    // The title first, in quotes, and the tier after it. With the tier in front — `- (pending) …` —
    // llama3.2:3b read it as the start of the title and answered that the first title was
    // "(pending) review" (measured 2026-09-02); the quotes say where the title begins and ends.
    lines.push(g.context?.purpose === "review" ? "Selected review draft (not a leaflet):" : "Leaflet titles, in document order, each quoted and followed by its tier:", ...g.titles.map((t) => `- "${t.title}" (${t.tier ?? "review draft; no proof tier"})`));
  }
  if (g.notListed > 0) lines.push(`${g.notListed} more leaflets are not listed.`);
  if (g.context !== undefined) lines.push(contextPrompt(g.context));
  return lines.join("\n");
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/**
 * Our system message first, then the client's forwarded turns in their order. The parser has
 * already removed the roles this server does not forward, so nothing the client sent can precede
 * or replace the grounding.
 */
export function chatMessagesFor(g: Grounding, history: readonly RunInputMessage[]): readonly ChatMessage[] {
  return [
    { role: "system", content: `${SCARLET_SYSTEM_PROMPT}\n\n${renderGrounding(g)}` },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
}
