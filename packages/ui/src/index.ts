/** Native document facade over the shared Foliage controls. */
import { createElement as h, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button as SharedButton } from "./button.ts";
import { EmptyState, EmptyStateTitle, EmptyStateActions } from "./empty-state.ts";
import { FeedbackNotice, type FeedbackNoticeTone } from "./feedback-notice.ts";
import { Textarea as SharedTextarea } from "./textarea.ts";

type DataProps = { [key: `data-${string}`]: string | undefined };
type ButtonProps = ComponentProps<typeof SharedButton> & DataProps;
type EmptyStateAction = Readonly<{ label: string; href: string }>;
type FeedbackNoticeOptions = Readonly<{ tone: FeedbackNoticeTone; heading?: string; id?: string; tabIndex?: number; autoFocus?: boolean; className?: string }>;
export function Button({ variant = "outline", className = "", ...props }: ButtonProps) {
  // Keep the static document classes while using the same Foliage component as React apps.
  return h(SharedButton, { ...props, variant, className: `btn ${variant === "default" ? "btn-primary" : "btn-ghost"} ${className}` });
}
function Input({ className = "", ...props }: ComponentProps<"input">) {
  return h("input", { className: `field ${className}`.trim(), "data-slot": "input", ...props });
}
function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return h(SharedTextarea, { ...props, className: `field ${className}`.trim() });
}
function Label({ className = "", ...props }: ComponentProps<"label">) {
  return h("label", { className, "data-slot": "label", ...props });
}
function Alert({ className = "", ...props }: ComponentProps<"div">) {
  return h("div", { className: `ui-alert ${className}`.trim(), "data-slot": "alert", role: "alert", ...props });
}

/** Values are text/React properties, never pre-escaped HTML. No raw-HTML API is exposed. */
export const ui = {
  button: (text: string, props: ButtonProps = {}) => renderToStaticMarkup(h(Button, props, text)),
  link: (text: string, props: ComponentProps<"a"> & DataProps) =>
    renderToStaticMarkup(h(Button, { asChild: true }, h("a", props, text))),
  input: (props: ComponentProps<"input">) => renderToStaticMarkup(h(Input, props)),
  textarea: (props: ComponentProps<"textarea">) => renderToStaticMarkup(h(Textarea, props)),
  label: (text: string, props: ComponentProps<"label">) => renderToStaticMarkup(h(Label, props, text)),
  alert: (text: string, props: ComponentProps<"div"> = {}) => renderToStaticMarkup(h(Alert, props, text)),
  feedbackNotice: (detail: string, { heading, ...props }: FeedbackNoticeOptions) =>
    renderToStaticMarkup(h(FeedbackNotice, props,
      heading ? h("strong", null, heading) : null,
      h("span", null, detail))),
  emptyState: (title: ReactNode, actions: readonly [EmptyStateAction, ...EmptyStateAction[]], options: { status?: boolean } = {}) =>
    renderToStaticMarkup(h(EmptyState, options.status ? { role: "status" } : null,
      h(EmptyStateTitle, null, title),
      h(EmptyStateActions, null, ...actions.map((action, index) => index === 0
        ? h(SharedButton, { asChild: true, key: `${index}-${action.href}` }, h("a", { href: action.href }, action.label))
        : h("a", { className: "fol-empty-state-link", href: action.href, key: `${index}-${action.href}` }, action.label))))),
};

export { workspaceHeader } from "./workspace.ts";
