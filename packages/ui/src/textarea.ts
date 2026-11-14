import { createElement as h, type ComponentProps } from "react";

/** Native multiline entry with the same token-backed treatment in React and server pages. */
function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return h("textarea", { className: `fol-textarea ${className}`.trim(), "data-slot": "textarea", ...props });
}

export { Textarea };
