"use client";

import * as React from "react";
import { cn } from "cn";

/** One full-width action in a compact list, built on the shared button contract. */
function ActionList({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="action-list" className={cn("fol-action-list", className)} {...props} />;
}

function ActionRow({ className, type = "button", ...props }: React.ComponentProps<"button">) {
  return <button type={type} data-slot="action-row" className={cn("fol-button fol-action-row", className)} {...props} />;
}

function ActionRowTitle({ className, ...props }: React.ComponentProps<"strong">) {
  return <strong data-slot="action-row-title" className={cn("fol-action-row-title", className)} {...props} />;
}

function ActionRowMeta({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="action-row-meta" className={cn("fol-action-row-meta", className)} {...props} />;
}

export { ActionList, ActionRow, ActionRowTitle, ActionRowMeta };
