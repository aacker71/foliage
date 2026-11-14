/**
 * THE SCARLET PAGE — `/scarlet`, the seventh owner surface: one question about the leaf, asked
 * and answered on one page, with nothing kept.
 *
 * Pure: a view in, a document out. No file, no clock, no model, no randomness — the server edge
 * loads the leaf, reads the environment, runs `runScarlet` with a collecting sink, and hands this
 * module what it collected. There is no JavaScript on the page and the CSP forbids any, so the
 * whole exchange is one form POST and one HTML response.
 *
 * THREE VIEWS AND NOTHING MORE. `ask` is the form when a model is selected, or a setup action
 * when one is missing; `answered` shows the form and response; `refused` shows a human label and
 * recovery, with the runner's code and detail in a disclosure. An `ask` carries model configuration
 * so GET can offer setup before anyone tries to ask. A page is still status 200, not a run.
 *
 * THE BAND IS A CONTROL, HERE AS EVERYWHERE. `fabricationBand` renders on every view whenever the
 * leaf source says it is an example, from the same `fabricationSignals` the grounding uses — a
 * model answering from a fabricated document says so in its prompt, and this page says so above
 * the answer.
 *
 * NO SCORE. The three tier counts are three integers in the fixed order verified/pending/excluded
 * — a grouping, never combined, never ranked. A model is asked not to rate anyone, and a model is
 * not obeyed: rating-shaped answers are withheld, consistently with the workspace.
 *
 * NOTHING IS KEPT. The answer exists in the response bytes and nowhere else: no file, no log, no
 * session. The label `Not kept` beside `Answer` says so on the page.
 *
 * TWO REFUSAL VOCABULARIES, DELIBERATELY SEPARATE. `RunErrorCode` is the wire's — every word a
 * `RUN_ERROR` may carry, shared with `/scarlet/run`. `PageRefusal` adds the two words only a form
 * can make, both refused before any run starts: `empty-question`, because a run with no question
 * would spend the machine's model on nothing, and `question-too-long`, because the textarea's
 * `maxlength` is a browser's hint and the server holds the same number itself.
 */

import { RATING_SHAPED } from "@foliage/leaf";
import { ui } from "@foliage/ui";

import type { Provenance, RunErrorCode } from "./agui.ts";
import type { LeafLoad } from "./leafDocument.ts";
import { LOCAL_MODEL_DEFAULT_BASE_URL, MODEL_CEILING_MS, chatEndpoint, type ModelConfigResult } from "./scarletModel.ts";
import { groundingFor, renderGrounding, type Grounding } from "./scarletPrompt.ts";
import { NO_MODEL_MESSAGE, leafUnavailableMessage } from "./scarletRun.ts";
import { OLLAMA_SETUP_HREF, SCARLET_SETUP_ROUTE } from "./scarletSetupPage.ts";
import { SCARLET_ROUTE, disclosure, esc, fabricationBand, httpStatusForUnwritable, page, pathChip } from "./render.ts";

/** The one ceiling on a question: the textarea's `maxlength` and the server's check, from this number. */
export const QUESTION_MAX_CHARS = 4000;

/** The refusals a form makes before a run starts. */
export type FormRefusal = "empty-question" | "question-too-long";
/** The page's refusal words: the wire's, plus the ones only a form can make. */
export type PageRefusal = RunErrorCode | FormRefusal;

export type ScarletView =
  | {
      readonly kind: "ask";
      readonly leaf: LeafLoad;
      readonly model: ModelConfigResult;
      /** A POST whose question was blank or too long re-renders the form as `ask`, refused by name, at 400. */
      readonly refusal: FormRefusal | null;
      /** Submitted text retained when form validation refuses it. */
      readonly question?: string;
    }
  | {
      readonly kind: "answered";
      readonly leaf: LeafLoad;
      readonly question: string;
      readonly answer: string;
      readonly provenance: Provenance;
    }
  | {
      readonly kind: "refused";
      readonly leaf: LeafLoad;
      readonly question: string;
      readonly code: RunErrorCode;
      readonly message: string;
      /** What the run reported before it refused, or null when it refused before naming a model. */
      readonly provenance: Provenance | null;
    };

/**
 * Every word `PageRefusal` holds, as a list a test can loop over. The mapped type is what keeps it
 * exhaustive: a member added to the union without a row here fails the typecheck, and so does a
 * row for a word the union no longer has.
 */
const PAGE_REFUSAL_WORDS: { readonly [K in PageRefusal]: K } = {
  "no-model-declared": "no-model-declared",
  "not-loopback": "not-loopback",
  "malformed-endpoint": "malformed-endpoint",
  redirected: "redirected",
  "no-runtime": "no-runtime",
  "model-absent": "model-absent",
  timeout: "timeout",
  "runtime-refused": "runtime-refused",
  "malformed-response": "malformed-response",
  "leaf-unavailable": "leaf-unavailable",
  "empty-question": "empty-question",
  "question-too-long": "question-too-long",
};
/** Exported for its test, and for the workspace, which names the same refusals in the same words. */
export const PAGE_REFUSALS: readonly PageRefusal[] = Object.values(PAGE_REFUSAL_WORDS);

/* ---------------------------------------------------------------------------- status ---- */

/**
 * 409 for the operator's configuration (the `refuseIfUnconfigured` posture: nothing will be
 * guessed); 502 when this machine's own model runtime failed to answer — a gateway failure, named
 * as one (503 already means "the publish policy refuses" in this app); 409 when there is no leaf
 * to ask about yet or it needs repair — `httpStatusForUnwritable`, the same answer a review POST
 * gives over the harvest, not a second copy of it; 400 for a form with no question in it, or too
 * much.
 */
function httpStatusForRefusal(code: PageRefusal, leaf: LeafLoad): 400 | 409 | 500 | 502 {
  switch (code) {
    case "empty-question":
    case "question-too-long":
      return 400;
    case "no-model-declared":
    case "not-loopback":
    case "malformed-endpoint":
      return 409;
    case "no-runtime":
    case "model-absent":
    case "timeout":
    case "redirected":
    case "runtime-refused":
    case "malformed-response":
      return 502;
    case "leaf-unavailable":
      // A `leaf-unavailable` refusal beside a leaf that loaded cannot happen — the runner refuses on
      // the load it was handed — and if it ever did, the weaker claim is the server's own fault.
      return leaf.ok ? 500 : httpStatusForUnwritable(leaf);
    default: {
      const impossible: never = code;
      throw new Error(`unhandled page refusal: ${JSON.stringify(impossible)}`);
    }
  }
}

export function httpStatusForScarlet(view: ScarletView): 200 | 400 | 409 | 500 | 502 {
  switch (view.kind) {
    case "ask":
      return view.refusal === null ? 200 : httpStatusForRefusal(view.refusal, view.leaf);
    case "answered":
      return 200;
    case "refused":
      return httpStatusForRefusal(view.code, view.leaf);
    default: {
      const impossible: never = view;
      throw new Error(`unhandled scarlet view: ${JSON.stringify(impossible)}`);
    }
  }
}

/* ------------------------------------------------------------------------------ parts ---- */

interface Aside {
  readonly code: PageRefusal;
  readonly message: string;
}

function formRefusalMessage(refusal: FormRefusal): string {
  switch (refusal) {
    case "empty-question":
      return "the question was blank, so nothing was asked";
    case "question-too-long":
      return `the question is longer than ${QUESTION_MAX_CHARS} characters, so nothing was asked`;
    default: {
      const impossible: never = refusal;
      throw new Error(`unhandled form refusal: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * What the page says was not answered, or null. A `refused` view carries the runner's own words;
 * an `ask` checks form validation, leaf availability and local model selection in runner order.
 * The primary UI maps the cause to a human label; the runner's words remain in technical details.
 */
function asideFor(view: ScarletView): Aside | null {
  switch (view.kind) {
    case "answered":
      return null;
    case "refused":
      // The run's own message is its visible sentence; the closed Technical details keep the loader's words.
      return { code: view.code, message: view.code === "leaf-unavailable" && !view.leaf.ok ? leafUnavailableMessage(view.leaf) : view.message };
    case "ask":
      if (view.refusal !== null) return { code: view.refusal, message: formRefusalMessage(view.refusal) };
      if (!view.leaf.ok) return { code: "leaf-unavailable", message: leafUnavailableMessage(view.leaf) };
      if (!view.model.ok) return { code: "no-model-declared", message: NO_MODEL_MESSAGE };
      return null;
    default: {
      const impossible: never = view;
      throw new Error(`unhandled scarlet view: ${JSON.stringify(impossible)}`);
    }
  }
}

function refusalAside(aside: Aside, attempted: boolean, endpoint: string | null): string {
  const label = refusalLabel(aside.code, endpoint);
  const recovery = refusalRecovery(aside.code, endpoint);
  return `<aside class="review-refusal" role="alert" data-refusal="${esc(aside.code)}" id="assistant-status">
${attempted ? '<span class="fol-label">Not answered</span>' : ""}
<strong>${esc(label)}</strong>${recovery === null ? "" : ui.link(recovery.label, { href: recovery.href })}
${disclosure("scarlet-error", "Technical details", `<p class="fol-metric">${esc(aside.code)}</p><p>${esc(aside.message)}</p>`)}
</aside>`;
}

/** Ollama's own address, the one place where nothing answering means Ollama is not running. */
const OLLAMA_DEFAULT_HOST = new URL(LOCAL_MODEL_DEFAULT_BASE_URL).host;

/** `127.0.0.1:11434` from the endpoint a run called (or would call), or null when there is none. */
function runtimeHost(endpoint: string | null): string | null {
  if (endpoint === null) return null;
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

/**
 * The one next step a refusal offers, or null. A runtime that is not running is fixed by starting
 * it, not by choosing another model, so it links to Ollama's own setup: "Get Ollama" only at
 * Ollama's default address, setup help at any other. `endpoint` is where the model was (or would
 * be) asked. Exported because the workspace's client says the same words for the same codes.
 */
export function refusalRecovery(code: PageRefusal, endpoint: string | null): { readonly label: string; readonly href: string } | null {
  switch (code) {
    case "no-runtime": return { label: runtimeHost(endpoint) === OLLAMA_DEFAULT_HOST ? "Get Ollama" : "Ollama setup help", href: OLLAMA_SETUP_HREF };
    case "no-model-declared":
    case "model-absent": return { label: "Choose local model", href: SCARLET_SETUP_ROUTE };
    case "leaf-unavailable": return { label: "Open portfolio setup", href: "/leaf/setup" };
    default: return null;
  }
}

/**
 * The refusal in plain words. Nothing answering at the configured address is all `no-runtime`
 * knows, whatever runs there, so it names that address and not a program.
 */
export function refusalLabel(code: PageRefusal, endpoint: string | null): string {
  switch (code) {
    case "no-model-declared": return "No local model";
    case "model-absent": return "Model not installed";
    case "no-runtime": {
      const host = runtimeHost(endpoint);
      return host === null ? "The local model isn't answering" : `The local model isn't answering at ${host}`;
    }
    case "not-loopback": return "Connection blocked";
    case "malformed-endpoint": return "Connection unavailable";
    case "redirected": return "Connection changed";
    case "timeout": return "Model timed out";
    case "runtime-refused": return "Model unavailable";
    case "malformed-response": return "Response unavailable";
    case "leaf-unavailable": return "Leaf unavailable";
    case "empty-question": return "Add a question";
    case "question-too-long": return "Question too long";
    default: {
      const impossible: never = code;
      throw new Error(`unhandled page refusal: ${JSON.stringify(impossible)}`);
    }
  }
}

/** The three tiers, in the format's own order. A grouping: three integers and no fourth figure. */
function countCells(grounding: Grounding): string {
  const counts = { verified: grounding.verified, pending: grounding.pending, excluded: grounding.excluded } as const;
  const cells = (["verified", "pending", "excluded"] as const)
    .map(
      (tier) => `<div data-scarlet-count="${tier}">
<span class="fol-label">${tier}</span>
<b class="fol-metric leaf-count">${counts[tier]}</b>
</div>`,
    )
    .join("\n");
  return `<section class="assistant-counts" aria-label="Leaflets by tier">
${cells}
</section>`;
}

interface NamedModel {
  readonly model: string;
  readonly endpoint: string;
}

/**
 * Which model was — or would be — asked, and where. A REPORT after a run: `answered` and `refused`
 * show what the run itself emitted as its provenance, and a refusal that came before any model was
 * named shows none. A PROMISE before one: `ask` shows the configuration in force, computed here.
 */
function namedModel(view: ScarletView): NamedModel | null {
  switch (view.kind) {
    case "ask":
      return view.model.ok ? { model: `ollama · ${view.model.config.model}`, endpoint: chatEndpoint(view.model.config) } : null;
    case "answered":
    case "refused":
      return view.provenance === null ? null : { model: `${view.provenance.runtime} · ${view.provenance.model}`, endpoint: view.provenance.endpoint };
    default: {
      const impossible: never = view;
      throw new Error(`unhandled scarlet view: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * Model, endpoint, and how many titles the model was (or would be) given — as the leaflet's own
 * provenance list, label over value, because the endpoint is a URL and that component is the one
 * that wraps a long value inside its column.
 */
function provenanceList(view: ScarletView, grounding: Grounding | null): string {
  const named = namedModel(view);
  const titles = grounding === null ? "—" : `${grounding.titles.length} ${grounding.titles.length === 1 ? "title" : "titles"}`;
  const row = (label: string, value: string, key: string): string =>
    `<div data-scarlet-provenance="${key}"><dt class="fol-label">${label}</dt><dd class="fol-metric">${esc(value)}</dd></div>`;
  return `<dl class="leaf-prov" aria-label="Provenance">
${row("Model", named?.model ?? "—", "model")}
${row("Endpoint", named?.endpoint ?? "—", "endpoint")}
${row("Grounded on", titles, "grounded-on")}
</dl>`;
}

/** The form, carrying the question that was asked so the page is honest about what it answered. */
function askForm(question: string, ready: boolean, blocked: boolean): string {
  return `<form class="scarlet-form" method="post" action="${SCARLET_ROUTE}">
${ui.label("Question", { htmlFor: "q", className: "fol-label" })}
${ui.textarea({ id: "q", name: "question", rows: 4, maxLength: QUESTION_MAX_CHARS, required: true, defaultValue: question, ...(blocked ? { "aria-describedby": "assistant-status" } : {}) })}
${ui.button("Ask", { type: "submit", variant: "default", disabled: !ready })}
</form>`;
}

/**
 * The answer, as paragraphs: a blank line in the model's text is a paragraph break, a single line
 * break is a space within one. Every character goes through `esc` — the model's words are text
 * on this page, never markup.
 */
function answerParagraphs(answer: string): string {
  return answer
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => `<p>${esc(paragraph)}</p>`)
    .join("\n");
}

function answerSection(answer: string): string {
  const rated = RATING_SHAPED.test(answer);
  return `<section class="scarlet-answer" data-authored="model-answer"${rated ? ' data-rating-shaped="true"' : ""} aria-labelledby="scarlet-answer-h">
<span class="fol-label" id="scarlet-answer-h">Answer</span>
<span class="fol-label">Not kept</span>${rated ? `\n<span class="fol-label">contains a rating</span>` : ""}
${rated ? "" : answerParagraphs(answer)}
</section>`;
}

/**
 * Exactly what the model was given, the same text `chatMessagesFor` puts in the system message —
 * rendered from the same function, one paragraph per line of it, so the drawer cannot drift from
 * the prompt. Ends with the ceiling, from the one constant that enforces it.
 */
function groundingDisclosure(grounding: Grounding): string {
  const given = renderGrounding(grounding)
    .split("\n")
    .map((line) => `<p>${esc(line)}</p>`)
    .join("\n");
  return disclosure(
    "grounding",
    "What Photosynthesis was given",
    `${given}
<p class="fol-metric">Ceiling: ${MODEL_CEILING_MS / 1000} s</p>`,
  );
}

function sourceFooter(leaf: LeafLoad): string {
  const path = leaf.ok ? leaf.source.path : leaf.path;
  if (path === null) return "";
  return `<footer class="leaf-source">
<span class="fol-label">Document</span>
${pathChip(path)}
</footer>`;
}

/* ------------------------------------------------------------------------------- page ---- */

export function renderScarletPage(view: ScarletView): string {
  const aside = asideFor(view);
  const needsSetup = aside?.code === "no-model-declared" || aside?.code === "leaf-unavailable";
  const question = view.kind === "ask" ? view.question ?? "" : view.question;
  // THE SAME GROUNDING THE RUN USED, from the same pure function over the same leaf: the wire's
  // report carries the counts but not the titles, and the drawer shows the titles. A leaf that did
  // not load has no grounding — no counts (never zeros), no titles, no drawer.
  const grounding = view.leaf.ok ? groundingFor(view.leaf.leaf, view.leaf.source) : null;
  // WHERE THE REFUSAL SITS. Before a question is asked (`ask`), it goes ABOVE the form, so the
  // person learns before typing; after one (`refused`), it takes the answer's place BELOW the
  // form, because it is the answer to what they just sent.
  const refusal = aside === null ? "" : refusalAside(aside, view.kind !== "ask" || view.refusal !== null, namedModel(view)?.endpoint ?? null);
  const body = `<div class="assistant-page${needsSetup ? " assistant-page-setup" : ""}">
<section class="leaf-subject" aria-labelledby="scarlet-h">
<div class="leaf-subject-text">
<h1 id="scarlet-h">${needsSetup ? "Photosynthesis" : "Ask about this leaf"}</h1>
<p class="leaf-lede">Your work, on this device</p>
</div>
</section>
${view.leaf.ok ? fabricationBand(view.leaf.source) : ""}
${grounding === null || needsSetup ? "" : countCells(grounding)}
${view.kind === "ask" ? refusal : ""}
${needsSetup ? "" : askForm(question, grounding !== null && namedModel(view) !== null, aside !== null)}
${view.kind === "answered" ? answerSection(view.answer) : ""}
${view.kind === "refused" ? refusal : ""}
${needsSetup ? "" : `<p class="assistant-workspace-link">${ui.link("Open workspace", { href: "/scarlet/workspace" })}</p>
${disclosure("runtime", "Model and execution details", provenanceList(view, grounding))}
${grounding === null ? "" : groundingDisclosure(grounding)}
${sourceFooter(view.leaf)}`}
</div>`;

  return page({
    title: "Foliage — Photosynthesis",
    state: aside === null ? view.kind : aside.code,
    surface: "scarlet",
    // As on every sibling: the document LOADED and holds nothing. A leaf that failed to load is a
    // state, not an empty one.
    empty: view.leaf.ok && view.leaf.leaf.leaflets.length === 0,
    face: "night",
    nav: "scarlet",
    body,
  });
}
