import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { PageMast } from "@/components/brand/PageMast";

function renderInRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("PageMast", () => {
  it("renders the brand link to the configured brandHref", () => {
    renderInRouter(<PageMast brandHref="/pricing" />);
    expect(screen.getByRole("link", { name: /DeclutrMail home/i })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("renders provided nav links and marks the active one with aria-current", () => {
    renderInRouter(
      <PageMast
        navLinks={[
          { label: "Pricing", href: "/pricing", active: true },
          { label: "Compare", href: "/compare" },
        ]}
      />,
    );
    const pricing = screen.getByRole("link", { name: "Pricing" });
    const compare = screen.getByRole("link", { name: "Compare" });
    expect(pricing).toHaveAttribute("aria-current", "page");
    expect(pricing).toHaveClass("active");
    expect(compare).not.toHaveAttribute("aria-current");
  });

  it("renders the CTA link only when both ctaLabel and ctaHref are provided", () => {
    const { rerender } = renderInRouter(<PageMast ctaLabel="Try free" ctaHref="/auth" />);
    expect(screen.getByRole("link", { name: "Try free" })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <PageMast />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Try free" })).not.toBeInTheDocument();
  });

  it("uses semantic <header> + <nav role='navigation'> structure", () => {
    renderInRouter(<PageMast />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });
});
