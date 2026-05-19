"use client";
import type { Batch } from "../app/api";

export function BatchPreview({ batches }: { batches: Batch[] }) {
  if (batches.length === 0) return null;
  return (
    <div className="space-y-6">
      {batches.map((b, i) => (
        <article
          key={b.imageUrl}
          className="space-y-3 rounded-3xl bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-ink-soft">Batch {i + 1}</h3>
            {b.words.map((w) => (
              <span
                key={w}
                className="rounded-full bg-mint px-2.5 py-0.5 text-xs font-semibold text-ink"
              >
                {w}
              </span>
            ))}
            <button
              type="button"
              onClick={() => window.print()}
              className="ml-auto rounded-full border border-blush bg-cream px-4 py-1 text-sm font-semibold text-ink hover:bg-blush"
            >
              Print
            </button>
          </div>
          <img
            src={b.imageUrl}
            alt={`batch ${i + 1} worksheet`}
            className="print-target max-w-full rounded-2xl border border-blush"
            data-testid={`batch-preview-${i}`}
          />
        </article>
      ))}
    </div>
  );
}
