import * as React from "react";
import { cn } from "cn";

/** Layout for one native form control and its explicitly associated label. */
function Field({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field" className={cn("fol-field", className)} {...props} />;
}

export { Field };
