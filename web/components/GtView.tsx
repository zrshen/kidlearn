"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBanner } from "./ErrorBanner";
import { generateGt, suggestGt, type GtPair, type GtSpec, type Quality } from "../app/api";

type Banner = { kind: "none" } | { kind: "error"; message: string };

const TEST_BUILTINS = [
  { id: "general", label: "General GT" },
  { id: "cogat", label: "CogAT" },
  { id: "nnat", label: "NNAT" },
  { id: "olsat", label: "OLSAT" },
];

export function GtView({ topic, quality }: { topic: string; quality: Quality }) {
  const [spec, setSpec] = useState<GtSpec | null>(null);
  const [pair, setPair] = useState<GtPair | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>({ kind: "none" });
  const [builtinTest, setBuiltinTest] = useState("general");
  const [customTest, setCustomTest] = useState("");
  const effectiveTest = customTest.trim() || builtinTest;
  const usingCustom = customTest.trim().length > 0;
  const abortRef = useRef<AbortController | null>(null);

  function startWork(): AbortSignal {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl.signal;
  }

  async function handleGenerate() {
    setBanner({ kind: "none" });
    setPair(null);
    setSpec(null);
    setBusy(true);
    const signal = startWork();
    const sug = await suggestGt(topic.trim() || null, effectiveTest, signal);
    if (!sug.ok) {
      setBusy(false);
      if ("cancelled" in sug) return;
      setBanner({ kind: "error", message: sug.message });
      return;
    }
    setSpec(sug.spec);
    const gen = await generateGt(sug.spec, quality, signal);
    setBusy(false);
    if (gen.ok) setPair(gen.pair);
    else if (gen.kind === "error") setBanner({ kind: "error", message: gen.message });
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
                  ? "bg-ink text-white"
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
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Working…" : "Suggest & Generate"}
        </button>
        {pair && (
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-border hover:text-ink"
          >
            Print both
          </button>
        )}
      </div>

      {banner.kind === "error" && (
        <div className="mb-5">
          <ErrorBanner kind="error" message={banner.message} />
        </div>
      )}

      {spec && <SpecPeek spec={spec} />}

      {pair && (
        <div className="mb-8 flex flex-col gap-6">
          <SheetCard label="Front · Questions" tone="front" src={pair.frontUrl} testid="gt-front" />
          <SheetCard label="Back · Answers" tone="back" src={pair.backUrl} testid="gt-back" />
        </div>
      )}

      {pair && <GtPrintPortal frontUrl={pair.frontUrl} backUrl={pair.backUrl} />}
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

function SheetCard({ label, tone, src, testid }: { label: string; tone: "front" | "back"; src: string; testid: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface shadow-card-md">
      <figcaption className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="label-eyebrow">{label}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 font-mono text-[0.64rem] font-semibold ${
            tone === "front" ? "bg-accent-soft text-accent-strong" : "bg-[#ecfdf3] text-[#15803d]"
          }`}
        >
          {tone === "front" ? "FRONT" : "BACK"}
        </span>
      </figcaption>
      <img src={src} alt={label} className="w-full" data-testid={testid} />
    </figure>
  );
}

function GtPrintPortal({ frontUrl, backUrl }: { frontUrl: string; backUrl: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="gt-print-target" aria-hidden>
      <div className="pg">
        <img src={frontUrl} alt="" />
      </div>
      <div className="pg">
        <img src={backUrl} alt="" />
      </div>
    </div>,
    document.body,
  );
}
