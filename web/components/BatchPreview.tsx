"use client";
import type { Batch } from "../app/api";

export function BatchPreview({ batches }: { batches: Batch[] }) {
  if (batches.length === 0) return null;
  return (
    <div className="space-y-8 border-t border-border pt-8">
      <p className="label-eyebrow">Worksheets in this set</p>
      {batches.map((b, i) => (
        <article
          key={b.imageUrl}
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-card-md"
        >
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Batch <span className="text-accent">{i + 1}</span>
            </h3>
            <p className="flex flex-wrap gap-x-1 text-sm text-ink-soft">
              {b.words.map((w, j) => (
                <span key={w} className="inline-flex items-center gap-1">
                  {j > 0 && <span className="text-ink-faint">·</span>}
                  <span>{w}</span>
                </span>
              ))}
            </p>
            <button
              type="button"
              onClick={() => window.print()}
              className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-border hover:text-ink"
            >
              Print
            </button>
          </header>
          <img
            src={b.imageUrl}
            alt={`batch ${i + 1} worksheet`}
            className="print-target w-full"
            data-testid={`batch-preview-${i}`}
          />
        </article>
      ))}
    </div>
  );
}
