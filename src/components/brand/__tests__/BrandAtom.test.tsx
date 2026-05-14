import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BrandAtom } from "@/components/brand/BrandAtom";

describe("BrandAtom", () => {
  it("renders the D mark and the Declutr/Mail wordmark", () => {
    const { container } = render(<BrandAtom />);
    // Combine text nodes since the wordmark wraps "Mail" in <em>.
    expect(container.textContent?.replace(/\s+/g, "")).toContain("D");
    expect(container.textContent?.replace(/\s+/g, "")).toContain("Declutr");
    expect(container.textContent?.replace(/\s+/g, "")).toContain("Mail");
  });

  it("hides the decorative mark from assistive tech via aria-hidden", () => {
    const { container } = render(<BrandAtom />);
    const mark = container.querySelector("[aria-hidden='true']");
    expect(mark).toBeInTheDocument();
    // The square mark contains just "D·" — the wordmark is its sibling.
    expect(mark?.textContent).toMatch(/D/);
  });

  it("applies size variants without crashing", () => {
    const { rerender, container } = render(<BrandAtom size="sm" />);
    expect(container.firstChild).toHaveClass("inline-flex");
    rerender(<BrandAtom size="lg" />);
    expect(container.firstChild).toHaveClass("inline-flex");
  });

  it("forwards a custom className", () => {
    const { container } = render(<BrandAtom className="custom-class" />);
    expect(container.firstChild).toHaveClass("custom-class");
  });
});
