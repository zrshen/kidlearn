"use client";

type Props =
  | { kind: "none" }
  | { kind: "conflict"; conflicts: string[] }
  | { kind: "error"; message: string };

export function ErrorBanner(props: Props) {
  if (props.kind === "none") return null;
  const text =
    props.kind === "conflict"
      ? `These words are already used: ${props.conflicts.join(", ")}.`
      : props.message;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-conflict-ink/20 bg-conflict-bg px-4 py-3 text-sm text-conflict-ink shadow-card-sm"
    >
      <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-conflict-ink" />
      <span>
        <span className="mr-2 font-mono text-[0.7rem] font-semibold uppercase tracking-wider">
          Notice
        </span>
        {text}
      </span>
    </div>
  );
}
