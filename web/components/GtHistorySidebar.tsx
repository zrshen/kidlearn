"use client";
import { useState } from "react";
import type { GtHistoryEntry } from "../app/api";

export function GtHistorySidebar({
  entries,
  selectedId,
  onSelect,
  onDelete,
}: {
  entries: GtHistoryEntry[];
  selectedId: string | null;
  onSelect: (entry: GtHistoryEntry) => void;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <aside className="sticky top-0 h-screen w-[248px] flex-shrink-0 overflow-y-auto border-r border-border bg-surface p-4">
      <div className="mb-3.5 flex items-center justify-between">
        <span className="label-eyebrow">History · GT</span>
        <span className="font-mono text-[0.62rem] text-ink-faint">{entries.length}</span>
      </div>
      {entries.map((e) => (
        <div
          key={e.id}
          className={`group relative mb-3 block w-full overflow-hidden rounded-xl border bg-surface text-left shadow-card-sm transition-colors ${
            selectedId === e.id ? "border-accent" : "border-border hover:border-border-strong"
          } ${deletingId === e.id ? "opacity-50" : ""}`}
        >
          <button
            type="button"
            aria-pressed={selectedId === e.id}
            onClick={() => onSelect(e)}
            className="block w-full text-left"
          >
            <div className="relative aspect-[3/2] bg-bg">
              <img src={e.frontUrl} alt={e.theme || e.id} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute right-1.5 top-1.5 flex gap-1">
                <span className="rounded-full bg-black/60 px-1.5 py-px font-mono text-[0.55rem] font-semibold text-white">FRONT</span>
                <span className="rounded-full bg-black/60 px-1.5 py-px font-mono text-[0.55rem] font-semibold text-white">BACK</span>
              </span>
            </div>
            <span className="flex items-center justify-between gap-2 px-2.5 py-2">
              <span className="truncate text-[0.82rem] font-medium text-ink">{e.theme || e.id}</span>
              {e.test ? (
                <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px font-mono text-[0.56rem] font-semibold text-accent-strong">
                  {e.test}
                </span>
              ) : null}
            </span>
          </button>
          <button
            type="button"
            aria-label={`Delete ${e.theme || e.id} worksheet`}
            onClick={() => void handleDelete(e.id)}
            disabled={deletingId === e.id}
            className="absolute left-1.5 top-1.5 z-10 rounded-full bg-black/60 px-1.5 py-px text-white opacity-0 transition-opacity hover:bg-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
          >
            <span aria-hidden className="font-mono text-[0.62rem] leading-none">🗑</span>
          </button>
        </div>
      ))}
    </aside>
  );
}
