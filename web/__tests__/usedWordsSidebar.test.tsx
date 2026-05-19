import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UsedWordsSidebar } from "../components/UsedWordsSidebar";

describe("UsedWordsSidebar", () => {
  it("renders count and full word list sorted", () => {
    render(<UsedWordsSidebar words={["banana", "apple", "carrot"]} />);
    expect(screen.getByText("Used Words")).toBeInTheDocument();
    expect(screen.getByText("(3)")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["apple", "banana", "carrot"]);
  });

  it("filters case-insensitively by substring", async () => {
    const user = userEvent.setup();
    render(<UsedWordsSidebar words={["banana", "apple", "carrot"]} />);
    await user.type(screen.getByPlaceholderText(/search/i), "AN");
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["banana"]);
  });

  it("shows empty state when no matches", async () => {
    const user = userEvent.setup();
    render(<UsedWordsSidebar words={["apple"]} />);
    await user.type(screen.getByPlaceholderText(/search/i), "zz");
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});
