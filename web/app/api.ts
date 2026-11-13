const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Item = { word: string; sentence: string };
export type Quality = "low" | "medium" | "high";

export type GenerateResult =
  | { ok: true; imageUrl: string }
  | { ok: false; kind: "conflict"; conflicts: string[] }
  | { ok: false; kind: "error"; message: string }
  | { ok: false; kind: "cancelled" };

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

type GtEvent<Pair> =
  | { type: "step"; message: string; index?: number }
  | { type: "content_ready"; theme: string; panels: number; index?: number }
  | { type: "generate"; side: "front" | "back"; attempt: number; index?: number }
  | {
      type: "verify_result";
      side: "front" | "back";
      attempt: number;
      passed: boolean;
      mismatches: { panel: number; note: string }[];
      index?: number;
    }
  | { type: "retry"; side: "front" | "back"; attempt: number; index?: number }
  | { type: "done"; pair: Pair; index?: number }
  | { type: "error"; message: string }
  | { type: "batch_done" };

type GtWireEvent = GtEvent<GtPairRaw>;
export type GtProgressEvent = GtEvent<GtPair>;

async function readNdjson(
  body: ReadableStream<Uint8Array> | null,
  onLine: (raw: GtWireEvent) => void,
): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) onLine(JSON.parse(line) as GtWireEvent);
    }
  }
  const rest = buf.trim();
  if (rest) onLine(JSON.parse(rest) as GtWireEvent);
}

export async function fetchUsedWords(): Promise<string[]> {
  const r = await fetch(`${API}/api/used-words`);
  if (!r.ok) throw new Error(`used-words ${r.status}`);
  const j = (await r.json()) as { words: string[] };
  return j.words;
}

export type GeneratedEntry = {
  filename: string;
  url: string;
  word: string;
  words: string[];
  hasMetadata: boolean;
  mtime: number;
};

export async function fetchGenerated(): Promise<GeneratedEntry[]> {
  const r = await fetch(`${API}/api/generated`);
  if (!r.ok) throw new Error(`generated ${r.status}`);
  const j = (await r.json()) as {
    items: {
      filename: string;
      url: string;
      word: string;
      words: string[];
      has_metadata: boolean;
      mtime: number;
    }[];
  };
  return j.items.map((e) => ({
    filename: e.filename,
    url: `${API}${e.url}`,
    word: e.word,
    words: e.words,
    hasMetadata: e.has_metadata,
    mtime: e.mtime,
  }));
}

export type BackfillResult = {
  backfilled: { filename: string; words: string[] }[];
  failed: string[];
};

export async function backfillGenerated(): Promise<BackfillResult> {
  const r = await fetch(`${API}/api/generated/backfill`, { method: "POST" });
  if (!r.ok) throw new Error(`backfill ${r.status}`);
  return (await r.json()) as BackfillResult;
}

export async function deleteGenerated(
  filenames: string[],
): Promise<{ deleted: string[]; released_words: string[] }> {
  const r = await fetch(`${API}/api/generated/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filenames }),
  });
  if (!r.ok) throw new Error(`delete ${r.status}`);
  return (await r.json()) as { deleted: string[]; released_words: string[] };
}

export async function generate(
  items: Item[],
  quality: Quality = "medium",
  signal?: AbortSignal,
): Promise<GenerateResult> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, quality }),
      signal,
    });
  } catch (e) {
    if (isAbort(e)) return { ok: false, kind: "cancelled" };
    return { ok: false, kind: "error", message: "Could not reach server. Is the backend running?" };
  }
  if (r.status === 200) {
    const j = (await r.json()) as { image_url: string };
    return { ok: true, imageUrl: `${API}${j.image_url}` };
  }
  if (r.status === 409) {
    const j = (await r.json()) as { conflicts: string[] };
    return { ok: false, kind: "conflict", conflicts: j.conflicts };
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  return { ok: false, kind: "error", message: j.error ?? `server ${r.status}` };
}

export type SuggestResult =
  | { ok: true; items: Item[] }
  | { ok: false; message: string }
  | { ok: false; cancelled: true };

export async function suggest(
  topic: string | null,
  signal?: AbortSignal,
): Promise<SuggestResult> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
      signal,
    });
  } catch (e) {
    if (isAbort(e)) return { ok: false, cancelled: true };
    return { ok: false, message: "Could not reach server. Is the backend running?" };
  }
  if (r.status === 200) {
    const j = (await r.json()) as { items: Item[] };
    return { ok: true, items: j.items };
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  return { ok: false, message: j.error ?? `server ${r.status}` };
}


export type Batch = { imageUrl: string; words: string[] };

export type BatchResult =
  | { ok: true; batches: Batch[] }
  | { ok: false; message: string; completed: Batch[] }
  | { ok: false; cancelled: true };

function toBatch(raw: { image_url: string; words: string[] }): Batch {
  return { imageUrl: `${API}${raw.image_url}`, words: raw.words };
}

export async function batchGenerate(
  topic: string | null,
  n: number,
  quality: Quality = "medium",
  signal?: AbortSignal,
): Promise<BatchResult> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, n, quality }),
      signal,
    });
  } catch (e) {
    if (isAbort(e)) return { ok: false, cancelled: true };
    return {
      ok: false,
      message: "Could not reach server. Is the backend running?",
      completed: [],
    };
  }
  if (r.status === 200) {
    const j = (await r.json()) as { batches: { image_url: string; words: string[] }[] };
    return { ok: true, batches: j.batches.map(toBatch) };
  }
  const j = (await r.json().catch(() => ({}))) as {
    error?: string;
    completed?: { image_url: string; words: string[] }[];
  };
  return {
    ok: false,
    message: j.error ?? `server ${r.status}`,
    completed: (j.completed ?? []).map(toBatch),
  };
}

export type GtPanel = {
  type: string;
  heading: string;
  question: string;
  items: string[];
  choices: string[];
  instruction: string;
  answer: string;
  explanation?: string;
};
export type GtSpec = { title: string; theme: string; test?: string; panels: GtPanel[] };

export type GtSuggestResult =
  | { ok: true; spec: GtSpec }
  | { ok: false; message: string }
  | { ok: false; cancelled: true };

export async function suggestGt(
  topic: string | null,
  test: string | null = null,
  panels: number | null = null,
  signal?: AbortSignal,
): Promise<GtSuggestResult> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/gt/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, test, panels }),
      signal,
    });
  } catch (e) {
    if (isAbort(e)) return { ok: false, cancelled: true };
    return { ok: false, message: "Could not reach server. Is the backend running?" };
  }
  if (r.status === 200) {
    const j = (await r.json()) as { spec: GtSpec };
    return { ok: true, spec: j.spec };
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  return { ok: false, message: j.error ?? `server ${r.status}` };
}

export type GtPair = { id: string; theme: string; test: string; frontUrl: string; backUrl: string; spec?: GtSpec | null };

export type GtGenerateResult =
  | { ok: true; pair: GtPair }
  | { ok: false; kind: "error"; message: string }
  | { ok: false; kind: "cancelled" };

type GtPairRaw = { id: string; theme?: string; test?: string; front_url: string; back_url: string; spec?: GtSpec | null };

function toGtPair(raw: GtPairRaw): GtPair {
  return {
    id: raw.id,
    theme: raw.theme ?? "",
    test: raw.test ?? "",
    frontUrl: `${API}${raw.front_url}`,
    backUrl: `${API}${raw.back_url}`,
    spec: raw.spec ?? null,
  };
}

export async function generateGt(
  spec: GtSpec,
  quality: Quality = "medium",
  signal?: AbortSignal,
  onEvent?: (e: GtProgressEvent) => void,
): Promise<GtGenerateResult> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/gt/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec, quality }),
      signal,
    });
  } catch (e) {
    if (isAbort(e)) return { ok: false, kind: "cancelled" };
    return { ok: false, kind: "error", message: "Could not reach server. Is the backend running?" };
  }
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, kind: "error", message: j.error ?? `server ${r.status}` };
  }
  let pair: GtPair | null = null;
  let errorMessage: string | null = null;
  try {
    await readNdjson(r.body, (raw) => {
      if (raw.type === "done") {
        pair = toGtPair(raw.pair);
        onEvent?.({ type: "done", pair, index: raw.index });
      } else if (raw.type === "error") {
        errorMessage = raw.message;
        onEvent?.(raw);
      } else {
        onEvent?.(raw);
      }
    });
  } catch (e) {
    if (isAbort(e)) return { ok: false, kind: "cancelled" };
    return { ok: false, kind: "error", message: "Connection interrupted while reading the generation stream. Please try again." };
  }
  if (errorMessage) return { ok: false, kind: "error", message: errorMessage };
  if (!pair) return { ok: false, kind: "error", message: "stream ended without a result" };
  return { ok: true, pair };
}

export type GtBatchResult =
  | { ok: true; batches: GtPair[] }
  | { ok: false; message: string; completed: GtPair[] }
  | { ok: false; cancelled: true };

export async function batchGt(
  topic: string | null,
  test: string | null,
  n: number,
  panels: number | null = null,
  quality: Quality = "medium",
  signal?: AbortSignal,
  onEvent?: (e: GtProgressEvent) => void,
): Promise<GtBatchResult> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/gt/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, test, n, panels, quality }),
      signal,
    });
  } catch (e) {
    if (isAbort(e)) return { ok: false, cancelled: true };
    return { ok: false, message: "Could not reach server. Is the backend running?", completed: [] };
  }
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: j.error ?? `server ${r.status}`, completed: [] };
  }
  const completed: GtPair[] = [];
  let errorMessage: string | null = null;
  try {
    await readNdjson(r.body, (raw) => {
      if (raw.type === "done") {
        const pair = toGtPair(raw.pair);
        completed.push(pair);
        onEvent?.({ type: "done", pair, index: raw.index });
      } else if (raw.type === "error") {
        errorMessage = raw.message;
        onEvent?.(raw);
      } else {
        onEvent?.(raw);
      }
    });
  } catch (e) {
    if (isAbort(e)) return { ok: false, cancelled: true };
    return { ok: false, message: "Connection interrupted while reading the batch stream. Please try again.", completed };
  }
  if (errorMessage) return { ok: false, message: errorMessage, completed };
  return { ok: true, batches: completed };
}

export type GtHistoryEntry = GtPair & { mtime: number };

export async function fetchGtGenerated(): Promise<GtHistoryEntry[]> {
  const r = await fetch(`${API}/api/gt/generated`);
  if (!r.ok) throw new Error(`gt-generated ${r.status}`);
  const j = (await r.json()) as {
    items: (GtPairRaw & { mtime: number })[];
  };
  return j.items.map((e) => ({ ...toGtPair(e), mtime: e.mtime }));
}

export async function deleteGt(ids: string[]): Promise<{ deleted: string[] }> {
  const r = await fetch(`${API}/api/gt/generated/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!r.ok) throw new Error(`gt-delete ${r.status}`);
  return (await r.json()) as { deleted: string[] };
}
