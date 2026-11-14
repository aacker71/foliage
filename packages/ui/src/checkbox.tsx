"use client";

import * as React from "react";
import { Checkbox as Primitive } from "radix-ui";
import { cn } from "cn";

/** Radix owns checked, keyboard and form behavior; Foliage owns the control's appearance. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root data-slot="checkbox" className={cn("fol-checkbox", className)} {...props}>
      <Primitive.Indicator className="fol-checkbox-indicator" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Primitive.Indicator>
    </Primitive.Root>
  );
}

export { Checkbox };
