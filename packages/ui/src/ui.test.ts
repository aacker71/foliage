import test from "node:test";
import assert from "node:assert/strict";
import { ui } from "./index.ts";
import { FeedbackNotice } from "./feedback-notice.ts";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { evidenceVisual, portfolioLink } from "./portfolio.ts";

test("untrusted labels and form values remain text through server rendering", () => {
  const attack = '\"><script>window.compromised = true</script>';
  for (const html of [ui.button(attack), ui.label(attack, { htmlFor: "question" }),
    ui.input({ name: "q", defaultValue: attack }), ui.textarea({ name: "q", defaultValue: attack }),
    ui.alert(attack), ui.link(attack, { href: "/review#candidate-safe" })]) {
    assert.doesNotMatch(html, /<script|onclick=/i);
    assert.match(html, /&lt;script&gt;/);
  }
});

test("static controls preserve native navigation, form submission and unavailable states", () => {
  const link = ui.link("Return to Review", { href: "/review#candidate-git%3Aref" });
  assert.match(link, /^<a /);
  assert.doesNotMatch(link, /<button|<script|tabindex="-1"/);
  const button = ui.button("Approve", { name: "decision", value: "approve", type: "submit" });
  for (const attribute of ['name="decision"', 'value="approve"', 'type="submit"']) assert.ok(button.includes(attribute));
  assert.match(ui.button("Stop", { hidden: true, disabled: true }), /hidden=""/);
  assert.match(ui.button("Stop", { hidden: true, disabled: true }), /disabled=""/);
  assert.match(ui.input({ name: "by", required: true }), /required=""/);
  assert.match(ui.textarea({ name: "question", readOnly: true }), /readOnly=""/);
});

test("empty state keeps one primary action, native secondary links and escaped text", () => {
  const attack = '<script>unsafe</script>';
  const html = ui.emptyState(attack, [
    { label: "Connect a source", href: "/workflow#sources" },
    { label: attack, href: "/leaf/import" },
  ]);
  assert.match(html, /<section data-slot="empty-state" class="fol-empty-state">/);
  assert.match(html, /<h2 data-slot="empty-state-title" class="fol-empty-state-title">&lt;script&gt;unsafe&lt;\/script&gt;<\/h2>/);
  assert.match(html, /href="\/workflow#sources"[^>]*class="fol-button fol-button-primary[^\"]*">Connect a source<\/a>/);
  assert.match(html, /class="fol-empty-state-link" href="\/leaf\/import">&lt;script&gt;unsafe&lt;\/script&gt;<\/a>/);
  assert.doesNotMatch(html, /<script|<button|<u>|text-decoration:underline/i);
});

test("feedback notices announce errors assertively and results politely without losing recovery controls", () => {
  const error = renderToStaticMarkup(h(FeedbackNotice, { tone: "error" },
    h("p", null, "Could not connect"), h("button", { type: "button" }, "Retry")));
  assert.match(error, /data-slot="feedback-notice"[^>]*data-tone="error"[^>]*role="alert"/);
  assert.match(error, /<button type="button">Retry<\/button>/);
  const status = ui.feedbackNotice("Saved", { tone: "status", heading: "Connection", id: "notice", tabIndex: -1, autoFocus: true });
  assert.match(status, /data-tone="status"[^>]*role="status"/);
  assert.match(status, /id="notice"[^>]*tabindex="-1"[^>]*autofocus=""/i);
  assert.match(status, /<strong>Connection<\/strong><span>Saved<\/span>/);
});

test("native feedback notice treats caller wording as text", () => {
  const html = ui.feedbackNotice('<script>untrusted()</script>', { tone: "error", heading: '<img src="x">' });
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;untrusted\(\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=&quot;x&quot;&gt;/);
});

test("retained portfolio helpers render directly in Node and keep evidence as escaped text", () => {
  const attack = "<script>window.compromised = true</script>";
  const link = portfolioLink(attack, { href: "/leaf#work" });
  assert.match(link, /^<a /);
  assert.match(link, /href="\/leaf#work"/);
  for (const html of [link, evidenceVisual({ source: attack, ref: attack })]) {
    assert.doesNotMatch(html, /<script|<img|<button|<iframe/i);
    assert.match(html, /&lt;script&gt;/);
  }
  const absent = evidenceVisual();
  assert.match(absent, /Source not recorded/);
  assert.match(absent, /<span>No reference<\/span>/);
  assert.doesNotMatch(absent, /<img|<iframe/i);
});
