"use client";
import { useEffect, useRef, useState } from "react";
import { BatchControls } from "../components/BatchControls";
import { BatchPreview } from "../components/BatchPreview";
import { ErrorBanner } from "../components/ErrorBanner";
import { HistorySidebar } from "../components/HistorySidebar";
import { InputRows, emptyItems, type Item } from "../components/InputRows";
import { TopicInput } from "../components/TopicInput";
import { UsedWordsSidebar } from "../components/UsedWordsSidebar";
import { WorksheetTypeSwitcher, type WorksheetType } from "../components/WorksheetTypeSwitcher";
import { GtView } from "../components/GtView";
import { GtHistorySidebar } from "../components/GtHistorySidebar";
import {
  backfillGenerated,
  deleteGenerated,
  fetchGenerated,
  fetchGtGenerated,
  fetchUsedWords,
  generate,
  suggest,
  type Batch,
  type GenerateResult,
  type GeneratedEntry,
  type GtHistoryEntry,
  type Quality,
} from "./api";

type Banner =
  | { kind: "none" }
  | { kind: "conflict"; conflicts: string[] }
  | { kind: "error"; message: string };

export default function Page() {
  const [topic, setTopic] = useState("");
  const [quality, setQuality] = useState<Quality>("medium");
  const [items, setItems] = useState<Item[]>(emptyItems());
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<Batch[]>([]);
  const [usedWords, setUsedWords] = useState<string[]>([]);
  const [history, setHistory] = useState<GeneratedEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [batching, setBatching] = useState(false);
  const [banner, setBanner] = useState<Banner>({ kind: "none" });
  const [usedLoaded, setUsedLoaded] = useState(false);
  const [mode, setMode] = useState<WorksheetType>("flashcard");
  const [gtHistory, setGtHistory] = useState<GtHistoryEntry[]>([]);
  const [gtSelectedId, setGtSelectedId] = useState<string | null>(null);

  const busy = generating || suggesting || batching;
  const elapsed = useElapsedSeconds(busy);
  const elapsedLabel = formatElapsed(elapsed);
  const abortRef = useRef<AbortController | null>(null);

  function startWork(): AbortSignal {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl.signal;
  }

  function cancelWork() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  useEffect(() => {
    fetchUsedWords()
      .then((w) => {
        setUsedWords(w);
        setUsedLoaded(true);
      })
      .catch(() => setBanner({ kind: "error", message: "Could not load used words." }));
    fetchGenerated()
      .then(async (entries) => {
        setHistory(entries);
        if (entries.some((e) => !e.hasMetadata)) {
          try {
            await backfillGenerated();
            setHistory(await fetchGenerated());
          } catch {
            /* backfill failed; keep what we have */
          }
        }
      })
      .catch(() => {
        /* sidebar stays empty; not a blocking error */
      });
  }, []);

  useEffect(() => {
    document.body.classList.toggle("gt-mode", mode === "gt");
    document.body.classList.toggle("flashcard-mode", mode === "flashcard");
    return () => document.body.classList.remove("gt-mode", "flashcard-mode");
  }, [mode]);

  useEffect(() => {
    if (mode !== "gt") return;
    fetchGtGenerated()
      .then(setGtHistory)
      .catch(() => {
        /* sidebar stays empty; not blocking */
      });
  }, [mode]);

  async function refreshUsed() {
    try {
      setUsedWords(await fetchUsedWords());
    } catch {
      /* keep stale */
    }
    try {
      setHistory(await fetchGenerated());
    } catch {
      /* keep stale */
    }
  }

  async function handleGenerate() {
    setImageUrl(null);
    setBatchResults([]);
    setBanner({ kind: "none" });
    const signal = startWork();

    let itemsToUse = items;
    const needsSuggest = items.some(
      (it) => !it.word.trim() || !it.sentence.trim(),
    );
    if (needsSuggest) {
      setSuggesting(true);
      const sug = await suggest(topic.trim() || null, signal);
      setSuggesting(false);
      if (!sug.ok) {
        if ("cancelled" in sug) return;
        setBanner({ kind: "error", message: sug.message });
        return;
      }
      itemsToUse = sug.items.map((it) => ({ word: it.word, sentence: it.sentence }));
      setItems(itemsToUse);
    }

    setGenerating(true);
    const result: GenerateResult = await generate(itemsToUse, quality, signal);
    setGenerating(false);
    if (result.ok) {
      setImageUrl(result.imageUrl);
      await refreshUsed();
    } else if (result.kind === "conflict") {
      setBanner({ kind: "conflict", conflicts: result.conflicts });
    } else if (result.kind === "cancelled") {
      return;
    } else {
      setBanner({ kind: "error", message: result.message });
    }
  }

  function handleBatchDone(batches: Batch[]) {
    setBatchResults(batches);
    setImageUrl(null);
    void refreshUsed();
  }

  function handleBatchError(message: string, completed?: Batch[]) {
    setBanner({ kind: "error", message });
    if (completed && completed.length > 0) {
      setBatchResults(completed);
      void refreshUsed();
    }
  }

  const conflictWords = banner.kind === "conflict" ? banner.conflicts : [];
  const allRowsFilled = items.every(
    (it) => it.word.trim() && it.sentence.trim(),
  );
  const hasAnyContent =
    items.some((it) => it.word.trim() || it.sentence.trim()) ||
    imageUrl !== null ||
    batchResults.length > 0;

  function handleClear() {
    setItems(emptyItems());
    setImageUrl(null);
    setBatchResults([]);
    setBanner({ kind: "none" });
  }

  const generateLabel = suggesting
    ? `Suggesting… ${elapsedLabel}`
    : generating
      ? `Generating… ${elapsedLabel}`
      : allRowsFilled
        ? "Generate"
        : "Suggest & Generate";

  return (
    <div className="flex min-h-screen bg-bg">
      {mode === "flashcard" ? (
        <HistorySidebar
          entries={history}
          selectedUrl={imageUrl}
          onSelect={(url) => {
            setImageUrl(url);
            setBatchResults([]);
            setBanner({ kind: "none" });
          }}
          onDelete={async (filenames) => {
            await deleteGenerated(filenames);
            if (imageUrl && filenames.some((f) => imageUrl.endsWith(`/${f}`))) {
              setImageUrl(null);
            }
            await refreshUsed();
          }}
        />
      ) : (
        <GtHistorySidebar entries={gtHistory} selectedId={gtSelectedId} onSelect={(e) => setGtSelectedId(e.id)} />
      )}
      <main className="mx-auto w-full max-w-4xl flex-1 px-8 py-12">
        <WorksheetTypeSwitcher value={mode} onChange={setMode} />
        <header className="mb-10">
          <h1 className="text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.035em] text-ink">
            Create a <span className="grad-title">flashcard worksheet</span>
          </h1>
          <p className="mt-2 max-w-xl text-[0.95rem] text-ink-soft">
            Six K-level words on one printable page. Suggest from a topic or type your own.
          </p>
        </header>

        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <TopicInput value={topic} onChange={setTopic} />
          <QualityPanel value={quality} onChange={setQuality} disabled={busy} />
        </div>

        {mode === "gt" ? (
          <GtView topic={topic} quality={quality} />
        ) : (
          <>
            {imageUrl && (
              <figure className="mb-8 overflow-hidden rounded-xl border border-border bg-surface shadow-card-md">
                <figcaption className="flex items-center justify-between border-b border-border px-5 py-3">
                  <span className="label-eyebrow">The Worksheet</span>
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-wider text-ink-soft transition-colors hover:bg-border hover:text-ink"
                    >
                      Print
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageUrl(null)}
                      className="font-mono text-[0.7rem] uppercase tracking-wider text-ink-faint transition-colors hover:text-ink"
                      aria-label="Close preview"
                    >
                      Close ✕
                    </button>
                  </span>
                </figcaption>
                <img
                  src={imageUrl}
                  alt="generated worksheet"
                  className="print-target w-full"
                  data-testid="preview"
                />
              </figure>
            )}

            <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card-sm">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-ink"
              >
                {generateLabel}
                <span
                  aria-hidden="true"
                  className="rounded-[4px] bg-white/15 px-1.5 py-px font-mono text-[0.7rem]"
                >
                  ⌘ ↵
                </span>
              </button>
              <span className="mx-1 h-4 w-px bg-border" />
              <BatchControls
                topic={topic}
                quality={quality}
                getSignal={startWork}
                onBatchDone={(batches) => {
                  handleBatchDone(batches);
                  setBanner({ kind: "none" });
                }}
                onError={(msg, completed) => {
                  handleBatchError(msg, completed);
                }}
                disabled={busy}
                onBusyChange={setBatching}
                elapsedLabel={elapsedLabel}
              />
              {busy && (
                <button
                  type="button"
                  onClick={cancelWork}
                  className="rounded-lg border border-conflict-ink/30 bg-conflict-bg px-3 py-2 text-sm font-medium text-conflict-ink transition-colors hover:bg-conflict-ink hover:text-white"
                >
                  Cancel
                </button>
              )}
              {hasAnyContent && !busy && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-border hover:text-ink"
                >
                  Clear
                </button>
              )}
              <span className="ml-auto inline-flex items-center gap-1 font-mono text-[0.7rem] text-ink-faint">
                <kbd className="rounded-[4px] border border-border-strong border-b-2 bg-bg px-1.5 py-px font-mono text-[0.7rem] text-ink-soft">
                  ?
                </kbd>
                <span>shortcuts</span>
              </span>
            </div>

            {banner.kind !== "none" && (
              <div className="mb-5">
                <ErrorBanner {...banner} />
              </div>
            )}

            <InputRows items={items} onChange={setItems} conflicts={conflictWords} />

            <div className="mt-3 flex justify-between px-2 font-mono text-[0.7rem] text-ink-faint">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    usedLoaded ? "bg-success" : "bg-ink-faint"
                  }`}
                />
                {usedLoaded
                  ? `backend ready · ${usedWords.length} words in library`
                  : "connecting…"}
              </span>
              <span>v1.0 · gpt-image-2 · gpt-5.5</span>
            </div>

            <div className="mt-10">
              <BatchPreview batches={batchResults} />
            </div>
          </>
        )}
      </main>
      {mode === "flashcard" ? (
        <UsedWordsSidebar words={usedWords} />
      ) : (
        <aside className="sticky top-0 h-screen w-[232px] flex-shrink-0 border-l border-border bg-surface p-5 opacity-50">
          <span className="label-eyebrow">Word Library</span>
          <p className="mt-2 font-mono text-[0.66rem] text-ink-faint">🔒 Flashcard mode only</p>
          <p className="mt-2 text-[0.78rem] text-ink-faint">GT worksheets don’t track used words — every sheet is freshly generated.</p>
        </aside>
      )}
    </div>
  );
}

function QualityPanel({
  value,
  onChange,
  disabled,
}: {
  value: Quality;
  onChange: (q: Quality) => void;
  disabled?: boolean;
}) {
  const options: { label: string; value: Quality }[] = [
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
  ];
  return (
    <fieldset
      className="block rounded-xl border border-border bg-surface px-4 py-3 shadow-card-sm"
      aria-label="Image quality"
    >
      <legend className="label-eyebrow float-none px-0">Quality</legend>
      <div className="mt-1.5 flex gap-0 rounded-lg bg-border p-[2px]">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex-1 cursor-pointer rounded-md py-1.5 text-center text-[0.85rem] font-medium transition-all ${
              value === o.value
                ? "bg-surface text-ink shadow-card-sm"
                : "text-ink-soft hover:text-ink"
            } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <input
              type="radio"
              name="quality"
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              disabled={disabled}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

