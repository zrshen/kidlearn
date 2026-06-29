import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "../components/ThemeToggle";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  try {
    delete (localStorage as unknown as Record<string, string>).theme;
  } catch {
    /* ignore */
  }
});

describe("ThemeToggle", () => {
  it("toggles the dark class and persists the choice to localStorage", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /toggle dark mode/i });

    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.theme).toBe("dark");

    await user.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.theme).toBe("light");
  });
});
