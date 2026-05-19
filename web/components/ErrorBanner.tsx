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
      className="rounded-2xl bg-soft-red px-4 py-3 text-sm text-deep-red shadow-sm"
    >
      {text}
    </div>
  );
}
