"use client";
import { useEffect, useRef, useState } from "react";
import { BatchControls } from "../components/BatchControls";
import { BatchPreview } from "../components/BatchPreview";
import { ErrorBanner } from "../components/ErrorBanner";
import { InputRows, emptyItems, type Item } from "../components/InputRows";
import { TopicInput } from "../components/TopicInput";
import { UsedWordsSidebar } from "../components/UsedWordsSidebar";
import {
  fetchUsedWords,
  generate,
  suggest,
  type Batch,
  type GenerateResult,
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
  const [generating, setGenerating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [batching, setBatching] = useState(false);
  const [banner, setBanner] = useState<Banner>({ kind: "none" });

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
      .then(setUsedWords)
      .catch(() => setBanner({ kind: "error", message: "Could not load used words." }));
  }, []);

  async function refreshUsed() {
    try {
      setUsedWords(await fetchUsedWords());
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
  const generateLabel = suggesting
    ? `Suggesting... ${elapsedLabel}`
    : generating
      ? `Generating... ${elapsedLabel}`
      : allRowsFilled
        ? "Generate"
        : "Suggest & Generate";

  return (
    <div className="flex min-h-screen bg-cream">
      <main className="flex-1 space-y-5 p-6">
        <h1 className="text-2xl font-extrabold text-ink">Flash Card Generator</h1>

        <div className="flex flex-wrap items-center gap-4">
          <TopicInput value={topic} onChange={setTopic} />
          <QualityRadio value={quality} onChange={setQuality} disabled={busy} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="rounded-full bg-accent px-6 py-2 font-bold text-white shadow-sm hover:bg-accent-strong disabled:opacity-50"
          >
            {generateLabel}
          </button>
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
              className="rounded-full bg-soft-red px-4 py-2 font-semibold text-white shadow-sm hover:bg-deep-red"
            >
              Cancel
            </button>
          )}
          {imageUrl && (
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-full border border-blush bg-cream px-4 py-2 font-semibold text-ink hover:bg-blush"
            >
              Print
            </button>
          )}
        </div>

        <ErrorBanner {...bannerToProps(banner)} />

        <InputRows items={items} onChange={setItems} conflicts={conflictWords} />

        {imageUrl && (
          <img
            src={imageUrl}
            alt="generated worksheet"
            className="print-target max-w-full rounded-2xl border border-blush"
            data-testid="preview"
          />
        )}

        <BatchPreview batches={batchResults} />
      </main>
      <UsedWordsSidebar words={usedWords} />
    </div>
  );
}

function QualityRadio({
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
      className="flex items-center gap-2 text-sm text-ink"
      aria-label="Image quality"
    >
      <legend className="mr-1 font-semibold">Quality</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={`flex items-center gap-1 rounded-full border px-3 py-1 cursor-pointer ${
            value === o.value
              ? "border-accent bg-accent text-white"
              : "border-blush bg-white text-ink hover:bg-blush"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
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
          <span>{o.label}</span>
        </label>
      ))}
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

function bannerToProps(b: Banner) {
  if (b.kind === "none") return { kind: "none" as const };
  if (b.kind === "conflict")
    return { kind: "conflict" as const, conflicts: b.conflicts };
  return { kind: "error" as const, message: b.message };
}
