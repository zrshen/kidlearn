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
    <ol className="space-y-3">
      {items.map((it, i) => {
        const isConflict =
          it.word.length > 0 && conflictSet.has(it.word.trim().toLowerCase());
        return (
          <li
            key={i}
            data-testid={`row-${i}`}
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow-sm transition-colors ${
              isConflict ? "conflict bg-soft-red" : "bg-white"
            }`}
          >
            <span className="w-6 text-right text-sm font-semibold text-ink-soft">
              {i + 1}.
            </span>
            <input
              placeholder="word"
              value={it.word}
              onChange={(e) => setField(i, "word", e.target.value)}
              className="w-36 rounded-xl border border-transparent bg-cream px-3 py-2 outline-none focus:border-accent"
            />
            <input
              placeholder="sentence"
              value={it.sentence}
              onChange={(e) => setField(i, "sentence", e.target.value)}
              className="flex-1 rounded-xl border border-transparent bg-cream px-3 py-2 outline-none focus:border-accent"
            />
          </li>
        );
      })}
    </ol>
  );
}
