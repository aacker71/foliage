import { createElement as h, type ComponentProps } from "react";

export type FeedbackNoticeTone = "error" | "status";
export type FeedbackNoticeProps = Omit<ComponentProps<"div">, "role"> & {
  /** Errors are announced assertively; completed actions and updates are polite. */
  tone: FeedbackNoticeTone;
};

/** A live result surface. The caller owns its wording and any recovery action. */
export function FeedbackNotice({ tone, className = "", children, ...props }: FeedbackNoticeProps) {
  return h("div", {
    ...props,
    "data-slot": "feedback-notice",
    "data-tone": tone,
    className: `fol-feedback-notice ${className}`.trim(),
    role: tone === "error" ? "alert" : "status",
  }, children);
}
