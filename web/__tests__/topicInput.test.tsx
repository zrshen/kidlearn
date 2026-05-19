import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TopicInput } from "../components/TopicInput";

describe("TopicInput", () => {
  it("renders the label and placeholder", () => {
    render(<TopicInput value="" onChange={() => {}} />);
    expect(screen.getByText(/topic/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/animals/i)).toBeInTheDocument();
  });

  it("calls onChange when the user types", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<TopicInput value="" onChange={spy} />);
    await user.type(screen.getByPlaceholderText(/animals/i), "fruit");
    expect(spy).toHaveBeenLastCalledWith("t");
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it("is controlled by the value prop", () => {
    render(<TopicInput value="kitchen" onChange={() => {}} />);
    const input = screen.getByPlaceholderText(/animals/i) as HTMLInputElement;
    expect(input.value).toBe("kitchen");
  });
});
