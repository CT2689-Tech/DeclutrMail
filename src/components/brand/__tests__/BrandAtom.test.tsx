import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandAtom } from "@/components/brand/BrandAtom";

describe("BrandAtom", () => {
  it("exposes the logo to assistive tech via role='img' and aria-label", () => {
    render(<BrandAtom />);
    expect(screen.getByRole("img", { name: "DeclutrMail" })).toBeInTheDocument();
  });

  it("renders the wordmark text 'Declutr' + 'Mail'", () => {
    render(<BrandAtom />);
    const logo = screen.getByRole("img", { name: "DeclutrMail" });
    expect(logo).toHaveTextContent(/Declutr/);
    expect(logo).toHaveTextContent(/Mail/);
  });

  it("renders for each size variant", () => {
    const sizes = ["sm", "md", "lg"] as const;
    sizes.forEach((size) => {
      const { unmount } = render(<BrandAtom size={size} />);
      // Smoke test: the wrapper renders with inline-flex layout regardless of size.
      expect(screen.getByRole("img", { name: "DeclutrMail" })).toHaveClass("inline-flex");
      unmount();
    });
  });

  it("forwards a custom className", () => {
    render(<BrandAtom className="custom-class" />);
    expect(screen.getByRole("img", { name: "DeclutrMail" })).toHaveClass("custom-class");
  });
});
