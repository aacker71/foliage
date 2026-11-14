/** Authored portfolio presentation only. Callers decide which text and records may be read. */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./index.ts";

type Action = { readonly label: string; readonly href: string };
type PersonHero = {
  readonly subject: string;
  readonly headline?: string;
  readonly biography?: string;
  readonly direction?: string;
  readonly passions?: readonly string[];
  readonly eyebrow?: string;
  readonly actions?: readonly Action[];
  readonly secondaryActions?: readonly Action[];
  readonly note?: string;
  readonly composition?: "split" | "stacked";
};

/** A biography-only portfolio is complete as a reading surface; absent context stays absent. */
export function renderPersonHero(person: PersonHero): string {
  const passions = person.passions?.filter(value => value.trim());
  const hasAside = Boolean(person.direction?.trim() || passions?.length);
  const hasContent = Boolean(person.headline?.trim() || person.biography?.trim() || hasAside);
  const links = (actions: readonly Action[] | undefined, className: string) => actions?.length
    ? h("div", { className }, ...actions.map((action, index) => className === "lp-person-actions" && index === 0
      ? h(Button, { key: action.href, asChild: true, variant: "default" }, h("a", { href: action.href }, action.label))
      : h("a", { key: action.href, href: action.href }, action.label))) : null;
  return renderToStaticMarkup(h("header", { className: "lp-person-hero", "data-person-layout": hasAside ? "context" : "biography", "data-person-composition": person.composition ?? "split", "data-person-content": hasContent ? "authored" : "empty" },
    h("div", { className: "lp-person-intro", "data-person-intro": "" },
      person.eyebrow ? h("p", { className: "lp-editorial-label" }, person.eyebrow) : null,
      h("h1", { id: "personal-subject-h", "data-authored": "subject" }, person.subject),
      person.headline?.trim() ? h("p", { className: "lp-person-headline", "data-authored": "subject" }, person.headline) : null,
      person.biography?.trim() ? h("p", { className: "lp-person-bio", "data-authored": "subject" }, person.biography) : null,
      links(person.actions, "lp-person-actions"),
      person.secondaryActions?.length ? h("details", { className: "lp-person-tools" },
        h("summary", null, "Portfolio tools"), links(person.secondaryActions, "lp-person-secondary")) : null),
    hasAside ? h("div", { className: "lp-person-context" },
      person.direction?.trim() ? h("section", { "data-person-direction": "" },
        h("h2", { className: "lp-editorial-label" }, "Direction"),
        h("p", { "data-authored": "subject" }, person.direction)) : null,
      passions?.length ? h("section", { "data-person-passions": "" },
        h("h2", { className: "lp-editorial-label" }, "Interests"),
        h("ul", { className: "lp-person-passions" }, ...passions.map((passion, index) => h("li", { key: index, "data-authored": "subject" }, passion)))) : null) : null,
    person.note ? h("p", { className: "lp-person-note" }, person.note) : null));
}

type Keystone = {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly href: string;
  readonly eyebrow?: string;
  readonly collectionIds?: readonly string[];
};

/** Owner-ordered achievements link to their actual package. No summary or impact is inferred. */
export function renderKeystones(options: {
  readonly heading?: string;
  readonly introduction?: string;
  readonly items: readonly Keystone[];
  readonly selectedCollection?: string;
  readonly empty?: { readonly text: string; readonly action?: Action };
}): string {
  if (!options.items.length && !options.empty) return "";
  return renderToStaticMarkup(h("section", { id: "portfolio-keystones", tabIndex: -1, className: "lp-keystones", "data-portfolio-keystones": "" },
    h("div", { className: "lp-section-heading" },
      h("h2", null, options.heading ?? "Achievements"),
      options.introduction ? h("p", null, options.introduction) : null),
    options.items.length ? h("ol", { className: "lp-keystone-list" }, ...options.items.map(item => h("li", {
      key: item.id, className: "lp-keystone", "data-achievement-id": item.id,
      "data-collection-ids": JSON.stringify(item.collectionIds ?? []),
      hidden: Boolean(options.selectedCollection && !item.collectionIds?.includes(options.selectedCollection)),
    },
    h("div", { className: "lp-keystone-main" },
      item.eyebrow ? h("p", { className: "lp-editorial-label" }, item.eyebrow) : null,
      h("h3", { "data-authored": "subject" }, h("a", { href: item.href }, item.title)),
      item.summary ? h("p", { className: "lp-keystone-summary", "data-authored": "subject" }, item.summary) : null),
    h("a", { className: "lp-keystone-open", href: item.href, "aria-label": `Read ${item.title}` },
      h("span", null, "Read"), h("span", { "aria-hidden": true }, "↗")))))
      : h("div", { className: "lp-keystone-empty" }, h("p", null, options.empty!.text),
        options.empty!.action ? h("a", { href: options.empty!.action.href }, options.empty!.action.label) : null),
    options.items.length ? h("p", {
      className: "lp-keystone-empty", "data-portfolio-keystone-empty": "",
      hidden: !options.selectedCollection || options.items.some(item => item.collectionIds?.includes(options.selectedCollection!)),
    }, "No achievements in this view") : null));
}
