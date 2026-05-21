"use client";

export function TopicInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block rounded-xl border border-border bg-surface px-4 py-3 shadow-card-sm transition-colors focus-within:border-ink-faint">
      <span className="label-eyebrow block">Topic</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="animals, food, feelings…"
        maxLength={100}
        className="mt-1.5 w-full border-0 bg-transparent p-0 text-base font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-faint"
      />
    </label>
  );
}
