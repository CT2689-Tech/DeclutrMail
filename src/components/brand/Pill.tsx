import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Pill — small rounded label with semantic + planning tones.
 *
 * Two ways to specify color:
 *   <Pill tone="primary">Pro</Pill>          // explicit color tone
 *   <Pill variant="now">In progress</Pill>   // semantic alias maps to a tone
 *
 * The `variant` prop covers planning vocabulary used in design docs and
 * status surfaces; `tone` covers the underlying palette. Use `tone` for
 * product UI (Brief / Activity / Snoozed), `variant` for planning surfaces
 * (Punch list / handoff docs).
 */
export type PillTone = "default" | "primary" | "amber" | "emerald" | "red" | "dark";

export type PillVariant =
  | "now"
  | "next"
  | "later"
  | "skip"
  | "exists"
  | "refresh"
  | "new"
  | "diverge"
  | "keep"
  | "done";

// Planning-vocabulary → underlying color tone. Mirrors the design's
// .pill.now / .pill.next / .pill.later / etc. mapping in reference docs.
const VARIANT_TO_TONE: Record<PillVariant, PillTone> = {
  now: "red",
  diverge: "red",
  next: "amber",
  refresh: "amber",
  later: "primary",
  new: "primary",
  skip: "default",
  exists: "emerald",
  keep: "emerald",
  done: "emerald",
};

const TONE_CLASS: Record<PillTone, string> = {
  default: "bg-muted text-foreground border-border",
  primary: "bg-primary-soft text-primary border-primary-border",
  amber: "bg-warning-soft text-warning-strong border-warning/30",
  emerald: "bg-success-soft text-success-strong border-success/25",
  red: "bg-danger-soft text-danger border-danger/25",
  dark: "bg-foreground text-white border-foreground",
};

export type PillProps = {
  /** Explicit color tone — ignored if `variant` is also set. */
  tone?: PillTone;
  /** Semantic planning variant — wins over `tone` when both are set. */
  variant?: PillVariant;
  className?: string;
  children: ReactNode;
};

export function Pill({ tone, variant, className, children }: PillProps) {
  const effectiveTone: PillTone = variant ? VARIANT_TO_TONE[variant] : (tone ?? "default");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] rounded-full border px-2 py-[2px]",
        "font-sans text-[11px] font-medium",
        TONE_CLASS[effectiveTone],
        className,
      )}
    >
      {children}
    </span>
  );
}
