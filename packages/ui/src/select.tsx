"use client";

import * as React from "react";
import { Select as Primitive } from "radix-ui";
import { cn } from "cn";

/** Radix owns keyboard and focus behavior; Foliage tokens own the field and menu. */
function Select(props: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props} />;
}

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger data-slot="select-trigger" className={cn("fol-select-trigger", className)} {...props}>
      {children}
      <Primitive.Icon className="fol-select-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Primitive.Icon>
    </Primitive.Trigger>
  );
}

function SelectValue(props: React.ComponentProps<typeof Primitive.Value>) {
  return <Primitive.Value data-slot="select-value" {...props} />;
}

function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content data-slot="select-content" className={cn("fol-select-content", className)} position={position} {...props}>
        <Primitive.Viewport className="fol-select-viewport">{children}</Primitive.Viewport>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item data-slot="select-item" className={cn("fol-select-item", className)} {...props}>
      <Primitive.ItemText>{children}</Primitive.ItemText>
      <Primitive.ItemIndicator className="fol-select-indicator" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
