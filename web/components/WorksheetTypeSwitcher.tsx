"use client";

export type WorksheetType = "flashcard" | "gt";

export function WorksheetTypeSwitcher({
  value,
  onChange,
}: {
  value: WorksheetType;
  onChange: (t: WorksheetType) => void;
}) {
  const options: { label: string; value: WorksheetType; dot: string }[] = [
    { label: "Flashcard", value: "flashcard", dot: "#ffb84d" },
    { label: "GT Thinking", value: "gt", dot: "#5e5cff" },
  ];
  return (
    <div className="mb-6 inline-flex gap-[2px] rounded-xl bg-border p-[3px]" role="tablist" aria-label="Worksheet type">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
            value === o.value ? "bg-surface text-ink shadow-card-sm" : "text-ink-soft hover:text-ink"
          }`}
        >
          <span className="h-3 w-3 rounded" style={{ background: o.dot }} />
          {o.label}
        </button>
      ))}
    </div>
  );
}
