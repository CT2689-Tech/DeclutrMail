import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { BrandAtom } from "./BrandAtom";

/**
 * PageMast — sticky marketing masthead (brand + nav + optional CTA).
 *
 * Use on marketing surfaces (Landing / Pricing / Compare / FAQ / Legal /
 * Contact / Blog / Guides). Product app shell has its own chrome — don't
 * use PageMast inside the authenticated app.
 *
 * Composes the `.masthead` CSS class from src/index.css (PR #1) which
 * handles the sticky positioning, brand/nav alignment, mobile collapse,
 * and CTA hover styling.
 */
export type PageMastNavLink = {
  label: string;
  href: string;
  active?: boolean;
};

export type PageMastProps = {
  /** Navigation links shown to the right of the brand atom. */
  navLinks?: PageMastNavLink[];
  /** Primary CTA shown at the far right. Hidden if either prop missing. */
  ctaLabel?: string;
  ctaHref?: string;
  /** Where the brand atom links to. Defaults to `/`. */
  brandHref?: string;
  /** Optional content rendered after navLinks but before the CTA. */
  navTail?: ReactNode;
  className?: string;
};

export function PageMast({
  navLinks = [],
  ctaLabel,
  ctaHref,
  brandHref = "/",
  navTail,
  className,
}: PageMastProps) {
  return (
    <header className={cn("masthead", className)}>
      <div className="inner">
        <Link to={brandHref} aria-label="DeclutrMail home">
          <BrandAtom />
        </Link>
        <nav aria-label="Primary">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              className={link.active ? "active" : undefined}
              aria-current={link.active ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
          {navTail}
          {ctaLabel && ctaHref ? (
            <Link to={ctaHref} className="cta">
              {ctaLabel}
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
