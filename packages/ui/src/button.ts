/** Foliage control. Radix Slot preserves the semantics of a supplied link or button. */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

const buttonVariants = cva("fol-button", {
  variants: {
    variant: {
      default: "fol-button-primary", outline: "fol-button-outline",
      secondary: "fol-button-secondary", ghost: "fol-button-ghost",
      destructive: "fol-button-destructive", link: "fol-button-link",
    },
    size: {
      default: "fol-button-regular", xs: "fol-button-xs", sm: "fol-button-sm",
      lg: "fol-button-lg", icon: "fol-button-icon", "icon-xs": "fol-button-icon fol-button-xs",
      "icon-sm": "fol-button-icon fol-button-sm", "icon-lg": "fol-button-icon fol-button-lg",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});
function Button({ className, variant = "default", size = "default", asChild = false, ...props }:
  React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const attributes = {
    "data-slot": "button", "data-variant": variant, "data-size": size,
    className: cn(buttonVariants({ variant, size, className })), ...props,
  };
  return React.createElement(asChild ? Slot.Root : "button", attributes);
}
export { Button, buttonVariants };
