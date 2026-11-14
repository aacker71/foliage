/** Local view anchors contain no source paths, emails or draft text. Review is not a view here:
 * the one review queue is /review, and an old `#review` link lands on the Overview. */
export const workflowViews = ["Overview", "Sources", "Background workflow"] as const;
export type WorkflowView = (typeof workflowViews)[number];
const anchors = ["overview", "sources", "background"] as const;
export function workflowHref(view: WorkflowView): string {
  return `#${anchors[workflowViews.indexOf(view)]}`;
}
export function workflowLocation(hash: string): { view: WorkflowView } | null {
  if (hash === "#workspace-main") return null;
  const [anchor] = hash.replace(/^#/, "").split("/");
  return { view: workflowViews[anchors.findIndex((v) => v === anchor)] ?? "Overview" };
}
