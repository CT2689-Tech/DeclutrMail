import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Display — Fraunces display heading with responsive clamp() sizing.
 *
 * Marketing-only per the design gotcha (CLAUDE.md "Design Gotchas":
 * editorial typography is marketing-only). Don't use on product surfaces;
 * use standard h1/h2 from Tailwind there.
 *
 * Composes the `.font-display`/`.font-display-italic` + `.text-display-*`
 * utility classes from src/index.css (ported in PR #1).
 */
export type DisplayProps = {
  /** Underlying tag — defaults to h1. */
  as?: "h1" | "h2" | "h3" | "p" | "span";
  /** Responsive size — xl=hero, lg=section H2, md=standard H1, sm=H3. */
  size?: "xl" | "lg" | "md" | "sm";
  /** Use Fraunces italic SOFT/WONK variation. */
  italic?: boolean;
  className?: string;
  children: ReactNode;
};

const SIZE_CLASS: Record<"xl" | "lg" | "md" | "sm", string> = {
  xl: "text-display-xl",
  lg: "text-display-lg",
  md: "text-display-md",
  sm: "text-display-sm",
};

export function Display({
  as: Tag = "h1",
  size = "md",
  italic = false,
  className,
  children,
}: DisplayProps) {
  return (
    <Tag
      className={cn(italic ? "font-display-italic" : "font-display", SIZE_CLASS[size], className)}
    >
      {children}
    </Tag>
  );
}
