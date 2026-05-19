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
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1 text-sm font-semibold text-ink">
        <input
          type="number"
          min={MIN}
          max={MAX}
          value={n}
          onChange={(e) => setN(parseInt(e.target.value, 10))}
          className="w-16 rounded-xl border border-blush bg-white px-2 py-1 text-center outline-none focus:border-accent"
        />
        <span>batches</span>
      </label>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled || pendingConfirm}
        className="rounded-full bg-mint px-5 py-2 font-bold text-ink shadow-sm transition-colors hover:bg-sun disabled:opacity-50"
      >
        {busy ? `Generating... ${elapsedLabel ?? ""}`.trim() : "Batch Generate"}
      </button>
      {pendingConfirm && (
        <div className="flex items-center gap-2 rounded-2xl bg-sun px-3 py-2 text-sm text-ink">
          <span>Generate {clampedN()} worksheets? Each uses one OpenAI image credit.</span>
          <button
            type="button"
            onClick={() => void doRequest()}
            disabled={busy}
            className="rounded-full bg-accent px-3 py-1 font-bold text-white hover:bg-accent-strong"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setPendingConfirm(false)}
            disabled={busy}
            className="rounded-full bg-white px-3 py-1 font-semibold text-ink"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
