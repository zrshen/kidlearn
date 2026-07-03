"use client";
import { useMemo, useState } from "react";
import type { GeneratedEntry } from "../app/api";

export function HistorySidebar({
  entries,
  selectedUrl,
  onSelect,
  onDelete,
}: {
  entries: GeneratedEntry[];
  selectedUrl: string | null;
  onSelect: (url: string) => void;
  onDelete: (filenames: string[]) => Promise<void>;
}) {
  const [filter, setFilter] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);

  async function handleQuickDelete(filename: string) {
    setDeletingFilename(filename);
    try {
      await onDelete([filename]);
      setChecked((prev) => {
        if (!prev.has(filename)) return prev;
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
    } finally {
      setDeletingFilename(null);
    }
  }

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return entries;
    return entries.filter((e) => {
      if (e.word.toLowerCase().includes(f)) return true;
      return e.words.some((w) => w.toLowerCase().includes(f));
    });
  }, [entries, filter]);
  const groups = useMemo(() => groupByDay(visible), [visible]);

  const checkedCount = checked.size;
  const visibleFilenames = visible.map((e) => e.filename);
  const allChecked =
    checkedCount > 0 &&
    visibleFilenames.length > 0 &&
    visibleFilenames.every((f) => checked.has(f));

  function toggle(filename: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) => {
      if (allChecked) {
        const next = new Set(prev);
        for (const f of visibleFilenames) next.delete(f);
        return next;
      }
      const next = new Set(prev);
      for (const f of visibleFilenames) next.add(f);
      return next;
    });
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(Array.from(checked));
      setChecked(new Set());
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <aside className="hidden w-72 shrink-0 border-r border-border bg-surface px-5 py-10 lg:block">
      <div className="border-b border-border pb-5">
        <p className="label-eyebrow">Archive</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">
          Past Worksheets
        </h2>
        <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-xs font-medium text-accent">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          {entries.length} saved
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">
          No worksheets yet. Generate one to see it here.
        </p>
      ) : (
        <>
          <input
            type="search"
            placeholder="Search worksheets…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mt-4 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent focus:bg-surface"
          />

          {visible.length === 0 && filter && (
            <p className="mt-3 text-sm text-ink-soft">
              No worksheets match &quot;{filter.trim()}&quot;.
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={toggleAll}
              className="font-mono uppercase tracking-wider text-ink-faint transition-colors hover:text-ink"
            >
              {allChecked ? "Clear" : "Select all"}
            </button>
            {checkedCount > 0 && !confirming && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md border border-conflict-ink/30 bg-conflict-bg px-2.5 py-1 font-medium text-conflict-ink transition-colors hover:bg-danger hover:text-white"
              >
                Delete {checkedCount}
              </button>
            )}
          </div>

          {confirming && (
            <div className="mt-3 rounded-lg border border-conflict-ink/30 bg-conflict-bg p-3 text-sm">
              <p className="text-conflict-ink">
                Delete {checkedCount}{" "}
                {checkedCount === 1 ? "worksheet" : "worksheets"}? Their words
                will be released back to the suggester.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-md bg-danger px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-primary disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                  className="rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-ink-soft hover:bg-bg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 max-h-[calc(100vh-16rem)] space-y-6 overflow-y-auto pr-1">
            {groups.map(([label, items]) => (
              <section key={label}>
                <h3 className="mb-2 font-mono text-[0.7rem] uppercase tracking-wider text-ink-faint">
                  {label}
                </h3>
                <ul className="space-y-2">
                  {items.map((e) => {
                    const isSelected = e.url === selectedUrl;
                    const isChecked = checked.has(e.filename);
                    return (
                      <li key={e.filename}>
                        <div
                          className={`group flex items-center gap-2 rounded-lg border p-2 transition-colors ${
                            isChecked
                              ? "border-conflict-ink/40 bg-conflict-bg/30"
                              : isSelected
                                ? "border-accent bg-accent-soft"
                                : "border-border bg-surface hover:bg-bg"
                          }`}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select ${e.word}`}
                            checked={isChecked}
                            onChange={() => toggle(e.filename)}
                            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-conflict-ink"
                          />
                          <button
                            type="button"
                            onClick={() => onSelect(e.url)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <img
                              src={e.url}
                              alt={`worksheet starting with ${e.word}`}
                              loading="lazy"
                              className="h-10 w-14 shrink-0 rounded border border-border object-cover"
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block truncate text-sm font-medium ${
                                  isSelected ? "text-accent" : "text-ink"
                                }`}
                                title={e.words.join(", ")}
                              >
                                {e.words.length > 1 ? e.words.join(", ") : e.word}
                              </span>
                              <span className="block font-mono text-[0.7rem] text-ink-faint">
                                {formatTime(e.mtime)}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete worksheet ${e.word}`}
                            onClick={() => void handleQuickDelete(e.filename)}
                            disabled={deletingFilename === e.filename}
                            className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition-opacity hover:text-conflict-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                          >
                            <span aria-hidden className="text-sm leading-none">🗑</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function groupByDay(entries: GeneratedEntry[]): [string, GeneratedEntry[]][] {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = today - 86400_000;
  const weekStart = today - 6 * 86400_000;
  const buckets = new Map<string, GeneratedEntry[]>();
  for (const e of entries) {
    const t = e.mtime * 1000;
    let label: string;
    if (t >= today) label = "Today";
    else if (t >= yesterday) label = "Yesterday";
    else if (t >= weekStart) label = "This Week";
    else label = "Earlier";
    const arr = buckets.get(label) ?? [];
    arr.push(e);
    buckets.set(label, arr);
  }
  const order = ["Today", "Yesterday", "This Week", "Earlier"];
  return order
    .filter((k) => buckets.has(k))
    .map((k) => [k, buckets.get(k)!] as [string, GeneratedEntry[]]);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
