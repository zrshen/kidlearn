import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HistorySidebar } from "../components/HistorySidebar";
import type { GeneratedEntry } from "../app/api";

const ENTRIES: GeneratedEntry[] = [
  {
    filename: "image-carrot.png",
    url: "http://x/generated/image-carrot.png",
    word: "carrot",
    words: ["carrot", "apple"],
    hasMetadata: true,
    mtime: Math.floor(Date.now() / 1000),
  },
];

describe("HistorySidebar per-item delete", () => {
  it("calls onDelete with the single filename when the trash button is clicked", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <HistorySidebar entries={ENTRIES} selectedUrl={null} onSelect={() => {}} onDelete={onDelete} />,
    );
    await user.click(screen.getByRole("button", { name: /delete worksheet carrot/i }));
    expect(onDelete).toHaveBeenCalledWith(["image-carrot.png"]);
  });
});
