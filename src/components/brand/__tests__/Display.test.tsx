import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Display } from "@/components/brand/Display";

describe("Display", () => {
  it("renders as h1 by default", () => {
    render(<Display>Hello</Display>);
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
  });

  it("renders as the tag specified by the `as` prop", () => {
    render(<Display as="h2">Section</Display>);
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeInTheDocument();
  });

  it("applies font-display by default and font-display-italic when italic", () => {
    const { rerender } = render(<Display>Plain</Display>);
    const plain = screen.getByRole("heading", { name: "Plain" });
    expect(plain).toHaveClass("font-display");
    expect(plain).not.toHaveClass("font-display-italic");

    rerender(<Display italic>Italic</Display>);
    const italic = screen.getByRole("heading", { name: "Italic" });
    expect(italic).toHaveClass("font-display-italic");
    expect(italic).not.toHaveClass("font-display");
  });

  it("applies the responsive size class for each `size` prop value", () => {
    const sizes = ["xl", "lg", "md", "sm"] as const;
    sizes.forEach((size) => {
      const { unmount } = render(<Display size={size}>{`Size-${size}`}</Display>);
      expect(screen.getByRole("heading", { name: `Size-${size}` })).toHaveClass(
        `text-display-${size}`,
      );
      unmount();
    });
  });
});
