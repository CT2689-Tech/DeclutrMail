import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Decision } from "@/components/brand/Decision";

describe("Decision", () => {
  it("renders the stamp label and body text", () => {
    render(<Decision stamp="DECISION">Keep Vite</Decision>);
    expect(screen.getByText("DECISION")).toBeInTheDocument();
    expect(screen.getByText("Keep Vite")).toBeInTheDocument();
  });

  it("exposes the callout as a semantic note region", () => {
    render(<Decision stamp="NOTE">body</Decision>);
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("uses the editorial mono+uppercase styling on the stamp", () => {
    render(<Decision stamp="STAMP">body</Decision>);
    const stamp = screen.getByText("STAMP");
    expect(stamp).toHaveClass("font-mono-edit");
    expect(stamp).toHaveClass("text-primary");
  });

  it("applies primary-soft background + left-accent border classes on the wrapper", () => {
    const { container } = render(<Decision stamp="x">y</Decision>);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("bg-primary-soft");
    expect(wrapper).toHaveClass("border-l-primary");
  });
});
