/**
 * THE LEGACY LABEL. This dashboard predates `foliage up` and is kept for reference only, so every
 * HTML page it serves says so at the top of its content. The pages it composes come from other
 * apps' renderers, which this composition does not rewrite (see routes.ts); the notice is placed
 * on the way out instead, at the one `send` every response passes through.
 *
 * The review renderer already carries the same notice, so a page that has it is left alone.
 */

/** Spacing for the notice. The composed pages link their own stylesheets, not this app's. */
const STYLESHEET = '<link rel="stylesheet" href="/dashboard.css">';

/** Top of the content column when there is one, else the top of `<main>`, `<body>`, or the page. */
const CONTENT_START = [
  /<main\b[^>]*>\s*<div class="fol-app-content\b[^"]*">/,
  /<main\b[^>]*>/,
  /<body\b[^>]*>/,
  /<\/title>/,
];

/**
 * The top of a page with none of those: after its doctype and any leading `<html>`, `<head>`,
 * `<meta>`, `<link>` or `</head>`. Anything before the doctype puts the browser in quirks mode.
 */
const PREAMBLE = /^\s*(?:<!doctype\b[^>]*>\s*)?(?:(?:<(?:html|head|meta|link)\b[^>]*>|<\/head>)\s*)*/i;

export function withLegacyNotice(html: string, notice: string): string {
  if (html.includes(notice)) return html;
  const head = html.indexOf("</head>");
  const styled = head === -1 || html.includes(STYLESHEET) ? html : html.slice(0, head) + STYLESHEET + html.slice(head);
  for (const pattern of CONTENT_START) {
    const at = pattern.exec(styled);
    if (at !== null) {
      const end = at.index + at[0].length;
      return styled.slice(0, end) + notice + styled.slice(end);
    }
  }
  const top = PREAMBLE.exec(styled)?.[0].length ?? 0;
  return styled.slice(0, top) + notice + styled.slice(top);
}
