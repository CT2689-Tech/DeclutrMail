import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Eyebrow } from "@/components/brand/Eyebrow";

describe("Eyebrow", () => {
  it("renders the children", () => {
    render(<Eyebrow>FEATURED</Eyebrow>);
    expect(screen.getByText("FEATURED")).toBeInTheDocument();
  });

  it("uses font-mono-edit for editorial mono styling", () => {
    render(<Eyebrow>Mono</Eyebrow>);
    expect(screen.getByText("Mono")).toHaveClass("font-mono-edit");
  });

  it("applies the tone class per `tone` prop", () => {
    const cases: Array<{
      tone: "default" | "primary" | "amber";
      expected: string;
      label: string;
    }> = [
      { tone: "default", expected: "text-muted-foreground", label: "DefaultTone" },
      { tone: "primary", expected: "text-primary", label: "PrimaryTone" },
      { tone: "amber", expected: "text-warning-strong", label: "AmberTone" },
    ];
    cases.forEach(({ tone, expected, label }) => {
      const { unmount } = render(<Eyebrow tone={tone}>{label}</Eyebrow>);
      expect(screen.getByText(label)).toHaveClass(expected);
      unmount();
    });
  });
});
