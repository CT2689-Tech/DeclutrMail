import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Eyebrow } from "@/components/brand/Eyebrow";

describe("Eyebrow", () => {
  it("renders the children", () => {
    const { container } = render(<Eyebrow>FEATURED</Eyebrow>);
    expect(container).toHaveTextContent("FEATURED");
  });

  it("uses font-mono-edit for editorial mono styling", () => {
    const { container } = render(<Eyebrow>x</Eyebrow>);
    expect(container.firstChild).toHaveClass("font-mono-edit");
  });

  it("applies the tone class per `tone` prop", () => {
    const cases: Array<{ tone: "default" | "primary" | "amber"; expected: string }> = [
      { tone: "default", expected: "text-muted-foreground" },
      { tone: "primary", expected: "text-primary" },
      { tone: "amber", expected: "text-warning-strong" },
    ];
    cases.forEach(({ tone, expected }) => {
      const { container, unmount } = render(<Eyebrow tone={tone}>x</Eyebrow>);
      expect(container.firstChild).toHaveClass(expected);
      unmount();
    });
  });
});
