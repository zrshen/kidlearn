import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BatchPreview } from "../components/BatchPreview";

const BATCHES = [
  { imageUrl: "http://localhost:8000/generated/image-tiger.png", words: ["tiger", "zebra", "fox", "owl", "panda", "giraffe"] },
  { imageUrl: "http://localhost:8000/generated/image-carrot.png", words: ["carrot", "tomato", "grapes", "potato", "broccoli", "kiwi"] },
];

describe("BatchPreview", () => {
  it("renders one tile per batch with image, words, and a Print button", () => {
    render(<BatchPreview batches={BATCHES} />);
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", BATCHES[0].imageUrl);
    expect(imgs[1]).toHaveAttribute("src", BATCHES[1].imageUrl);

    // All 12 words show up
    for (const w of [...BATCHES[0].words, ...BATCHES[1].words]) {
      expect(screen.getByText(w)).toBeInTheDocument();
    }

    expect(screen.getAllByRole("button", { name: /print/i })).toHaveLength(2);
  });

  it("renders nothing when batches is empty", () => {
    const { container } = render(<BatchPreview batches={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("triggers window.print when a Print button is clicked", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<BatchPreview batches={[BATCHES[0]]} />);
    await user.click(screen.getByRole("button", { name: /print/i }));
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });
});
