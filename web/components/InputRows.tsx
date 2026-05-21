"use client";

export type Item = { word: string; sentence: string };

export const emptyItems = (): Item[] =>
  Array.from({ length: 6 }, () => ({ word: "", sentence: "" }));

export function InputRows({
  items,
  onChange,
  conflicts,
}: {
  items: Item[];
  onChange: (next: Item[]) => void;
  conflicts: string[];
}) {
  const conflictSet = new Set(conflicts.map((c) => c.toLowerCase()));
  const setField = (i: number, k: keyof Item, v: string) => {
    const next = items.map((it, j) => (i === j ? { ...it, [k]: v } : it));
    onChange(next);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card-md">
      <div className="grid grid-cols-[3rem_minmax(0,11rem)_1fr] items-center gap-4 border-b border-border px-5 py-2 label-eyebrow">
        <span>#</span>
        <span>Word</span>
        <span>Sentence</span>
      </div>
      <ol className="list-none p-0">
        {items.map((it, i) => {
          const isConflict =
            it.word.length > 0 && conflictSet.has(it.word.trim().toLowerCase());
          const hasContent = it.word.trim().length > 0;
          return (
            <li
              key={i}
              data-testid={`row-${i}`}
              className={`grid grid-cols-[3rem_minmax(0,11rem)_1fr] items-center gap-4 border-b border-border px-5 py-3 transition-colors last:border-b-0 hover:bg-accent-soft ${
                isConflict ? "conflict bg-conflict-bg hover:bg-conflict-bg" : ""
              }`}
            >
              <span
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border font-mono text-[0.8rem] font-medium ${
                  isConflict
                    ? "border-conflict-ink/30 bg-white text-conflict-ink"
                    : hasContent
                      ? "border-accent/20 bg-accent-soft text-accent"
                      : "border-border bg-bg text-ink-soft"
                }`}
              >
                {i + 1}
              </span>
              <input
                placeholder="word"
                value={it.word}
                onChange={(e) => setField(i, "word", e.target.value)}
                className={`w-full border-0 bg-transparent p-0 py-0.5 text-[0.95rem] font-semibold outline-none placeholder:font-normal placeholder:text-ink-faint ${
                  isConflict ? "text-conflict-ink" : "text-ink"
                }`}
              />
              <input
                placeholder="sentence"
                value={it.sentence}
                onChange={(e) => setField(i, "sentence", e.target.value)}
                className={`w-full border-0 bg-transparent p-0 py-0.5 text-[0.95rem] outline-none placeholder:text-ink-faint ${
                  isConflict ? "text-conflict-ink" : "text-ink"
                }`}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
