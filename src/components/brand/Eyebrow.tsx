import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Eyebrow — mono uppercase label that sits above section / hero headings.
 *
 * Three tones: default (muted), primary (brand teal), amber.
 *
 * Source: marketing CSS at v2-marketing.css §169-175 (`.eyebrow`,
 * `.eyebrow.primary`, `.eyebrow.amber`); product primitive at
 * lib/tokens.jsx `DVEyebrow` lines 37-47.
 *
 * Single-word eyebrows on top-level marketing routes (Pricing, FAQ, Compare).
 * Em-dashed eyebrows are reserved for in-page section eyebrows below the hero.
 */
export type EyebrowTone = "default" | "primary" | "amber";

const TONE_CLASS: Record<EyebrowTone, string> = {
  default: "text-muted-foreground",
  primary: "text-primary",
  amber: "text-warning-strong",
};

export type EyebrowProps = {
  tone?: EyebrowTone;
  className?: string;
  children: ReactNode;
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
