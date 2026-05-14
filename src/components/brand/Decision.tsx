import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Decision — editorial callout for naming a deliberate choice.
 *
 * Two-column grid: mono uppercase stamp on the left, body text on the right.
 * Primary-soft background with a left-side primary accent border. Used in
 * design docs and marketing pages to call out architectural decisions
 * ("Decision: keep Vite", "Read this", "Sequence", etc.).
 *
 * Source: design system reference docs (`/tmp/declutr-design/.../Next
 * session handoff.html`, `Hand off to Claude Code.html`).
 */
export type DecisionProps = {
  /** Mono uppercase label on the left. Keep short (≤ 12 chars). */
  stamp: string;
  className?: string;
  children: ReactNode;
};

export function Decision({ stamp, className, children }: DecisionProps) {
  return (
    <div
      className={cn(
        "my-5 grid grid-cols-[130px_1fr] items-start gap-4",
        "rounded-sm border border-primary-border border-l-[3px] border-l-primary",
        "bg-primary-soft px-5 py-4",
        "text-foreground",
        "max-md:grid-cols-1 max-md:gap-2",
        className,
      )}
      role="note"
    >
      <span className="pt-[3px] font-mono-edit text-[10px] font-bold leading-tight text-primary">
        {stamp}
      </span>
      <div className="text-[14px] leading-[1.55]">{children}</div>
    </div>
  );
}
