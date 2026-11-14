/** Hide the collector's grouping label in compact previews; Review keeps the full draft title. */
export function compactDraftTitle(id: string, title: string): string {
  const rest = id.startsWith("git-cluster:") ? id.slice("git-cluster:".length) : "";
  const prefix = rest.replace(/:[1-9]\d*$/, "");
  const grouping = prefix && !prefix.includes(":") ? `${prefix}: ` : "";
  return grouping && title.startsWith(grouping) ? title.slice(grouping.length) : title;
}
