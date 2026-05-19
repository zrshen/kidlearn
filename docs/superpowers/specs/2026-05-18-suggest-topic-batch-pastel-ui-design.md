# Suggest + Topic + Batch + Pastel UI Redesign

**Date:** 2026-05-18
**Status:** Approved, ready for implementation plan

## Problem

The current flashcard UI requires the user to manually type 6 word/sentence pairs every run, has a stark black-on-white (or worse, broken dark-mode) look that doesn't match its kindergarten audience, and produces only one worksheet per click. Goals:

1. Let an LLM pick fresh (word, sentence) pairs that aren't already in `used_words.json`, optionally biased by a topic the user types.
2. Make the UI visually appropriate for the audience (kid-friendly pastel, rounded, friendly font).
3. Allow producing N worksheets in a single click ("batch generate").

## Non-goals

- Mobile / responsive design pass (desktop only for v1).
- Live progress streaming for batch (SSE/polling) — v1 is synchronous "spinner until done."
- Per-batch topic / per-row regeneration / cancel-mid-batch.
- LLM model selection in the UI (model is hardcoded).
- Suggest-only-empty-rows mode (Suggest always replaces all 6 rows).
- Topic preset dropdown (free text only).
- Auth / multi-user.

## Architecture overview

Three layers, same as today:
- `flashcard_lib.py` — pure Python lib; adds `suggest_items()` and `batch_generate()`.
- `server/main.py` — FastAPI; adds `POST /api/suggest` and `POST /api/batch`.
- `web/` — Next.js; adds `TopicInput`, `SuggestButton`, `BatchControls`, restyles existing components.

All OpenAI calls remain server-side. Frontend never sees the prompt or model name. Existing `FLASHCARD_STUB_IMAGE` pattern is mirrored for the chat-completion path so E2E never spends API credits.

## Backend changes

### `flashcard_lib.py`

#### `suggest_items(used: set[str], topic: str | None) -> list[WordSentence]`

Calls OpenAI chat (`gpt-4o-mini`) in JSON mode asking for 6 (word, sentence) pairs.

**Prompt sketch:**
```
You pick 6 vocabulary words and example sentences for a Kindergarten flashcard worksheet.

Rules:
- Pick 6 distinct, age-appropriate (K-level) single words.
- Each sentence: short (4-8 words), uses the word exactly once.
- Lowercase the words.
- {if topic}: All 6 words should fit the theme "{topic}".
- Do NOT pick any of these already-used words: {sorted_used_list}.

Return JSON: {"items": [{"word": "...", "sentence": "..."}, ...]}
```

**Validation:**
- Response parses as JSON with exactly 6 items.
- No word collides with `used` (case-folded).
- All words are non-empty strings.

**Retry policy:** one retry if validation fails (e.g., LLM returned a used word). On second failure, raise `SuggestionError(reason: str)`.

**Stub mode:** if `FLASHCARD_STUB_SUGGEST` env var is set to a path, read that JSON file instead of calling OpenAI. File contains `{"items": [...6 pairs...]}`. Used by the E2E test.

#### `batch_generate(n: int, topic: str | None) -> list[BatchResult]`

Loops `n` times: `suggest_items` → `generate_and_record`. Each batch picks fresh words (because `used` includes previously-generated batches in the loop).

Returns `[{"image_url_path": "/generated/image-x.png", "words": ["x", ...]}, ...]`.

On exception in batch K, returns a partial result via a custom exception:
```python
class PartialBatchError(Exception):
    def __init__(self, completed: list[BatchResult], reason: str): ...
```

The endpoint handler converts this into a 502 with `{"error": reason, "completed": [...]}` in the body. Note that completed batches have **already written to `used_words.json`** (because each iteration calls `generate_and_record`, which commits under the file lock). So a partial failure is durable — the user keeps both the image files and the used-words side effect for the batches that succeeded.

#### Module constants

```python
SUGGEST_MODEL = "gpt-4o-mini"
SUGGEST_MAX_RETRIES = 1
FLASHCARD_STUB_SUGGEST = os.environ.get("FLASHCARD_STUB_SUGGEST")
```

### `server/main.py`

#### `POST /api/suggest`

**Request:**
```json
{"topic": "animals"}      // topic optional, null/missing OK
```

**Validation:** `topic` is a string ≤ 100 chars or null/missing. 422 on type/length violation.

**Response 200:**
```json
{"items": [{"word": "tiger", "sentence": "A tiger roars loud."}, ...]}
```

**Response 502:**
```json
{"error": "Couldn't generate suggestions: <reason>"}
```

#### `POST /api/batch`

**Request:**
```json
{"topic": "animals", "n": 3}
```

**Validation:** `n` is an integer 1–10. `topic` per the suggest endpoint. 422 on violation.

**Response 200:**
```json
{
  "batches": [
    {"image_url": "/generated/image-tiger.png", "words": ["tiger", "zebra", ...]},
    {"image_url": "/generated/image-fox.png",   "words": ["fox", ...]}
  ]
}
```

**Response 502 (partial failure):**
```json
{
  "error": "Batch 3 of 5 failed: <reason>",
  "completed": [
    {"image_url": "/generated/image-tiger.png", "words": [...]},
    {"image_url": "/generated/image-fox.png",   "words": [...]}
  ]
}
```

The custom HTTPException handler from Task 8 of the original plan already strips the `detail` wrapper, so the body is at the top level.

**Timeout:** This endpoint is intentionally long-lived (N=10 ≈ 5 min). uvicorn default is unlimited. Frontend uses `fetch` without a timeout. Document that browsers may also have implicit timeouts; for v1 we accept the risk (no SSE).

### `flashcard_lib.py` shared types

```python
class BatchResult(TypedDict):
    image_url_path: str   # e.g., "/generated/image-tiger.png" (server prepends nothing; just the path)
    words: list[str]
```

The server endpoint translates `image_url_path` → `image_url` for the response shape.

## Frontend changes

### New components

#### `web/components/TopicInput.tsx`
Controlled text input. Props: `value: string`, `onChange: (v: string) => void`. Pastel rounded styling. Label "Topic (optional)". Placeholder: "e.g. animals, food, feelings".

#### `web/components/SuggestButton.tsx`
Button that calls `suggest(topic)` from `api.ts`. Shows spinner + disabled state while in flight. Props: `topic: string`, `onSuggested: (items: Item[]) => void`, `onError: (msg: string) => void`, `disabled?: boolean`.

#### `web/components/BatchControls.tsx`
Composite: number input (1–10, default 1) + "Batch Generate" button + confirm modal logic.

- When user clicks button: if N ≥ 3, render an inline confirm panel asking "Generate N worksheets? Each uses one OpenAI image credit." with `Confirm` / `Cancel`.
- If N < 3, skip confirm and call straight through.
- Spinner + disabled state while in flight.

Props: `topic: string`, `disabled?: boolean`, `onBatchDone: (batches: Batch[]) => void`, `onError: (msg: string) => void`.

#### `web/components/BatchPreview.tsx`
Renders the list of batch result images (when N > 1). Each tile shows the image, the 6 words as small tag pills, and an individual `Print this one` button (uses the print-target class pattern).

For N == 1, the existing single `<img>` preview is used (no need to introduce the list form).

### Modified components

- `web/components/InputRows.tsx` — pastel restyle: rounded-2xl rows, soft pastel background per row, more breathing room. Behavior unchanged.
- `web/components/UsedWordsSidebar.tsx` — pastel restyle: words become rounded "pill" tags arranged in a flow, not a vertical list. Count is a chip in the header. Search box rounded-full. Behavior unchanged.
- `web/components/ErrorBanner.tsx` — soft red pastel (rose-100/rose-700) instead of stark red.

### `web/app/api.ts`

Add:
```ts
export type SuggestResult =
  | { ok: true; items: Item[] }
  | { ok: false; message: string };

export async function suggest(topic: string | null): Promise<SuggestResult>;

export type Batch = { imageUrl: string; words: string[] };
export type BatchResult =
  | { ok: true; batches: Batch[] }
  | { ok: false; message: string; completed: Batch[] };

export async function batchGenerate(topic: string | null, n: number): Promise<BatchResult>;
```

### `web/app/page.tsx` state additions

```ts
const [topic, setTopic] = useState("");
const [n, setN] = useState(1);
const [suggesting, setSuggesting] = useState(false);
const [batching, setBatching] = useState(false);
const [batchResults, setBatchResults] = useState<Batch[]>([]);
```

Layout:
```
+----------------------------------------------------------+
|  Flash Card Generator                                    |
+----------------------------------------------------------+
|  Topic [______]   [ Suggest ]                            |
|                                                          |
|  [1.][word][sentence]                                    |
|  [2.][word][sentence]                                    |
|  ...                                                     |
|  [6.][word][sentence]                                    |
|                                                          |
|  ( Generate )   ( N:[1]  Batch Generate )   ( Print )    |
|                                                          |
|  preview image | batch tiles below                       |
+----------------------------------------------------------+
                                                ^ Used Words (sidebar)
```

The `Generate` button stays as-is (single worksheet, uses current rows). Batch is its own button. Mutual exclusion: only one of Generate / Suggest / Batch active at a time (others disabled while one is in flight).

### `web/app/layout.tsx`

Load Nunito via `next/font/google`:
```ts
import { Nunito } from "next/font/google";
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });
// apply to <body className={`${nunito.variable} font-sans ...`}>
```

### `web/app/globals.css`

Replace existing dark-mode rule (which is broken right now) with explicit pastel theme. Tailwind v4 `@theme`:

```css
@import "tailwindcss";

@theme {
  --color-cream: #fff8ec;
  --color-blush: #ffd6e0;
  --color-sky: #cfeaff;
  --color-mint: #d4f1d4;
  --color-sun: #ffe9a8;
  --color-ink: #2a2a2a;
  --color-accent: #ff7eb0;
  --font-sans: var(--font-nunito), ui-sans-serif, system-ui, sans-serif;
}

body {
  background: var(--color-cream);
  color: var(--color-ink);
}

@media print {
  body * { visibility: hidden; }
  .print-target, .print-target * { visibility: visible; }
  .print-target { position: absolute; inset: 0; width: 100%; height: auto; }
}
```

Components use the theme tokens via `bg-cream`, `bg-blush`, etc. (Tailwind v4 generates the utilities from `@theme`).

## Data flow

### Suggest
```
User types topic, clicks Suggest
  → POST /api/suggest {topic}
    backend: suggest_items(load_used_words(), topic)
      → OpenAI chat, JSON mode, with prompt incl. used words
      → validate response (6 items, no conflicts, non-empty)
      → retry once if invalid
      → return items
  → frontend: setItems(items)  // replaces all 6 rows
```

### Single Generate (unchanged)
```
User clicks Generate
  → POST /api/generate {items}  // current behavior
  → frontend: setImageUrl(result.imageUrl)
              setBatchResults([])  // clear any prior batch
              refresh sidebar
```

### Batch Generate
```
User sets N, clicks Batch Generate
  if N ≥ 3: show inline confirm; wait for Confirm
  → POST /api/batch {topic, n}
    backend: loop n times:
      items = suggest_items(load_used_words(), topic)
      path  = generate_and_record(items)
      yield {image_url: "/generated/" + path.name, words: [i.word for i in items]}
    (file lock serializes the per-batch writes within the loop)
  → frontend: setBatchResults(batches)
              setImageUrl(null)  // hide the single-preview
              refresh sidebar
```

## Error handling

| Case | Backend | Frontend |
|------|---------|----------|
| LLM returns malformed JSON twice | 502 with `{error}` | ErrorBanner: "Couldn't generate suggestions" |
| LLM returns conflict words twice | 502 with `{error}` (mentions trying a different topic) | ErrorBanner: same text |
| `POST /api/suggest` topic > 100 chars | 422 | inline form validation also catches this client-side |
| `POST /api/batch` N out of 1..10 | 422 | client constrains the input |
| Batch K fails mid-loop | 502 with `{error, completed: [...]}` | ErrorBanner with msg + render the `completed` batches so user keeps what was produced |
| Network failure | n/a | existing ErrorBanner pattern: "Could not reach server." |

## Files

### New
- `web/components/TopicInput.tsx`
- `web/components/SuggestButton.tsx`
- `web/components/BatchControls.tsx`
- `web/components/BatchPreview.tsx`
- `web/__tests__/topicInput.test.tsx`
- `web/__tests__/suggestButton.test.tsx`
- `web/__tests__/batchControls.test.tsx`
- `web/__tests__/batchPreview.test.tsx`
- `tests/fixtures/suggest_stub.json` (6 fixed items for E2E)

### Modified
- `flashcard_lib.py` — add `suggest_items`, `batch_generate`, `SuggestionError`, `PartialBatchError`, stub-mode plumbing.
- `server/main.py` — add `POST /api/suggest` and `POST /api/batch` endpoints, request models.
- `tests/test_flashcard_lib.py` — `suggest_items` happy/retry/failure/stub tests; `batch_generate` happy/partial-failure tests.
- `tests/test_server.py` — `/api/suggest` and `/api/batch` endpoint tests (mocked lib).
- `web/app/api.ts` — `suggest`, `batchGenerate`, types.
- `web/app/page.tsx` — wire new components + state.
- `web/app/layout.tsx` — load Nunito.
- `web/app/globals.css` — pastel theme, remove broken dark-mode block.
- `web/components/InputRows.tsx` — pastel restyle.
- `web/components/UsedWordsSidebar.tsx` — pastel restyle, pill tags.
- `web/components/ErrorBanner.tsx` — soft red.
- `web/__tests__/page.test.tsx` — extend for Suggest + Batch flows.
- `web/playwright.config.ts` — pass `FLASHCARD_STUB_SUGGEST` env to backend.
- `web/e2e/generate.spec.ts` — add a Suggest-then-Generate happy path using stubs.

## Testing

### Backend (pytest)
- `suggest_items`: happy path (mocked chat returns 6 valid items); retry on conflict (mocked: first call returns conflict, second succeeds); failure (both calls conflict → `SuggestionError`); failure on malformed JSON; stub mode reads fixture file; topic appears in prompt.
- `batch_generate`: happy path with N=2 in stub mode (suggest stub + image stub) — verifies 2 distinct image files written, used_words grew by 12; partial failure (mock suggest_items to raise on call 2; expect `PartialBatchError(completed=[1 item])`).
- `POST /api/suggest`: 200 happy, 422 oversize topic, 502 on `SuggestionError`.
- `POST /api/batch`: 200 happy (mocked lib), 422 on N=0 / N=11 / bad body, 502 on `PartialBatchError` with `completed` in body.

### Frontend (Vitest + MSW)
- `TopicInput`: controlled, calls onChange.
- `SuggestButton`: spinner during request, replaces items on success, calls onError on failure, disabled when `disabled` prop set.
- `BatchControls`: number input clamped 1–10, no confirm at N=2, confirm panel appears at N=3, Cancel hides confirm, Confirm triggers request; spinner during request.
- `BatchPreview`: renders N tiles, each with image + word pills + Print button.
- Page integration: suggest flow fills inputs; batch flow shows tiles; controls mutually disabled during in-flight requests.

### E2E (Playwright)
- Keep existing "Generate happy path" test (uses image stub).
- Add "Suggest then Generate" test: stub both `FLASHCARD_STUB_IMAGE` and `FLASHCARD_STUB_SUGGEST`. Type topic "animals", click Suggest, verify 6 rows populated from the stub, click Generate, verify preview + sidebar grew.
- Add "Batch Generate N=2" test: stubs as above, set N=2, click Batch Generate (no confirm), verify 2 tiles render with distinct image URLs, sidebar grew by 12.

## Open risks

- **Cost** in production use. The N≥3 confirm panel is the only guardrail. If concerning, add a daily-budget env var as follow-up.
- **Long batch requests** can be killed by browser/proxy timeouts. v1 accepts this; v2 should add SSE.
- **`gpt-4o-mini` JSON-mode reliability** for "avoid these words" — the prompt asks but the model may pick collisions. The retry + final 502 handles it. If users hit this often, consider a deterministic post-filter (drop collisions, request top-up of N-collided).
- **Tailwind v4 `@theme` token syntax** — current scaffold uses Tailwind 4 with no `tailwind.config.ts`. We rely on `@theme` in globals.css generating utilities. If that turns out to be flaky, fall back to inline CSS classes.

## Out-of-scope follow-ups (already noted)

- SSE progress for batch
- Per-batch topic
- Cancel mid-batch
- Mobile responsive pass
- Suggest-only-empty-rows mode
- Topic presets
