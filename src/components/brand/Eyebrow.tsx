import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Eyebrow — mono uppercase label that sits above section / hero headings.
 *
 * Marketing surfaces use a single-word eyebrow per CLAUDE.md design gotcha
 * (e.g. `Pricing`, `FAQ`, `Compare`). Em-dashed eyebrows (`— Featured —`)
 * are reserved for in-page section eyebrows below the hero.
 *
 * Composes `.font-mono-edit` (Inter mono with 0.16em tracking + uppercase)
 * from src/index.css (PR #1).
 */
export type EyebrowProps = {
  /** Color tone — primary = brand teal, amber = warning hue, default = muted. */
  tone?: "default" | "primary" | "amber";
  className?: string;
  children: ReactNode;
};

const TONE_CLASS: Record<"default" | "primary" | "amber", string> = {
  default: "text-muted-foreground",
  primary: "text-primary",
  amber: "text-warning-strong",
};

export function Eyebrow({ tone = "default", className, children }: EyebrowProps) {
  return (
    <div
      className={cn(
        "font-mono-edit text-[10px] font-medium leading-tight",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
