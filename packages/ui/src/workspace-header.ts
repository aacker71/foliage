import { createElement as h } from "react";

export function WorkspaceHeader(options: {
  readonly home?: string;
  readonly layout?: "rail";
  readonly plane?: "studio" | "internal";
  readonly section?: string;
  readonly links: readonly { readonly label: string; readonly href: string; readonly current?: boolean }[];
  readonly tools?: readonly { readonly label: string; readonly href: string; readonly current?: boolean }[];
  readonly currentTool?: string;
  readonly action?: { readonly label: string; readonly href: string };
  readonly privacy?: string;
}) {
  const link = (item: typeof options.links[number]) => h("a", { key: item.href, href: item.href, ...(item.current ? { "aria-current": "page" as const } : {}) }, item.label);
  return h("header", { className: "fol-workspace", ...(options.layout ? { "data-layout": options.layout } : {}), ...(options.plane ? { "data-plane": options.plane } : {}) },
    h("a", { className: "fol-workspace-brand", href: options.home ?? "/" }, h("span", { className: "fol-workspace-mark", "aria-hidden": true }), "Foliage"),
    options.section ? h("span", { className: "fol-workspace-section" }, options.section) : null,
    h("nav", { "aria-label": "Primary", className: "fol-workspace-nav" }, ...options.links.map(link)),
    options.tools?.length || options.action ? h("details", { className: "fol-workspace-tools", ...(!options.tools?.length ? { "data-mobile-only": true } : {}) },
      h("summary", options.currentTool ? { "aria-current": "page", "aria-label": `More tools; current page ${options.currentTool}` } : null, "More"),
      h("nav", { "aria-label": "More tools" },
        ...(options.tools?.map(link) ?? []),
        options.action ? h("a", { className: "fol-workspace-action-mobile", href: options.action.href }, options.action.label) : null)) : null,
    options.privacy ? h("span", { className: "fol-workspace-privacy" }, options.privacy) : null,
    options.action ? h("a", { className: "fol-workspace-action", href: options.action.href }, options.action.label) : null);
}
