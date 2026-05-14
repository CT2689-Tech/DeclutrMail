import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Pill } from "@/components/brand/Pill";

describe("Pill", () => {
  it("renders children", () => {
    const { container } = render(<Pill>Active</Pill>);
    expect(container).toHaveTextContent("Active");
  });

  it("defaults to the `default` tone when neither tone nor variant given", () => {
    const { container } = render(<Pill>x</Pill>);
    expect(container.firstChild).toHaveClass("bg-muted");
    expect(container.firstChild).toHaveClass("text-foreground");
  });

  it("applies the explicit tone classes for each tone option", () => {
    const cases: Array<{
      tone: "primary" | "amber" | "emerald" | "red" | "dark";
      expected: string;
    }> = [
      { tone: "primary", expected: "bg-primary-soft" },
      { tone: "amber", expected: "bg-warning-soft" },
      { tone: "emerald", expected: "bg-success-soft" },
      { tone: "red", expected: "bg-danger-soft" },
      { tone: "dark", expected: "bg-foreground" },
    ];
    cases.forEach(({ tone, expected }) => {
      const { container, unmount } = render(<Pill tone={tone}>x</Pill>);
      expect(container.firstChild).toHaveClass(expected);
      unmount();
    });
  });

  it("maps each planning `variant` to the correct underlying tone", () => {
    // From the documented mapping in Pill.tsx:
    //   now/diverge → red, next/refresh → amber, later/new → primary,
    //   skip → default, exists/keep/done → emerald
    const cases: Array<{
      variant: "now" | "next" | "later" | "exists" | "skip";
      expectedBg: string;
    }> = [
      { variant: "now", expectedBg: "bg-danger-soft" },
      { variant: "next", expectedBg: "bg-warning-soft" },
      { variant: "later", expectedBg: "bg-primary-soft" },
      { variant: "exists", expectedBg: "bg-success-soft" },
      { variant: "skip", expectedBg: "bg-muted" },
    ];
    cases.forEach(({ variant, expectedBg }) => {
      const { container, unmount } = render(<Pill variant={variant}>x</Pill>);
      expect(container.firstChild).toHaveClass(expectedBg);
      unmount();
    });
  });

  it("variant wins over tone when both are set", () => {
    // variant=now → red; even though tone="primary" is also passed.
    const { container } = render(
      <Pill variant="now" tone="primary">
        x
      </Pill>,
    );
    expect(container.firstChild).toHaveClass("bg-danger-soft");
    expect(container.firstChild).not.toHaveClass("bg-primary-soft");
  });
});
