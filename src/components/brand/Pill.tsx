import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Pill — small rounded label with the v2 semantic palette.
 *
 * Six tones: default + the four canonical marketing tones
 * (primary/amber/emerald/red) + dark for product surfaces.
 *
 * Source: marketing CSS at v2-marketing.css §169-187 (`.pill`, `.pill.primary`,
 * `.pill.amber`, `.pill.emerald`, `.pill.red`); product primitive at
 * lib/tokens.jsx `DVPill` lines 50-71 (adds `dark`).
 */
export type PillTone = "default" | "primary" | "amber" | "emerald" | "red" | "dark";

const TONE_CLASS: Record<PillTone, string> = {
  default: "bg-muted text-foreground border-border",
  primary: "bg-primary-soft text-primary border-primary-border",
  amber: "bg-warning-soft text-warning-strong border-warning/30",
  emerald: "bg-success-soft text-success-strong border-success/25",
  red: "bg-danger-soft text-danger border-danger/25",
  dark: "bg-foreground text-white border-foreground",
};

export type PillProps = {
  tone?: PillTone;
  className?: string;
  children: ReactNode;
};

export function Pill({ tone = "default", className, children }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] rounded-full border px-2 py-[2px]",
        "font-sans text-[11px] font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
