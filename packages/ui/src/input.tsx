// Adapted from shadcn/ui radix-nova Input; see docs/UI-FOUNDATION.md.
import * as React from "react";
import { cn } from "cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn("fol-input", className)} {...props} />;
}
export { Input };
