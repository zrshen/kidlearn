import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { InputRows, emptyItems, type Item } from "../components/InputRows";

function Harness({ onChange }: { onChange: (items: Item[]) => void }) {
  const [items, setItems] = useState<Item[]>(emptyItems());
  return (
    <InputRows
      items={items}
      onChange={(next) => {
        setItems(next);
        onChange(next);
      }}
      conflicts={[]}
    />
  );
}

describe("InputRows", () => {
  it("renders 6 word inputs and 6 sentence inputs", () => {
    render(<Harness onChange={() => {}} />);
    expect(screen.getAllByPlaceholderText("word")).toHaveLength(6);
    expect(screen.getAllByPlaceholderText("sentence")).toHaveLength(6);
  });

  it("calls onChange when typing in a row", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    await user.type(screen.getAllByPlaceholderText("word")[0], "apple");
    expect(spy).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ word: "apple" })]),
    );
  });

  it("highlights rows whose word is in conflicts", () => {
    const items = emptyItems();
    items[0].word = "apple";
    render(<InputRows items={items} onChange={() => {}} conflicts={["apple"]} />);
    const row0 = screen.getByTestId("row-0");
    expect(row0.className).toMatch(/conflict/);
  });
});
