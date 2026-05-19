# kidlearn

An internal tool that generates printable kindergarten flashcard worksheets. The
backend (FastAPI + OpenAI Images API) takes exactly 6 (word, sentence) pairs,
builds a prompt, and calls `gpt-image-2` to produce a single 1536x1024 PNG laid
out as a 3x2 grid of illustrated flashcards. The frontend (Next.js 16, App
Router) provides a browser UI with editable inputs, an image preview, and a
print button; a sidebar lists previously-used words loaded from the server so you
can avoid repeating them.

## Architecture

- `flashcard_lib.py` — pure Python library: prompt template, OpenAI call, and
  file-locked read/write of `used_words.json`. No FastAPI or CLI imports.
- `generate_flash_cards.py` — thin CLI that calls the lib with a hard-coded
  six-item list. Output goes to `server/generated/image-<first-word>.png`.
- `server/` — FastAPI app (`server/main.py`): `GET /api/used-words`,
  `POST /api/generate`, and a static mount at `/generated/*`.
- `web/` — Next.js 16 (App Router) + Tailwind v4 + TypeScript. Unit tests with
  Vitest + React Testing Library + MSW; E2E tests with Playwright.

## Setup

```
uv sync                  # Python deps (FastAPI, OpenAI, uvicorn, pytest…)
cd web && npm install    # Frontend deps
```

Create a `.env` file at the repo root:

```
OPENAI_API_KEY=sk-...
```

## Run

Open two terminals:

```
# Terminal 1 — backend
uv run uvicorn server.main:app --reload --port 8000

# Terminal 2 — frontend
cd web && npm run dev
```

Then open http://localhost:3000.

## Tests

```
uv run pytest                # backend: lib unit tests + server integration tests
cd web && npm test           # frontend unit/component tests (Vitest + RTL + MSW)
cd web && npm run e2e        # Playwright happy-path (no API spend, see below)
```

The Playwright suite sets `FLASHCARD_STUB_IMAGE` to a local PNG so no real
OpenAI call is made during E2E runs.

## Environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required for real image generation |
| `FLASHCARD_STUB_IMAGE` | Path to a PNG used instead of calling OpenAI (used by E2E tests) |
| `NEXT_PUBLIC_API_URL` | Frontend's backend base URL (default: `http://localhost:8000`) |

## CLI mode

```
uv run python generate_flash_cards.py
```

Generates a worksheet from the hard-coded list in that file and prints the
output path (`server/generated/image-<first-word>.png`). Raises an error if any
word was already used.
