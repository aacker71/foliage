import * as React from "react";
import { cn } from "cn";

/** A small, action-led state for an honest absence of content. */
function EmptyState({ className, ...props }: React.ComponentProps<"section">) {
  return React.createElement("section", { "data-slot": "empty-state", className: cn("fol-empty-state", className), ...props });
}

function EmptyStateTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return React.createElement("h2", { "data-slot": "empty-state-title", className: cn("fol-empty-state-title", className), ...props });
}

function EmptyStateActions({ className, ...props }: React.ComponentProps<"div">) {
  return React.createElement("div", { "data-slot": "empty-state-actions", className: cn("fol-empty-state-actions", className), ...props });
}

export { EmptyState, EmptyStateTitle, EmptyStateActions };
