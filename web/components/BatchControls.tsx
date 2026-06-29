"use client";
import { useState } from "react";
import { batchGenerate, type Batch, type Quality } from "../app/api";

const MIN = 1;
const MAX = 10;
const CONFIRM_THRESHOLD = 3;

export function BatchControls({
  topic,
  quality,
  getSignal,
  onBatchDone,
  onError,
  disabled,
  onBusyChange,
  elapsedLabel,
}: {
  topic: string;
  quality?: Quality;
  getSignal?: () => AbortSignal;
  onBatchDone: (batches: Batch[]) => void;
  onError: (msg: string, completed?: Batch[]) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  elapsedLabel?: string;
}) {
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  function clampedN(): number {
    if (Number.isNaN(n)) return MIN;
    return Math.max(MIN, Math.min(MAX, Math.trunc(n)));
  }

  async function doRequest() {
    const effective = clampedN();
    setBusy(true);
    onBusyChange?.(true);
    const signal = getSignal?.();
    const result = await batchGenerate(topic.trim() || null, effective, quality, signal);
    setBusy(false);
    onBusyChange?.(false);
    setPendingConfirm(false);
    if (result.ok) {
      onBatchDone(result.batches);
    } else if ("cancelled" in result) {
      return;
    } else {
      onError(result.message, result.completed);
    }
  }

  function handleClick() {
    if (clampedN() >= CONFIRM_THRESHOLD) {
      setPendingConfirm(true);
    } else {
      void doRequest();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-ink-soft">
        <span className="text-sm">Batches</span>
        <input
          type="number"
          min={MIN}
          max={MAX}
          value={Number.isNaN(n) ? "" : n}
          onChange={(e) => setN(parseInt(e.target.value, 10))}
          className="w-12 rounded-md border border-border bg-surface px-1.5 py-1.5 text-center font-mono text-sm text-ink outline-none focus:border-accent"
        />
      </label>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled || pendingConfirm}
        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-border hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-soft"
      >
        {busy ? `Generating… ${elapsedLabel ?? ""}`.trim() : "Batch Generate"}
      </button>
      {pendingConfirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-card-sm">
          <span className="text-ink-soft">
            Generate {clampedN()} worksheets? Each uses one OpenAI image credit.
          </span>
          <button
            type="button"
            onClick={() => void doRequest()}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors hover:bg-accent disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setPendingConfirm(false)}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-border hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
