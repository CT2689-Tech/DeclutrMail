import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Display — Fraunces display heading sized via fluid clamp().
 *
 * Marketing-only per CLAUDE.md design gotcha "Editorial typography is
 * marketing-only." Product surfaces use standard h1/h2 from Tailwind.
 *
 * Source: marketing CSS at v2-marketing.css §434-443 (`.display`,
 * `.display em`, `.display .italic`); composes the
 * `.font-display`/`.font-display-italic` + `.text-display-*` utility classes
 * from src/index.css (which mirror canonical colors_and_type.css §96-100,
 * 154-182).
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

const SIZE_CLASS: Record<NonNullable<DisplayProps["size"]>, string> = {
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
