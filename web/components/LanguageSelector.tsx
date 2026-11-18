"use client";
import type { Language } from "../app/api";

export function LanguageSelector({ value, onChange, disabled }: {
  value: Language;
  onChange: (language: Language) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block rounded-xl border border-border bg-surface px-4 py-3 shadow-card-sm">
      <span className="label-eyebrow block">Worksheet language</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Language)}
        className="mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-2 text-sm text-ink outline-none focus:border-ink-faint disabled:opacity-50"
      >
        <option value="en">English</option>
        <option value="zh-CN">简体中文 + 拼音</option>
      </select>
    </label>
  );
}

export function LanguageBadge({ language = "en" }: { language?: Language }) {
  return <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[0.65rem] text-accent-strong">{language === "zh-CN" ? "中文 + 拼音" : "English"}</span>;
}
