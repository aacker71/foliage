/** Hosted presentation only. Identity, CSRF, publication authority and retries stay in the router. */
import { ui, workspaceHeader } from "@foliage/ui";
import { esc } from "./renderPublished.ts";

export function hostedShell(title: string, content: string, csrf: string, signedIn = false, recruiting = false): string {
  const section = title.toLowerCase();
  const home = recruiting ? "/recruiting" : "/manage";
  const header = workspaceHeader({ home, layout: "rail", plane: "internal",
    section: recruiting ? "Recruiting" : "Canopy",
    links: recruiting ? [
      { label: "Shared portfolios", href: home, current: !section.includes("ats") },
      { label: "ATS accounts", href: "/recruiting/accounts", current: section.includes("ats") },
    ] : [
      { label: "Publications", href: home, current: !section.includes("notification") && !section.includes("source") },
      { label: "Sources", href: "/manage/sources/connect", current: section.includes("source") },
      { label: "Notifications", href: "/settings/notifications", current: section.includes("notification") },
    ], privacy: recruiting ? "Recruiting workspace" : "Private workspace",
  });
  const account = signedIn ? `<form method="post" action="/auth/sign-out"><input type="hidden" name="csrf" value="${esc(csrf)}">${ui.button("Sign out", { type: "submit", variant: "ghost" })}</form>` : ui.link("Sign in", { href: "/auth/sign-in" });
  return `<!doctype html><html lang="en" data-face="night"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Foliage</title><link rel="icon" href="/mark-icon.svg"><link rel="stylesheet" href="/foliage-tokens.css"><link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/foliage.css"><link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/workspace-shell.css"><link rel="stylesheet" href="/hosted-workspace.css"></head><body class="fol-app hosted-app"><a class="hosted-skip" href="#main">Skip to content</a>${header}<main id="main" class="fol-app-main"><div class="fol-app-content"><header class="hosted-heading"><h1>${esc(title)}</h1><nav aria-label="Account">${account}</nav></header><div class="hosted-content">${content}</div></div></main></body></html>`;
}
