import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "@/components/brand/Pill";

describe("Pill", () => {
  it("renders children", () => {
    render(<Pill>Active</Pill>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("defaults to the `default` tone when no tone given", () => {
    render(<Pill>Default</Pill>);
    const el = screen.getByText("Default");
    expect(el).toHaveClass("bg-muted");
    expect(el).toHaveClass("text-foreground");
  });

  it("applies the explicit tone classes for each tone option", () => {
    const cases: Array<{
      tone: "primary" | "amber" | "emerald" | "red" | "dark";
      expected: string;
      label: string;
    }> = [
      { tone: "primary", expected: "bg-primary-soft", label: "Primary" },
      { tone: "amber", expected: "bg-warning-soft", label: "Amber" },
      { tone: "emerald", expected: "bg-success-soft", label: "Emerald" },
      { tone: "red", expected: "bg-danger-soft", label: "Red" },
      { tone: "dark", expected: "bg-foreground", label: "Dark" },
    ];
    cases.forEach(({ tone, expected, label }) => {
      const { unmount } = render(<Pill tone={tone}>{label}</Pill>);
      expect(screen.getByText(label)).toHaveClass(expected);
      unmount();
    });
  });

  it("forwards a custom className", () => {
    render(<Pill className="custom-class">Custom</Pill>);
    expect(screen.getByText("Custom")).toHaveClass("custom-class");
  });
});
