import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GtHistorySidebar } from "../components/GtHistorySidebar";
import type { GtHistoryEntry } from "../app/api";

const ENTRIES: GtHistoryEntry[] = [
  { id: "fruits-1", theme: "fruits", test: "CogAT", frontUrl: "http://x/gt-fruits-1-front.png", backUrl: "http://x/gt-fruits-1-back.png", mtime: 2 },
  { id: "ocean-1", theme: "ocean", test: "General GT", frontUrl: "http://x/gt-ocean-1-front.png", backUrl: "http://x/gt-ocean-1-back.png", mtime: 1 },
];

describe("GtHistorySidebar", () => {
  it("renders a pair per entry with test/theme labels and FRONT/BACK badges", () => {
    render(<GtHistorySidebar entries={ENTRIES} selectedId={null} onSelect={() => {}} onDelete={() => {}} />);
    expect(screen.getByText("fruits")).toBeInTheDocument();
    expect(screen.getByText("ocean")).toBeInTheDocument();
    expect(screen.getByText("CogAT")).toBeInTheDocument();
    expect(screen.getAllByText("FRONT")).toHaveLength(2);
    expect(screen.getAllByText("BACK")).toHaveLength(2);
  });

  it("calls onSelect with the entry when clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<GtHistorySidebar entries={ENTRIES} selectedId={null} onSelect={onSelect} onDelete={() => {}} />);
    await user.click(screen.getByText("fruits"));
    expect(onSelect).toHaveBeenCalledWith(ENTRIES[0]);
  });

  it("calls onDelete with the entry id when the trash button is clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<GtHistorySidebar entries={ENTRIES} selectedId={null} onSelect={() => {}} onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: /delete fruits/i }));
    expect(onDelete).toHaveBeenCalledWith("fruits-1");
  });
});
