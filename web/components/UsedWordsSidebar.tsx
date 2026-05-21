"use client";
import { useMemo, useState } from "react";

export function UsedWordsSidebar({ words }: { words: string[] }) {
  const [filter, setFilter] = useState("");
  const sorted = useMemo(() => [...words].sort(), [words]);
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? sorted.filter((w) => w.toLowerCase().includes(f)) : sorted;
  }, [sorted, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const w of visible) {
      const key = (w[0] || "·").toUpperCase();
      const arr = map.get(key) ?? [];
      arr.push(w);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [visible]);

  return (
    <aside className="hidden w-80 shrink-0 border-l border-border bg-surface px-6 py-10 lg:block">
      <div className="border-b border-border pb-5">
        <p className="label-eyebrow">Library</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">
          Used Words
        </h2>
        <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-xs font-medium text-accent">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          {`(${sorted.length})`}
        </span>
      </div>

      <input
        type="search"
        placeholder="Search…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mt-5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent focus:bg-surface"
      />

      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">No matches</p>
      ) : (
        <div className="mt-5 max-h-[68vh] space-y-5 overflow-y-auto pr-1">
          {groups.map(([letter, ws]) => (
            <section key={letter}>
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold tracking-tight text-ink">
                  {letter}
                </h3>
                <span className="font-mono text-[0.7rem] text-ink-faint">
                  {ws.length}
                </span>
              </div>
              <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[0.825rem] text-ink-soft">
                {ws.map((w) => (
                  <li
                    key={w}
                    className="cursor-default leading-[1.5] transition-colors hover:text-accent"
                  >
                    {w}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
