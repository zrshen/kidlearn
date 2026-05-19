import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorBanner } from "../components/ErrorBanner";

describe("ErrorBanner", () => {
  it("renders conflict message listing all conflicts", () => {
    render(<ErrorBanner kind="conflict" conflicts={["apple", "banana"]} />);
    expect(screen.getByRole("alert").textContent).toMatch(/apple/);
    expect(screen.getByRole("alert").textContent).toMatch(/banana/);
  });

  it("renders generic message for server errors", () => {
    render(<ErrorBanner kind="error" message="image generation failed: api down" />);
    expect(screen.getByRole("alert").textContent).toMatch(/api down/);
  });

  it("renders nothing when kind is none", () => {
    const { container } = render(<ErrorBanner kind="none" />);
    expect(container.firstChild).toBeNull();
  });
});
