/** Static portfolio components: no hydration, remote assets or authority over evidence. */
import { createElement as h, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button.ts";

export function portfolioLink(label: string, props: ComponentProps<"a">): string {
  return renderToStaticMarkup(h(Button, { asChild: true, variant: "outline", className: "portfolio-button" }, h("a", props, label)));
}

/** A source record, never an invented screenshot or a claim of authorship. */
export function evidenceVisual(source?: { readonly source: string; readonly ref: string }): string {
  return renderToStaticMarkup(h("div", { className: "portfolio-evidence", "data-visual": "evidence" },
    h("span", { className: "portfolio-eyebrow" }, "Evidence record"),
    h("div", { className: "portfolio-record" },
      h("span", { className: "portfolio-record-mark", "aria-hidden": true }, "{ }"),
      h("strong", null, source?.source ?? "Source not recorded"),
      source ? h("code", { title: source.ref }, source.ref) : h("span", null, "No reference"))));
}
