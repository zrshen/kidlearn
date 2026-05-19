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

export async function fetchUsedWords(): Promise<string[]> {
  const r = await fetch(`${API}/api/used-words`);
  if (!r.ok) throw new Error(`used-words ${r.status}`);
  const j = (await r.json()) as { words: string[] };
  return j.words;
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
