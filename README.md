# kidlearn

A small tool for making printable Kindergarten flashcard worksheets. Pick a topic
(or let it suggest one), and the backend builds a 3×2 grid of illustrated cards
using OpenAI's image model. Each card has a word, a kid-friendly illustration,
and a short sentence with the target word highlighted.

![Flashcard generator UI](docs/assets/screenshot.png)

## Features

- **Suggest from a topic** — type a theme (animals, food, weather) or leave it
  blank to let `gpt-5.4` pick a coherent set of 6 K-level words.
- **One-click generate** — six (word, sentence) pairs in, one PNG worksheet out.
- **Batch mode** — generate N worksheets in a row, each on a fresh topic-coherent
  set with no word reuse.
- **No-repeat library** — every used word is recorded in `used_words.json`; the
  suggester is told to avoid them, and a 502 conflict is returned if you try to
  reuse one manually.
- **Quality control** — Low / Medium / High maps to the image model's quality
  setting (cost/quality tradeoff).
- **Archive sidebar** — every previously generated worksheet, grouped by day,
  searchable by any of its six words. Multi-select to delete (which releases the
  words back to the library).
- **Print-ready** — landscape letter, fills the page, single sheet.

## Quickstart

```bash
# Backend deps
uv sync

# Frontend deps
cd web && npm install && cd ..

# Set your OpenAI key
echo "OPENAI_API_KEY=sk-..." > .env

# Two terminals:
uv run uvicorn server.main:app --reload --port 8000   # backend
cd web && npm run dev                                  # frontend → http://localhost:3000
```

## Architecture

```
flashcard_lib.py   Pure Python: prompt template, OpenAI calls (image + vision +
                   chat), file-locked used_words.json read/write, sidecar
                   metadata, batch + backfill.

server/main.py     FastAPI app — thin wrapper around flashcard_lib.
                   Mounts /generated/* as static files.

server/generated/  Output directory:
                     image-<firstWord>.png   the worksheet
                     image-<firstWord>.json  sidecar { "words": [...6] }

used_words.json    The library. Single source of truth, fcntl-locked.

web/               Next.js 16 (App Router) + Tailwind v4 + TypeScript.
                   Vitest + RTL + MSW for unit tests; Playwright for E2E.
```

## API

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/used-words`         | All recorded words |
| `POST` | `/api/suggest`            | `{topic}` → 6 (word, sentence) pairs |
| `POST` | `/api/generate`           | `{items[6], quality}` → image URL (409 on word conflict) |
| `POST` | `/api/batch`              | `{topic, n, quality}` → N image URLs |
| `GET`  | `/api/generated`          | Archive listing with all 6 words per worksheet |
| `POST` | `/api/generated/backfill` | Extract words from older PNGs via vision and write sidecars |
| `POST` | `/api/generated/delete`   | Delete worksheets and release their words back to the library |

## Tests

```bash
uv run pytest             # backend: lib + server
cd web && npm test        # frontend: Vitest + RTL + MSW
cd web && npm run e2e     # Playwright (stubbed image — no API spend)
```

The E2E suite sets `FLASHCARD_STUB_IMAGE` to a local PNG so no real OpenAI call
is made during Playwright runs.

## Environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required for real image / suggest / vision calls |
| `FLASHCARD_STUB_IMAGE` | Path to a PNG used instead of calling the image model |
| `FLASHCARD_STUB_SUGGEST` | Path to a JSON fixture used instead of calling the suggest model |
| `FLASHCARD_STUB_EXTRACT` | Path to a JSON fixture used instead of calling the vision model (backfill) |
| `NEXT_PUBLIC_API_URL` | Frontend's backend base URL (default `http://localhost:8000`) |

## CLI mode

```bash
uv run python generate_flash_cards.py
```

Generates a worksheet from the hard-coded list in that file. Output path is
`server/generated/image-<first-word>.png`. Errors if any word is already used.
