"use client";

// Adapted from shadcn/ui radix-nova Label; see docs/UI-FOUNDATION.md.
import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "cn";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root data-slot="label" className={cn("fol-form-label", className)} {...props} />;
}
export { Label };
