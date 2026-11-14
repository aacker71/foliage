import { ui, workspaceHeader } from "@foliage/ui";
import { workspaceNavigation } from "./workspaceNavigation.ts";

/** The source checkout may not have its generated Sources bundle (workflow.js) yet. Keep the owner in the app. */
export function renderWorkflowUnavailablePage(): string {
  const actions = ui.emptyState("Sources unavailable", [
    { label: "Import a portfolio", href: "/leaf/import" },
    { label: "Work", href: "/leaf/photosynthesis" },
    { label: "Review", href: "/review" },
  ], { status: true });
  return `<!doctype html>
<html lang="en" data-face="night">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sources unavailable · Foliage</title>
  <link rel="icon" href="/mark-icon.svg">
  <link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/roles.css">
  <link rel="stylesheet" href="/foliage.css"><link rel="stylesheet" href="/controls.css">
  <link rel="stylesheet" href="/empty-state.css"><link rel="stylesheet" href="/workspace-shell.css">
  <link rel="stylesheet" href="/work-workspace.css">
</head>
<body class="fol-app" data-workflow-state="bundle-missing">
  <a class="work-skip" href="#workflow-main">Skip to content</a>
  ${workspaceHeader(workspaceNavigation("workflow"))}
  <main id="workflow-main" class="fol-app-main" tabindex="-1">
    <div class="fol-app-content work-content">
      <header class="work-heading"><h1>Sources</h1></header>
      ${actions}
      <details><summary>Technical details</summary><p>The Sources interface has not been built. Run <code>pnpm --filter @foliage/leaf-app workflow:build</code> from this checkout, then reload.</p></details>
    </div>
  </main>
</body>
</html>`;
}
