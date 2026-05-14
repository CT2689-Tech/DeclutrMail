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
    const { rerender, container } = render(<Display>Plain</Display>);
    expect(container.firstChild).toHaveClass("font-display");
    expect(container.firstChild).not.toHaveClass("font-display-italic");

    rerender(<Display italic>Italic</Display>);
    expect(container.firstChild).toHaveClass("font-display-italic");
    expect(container.firstChild).not.toHaveClass("font-display");
  });

  it("applies the responsive size class for each `size` prop value", () => {
    const sizes = ["xl", "lg", "md", "sm"] as const;
    sizes.forEach((size) => {
      const { container, unmount } = render(<Display size={size}>x</Display>);
      expect(container.firstChild).toHaveClass(`text-display-${size}`);
      unmount();
    });
  });
});
