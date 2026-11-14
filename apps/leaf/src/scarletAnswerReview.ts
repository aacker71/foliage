/** Narrow, deterministic checks. No result here establishes the truth of a model's prose. */
import { RATING_SHAPED } from "@foliage/leaf";
import type { ScarletContext } from "./scarletTools.ts";

export interface ScarletAnswerReview {
  readonly findings: readonly { readonly code: string; readonly detail: string }[];
  readonly checked: "citation labels, literal dates, missing-data statements, rating language";
}

export function reviewScarletAnswer(text: string, context: ScarletContext): ScarletAnswerReview {
  const findings: { code: string; detail: string }[] = [];
  const add = (code: string, detail: string): void => { findings.push({ code, detail }); };
  const labels = new Set(context.documents.map((d) => d.citation));
  const cited = [...text.matchAll(/\[(L\d+)\]/g)].map((m) => m[1]!);
  if (!cited.some((label) => labels.has(label))) add("missing-citations", "No supplied record cited. Check its claims.");
  if (cited.some((label) => !labels.has(label))) add("unknown-citation", "Cites a record not supplied.");
  const data = JSON.stringify(context);
  const dates = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((m) => m[0]);
  if (dates.some((date) => !data.includes(date))) add("date-not-in-context", "Date not in the evidence. Check it.");
  const observed = context.documents.some((d) => d.capturedAt || d.provenance?.observedAt || d.body.some((e) => e.provenance.observedAt));
  if (observed && /\b(?:no dates?|dates? (?:is|are) (?:missing|unavailable|not (?:recorded|provided|included)))\b/i.test(text)) add("overlooked-date", "Observation dates exist; the answer may miss them. Not work dates.");
  if (context.documents.length === 1 && context.documents[0]!.body.some((e) => e.text?.trim()) &&
      /\b(?:no (?:body|text|content) (?:is |was )?(?:recorded|provided|included)|body (?:is |was )?(?:missing|unavailable))\b/i.test(text)) {
    add("overlooked-text", "Says body text is missing; it was supplied.");
  }
  if (RATING_SHAPED.test(text)) add("rating-language", "Rating language · withheld. Ask about the evidence.");
  return { findings, checked: "citation labels, literal dates, missing-data statements, rating language" };
}
