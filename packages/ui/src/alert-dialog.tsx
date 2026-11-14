"use client";

import * as React from "react";
import { AlertDialog as Primitive } from "radix-ui";
import { cn } from "cn";

const AlertDialog = Primitive.Root;
const AlertDialogTrigger = Primitive.Trigger;
const AlertDialogCancel = Primitive.Cancel;
const AlertDialogAction = Primitive.Action;

function AlertDialogContent({ className, children, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal>
    <Primitive.Overlay data-slot="alert-dialog-overlay" className="fol-alert-dialog-overlay" />
    <Primitive.Content data-slot="alert-dialog-content" className={cn("fol-alert-dialog-content", className)} {...props}>
      {children}
    </Primitive.Content>
  </Primitive.Portal>;
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-header" className={cn("fol-alert-dialog-header", className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" className={cn("fol-alert-dialog-footer", className)} {...props} />;
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof Primitive.Title>) {
  return <Primitive.Title data-slot="alert-dialog-title" className={cn("fol-alert-dialog-title", className)} {...props} />;
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof Primitive.Description>) {
  return <Primitive.Description data-slot="alert-dialog-description" className={cn("fol-alert-dialog-description", className)} {...props} />;
}

export {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel,
  AlertDialogAction,
};
