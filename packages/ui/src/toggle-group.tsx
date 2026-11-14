"use client";

import * as React from "react";
import { ToggleGroup as Primitive } from "radix-ui";
import { cn } from "cn";

/** A compact choice with Radix roving focus. Selection is owned by the calling feature. */
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root className={cn("fol-toggle-group", className)} {...props} />;
}
function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={cn("fol-toggle-item", className)} {...props} />;
}
export { ToggleGroup, ToggleGroupItem };
