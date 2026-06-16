"use client";
import type { GtHistoryEntry } from "../app/api";

export function GtHistorySidebar({
  entries,
  selectedId,
  onSelect,
}: {
  entries: GtHistoryEntry[];
  selectedId: string | null;
  onSelect: (entry: GtHistoryEntry) => void;
}) {
  return (
    <aside className="sticky top-0 h-screen w-[248px] flex-shrink-0 overflow-y-auto border-r border-border bg-surface p-4">
      <div className="mb-3.5 flex items-center justify-between">
        <span className="label-eyebrow">History · GT</span>
        <span className="font-mono text-[0.62rem] text-ink-faint">{entries.length}</span>
      </div>
      {entries.map((e) => (
        <button
          key={e.id}
          type="button"
          aria-pressed={selectedId === e.id}
          onClick={() => onSelect(e)}
          className={`mb-3 block w-full overflow-hidden rounded-xl border bg-surface text-left shadow-card-sm transition-colors ${
            selectedId === e.id ? "border-accent" : "border-border hover:border-border-strong"
          }`}
        >
          <div className="relative aspect-[3/2] bg-[#fff7ec]">
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
      ))}
    </aside>
  );
}
