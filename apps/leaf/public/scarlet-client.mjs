import { readScarletStream } from "./scarlet-stream.mjs";

const form = document.querySelector("#lb-ask");
const question = document.querySelector("#lb-question");
const transcript = document.querySelector("#lb-transcript");
const status = document.querySelector("#lb-status");
const send = document.querySelector("#lb-send");
const stop = document.querySelector("#lb-stop");
const clear = document.querySelector("#lb-clear");
const threadId = crypto.randomUUID();
const ratingPattern = new RegExp(transcript.dataset.ratingPattern, "i");
const refusals = JSON.parse(form.dataset.refusals ?? "{}");
let history = [];
let controller = null;

function entry(label, text) {
  const section = document.createElement("section");
  section.className = "lb-message";
  const heading = document.createElement("h3");
  heading.textContent = label;
  const body = document.createElement("div");
  body.className = "lb-message-body";
  body.textContent = text;
  section.append(heading, body);
  transcript.append(section);
  return body;
}

function citations(body, text, records) {
  body.replaceChildren();
  const pattern = /\[(L\d+)\]/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    body.append(document.createTextNode(text.slice(cursor, match.index)));
    const doc = records.find((item) => item.citation === match[1]);
    if (doc) {
      const link = document.createElement("a");
      link.href = recordHref(doc);
      link.textContent = match[0];
      link.title = doc.title;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      body.append(link);
    } else body.append(document.createTextNode(`${match[0]} (unknown)`));
    cursor = match.index + match[0].length;
  }
  body.append(document.createTextNode(text.slice(cursor)));
  const sources = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Records";
  sources.append(summary);
  for (const doc of records) {
    const row = document.createElement("p");
    const link = document.createElement("a");
    link.href = recordHref(doc);
    link.textContent = `[${doc.citation}] ${doc.title}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    row.append(link);
    sources.append(row);
  }
  body.after(sources);
}

function recordHref(doc) {
  // Only the fixed private record routes are usable, even if a malformed context reaches us.
  return typeof doc.href === "string" && /^(?:\/review#candidate-|\/workflow\/export\?packet=[a-f0-9]{64}$)/.test(doc.href)
    ? doc.href : `/my/leaflet/${encodeURIComponent(doc.id)}`;
}

function showReview(answer, review, content) {
  const section = document.querySelector("#lb-check-template").content.firstElementChild.cloneNode(true);
  const heading = document.createElement("h4");
  heading.textContent = review.findings.length ? "Needs review" : "Checks";
  section.append(heading);
  const facts = document.createElement("p");
  facts.textContent = review.findings.length ? review.findings.map((f) => f.detail).join(" ") :
    "No issues found · not fact-checked";
  section.append(facts);
  answer.parentElement.append(section);
  if (review.findings.some((f) => f.code === "rating-language")) {
    answer.textContent = "Withheld";
    return;
  }
  const copy = document.querySelector("#lb-copy-template").content.firstElementChild.cloneNode(true);
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(content); copy.textContent = "Copied"; }
    catch { copy.textContent = "Copy failed"; }
  });
  answer.parentElement.append(copy);
}

// A refusal is named in plain words with its next step; the runner's own detail stays in a disclosure.
function refused(answer, item) {
  const copy = Object.hasOwn(refusals, item.code) ? refusals[item.code] : null;
  if (!copy) { status.textContent = item.message; return; }
  status.textContent = copy.label;
  if (copy.recovery) {
    // A new tab, as citations open: leaving this one would discard the conversation it holds.
    const link = document.createElement("a");
    link.href = copy.recovery.href;
    link.textContent = copy.recovery.label;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    status.append(" · ", link);
  }
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Technical details";
  const detail = document.createElement("p");
  detail.textContent = item.message;
  details.append(summary, detail);
  answer.after(details);
}

function busy(value) {
  send.disabled = value || form.dataset.ready !== "true";
  stop.hidden = !value;
  clear.disabled = value;
  question.readOnly = value;
  document.querySelectorAll("[data-question]").forEach((button) => { button.disabled = value; });
  form.setAttribute("aria-busy", String(value));
}

document.querySelectorAll("[data-question]").forEach((button) => {
  button.addEventListener("click", () => { question.value = button.dataset.question; question.focus(); });
});
stop.addEventListener("click", () => controller?.abort());
clear.addEventListener("click", () => {
  history = [];
  transcript.replaceChildren();
  status.textContent = "Cleared";
  question.focus();
});
window.addEventListener("pagehide", () => controller?.abort());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (controller || !form.reportValidity() || form.dataset.ready !== "true") return;
  const text = question.value.trim();
  if (!text) return;
  const user = { id: crypto.randomUUID(), role: "user", content: text };
  const selection = JSON.parse(form.dataset.selection);
  const runId = crypto.randomUUID();
  const request = { threadId, runId, messages: [...history, user], tools: [], context: [], state: {},
    forwardedProps: { foliage: selection } };
  entry("You", text);
  const answer = entry("Photosynthesis · suggestion", "");
  answer.dataset.authored = "model-answer";
  controller = new AbortController();
  const timed = AbortSignal.timeout(190_000);
  const signal = AbortSignal.any([controller.signal, timed]);
  let content = "";
  let records = [];
  let failed = false;
  let review = null;
  busy(true);
  status.textContent = "Reading…";
  try {
    const response = await fetch("/scarlet/run", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(request), signal, redirect: "error" });
    await readScarletStream(response, { threadId, runId }, (item) => {
      if (item.type === "CUSTOM" && item.name === "foliage.grounding") {
        const context = item.value?.context;
        if (!context || context.documentDigest !== form.dataset.digest || !Array.isArray(context.documents) ||
          context.documents.some((doc) => typeof doc.id !== "string" || typeof doc.title !== "string" || !/^L\d+$/.test(doc.citation))) {
          throw new Error("Evidence mismatch. Reload.");
        }
        records = context.documents;
        status.textContent = "Waiting for model…";
      }
      if (item.type === "TEXT_MESSAGE_CONTENT") {
        if (!records.length) throw new Error("Answer missing its evidence.");
        const follow = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 64;
        content += item.delta;
        answer.textContent = ratingPattern.test(content) ? "Withheld" : content;
        if (ratingPattern.test(content)) {
          answer.dataset.ratingShaped = "true";
          answer.previousElementSibling.textContent = "Photosynthesis · suggestion · contains a rating";
        }
        status.textContent = "Answering…";
        if (follow) transcript.scrollTop = transcript.scrollHeight;
      }
      if (item.type === "CUSTOM" && item.name === "foliage.answer-review") {
        if (!Array.isArray(item.value?.findings) || item.value.findings.some((f) => typeof f.code !== "string" || typeof f.detail !== "string")) throw new Error("Checks unreadable. Retry.");
        review = item.value;
      }
      if (item.type === "RUN_ERROR") { failed = true; refused(answer, item); }
    });
    if (!failed && content.trim()) {
      if (!review) throw new Error("Checks missing. Retry.");
      citations(answer, content, records);
      showReview(answer, review, content);
      if (!review.findings.length) history = [...history, user, { id: crypto.randomUUID(), role: "assistant", content }].slice(-8);
      // Bound browser-held history independently of answer size. No local/session storage.
      while (history.length && JSON.stringify(history).length > 80_000) history.splice(0, 2);
      if (!review.findings.length) question.value = "";
      status.textContent = review.findings.length ? "Needs review" : "Done";
    } else if (!failed) throw new Error("No answer. Try a narrower question.");
  } catch (error) {
    failed = true;
    status.textContent = signal.aborted
      ? timed.aborted ? "Timed out" : "Stopped"
      : error instanceof Error ? error.message : "Interrupted";
  } finally {
    if (failed) {
      answer.dataset.incomplete = "true";
      if (!content) answer.textContent = "No answer";
    }
    controller = null;
    busy(false);
  }
});
