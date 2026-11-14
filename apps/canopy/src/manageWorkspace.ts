import type { ManageState } from "./manageState.ts";
import type { PublicationInventory } from "./publicationInventory.ts";
import type { ManageNotice } from "./renderManage.ts";

/** Private, same-origin view. Mutations still re-read every digest in manage-server. */
export interface HostingWorkspaceState {
  state: ManageState;
  inventory: PublicationInventory;
  csrf: string;
  publicOrigin: string;
  portfolioDigest?: string;
  previewArtifact?: Record<string, unknown>;
}

const attribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface HostingWorkspaceEntry {
  readonly section?: "publications" | "prepare";
  readonly includePortfolio?: boolean;
}

export function renderHostingWorkspace(notice?: ManageNotice, entry: HostingWorkspaceEntry = {}): string {
  return `<!doctype html><html lang="en" data-face="night"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hosting workspace · Foliage</title><link rel="icon" href="/mark-icon.svg"><link rel="stylesheet" href="/foliage-tokens.css"><link rel="stylesheet" href="/roles.css"><link rel="stylesheet" href="/workspace.css"></head><body class="fol-app"><div id="hosting-root" data-notice="${attribute(JSON.stringify(notice ?? null))}" data-initial-section="${entry.section ?? "publications"}" data-include-portfolio="${entry.includePortfolio ? "on" : "off"}"><p>Loading your publication workspace…</p><a href="/">Open the standard publication manager</a></div><noscript><p>This workspace needs JavaScript. <a href="/">Use the standard manager</a> for the same publication controls.</p></noscript><script src="/workspace.js" defer></script></body></html>`;
}
