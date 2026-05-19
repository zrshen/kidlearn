"use client";

export function TopicInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-semibold text-ink">
      Topic
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. animals, food, feelings"
        maxLength={100}
        className="w-72 rounded-full border border-blush bg-white px-4 py-2 font-normal outline-none focus:border-accent"
      />
    </label>
  );
}
