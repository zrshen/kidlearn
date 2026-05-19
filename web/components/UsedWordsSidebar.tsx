"use client";
import { useMemo, useState } from "react";

export function UsedWordsSidebar({ words }: { words: string[] }) {
  const [filter, setFilter] = useState("");
  const sorted = useMemo(() => [...words].sort(), [words]);
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? sorted.filter((w) => w.toLowerCase().includes(f)) : sorted;
  }, [sorted, filter]);

  return (
    <aside className="w-72 shrink-0 space-y-3 border-l border-blush bg-cream p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-ink">Used Words</h2>
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">
          ({sorted.length})
        </span>
      </div>
      <input
        type="search"
        placeholder="search..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full rounded-full border border-blush bg-white px-3 py-1.5 text-sm outline-none focus:border-accent"
      />
      {visible.length === 0 ? (
        <p className="text-sm text-ink-soft">No matches</p>
      ) : (
        <ul className="flex max-h-[70vh] flex-wrap gap-1.5 overflow-y-auto">
          {visible.map((w) => (
            <li
              key={w}
              className="rounded-full bg-sky px-2.5 py-1 text-xs font-semibold text-ink"
            >
              {w}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
