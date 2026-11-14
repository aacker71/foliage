import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceHeader } from "./workspace-header.ts";
export function workspaceHeader(options: Parameters<typeof WorkspaceHeader>[0]): string {
  return renderToStaticMarkup(h(WorkspaceHeader, options));
}
