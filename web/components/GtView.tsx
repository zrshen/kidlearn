"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBanner } from "./ErrorBanner";
import { batchGt, generateGt, suggestGt, type GtPair, type GtProgressEvent, type GtSpec, type Quality } from "../app/api";
import { clampInt } from "../app/clamp";

type Banner = { kind: "none" } | { kind: "error"; message: string };
type PrintScope = "both" | "front";

const TEST_BUILTINS = [
  { id: "general", label: "General GT" },
  { id: "cogat", label: "CogAT" },
  { id: "nnat", label: "NNAT" },
  { id: "olsat", label: "OLSAT" },
];

const BATCH_MIN = 1;
const BATCH_MAX = 10;
const BATCH_CONFIRM_THRESHOLD = 3;

const PANELS_MIN = 4;
const PANELS_MAX = 6;
const PANELS_DEFAULT = 4;

type LogEntry = { text: string; kind: "info" | "success" | "error" };

function eventToLogLine(e: GtProgressEvent): LogEntry | null {
  switch (e.type) {
    case "generate":
      return {
        text: `⏳ ${e.side === "front" ? "Drawing front page" : "Drawing back page"} (attempt ${e.attempt})…`,
        kind: "info",
      };
    case "verify_result":
      if (e.passed) {
        return { text: `✓  ${e.side === "front" ? "Front" : "Back"} page verified`, kind: "success" };
      } else {
        const m = e.mismatches[0];
        const note = m ? `panel ${m.panel}: ${m.note}` : "mismatch found";
        return { text: `✗  ${e.side === "front" ? "Front" : "Back"} page check failed — ${note}`, kind: "error" };
      }
    case "retry":
      return {
        text: `⏳ ${e.side === "front" ? "Redrawing front page" : "Redrawing back page"} (attempt ${e.attempt})…`,
        kind: "info",
      };
    case "done":
      return { text: "✓  Done", kind: "success" };
    case "error":
      return { text: `✗  ${e.message}`, kind: "error" };
    default:
      return null;
  }
}

function batchBadgeText(e: GtProgressEvent): string | null {
  switch (e.type) {
    case "step":
      return "Writing worksheet content…";
    case "content_ready":
      return `Content ready — ${e.theme}`;
    case "generate":
      return `Drawing ${e.side} (attempt ${e.attempt})…`;
    case "verify_result":
      return e.passed
        ? `${e.side === "front" ? "Front" : "Back"} verified`
        : `${e.side === "front" ? "Front" : "Back"} check failed`;
    case "retry":
      return `Retrying ${e.side} (attempt ${e.attempt})…`;
    case "error":
      return "Failed";
    default:
      return null;
  }
}

export function GtView({
  topic,
  quality,
  selectedPair = null,
  deletedId = null,
  onGenerated,
}: {
  topic: string;
  quality: Quality;
  selectedPair?: GtPair | null;
  deletedId?: string | null;
  onGenerated?: () => void;
}) {
  const [spec, setSpec] = useState<GtSpec | null>(null);
  const [pair, setPair] = useState<GtPair | null>(null);
  const [batchPairs, setBatchPairs] = useState<GtPair[]>([]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>({ kind: "none" });
  const [builtinTest, setBuiltinTest] = useState("general");
  const [customTest, setCustomTest] = useState("");
  const [batchN, setBatchN] = useState(1);
  const [panelCount, setPanelCount] = useState(PANELS_DEFAULT);
  const [pendingBatchConfirm, setPendingBatchConfirm] = useState(false);
  const [printScope, setPrintScope] = useState<PrintScope>("both");
  const [printNonce, setPrintNonce] = useState(0);
  const [progressLog, setProgressLog] = useState<LogEntry[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [currentBatchStatus, setCurrentBatchStatus] = useState("");
  const effectiveTest = customTest.trim() || builtinTest;
  const usingCustom = customTest.trim().length > 0;
  const abortRef = useRef<AbortController | null>(null);

  // Mirror the displayed pair in a ref so the delete effect can read it
  // without re-running when the pair changes.
  const pairRef = useRef<GtPair | null>(null);
  // eslint-disable-next-line react-hooks/refs
  pairRef.current = pair;

  function startWork(): AbortSignal {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl.signal;
  }

  function clampedBatchN(): number {
    return clampInt(batchN, BATCH_MIN, BATCH_MAX, BATCH_MIN);
  }

  function clampedPanels(): number {
    return clampInt(panelCount, PANELS_MIN, PANELS_MAX, PANELS_DEFAULT);
  }

  useEffect(() => {
    if (selectedPair) {
      // Picking a history worksheet supersedes any in-flight generation, so it
      // can't resolve later and overwrite the selection. We own busy now.
      abortRef.current?.abort();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPair(selectedPair);
      setSpec(selectedPair.spec ?? null);
      setBatchPairs([]);
      setBanner({ kind: "none" });
      setBusy(false);
    }
  }, [selectedPair]);

  // Clear the on-screen worksheet if the pair currently shown was deleted.
  useEffect(() => {
    if (deletedId && pairRef.current?.id === deletedId) {
      setPair(null);
      setSpec(null);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBatchPairs((prev) => prev.filter((p) => p.id !== deletedId));
  }, [deletedId]);

  // Trigger the print dialog after the portal re-renders for the chosen scope.
  useEffect(() => {
    if (printNonce > 0) window.print();
  }, [printNonce]);

  function printScoped(scope: PrintScope) {
    setPrintScope(scope);
    setPrintNonce((n) => n + 1);
  }

  async function handleGenerate() {
    setBanner({ kind: "none" });
    setPair(null);
    setSpec(null);
    setBatchPairs([]);
    setBatchTotal(0);
    setProgressLog([]);
    setBusy(true);
    const signal = startWork();
    const sug = await suggestGt(topic.trim() || null, effectiveTest, clampedPanels(), signal);
    // Superseded by a newer click or a history selection — that path owns busy.
    if (signal.aborted) return;
    if (!sug.ok) {
      setBusy(false);
      if (!("cancelled" in sug)) setBanner({ kind: "error", message: sug.message });
      return;
    }
    setSpec(sug.spec);
    const gen = await generateGt(sug.spec, quality, signal, (e) => {
      const line = eventToLogLine(e);
      if (line) setProgressLog((prev) => [...prev, line]);
    });
    if (signal.aborted) return;
    setBusy(false);
    if (gen.ok) {
      setPair(gen.pair);
      onGenerated?.();
    } else if (gen.kind === "error") {
      setBanner({ kind: "error", message: gen.message });
    }
  }

  async function runBatch() {
    setBanner({ kind: "none" });
    setPair(null);
    setSpec(null);
    const total = clampedBatchN();
    setBatchPairs([]);
    setBatchTotal(total);
    setCurrentBatchStatus("");
    setProgressLog([]);
    setBusy(true);
    setPendingBatchConfirm(false);
    const signal = startWork();
    const res = await batchGt(topic.trim() || null, effectiveTest, total, clampedPanels(), quality, signal, (e) => {
      if (e.type === "done") {
        setBatchPairs((prev) => [...prev, e.pair]);
        setCurrentBatchStatus("");
        return;
      }
      const text = batchBadgeText(e);
      if (text) setCurrentBatchStatus(text);
    });
    // Superseded by a newer click or a history selection — that path owns busy.
    if (signal.aborted) return;
    setBusy(false);
    if (res.ok) {
      onGenerated?.();
    } else if (!("cancelled" in res)) {
      if (res.completed.length > 0) onGenerated?.();
      setBanner({ kind: "error", message: res.message });
    }
  }

  function handleBatchClick() {
    if (clampedBatchN() >= BATCH_CONFIRM_THRESHOLD) setPendingBatchConfirm(true);
    else void runBatch();
  }

  return (
    <section>
      <fieldset className="mb-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-card-sm">
        <legend className="label-eyebrow float-none px-0">Test focus</legend>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {TEST_BUILTINS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setBuiltinTest(b.id);
                setCustomTest("");
              }}
              aria-pressed={!usingCustom && builtinTest === b.id}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                !usingCustom && builtinTest === b.id
                  ? "bg-primary text-on-primary"
                  : "border border-border text-ink-soft hover:bg-border hover:text-ink"
              }`}
            >
              {b.label}
            </button>
          ))}
          <input
            type="text"
            value={customTest}
            onChange={(e) => setCustomTest(e.target.value)}
            placeholder="Other test…"
            aria-label="Other test"
            maxLength={60}
            className="min-w-[10rem] flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint"
          />
        </div>
      </fieldset>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card-sm">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary transition-colors hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Working…" : "Suggest & Generate"}
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <label className="flex items-center gap-1.5 text-ink-soft">
          <span className="text-sm">Panels</span>
          <input
            type="number"
            min={PANELS_MIN}
            max={PANELS_MAX}
            value={Number.isNaN(panelCount) ? "" : panelCount}
            onChange={(e) => setPanelCount(parseInt(e.target.value, 10))}
            onBlur={() => setPanelCount(clampedPanels())}
            disabled={busy}
            aria-label="Panels per worksheet"
            className="w-12 rounded-md border border-border bg-surface px-1.5 py-1.5 text-center font-mono text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
          />
        </label>
        <span className="mx-1 h-4 w-px bg-border" />
        <label className="flex items-center gap-1.5 text-ink-soft">
          <span className="text-sm">Batches</span>
          <input
            type="number"
            min={BATCH_MIN}
            max={BATCH_MAX}
            value={Number.isNaN(batchN) ? "" : batchN}
            onChange={(e) => setBatchN(parseInt(e.target.value, 10))}
            onBlur={() => setBatchN(clampedBatchN())}
            aria-label="Batches"
            className="w-12 rounded-md border border-border bg-surface px-1.5 py-1.5 text-center font-mono text-sm text-ink outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          onClick={handleBatchClick}
          disabled={busy || pendingBatchConfirm}
          className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-border hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-soft"
        >
          {busy ? "Generating…" : "Batch Generate"}
        </button>
        {pair && (
          <>
            <button
              type="button"
              onClick={() => printScoped("both")}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-border hover:text-ink"
            >
              Print both
            </button>
            <button
              type="button"
              onClick={() => printScoped("front")}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-border hover:text-ink"
            >
              Print questions
            </button>
          </>
        )}
      </div>

      {pendingBatchConfirm && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-card-sm">
          <span className="text-ink-soft">
            Generate {clampedBatchN()} GT worksheets? Each uses OpenAI image credits.
          </span>
          <button
            type="button"
            onClick={() => void runBatch()}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors hover:bg-accent disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setPendingBatchConfirm(false)}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-border hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}

      {banner.kind === "error" && (
        <div className="mb-5">
          <ErrorBanner kind="error" message={banner.message} />
        </div>
      )}

      <ProgressLog entries={progressLog} />

      {spec && <SpecPeek spec={spec} />}

      {pair && (
        <div className="mb-8 flex flex-col gap-6">
          <SheetCard label="Front · Questions" tone="front" src={pair.frontUrl} testid="gt-front" />
          <SheetCard label="Back · Answers" tone="back" src={pair.backUrl} testid="gt-back" />
        </div>
      )}

      {batchTotal > 0 && (
        <GtBatchPreview
          pairs={batchPairs}
          total={batchTotal}
          currentStatus={currentBatchStatus}
          onSelect={(p) => {
            setPair(p);
            setSpec(p.spec ?? null);
          }}
        />
      )}

      {pair && <GtPrintPortal frontUrl={pair.frontUrl} backUrl={pair.backUrl} scope={printScope} />}
    </section>
  );
}

function SpecPeek({ spec }: { spec: GtSpec }) {
  return (
    <div className="mb-6 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-3 font-mono text-[0.72rem] leading-relaxed text-ink-soft">
      <span className="font-semibold text-ink">Generated spec</span>
      {spec.test ? <> · <span className="text-accent-strong">{spec.test}</span></> : null} · {spec.theme} ·{" "}
      {spec.panels.length} panels
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {spec.panels.map((p, i) => (
          <span key={i}>
            <span className="text-accent-strong">{i + 1}</span> {p.type} → <span className="text-ink">{p.answer}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ProgressLog({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div
      className="mb-6 rounded-xl border border-border bg-surface px-4 py-3 font-mono text-[0.78rem] leading-relaxed"
      data-testid="gt-progress-log"
    >
      {entries.map((e, i) => (
        <div key={i} className={e.kind === "error" ? "text-danger" : e.kind === "success" ? "text-success-ink" : "text-ink-soft"}>
          {e.text}
        </div>
      ))}
    </div>
  );
}

function SheetCard({ label, tone, src, testid }: { label: string; tone: "front" | "back"; src: string; testid: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface shadow-card-md">
      <figcaption className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="label-eyebrow">{label}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 font-mono text-[0.64rem] font-semibold ${
            tone === "front" ? "bg-accent-soft text-accent-strong" : "bg-success-soft text-success-ink"
          }`}
        >
          {tone === "front" ? "FRONT" : "BACK"}
        </span>
      </figcaption>
      <img src={src} alt={label} className="w-full" data-testid={testid} />
    </figure>
  );
}

function GtBatchPreview({
  pairs,
  total,
  currentStatus,
  onSelect,
}: {
  pairs: GtPair[];
  total: number;
  currentStatus?: string;
  onSelect: (p: GtPair) => void;
}) {
  const pendingCount = Math.max(0, total - pairs.length);
  return (
    <div className="mb-8 border-t border-border pt-6">
      <p className="label-eyebrow mb-3">
        Worksheets in this set · {pairs.length}/{total}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {pairs.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p)}
            className="group overflow-hidden rounded-xl border border-border bg-surface text-left shadow-card-sm transition-colors hover:border-border-strong"
            data-testid={`gt-batch-${i}`}
          >
            <div className="relative aspect-[3/2] bg-bg">
              <img
                src={p.frontUrl}
                alt={p.theme || `worksheet ${i + 1}`}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <span className="flex items-center justify-between gap-2 px-2.5 py-2">
              <span className="truncate text-[0.8rem] font-medium text-ink">{p.theme || p.id}</span>
              {p.test ? (
                <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px font-mono text-[0.55rem] font-semibold text-accent-strong">
                  {p.test}
                </span>
              ) : null}
            </span>
          </button>
        ))}
        {Array.from({ length: pendingCount }, (_, j) => (
          <div
            key={`pending-${j}`}
            data-testid={`gt-batch-pending-${pairs.length + j}`}
            className="flex aspect-[3/2] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface text-center"
          >
            <span className="text-xs text-ink-faint">{j === 0 ? currentStatus || "Working…" : "Waiting…"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GtPrintPortal({ frontUrl, backUrl, scope }: { frontUrl: string; backUrl: string; scope: PrintScope }) {
  const [mounted, setMounted] = useState(false);
  // Portal mounts to document.body only after client hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="gt-print-target" aria-hidden>
      <div className="pg">
        <img src={frontUrl} alt="" />
      </div>
      {scope === "both" && (
        <div className="pg">
          <img src={backUrl} alt="" />
        </div>
      )}
    </div>,
    document.body,
  );
}
