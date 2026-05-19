# Flash Card Generator UI — Design

**Date:** 2026-05-16
**Status:** Spec — pending implementation

## Goal

Add a browser UI for the existing flash card generator. The UI lets the user enter 6 word/sentence pairs, click **Generate** to produce a worksheet image via the OpenAI image API, click **Print** to send that image to the browser print dialog, preview the latest image inline, and see the list of previously-used vocabulary words in a sidebar.

The current Python CLI (`generate_flash_cards.py`) continues to work unchanged.

## Architecture

Two processes, separate codebases under one repo:

```
┌─────────────────────┐   HTTP/JSON    ┌──────────────────────┐
│ Next.js frontend    │ ─────────────▶ │ FastAPI backend      │
│ localhost:3000      │                │ localhost:8000       │
│ React + Tailwind    │ ◀───────────── │ uvicorn              │
└─────────────────────┘                └──────────┬───────────┘
                                                  │ imports
                                       ┌──────────┴──────────┐
                                       │ flashcard_lib.py    │
                                       │ - prompt template   │
                                       │ - OpenAI call       │
                                       │ - used-words I/O    │
                                       │ - file lock         │
                                       └──────────┬──────────┘
                                                  │
                                       ┌──────────┴──────────┐
                                       │ used_words.json     │
                                       │ server/generated/   │
                                       └─────────────────────┘
```

- Backend owns the prompt, the OpenAI client, the PNG output, and `used_words.json`. Frontend never touches the prompt.
- `generate_flash_cards.py` and the FastAPI handler both call the same `flashcard_lib` functions, so there is one implementation of the generation logic.
- Concurrent writes between the CLI and the web API are guarded by an `fcntl.flock` on `used_words.json` inside `flashcard_lib`.

## Repository layout

```
flash_card_generation/
├── flashcard_lib.py            # extracted shared logic
├── generate_flash_cards.py     # thin CLI wrapper (unchanged behavior)
├── used_words.json             # source of truth, sorted JSON array
├── pyproject.toml              # adds fastapi, uvicorn
├── server/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app
│   └── generated/              # output PNGs, served at /generated/...
├── web/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── next.config.ts
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx            # the single UI page
│       └── globals.css         # Tailwind + @media print
└── docs/superpowers/specs/
    └── 2026-05-16-flashcard-ui-design.md
```

The previously-generated `image-banana.png` at the repo root moves to `server/generated/` during implementation.

## Backend

### `flashcard_lib.py`

Pure module — no FastAPI imports, no CLI argument parsing. Public surface:

```python
USED_WORDS_PATH: Path
GENERATED_DIR: Path

WordSentence = TypedDict("WordSentence", {"word": str, "sentence": str})

def load_used_words() -> set[str]: ...
def find_conflicts(new_words: Iterable[str], used: set[str]) -> list[str]: ...
def generate_and_record(items: list[WordSentence]) -> Path:
    """Validate, call OpenAI, write PNG, append to used_words.json under a file lock.
    Returns the path of the written PNG.
    Raises ConflictError if any word is already in used_words.
    Raises RuntimeError on OpenAI failure (file is NOT modified)."""
```

Internals:
- `_render_prompt(items)` formats the existing `FLASHCARD_PROMPT_TEMPLATE` with the 6 items.
- The file lock wraps the entire read-modify-write of `used_words.json`. OpenAI call happens **inside** the lock, after the conflict check, so a slow generation does block another generation — acceptable at single-user scale, prevents lost updates.
- On OpenAI error, the lock is released without mutating the file.
- Stub mode: if `FLASHCARD_STUB_IMAGE` env var is set to a path, the module copies that PNG to the output path instead of calling OpenAI. Used by the Playwright E2E so it doesn't burn real API calls or require network.

### `server/main.py` (FastAPI)

Three endpoints:

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/used-words` | Returns `{ words: string[], count: number }`. Sorted alphabetically. |
| `POST` | `/api/generate` | Body: `{ items: [{word, sentence}] }` length=6. Calls `generate_and_record`. Returns `{ image_url: "/generated/image-<word>.png" }`. On `ConflictError`, returns 409 with `{ conflicts: string[] }`. On any other failure, returns 500 with `{ error: string }`. |
| `GET` | `/generated/{filename}` | Static file mount serving `server/generated/`. |

CORS: allow origin `http://localhost:3000` for dev. Production CORS is out of scope.

Run command: `uv run uvicorn server.main:app --reload --port 8000`.

### `generate_flash_cards.py` (CLI)

After refactor, this file shrinks to ~15 lines:

```python
from flashcard_lib import generate_and_record

ITEMS = [
    {"word": "...", "sentence": "..."},
    # ... 6 total
]

if __name__ == "__main__":
    path = generate_and_record(ITEMS)
    print(f"Saved to {path}")
```

Behavior is identical to today — same conflict check, same append, same file path under `server/generated/`.

## Frontend

### Stack

- Next.js 15 (App Router), TypeScript, Tailwind CSS
- No external state library — local `useState` + a single `fetch` hook is enough
- API base URL from `NEXT_PUBLIC_API_URL`, defaults to `http://localhost:8000`

### Single page: `app/page.tsx`

```
┌─────────────────────────────────────────┬──────────────────┐
│ Flash Card Generator                    │ Used Words (230) │
│                                         │ [ search...   ]  │
│ 1. [word ] [sentence ..................]│ - all            │
│ 2. [word ] [sentence ..................]│ - angry          │
│ 3. [word ] [sentence ..................]│ - ant            │
│ 4. [word ] [sentence ..................]│ - apple          │
│ 5. [word ] [sentence ..................]│ - ...            │
│ 6. [word ] [sentence ..................]│                  │
│                                         │                  │
│ [Generate]  [Print]                     │                  │
│                                         │                  │
│ ┌─────────────────────────────────┐     │                  │
│ │  (image preview)                │     │                  │
│ └─────────────────────────────────┘     │                  │
└─────────────────────────────────────────┴──────────────────┘
```

State held in the page component:
- `items: {word, sentence}[]` — 6 rows, defaults empty
- `imageUrl: string | null` — set after a successful generate
- `usedWords: string[]` — fetched on mount and after each successful generate
- `wordFilter: string` — sidebar search box
- `status: "idle" | "generating" | "error"` plus `errorMessage` for display

Generate button:
1. Disabled while `status === "generating"`.
2. On click: POST `${API}/api/generate` with `{ items }`.
3. On 200: set `imageUrl`, refetch used words, switch to `idle`.
4. On 409: show inline error "These words are already used: X, Y" with each conflict highlighted next to its row.
5. On 500: show generic error message with the server's `error` field.

Print button:
- Renders `<button onClick={() => window.print()}>` only when `imageUrl` is set.
- `globals.css` has `@media print { body > *:not(.print-target) { display: none } .print-target { ... } }` so CMD+P prints only the image, sized to page.

Used Words sidebar:
- Fetched on mount via `GET ${API}/api/used-words`.
- Search box filters client-side (substring match, case-insensitive).
- Count badge updates with the unfiltered total.
- No add/remove UI — read-only. Manual edits to `used_words.json` plus a page refresh remain the escape hatch.

Run command: `cd web && npm run dev`.

## Data flow — successful generate

1. User fills 6 rows, clicks Generate.
2. Frontend POSTs `{ items }` to `/api/generate`.
3. Backend acquires file lock on `used_words.json`.
4. Backend loads used words, computes conflicts. (None → continue.)
5. Backend calls `client.images.generate(...)`. (Image bytes returned.)
6. Backend writes `server/generated/image-<first_word>.png`.
7. Backend appends 6 new words to the in-memory set, writes `used_words.json`.
8. Backend releases lock, returns `{ image_url: "/generated/image-<first_word>.png" }`.
9. Frontend sets `imageUrl` to `${API}${image_url}`, refetches `/api/used-words`.
10. Preview renders. Sidebar count goes from 230 → 236.

## Error handling

- **Conflict (409)** — server returns `{ conflicts: ["x","y"] }`. UI highlights the offending input rows and shows the message above the Generate button. No PNG written. No words added.
- **OpenAI failure (500)** — server catches, returns `{ error: "image generation failed: <reason>" }`. No PNG written. No words added. UI shows the error in a banner; user can retry without changing inputs.
- **Network failure from frontend** — caught in the fetch handler, UI shows "Could not reach server. Is the backend running?" with a hint to start `uvicorn`.
- **File lock held by CLI** — Generate request blocks (no timeout in v1). Acceptable single-user behavior.

## Testing approach

### Backend — `pytest`

- **`flashcard_lib` unit tests**
  - `find_conflicts`: overlap, no-overlap, case-sensitivity (lower-case is canonical).
  - `load_used_words` / `save_used_words` round-trip with a tmp path.
- **`flashcard_lib` integration tests** (mocked OpenAI client)
  - Happy path: `generate_and_record` writes PNG, appends 6 words.
  - Conflict path: raises `ConflictError`, file untouched, no PNG written.
  - OpenAI failure path: raises `RuntimeError`, file untouched, no PNG written.
- **`flashcard_lib` concurrency test**
  - Two threads call `generate_and_record` on disjoint word sets with mocked OpenAI. Assert both batches present in final file, no lost writes — proves the `fcntl.flock` works.
- **FastAPI handler tests** — `httpx.AsyncClient` against the app, `flashcard_lib.generate_and_record` mocked. Verify 200 / 409 / 500 response shapes and the static-mount behavior on `/generated/...`.

Run: `uv run pytest`.

### Frontend — Vitest + React Testing Library + Playwright

- **Vitest + RTL component tests** (`web/__tests__/`)
  - `usedWordsSidebar.test.tsx` — renders the count, filters list by substring (case-insensitive), shows "no matches" when empty.
  - `inputRows.test.tsx` — disables Generate when any row is empty; enables when all 6 rows are filled.
  - `errorBanner.test.tsx` — given a 409 response shape, renders each conflict next to the matching row; given a 500, renders the generic banner.
  - Network calls mocked with `msw` (handlers for `/api/generate` and `/api/used-words`).
- **Playwright E2E** (`web/e2e/generate.spec.ts`) — one happy-path test:
  1. Start FastAPI with `OPENAI_API_KEY` pointing at a stub server (or use an env flag in `flashcard_lib` to skip the real OpenAI call and return a fixture PNG).
  2. Navigate to `localhost:3000`, fill 6 unused words, click Generate.
  3. Assert preview `<img>` becomes visible with the expected `src`.
  4. Assert the used-words sidebar count increased by 6.
  5. Assert Print button is visible and `window.print` is wired (spy on `window.print`).

Run: `cd web && npm test` (Vitest), `npm run e2e` (Playwright).

### CI

Out of scope for v1, but tests are written so they can be picked up by GitHub Actions later: `uv run pytest` in one job, `npm test && npm run e2e` in another with a backend service container.

## Out of scope

- Authentication / multi-user
- History of past worksheets
- Image editing
- LLM-generated sentences (user still supplies them)
- Manual add/remove on the used-words list (file edit is the escape hatch)
- Production deployment, Docker, CI
- Internationalization
- Mobile-optimized layout

## Upgrade triggers

- **JSON → SQLite**: first time we want to store data *about* a word (timestamp, source image, category) or query history. Migration is a one-shot ~30-line script.
- **Add-on endpoints**: `DELETE /api/used-words/{word}` and `POST /api/used-words` if read-only proves too restrictive.
