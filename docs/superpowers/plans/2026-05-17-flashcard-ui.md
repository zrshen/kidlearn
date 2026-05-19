# Flashcard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser UI for the flash card generator: 6 word/sentence inputs, Generate + Print buttons, image preview, and a sidebar listing previously-used words.

**Architecture:** Two processes. Next.js 15 (TypeScript) frontend at `localhost:3000` calls a FastAPI backend at `localhost:8000`. Both the FastAPI server and the existing `generate_flash_cards.py` CLI share `flashcard_lib.py`, which owns the prompt template, the OpenAI call, and the file-locked I/O on `used_words.json`. Frontend never sees the prompt.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, pytest, httpx (for tests), Next.js 15 (App Router), TypeScript, Tailwind CSS, Vitest, React Testing Library, msw, Playwright. Package managers: `uv` for Python, `npm` for Node.

**Pre-work (one-time before Task 1):** The repo has a `.git` directory but no commits yet. Run `git add -A && git commit -m "chore: snapshot current state before UI work"` so the diffs in each task are clean.

---

## Phase 1 — Backend refactor + tests

### Task 1: Add test deps and a stub-image fixture

**Files:**
- Modify: `pyproject.toml`
- Create: `tests/__init__.py`
- Create: `tests/fixtures/stub.png`

- [ ] **Step 1: Add backend test dependencies**

Run:
```bash
uv add --dev pytest httpx
```

Expected: `pyproject.toml` shows `pytest` and `httpx` under `[dependency-groups.dev]`. `uv.lock` updates.

- [ ] **Step 2: Add server runtime dependencies (used later but install now to keep lockfile in one update)**

Run:
```bash
uv add fastapi uvicorn
```

Expected: both packages appear under `[project.dependencies]`.

- [ ] **Step 3: Create test scaffolding**

```bash
mkdir -p tests/fixtures
touch tests/__init__.py
```

- [ ] **Step 4: Create a tiny stub PNG fixture**

```python
# Run once from the repo root to produce tests/fixtures/stub.png
# This is a 4x4 red PNG, ~70 bytes
import base64, pathlib
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAQMAAACTPww9AAAABlBMVEX/AAD///9BHTQRAAAA"
    "C0lEQVQI12NgQAUAABwAAYrnxa4AAAAASUVORK5CYII="
)
pathlib.Path("tests/fixtures/stub.png").write_bytes(base64.b64decode(PNG_B64))
print("wrote tests/fixtures/stub.png")
```

Run:
```bash
uv run python -c "$(cat <<'PY'
import base64, pathlib
pathlib.Path('tests/fixtures/stub.png').write_bytes(base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAQMAAACTPww9AAAABlBMVEX/AAD///9BHTQRAAAA'
    'C0lEQVQI12NgQAUAABwAAYrnxa4AAAAASUVORK5CYII='))
print('ok')
PY
)"
```

Expected: prints `ok`. File size > 0.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml uv.lock tests/__init__.py tests/fixtures/stub.png
git commit -m "chore: add backend test deps and stub PNG fixture"
```

---

### Task 2: Extract pure helpers into `flashcard_lib.py` (TDD)

We split the existing module into a pure library + a thin CLI. This task creates the library with `load_used_words`, `save_used_words`, `find_conflicts`. The CLI stays untouched in this task (Task 5 will rewire it).

**Files:**
- Create: `flashcard_lib.py`
- Create: `tests/test_flashcard_lib.py`

- [ ] **Step 1: Write failing tests for the three pure helpers**

Create `tests/test_flashcard_lib.py`:

```python
import json
from pathlib import Path

import pytest

import flashcard_lib


@pytest.fixture
def tmp_used_words(tmp_path, monkeypatch):
    p = tmp_path / "used_words.json"
    p.write_text(json.dumps(["apple", "banana"]))
    monkeypatch.setattr(flashcard_lib, "USED_WORDS_PATH", p)
    return p


def test_load_used_words_returns_set(tmp_used_words):
    assert flashcard_lib.load_used_words() == {"apple", "banana"}


def test_save_used_words_writes_sorted_json(tmp_used_words):
    flashcard_lib.save_used_words({"zebra", "apple", "mango"})
    assert json.loads(tmp_used_words.read_text()) == ["apple", "mango", "zebra"]


def test_save_used_words_ends_with_newline(tmp_used_words):
    flashcard_lib.save_used_words({"x"})
    assert tmp_used_words.read_text().endswith("\n")


def test_find_conflicts_returns_sorted_overlap():
    used = {"apple", "banana", "cherry"}
    assert flashcard_lib.find_conflicts(["mango", "banana", "apple"], used) == ["apple", "banana"]


def test_find_conflicts_empty_when_no_overlap():
    assert flashcard_lib.find_conflicts(["mango", "kiwi"], {"apple"}) == []
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:
```bash
uv run pytest tests/test_flashcard_lib.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'flashcard_lib'`.

- [ ] **Step 3: Create `flashcard_lib.py` with the three pure helpers**

```python
"""Pure helpers and (later) the OpenAI-backed generator. No FastAPI/CLI imports."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, TypedDict


class WordSentence(TypedDict):
    word: str
    sentence: str


USED_WORDS_PATH: Path = Path(__file__).parent / "used_words.json"
GENERATED_DIR: Path = Path(__file__).parent / "server" / "generated"


def load_used_words() -> set[str]:
    return set(json.loads(USED_WORDS_PATH.read_text()))


def save_used_words(words: set[str]) -> None:
    USED_WORDS_PATH.write_text(json.dumps(sorted(words), indent=2) + "\n")


def find_conflicts(new_words: Iterable[str], used: set[str]) -> list[str]:
    return sorted(set(new_words) & used)
```

- [ ] **Step 4: Run tests to confirm they pass**

Run:
```bash
uv run pytest tests/test_flashcard_lib.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add flashcard_lib.py tests/test_flashcard_lib.py
git commit -m "feat: extract flashcard_lib with pure helpers"
```

---

### Task 3: Add `generate_and_record` with file lock, stub mode, and OpenAI happy/sad paths (TDD)

This task adds the function that wraps the OpenAI call, writes the PNG, and atomically appends to `used_words.json` under a file lock. The OpenAI call is mocked in tests. Stub-image mode (used later by the Playwright E2E) is added here as a real code path.

**Files:**
- Modify: `flashcard_lib.py`
- Modify: `tests/test_flashcard_lib.py`

- [ ] **Step 1: Append failing tests for `generate_and_record`**

Append to `tests/test_flashcard_lib.py`:

```python
import shutil
from unittest.mock import MagicMock, patch


@pytest.fixture
def isolated_lib(tmp_path, monkeypatch):
    used = tmp_path / "used_words.json"
    used.write_text(json.dumps(["apple"]))
    gen = tmp_path / "generated"
    gen.mkdir()
    monkeypatch.setattr(flashcard_lib, "USED_WORDS_PATH", used)
    monkeypatch.setattr(flashcard_lib, "GENERATED_DIR", gen)
    return used, gen


SIX_ITEMS = [
    {"word": "carrot", "sentence": "A rabbit eats a carrot."},
    {"word": "tomato", "sentence": "The tomato is red."},
    {"word": "grapes", "sentence": "I share my grapes."},
    {"word": "potato", "sentence": "We bake a potato."},
    {"word": "broccoli", "sentence": "I dip broccoli."},
    {"word": "kiwi", "sentence": "A kiwi is green."},
]


def _stub_openai_response(b64: str) -> MagicMock:
    m = MagicMock()
    m.images.generate.return_value = MagicMock(data=[MagicMock(b64_json=b64)])
    return m


def test_generate_and_record_writes_png_and_appends_words(isolated_lib):
    used, gen = isolated_lib
    fake_png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
    with patch.object(flashcard_lib, "_openai_client", lambda: _stub_openai_response(fake_png_b64)):
        path = flashcard_lib.generate_and_record(SIX_ITEMS)
    assert path.name == "image-carrot.png"
    assert path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert json.loads(used.read_text()) == sorted(["apple"] + [i["word"] for i in SIX_ITEMS])


def test_generate_and_record_raises_conflict_and_does_not_write(isolated_lib):
    used, gen = isolated_lib
    items = [{**SIX_ITEMS[0], "word": "apple"}, *SIX_ITEMS[1:]]
    with pytest.raises(flashcard_lib.ConflictError) as exc:
        flashcard_lib.generate_and_record(items)
    assert exc.value.conflicts == ["apple"]
    assert list(gen.iterdir()) == []
    assert json.loads(used.read_text()) == ["apple"]


def test_generate_and_record_openai_error_does_not_mutate(isolated_lib):
    used, gen = isolated_lib
    boom = MagicMock()
    boom.images.generate.side_effect = RuntimeError("api down")
    with patch.object(flashcard_lib, "_openai_client", lambda: boom):
        with pytest.raises(RuntimeError, match="api down"):
            flashcard_lib.generate_and_record(SIX_ITEMS)
    assert list(gen.iterdir()) == []
    assert json.loads(used.read_text()) == ["apple"]


def test_generate_and_record_stub_mode_uses_fixture(isolated_lib, monkeypatch):
    used, gen = isolated_lib
    fixture = Path("tests/fixtures/stub.png").resolve()
    monkeypatch.setenv("FLASHCARD_STUB_IMAGE", str(fixture))
    path = flashcard_lib.generate_and_record(SIX_ITEMS)
    assert path.read_bytes() == fixture.read_bytes()
    assert json.loads(used.read_text()) == sorted(["apple"] + [i["word"] for i in SIX_ITEMS])
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:
```bash
uv run pytest tests/test_flashcard_lib.py -v
```

Expected: 4 new failures (ConflictError missing, generate_and_record missing, _openai_client missing).

- [ ] **Step 3: Extend `flashcard_lib.py` with prompt, lock, stub mode, OpenAI call**

Append to `flashcard_lib.py`:

```python
import base64
import fcntl
import os
import shutil
from contextlib import contextmanager

from openai import OpenAI

FLASHCARD_PROMPT_TEMPLATE = """
Create one educational flashcard worksheet image for a Kindergarten student.

PAGE FORMAT:
- One image only.
- Exactly 6 flashcards on the page.
- Arrange the flashcards in a clean 3-column x 2-row grid.
- White page background.
- Each flashcard should have rounded corners and a thin colorful border.
- Each flashcard must include:
  1. A large lowercase vocabulary word at the top.
  2. A simple, colorful, kid-friendly illustration in the middle.
  3. A short Kindergarten-level sentence at the bottom.
  4. The target word highlighted in the sentence using a rounded colored label.

STYLE:
- Bright children's book illustration style.
- Large bold rounded font.
- Clean spacing.
- High readability.
- No watermark, no logo, no extra labels, no extra cards.
- Keep the text spelling correct.
- Keep all sentence text inside the card boundaries.

SENTENCE RULES:
- Use varied simple sentence patterns.
- Do NOT use "This is a ___" for every card.
- Each sentence should be short and easy for a K student.
- Each sentence must include the target word exactly once.
- Highlight the target word in the sentence.
- Do not add any extra words beyond the given title and sentence.

WORDS AND SENTENCES:
1. {word_1}: "{sentence_1}"
2. {word_2}: "{sentence_2}"
3. {word_3}: "{sentence_3}"
4. {word_4}: "{sentence_4}"
5. {word_5}: "{sentence_5}"
6. {word_6}: "{sentence_6}"

IMPORTANT:
- The card title must be exactly the word before the colon.
- The sentence must be exactly the sentence inside quotes.
- The target word must be highlighted in each sentence.
"""


class ConflictError(Exception):
    def __init__(self, conflicts: list[str]) -> None:
        super().__init__(f"already used: {conflicts}")
        self.conflicts = conflicts


def _render_prompt(items: list[WordSentence]) -> str:
    fmt: dict[str, str] = {}
    for i, item in enumerate(items, start=1):
        fmt[f"word_{i}"] = item["word"]
        fmt[f"sentence_{i}"] = item["sentence"]
    return FLASHCARD_PROMPT_TEMPLATE.format(**fmt)


def _openai_client() -> OpenAI:
    return OpenAI()


@contextmanager
def _used_words_lock():
    USED_WORDS_PATH.touch(exist_ok=True)
    with open(USED_WORDS_PATH, "r+") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def _produce_png_bytes(items: list[WordSentence]) -> bytes:
    stub = os.environ.get("FLASHCARD_STUB_IMAGE")
    if stub:
        return Path(stub).read_bytes()
    result = _openai_client().images.generate(
        model="gpt-image-2",
        prompt=_render_prompt(items),
        size="1536x1024",
        quality="high",
        n=1,
    )
    assert result.data and result.data[0].b64_json, "image generation returned no data"
    return base64.b64decode(result.data[0].b64_json)


def generate_and_record(items: list[WordSentence]) -> Path:
    if len(items) != 6:
        raise ValueError(f"expected 6 items, got {len(items)}")
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    new_words = [i["word"] for i in items]
    with _used_words_lock():
        used = load_used_words()
        conflicts = find_conflicts(new_words, used)
        if conflicts:
            raise ConflictError(conflicts)
        png_bytes = _produce_png_bytes(items)
        out_path = GENERATED_DIR / f"image-{items[0]['word']}.png"
        out_path.write_bytes(png_bytes)
        save_used_words(used | set(new_words))
    return out_path
```

- [ ] **Step 4: Run tests to confirm they pass**

Run:
```bash
uv run pytest tests/test_flashcard_lib.py -v
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add flashcard_lib.py tests/test_flashcard_lib.py
git commit -m "feat: generate_and_record with file lock and stub mode"
```

---

### Task 4: Concurrency test for the file lock

**Files:**
- Modify: `tests/test_flashcard_lib.py`

- [ ] **Step 1: Append a threaded test**

Append to `tests/test_flashcard_lib.py`:

```python
import threading


def test_generate_and_record_concurrent_writes_do_not_lose_words(isolated_lib, monkeypatch):
    used, gen = isolated_lib
    fixture = Path("tests/fixtures/stub.png").resolve()
    monkeypatch.setenv("FLASHCARD_STUB_IMAGE", str(fixture))

    batch_a = [{"word": f"a{i}", "sentence": "s"} for i in range(6)]
    batch_b = [{"word": f"b{i}", "sentence": "s"} for i in range(6)]

    errors: list[Exception] = []

    def run(batch):
        try:
            flashcard_lib.generate_and_record(batch)
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    t1 = threading.Thread(target=run, args=(batch_a,))
    t2 = threading.Thread(target=run, args=(batch_b,))
    t1.start(); t2.start()
    t1.join(); t2.join()

    assert errors == []
    final = set(json.loads(used.read_text()))
    expected = {"apple", *[i["word"] for i in batch_a], *[i["word"] for i in batch_b]}
    assert final == expected
```

- [ ] **Step 2: Run the new test**

Run:
```bash
uv run pytest tests/test_flashcard_lib.py::test_generate_and_record_concurrent_writes_do_not_lose_words -v
```

Expected: PASS. (If it fails by losing words, the lock is wrong — re-check `_used_words_lock`.)

- [ ] **Step 3: Run the full backend test suite**

Run:
```bash
uv run pytest -v
```

Expected: 10 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/test_flashcard_lib.py
git commit -m "test: concurrent generate_and_record under file lock"
```

---

### Task 5: Refactor `generate_flash_cards.py` to a thin CLI

The existing module-level script becomes a CLI that imports `flashcard_lib`. Behavior is unchanged except the PNG now lands in `server/generated/`.

**Files:**
- Modify: `generate_flash_cards.py`

- [ ] **Step 1: Replace the whole file with the thin CLI**

Overwrite `generate_flash_cards.py`:

```python
"""CLI: generate one worksheet from a hard-coded list."""
from dotenv import load_dotenv

from flashcard_lib import ConflictError, generate_and_record

load_dotenv()

ITEMS = [
    {"word": "banana", "sentence": "I peel a banana."},
    {"word": "carrot", "sentence": "A rabbit eats a carrot."},
    {"word": "tomato", "sentence": "The tomato is red and round."},
    {"word": "grapes", "sentence": "I share my grapes with mom."},
    {"word": "potato", "sentence": "We bake a big potato."},
    {"word": "broccoli", "sentence": "I dip broccoli in cheese."},
]

if __name__ == "__main__":
    try:
        out = generate_and_record(ITEMS)
        print(f"Saved to {out}")
    except ConflictError as e:
        raise SystemExit(f"Already-used words: {e.conflicts}. Pick fresh words.")
```

- [ ] **Step 2: Confirm the script syntax-checks without running it**

Run:
```bash
uv run python -c "import generate_flash_cards; print('ok')"
```

Expected: prints `ok` (no OpenAI call because there's no `__main__` execution).

- [ ] **Step 3: Commit**

```bash
git add generate_flash_cards.py
git commit -m "refactor: generate_flash_cards.py is now a thin CLI"
```

---

### Task 6: Move existing PNG into `server/generated/` and add `.gitkeep`

**Files:**
- Create: `server/__init__.py`
- Create: `server/generated/.gitkeep`
- Move: `image-banana.png` → `server/generated/image-banana.png`
- Modify: `.gitignore`

- [ ] **Step 1: Move the existing PNG and create the package**

Run:
```bash
mkdir -p server/generated
touch server/__init__.py server/generated/.gitkeep
[ -f image-banana.png ] && git mv image-banana.png server/generated/image-banana.png || true
```

- [ ] **Step 2: Ignore future generated PNGs in git (keep `.gitkeep`)**

Append to `.gitignore`:

```
server/generated/*.png
!server/generated/.gitkeep
```

- [ ] **Step 3: Commit**

```bash
git add server/__init__.py server/generated/.gitkeep .gitignore image-banana.png server/generated/image-banana.png 2>/dev/null || true
git add -A server/ .gitignore
git commit -m "chore: relocate generated PNGs under server/generated/"
```

---

## Phase 2 — FastAPI server

### Task 7: FastAPI app skeleton with `GET /api/used-words` (TDD)

**Files:**
- Create: `server/main.py`
- Create: `tests/test_server.py`

- [ ] **Step 1: Write failing test for `GET /api/used-words`**

Create `tests/test_server.py`:

```python
import json

import pytest
from fastapi.testclient import TestClient

import flashcard_lib
from server.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    used = tmp_path / "used_words.json"
    used.write_text(json.dumps(["alpha", "beta", "gamma"]))
    monkeypatch.setattr(flashcard_lib, "USED_WORDS_PATH", used)
    return TestClient(app)


def test_used_words_returns_sorted_with_count(client):
    r = client.get("/api/used-words")
    assert r.status_code == 200
    assert r.json() == {"words": ["alpha", "beta", "gamma"], "count": 3}
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
uv run pytest tests/test_server.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'server.main'`.

- [ ] **Step 3: Create `server/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import flashcard_lib

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/used-words")
def used_words() -> dict:
    words = sorted(flashcard_lib.load_used_words())
    return {"words": words, "count": len(words)}
```

- [ ] **Step 4: Run to confirm pass**

Run:
```bash
uv run pytest tests/test_server.py -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_server.py
git commit -m "feat: FastAPI app with GET /api/used-words"
```

---

### Task 8: `POST /api/generate` (happy + 409 + 500, TDD)

**Files:**
- Modify: `tests/test_server.py`
- Modify: `server/main.py`

- [ ] **Step 1: Append failing tests**

Append to `tests/test_server.py`:

```python
from pathlib import Path
from unittest.mock import patch

from flashcard_lib import ConflictError


SIX_ITEMS = [
    {"word": "carrot", "sentence": "A rabbit eats a carrot."},
    {"word": "tomato", "sentence": "The tomato is red."},
    {"word": "grapes", "sentence": "I share my grapes."},
    {"word": "potato", "sentence": "We bake a potato."},
    {"word": "broccoli", "sentence": "I dip broccoli."},
    {"word": "kiwi", "sentence": "A kiwi is green."},
]


def test_generate_returns_image_url_on_success(client, tmp_path):
    fake_out = tmp_path / "image-carrot.png"
    fake_out.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    with patch("server.main.flashcard_lib.generate_and_record", return_value=fake_out):
        r = client.post("/api/generate", json={"items": SIX_ITEMS})
    assert r.status_code == 200
    assert r.json() == {"image_url": "/generated/image-carrot.png"}


def test_generate_returns_409_on_conflict(client):
    with patch(
        "server.main.flashcard_lib.generate_and_record",
        side_effect=ConflictError(["carrot", "potato"]),
    ):
        r = client.post("/api/generate", json={"items": SIX_ITEMS})
    assert r.status_code == 409
    assert r.json() == {"conflicts": ["carrot", "potato"]}


def test_generate_returns_500_on_openai_failure(client):
    with patch(
        "server.main.flashcard_lib.generate_and_record",
        side_effect=RuntimeError("api down"),
    ):
        r = client.post("/api/generate", json={"items": SIX_ITEMS})
    assert r.status_code == 500
    assert r.json() == {"error": "image generation failed: api down"}


def test_generate_validates_item_count(client):
    r = client.post("/api/generate", json={"items": SIX_ITEMS[:5]})
    assert r.status_code == 422
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
uv run pytest tests/test_server.py -v
```

Expected: 4 new failures (route missing).

- [ ] **Step 3: Implement the route**

Append to `server/main.py`:

```python
from pathlib import Path
from typing import Annotated

from fastapi import HTTPException
from pydantic import BaseModel, Field


class WordSentenceIn(BaseModel):
    word: str = Field(min_length=1)
    sentence: str = Field(min_length=1)


class GenerateRequest(BaseModel):
    items: Annotated[list[WordSentenceIn], Field(min_length=6, max_length=6)]


@app.post("/api/generate")
def generate(req: GenerateRequest) -> dict:
    items = [{"word": i.word, "sentence": i.sentence} for i in req.items]
    try:
        out_path: Path = flashcard_lib.generate_and_record(items)
    except flashcard_lib.ConflictError as e:
        raise HTTPException(status_code=409, detail={"conflicts": e.conflicts})
    except Exception as e:  # OpenAI or filesystem failure
        raise HTTPException(status_code=500, detail={"error": f"image generation failed: {e}"})
    return {"image_url": f"/generated/{out_path.name}"}
```

The default FastAPI exception handler wraps `HTTPException.detail` in `{"detail": ...}`. To match the response shapes the frontend expects (`{"conflicts": ...}` and `{"error": ...}` at the top level), add an exception handler. Append:

```python
from fastapi.requests import Request
from fastapi.responses import JSONResponse


@app.exception_handler(HTTPException)
async def _http_exc(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.detail)
```

- [ ] **Step 4: Run to confirm pass**

Run:
```bash
uv run pytest tests/test_server.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_server.py
git commit -m "feat: POST /api/generate with conflict and error responses"
```

---

### Task 9: Mount `server/generated/` as static files (TDD)

**Files:**
- Modify: `tests/test_server.py`
- Modify: `server/main.py`

- [ ] **Step 1: Append failing test for static mount**

Append to `tests/test_server.py`:

```python
def test_generated_static_mount_serves_file(tmp_path, monkeypatch):
    gen = tmp_path / "generated"
    gen.mkdir()
    (gen / "image-x.png").write_bytes(b"\x89PNG\r\n\x1a\nhi")
    monkeypatch.setattr(flashcard_lib, "GENERATED_DIR", gen)
    # The mount captures the directory at app-construction time, so reload the module.
    import importlib, server.main as sm
    importlib.reload(sm)
    c = TestClient(sm.app)
    r = c.get("/generated/image-x.png")
    assert r.status_code == 200
    assert r.content.startswith(b"\x89PNG")
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
uv run pytest tests/test_server.py::test_generated_static_mount_serves_file -v
```

Expected: FAIL — 404.

- [ ] **Step 3: Add the static mount**

Append to `server/main.py`:

```python
from fastapi.staticfiles import StaticFiles

flashcard_lib.GENERATED_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/generated", StaticFiles(directory=flashcard_lib.GENERATED_DIR), name="generated")
```

- [ ] **Step 4: Run to confirm pass and check full suite**

Run:
```bash
uv run pytest -v
```

Expected: all tests pass (15+).

- [ ] **Step 5: Smoke-test the server manually**

In one terminal:
```bash
uv run uvicorn server.main:app --reload --port 8000
```

In another:
```bash
curl -s http://localhost:8000/api/used-words | head -c 200
```

Expected: JSON with `"words":` and `"count":`.

Stop uvicorn (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
git add server/main.py tests/test_server.py
git commit -m "feat: serve generated PNGs at /generated/*"
```

---

## Phase 3 — Frontend scaffold

### Task 10: Scaffold Next.js 15 + TypeScript + Tailwind in `web/`

**Files:**
- Create: `web/` (entire Next.js scaffold)
- Modify: `.gitignore`

- [ ] **Step 1: Run the Next.js initializer**

Run:
```bash
npx --yes create-next-app@latest web \
  --typescript --tailwind --app --no-src-dir --eslint --no-import-alias \
  --use-npm --no-turbopack --yes
```

Expected: `web/` populated with `app/`, `package.json`, `tailwind.config.ts`, etc. If the CLI still prompts, accept defaults.

- [ ] **Step 2: Confirm the dev server starts**

Run:
```bash
cd web && npm run dev &
sleep 4
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
kill %1 2>/dev/null
cd ..
```

Expected: prints `200`.

- [ ] **Step 3: Ignore Next.js build artifacts (the initializer adds most; double-check)**

Confirm `web/.gitignore` contains `.next/` and `node_modules/`. Add the entries if missing.

Append to repo-root `.gitignore` (so a top-level `git status` stays quiet):

```
web/node_modules/
web/.next/
web/playwright-report/
web/test-results/
```

- [ ] **Step 4: Commit**

```bash
git add web/ .gitignore
git commit -m "chore: scaffold Next.js 15 + Tailwind in web/"
```

---

### Task 11: Add Vitest + React Testing Library + msw

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`
- Create: `web/__tests__/setup.ts`
- Create: `web/__tests__/handlers.ts`

- [ ] **Step 1: Add dev dependencies (including the React plugin Vitest needs)**

Run:
```bash
cd web && npm install --save-dev \
  vitest @vitest/ui jsdom @vitejs/plugin-react \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  msw whatwg-fetch
cd ..
```

- [ ] **Step 2: Create `web/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./__tests__/setup.ts"],
    globals: true,
    css: false,
  },
});
```

- [ ] **Step 3: Create `web/__tests__/setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest";
import "whatwg-fetch";
import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const mswServer = setupServer(...handlers);

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
```

- [ ] **Step 4: Create `web/__tests__/handlers.ts`**

```typescript
import { http, HttpResponse } from "msw";

const API = "http://localhost:8000";

export const handlers = [
  http.get(`${API}/api/used-words`, () =>
    HttpResponse.json({ words: ["alpha", "beta", "gamma"], count: 3 })
  ),
  http.post(`${API}/api/generate`, async () =>
    HttpResponse.json({ image_url: "/generated/image-carrot.png" })
  ),
];
```

- [ ] **Step 5: Add test scripts to `web/package.json`**

In `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Verify Vitest can boot (no tests yet, should report 0 files)**

Run:
```bash
cd web && npm test || true
cd ..
```

Expected: Vitest runs and reports "No test files found" or similar — that's fine, we add tests next.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/__tests__/setup.ts web/__tests__/handlers.ts
git commit -m "chore: vitest + RTL + msw setup"
```

---

### Task 12: Add Playwright

**Files:**
- Modify: `web/package.json`
- Create: `web/playwright.config.ts`
- Create: `web/e2e/.gitkeep`

- [ ] **Step 1: Install Playwright**

Run:
```bash
cd web && npm install --save-dev @playwright/test
npx playwright install chromium
cd ..
```

- [ ] **Step 2: Create `web/playwright.config.ts`**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Add e2e script to `web/package.json`**

```json
"e2e": "playwright test"
```

- [ ] **Step 4: Touch the e2e dir so git tracks it**

Run: `mkdir -p web/e2e && touch web/e2e/.gitkeep`

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/playwright.config.ts web/e2e/.gitkeep
git commit -m "chore: playwright config"
```

---

## Phase 4 — Frontend components (TDD)

### Task 13: `UsedWordsSidebar` component + test

**Files:**
- Create: `web/__tests__/usedWordsSidebar.test.tsx`
- Create: `web/components/UsedWordsSidebar.tsx`

- [ ] **Step 1: Write failing test**

Create `web/__tests__/usedWordsSidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UsedWordsSidebar } from "../components/UsedWordsSidebar";

describe("UsedWordsSidebar", () => {
  it("renders count and full word list sorted", () => {
    render(<UsedWordsSidebar words={["banana", "apple", "carrot"]} />);
    expect(screen.getByText(/Used Words \(3\)/)).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["apple", "banana", "carrot"]);
  });

  it("filters case-insensitively by substring", async () => {
    const user = userEvent.setup();
    render(<UsedWordsSidebar words={["banana", "apple", "carrot"]} />);
    await user.type(screen.getByPlaceholderText(/search/i), "AN");
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["banana"]);
  });

  it("shows empty state when no matches", async () => {
    const user = userEvent.setup();
    render(<UsedWordsSidebar words={["apple"]} />);
    await user.type(screen.getByPlaceholderText(/search/i), "zz");
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
cd web && npm test
cd ..
```

Expected: failures — module not found.

- [ ] **Step 3: Create `web/components/UsedWordsSidebar.tsx`**

```tsx
"use client";
import { useMemo, useState } from "react";

export function UsedWordsSidebar({ words }: { words: string[] }) {
  const [filter, setFilter] = useState("");
  const sorted = useMemo(() => [...words].sort(), [words]);
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? sorted.filter((w) => w.toLowerCase().includes(f)) : sorted;
  }, [sorted, filter]);

  return (
    <aside className="w-64 border-l border-gray-200 p-4 space-y-3">
      <h2 className="font-semibold">Used Words ({sorted.length})</h2>
      <input
        type="search"
        placeholder="search..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full rounded border px-2 py-1"
      />
      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">No matches</p>
      ) : (
        <ul className="text-sm space-y-1 max-h-[70vh] overflow-y-auto">
          {visible.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run to confirm pass**

Run:
```bash
cd web && npm test
cd ..
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add web/components/UsedWordsSidebar.tsx web/__tests__/usedWordsSidebar.test.tsx
git commit -m "feat(web): UsedWordsSidebar with search filter"
```

---

### Task 14: `InputRows` component + test

**Files:**
- Create: `web/__tests__/inputRows.test.tsx`
- Create: `web/components/InputRows.tsx`

- [ ] **Step 1: Write failing test**

Create `web/__tests__/inputRows.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { InputRows, emptyItems, type Item } from "../components/InputRows";

function Harness({ onChange }: { onChange: (items: Item[]) => void }) {
  const [items, setItems] = useState<Item[]>(emptyItems());
  return (
    <InputRows
      items={items}
      onChange={(next) => {
        setItems(next);
        onChange(next);
      }}
      conflicts={[]}
    />
  );
}

describe("InputRows", () => {
  it("renders 6 word inputs and 6 sentence inputs", () => {
    render(<Harness onChange={() => {}} />);
    expect(screen.getAllByPlaceholderText("word")).toHaveLength(6);
    expect(screen.getAllByPlaceholderText("sentence")).toHaveLength(6);
  });

  it("calls onChange when typing in a row", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    await user.type(screen.getAllByPlaceholderText("word")[0], "apple");
    expect(spy).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ word: "apple" })]),
    );
  });

  it("highlights rows whose word is in conflicts", () => {
    const items = emptyItems();
    items[0].word = "apple";
    render(<InputRows items={items} onChange={() => {}} conflicts={["apple"]} />);
    const row0 = screen.getByTestId("row-0");
    expect(row0.className).toMatch(/conflict/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
cd web && npm test
cd ..
```

Expected: failures — module not found.

- [ ] **Step 3: Create `web/components/InputRows.tsx`**

```tsx
"use client";

export type Item = { word: string; sentence: string };

export const emptyItems = (): Item[] =>
  Array.from({ length: 6 }, () => ({ word: "", sentence: "" }));

export function InputRows({
  items,
  onChange,
  conflicts,
}: {
  items: Item[];
  onChange: (next: Item[]) => void;
  conflicts: string[];
}) {
  const conflictSet = new Set(conflicts);
  const setField = (i: number, k: keyof Item, v: string) => {
    const next = items.map((it, j) => (i === j ? { ...it, [k]: v } : it));
    onChange(next);
  };

  return (
    <ol className="space-y-2">
      {items.map((it, i) => {
        const isConflict = it.word.length > 0 && conflictSet.has(it.word);
        return (
          <li
            key={i}
            data-testid={`row-${i}`}
            className={`flex gap-2 items-center p-1 rounded ${
              isConflict ? "conflict bg-red-100" : ""
            }`}
          >
            <span className="w-5 text-right text-sm text-gray-500">{i + 1}.</span>
            <input
              placeholder="word"
              value={it.word}
              onChange={(e) => setField(i, "word", e.target.value)}
              className="w-32 rounded border px-2 py-1"
            />
            <input
              placeholder="sentence"
              value={it.sentence}
              onChange={(e) => setField(i, "sentence", e.target.value)}
              className="flex-1 rounded border px-2 py-1"
            />
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: Run to confirm pass**

Run:
```bash
cd web && npm test
cd ..
```

Expected: all sidebar + InputRows tests pass (6).

- [ ] **Step 5: Commit**

```bash
git add web/components/InputRows.tsx web/__tests__/inputRows.test.tsx
git commit -m "feat(web): InputRows with conflict highlighting"
```

---

### Task 15: `ErrorBanner` component + test

**Files:**
- Create: `web/__tests__/errorBanner.test.tsx`
- Create: `web/components/ErrorBanner.tsx`

- [ ] **Step 1: Write failing test**

Create `web/__tests__/errorBanner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorBanner } from "../components/ErrorBanner";

describe("ErrorBanner", () => {
  it("renders conflict message listing all conflicts", () => {
    render(<ErrorBanner kind="conflict" conflicts={["apple", "banana"]} />);
    expect(screen.getByRole("alert").textContent).toMatch(/apple/);
    expect(screen.getByRole("alert").textContent).toMatch(/banana/);
  });

  it("renders generic message for server errors", () => {
    render(<ErrorBanner kind="error" message="image generation failed: api down" />);
    expect(screen.getByRole("alert").textContent).toMatch(/api down/);
  });

  it("renders nothing when kind is none", () => {
    const { container } = render(<ErrorBanner kind="none" />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
cd web && npm test
cd ..
```

Expected: failures — module not found.

- [ ] **Step 3: Create `web/components/ErrorBanner.tsx`**

```tsx
"use client";

type Props =
  | { kind: "none" }
  | { kind: "conflict"; conflicts: string[] }
  | { kind: "error"; message: string };

export function ErrorBanner(props: Props) {
  if (props.kind === "none") return null;
  const text =
    props.kind === "conflict"
      ? `These words are already used: ${props.conflicts.join(", ")}.`
      : props.message;
  return (
    <div role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
      {text}
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm pass**

Run:
```bash
cd web && npm test
cd ..
```

Expected: 9 passed (sidebar + inputs + banner).

- [ ] **Step 5: Commit**

```bash
git add web/components/ErrorBanner.tsx web/__tests__/errorBanner.test.tsx
git commit -m "feat(web): ErrorBanner for conflict and server errors"
```

---

### Task 16: Typed API client (`app/api.ts`)

**Files:**
- Create: `web/app/api.ts`

- [ ] **Step 1: Create the client**

```typescript
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Item = { word: string; sentence: string };

export type GenerateResult =
  | { ok: true; imageUrl: string }
  | { ok: false; kind: "conflict"; conflicts: string[] }
  | { ok: false; kind: "error"; message: string };

export async function fetchUsedWords(): Promise<string[]> {
  const r = await fetch(`${API}/api/used-words`);
  if (!r.ok) throw new Error(`used-words ${r.status}`);
  const j = (await r.json()) as { words: string[] };
  return j.words;
}

export async function generate(items: Item[]): Promise<GenerateResult> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  } catch {
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
```

- [ ] **Step 2: Commit**

```bash
git add web/app/api.ts
git commit -m "feat(web): typed API client"
```

---

### Task 17: Wire `app/page.tsx` and add print CSS

**Files:**
- Modify: `web/app/page.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/app/layout.tsx` (if needed for metadata)

- [ ] **Step 1: Replace `web/app/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { InputRows, emptyItems, type Item } from "../components/InputRows";
import { UsedWordsSidebar } from "../components/UsedWordsSidebar";
import { fetchUsedWords, generate, type GenerateResult } from "./api";

type Banner =
  | { kind: "none" }
  | { kind: "conflict"; conflicts: string[] }
  | { kind: "error"; message: string };

export default function Page() {
  const [items, setItems] = useState<Item[]>(emptyItems());
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [usedWords, setUsedWords] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "generating">("idle");
  const [banner, setBanner] = useState<Banner>({ kind: "none" });

  useEffect(() => {
    fetchUsedWords().then(setUsedWords).catch(() => {
      setBanner({ kind: "error", message: "Could not load used words." });
    });
  }, []);

  const canGenerate =
    status === "idle" && items.every((it) => it.word.trim() && it.sentence.trim());

  async function handleGenerate() {
    setStatus("generating");
    setBanner({ kind: "none" });
    const result: GenerateResult = await generate(items);
    setStatus("idle");
    if (result.ok) {
      setImageUrl(result.imageUrl);
      try { setUsedWords(await fetchUsedWords()); } catch { /* keep stale */ }
    } else if (result.kind === "conflict") {
      setBanner({ kind: "conflict", conflicts: result.conflicts });
    } else {
      setBanner({ kind: "error", message: result.message });
    }
  }

  const conflictWords = banner.kind === "conflict" ? banner.conflicts : [];

  return (
    <div className="flex min-h-screen">
      <main className="flex-1 p-6 space-y-4 main-pane">
        <h1 className="text-xl font-semibold">Flash Card Generator</h1>
        <InputRows items={items} onChange={setItems} conflicts={conflictWords} />
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {status === "generating" ? "Generating..." : "Generate"}
          </button>
          {imageUrl && (
            <button
              onClick={() => window.print()}
              className="rounded border px-4 py-2"
            >
              Print
            </button>
          )}
        </div>
        <ErrorBanner {...bannerToProps(banner)} />
        {imageUrl && (
          <img
            src={imageUrl}
            alt="generated worksheet"
            className="print-target max-w-full rounded border"
            data-testid="preview"
          />
        )}
      </main>
      <UsedWordsSidebar words={usedWords} />
    </div>
  );
}

function bannerToProps(b: Banner) {
  if (b.kind === "none") return { kind: "none" as const };
  if (b.kind === "conflict") return { kind: "conflict" as const, conflicts: b.conflicts };
  return { kind: "error" as const, message: b.message };
}
```

- [ ] **Step 2: Append print CSS to `web/app/globals.css`**

```css
@media print {
  body * {
    visibility: hidden;
  }
  .print-target, .print-target * {
    visibility: visible;
  }
  .print-target {
    position: absolute;
    inset: 0;
    width: 100%;
    height: auto;
  }
}
```

- [ ] **Step 3: Run Vitest to confirm components still pass**

Run:
```bash
cd web && npm test
cd ..
```

Expected: all component tests still green.

- [ ] **Step 4: Manual smoke test**

Terminal 1:
```bash
uv run uvicorn server.main:app --reload --port 8000
```

Terminal 2:
```bash
cd web && npm run dev
```

Visit `http://localhost:3000`. Fill 6 fresh words. Click Generate. Confirm preview appears, sidebar grows by 6, Print opens browser print dialog showing only the image.

- [ ] **Step 5: Commit**

```bash
git add web/app/page.tsx web/app/globals.css
git commit -m "feat(web): wire page with generate/print/preview + print css"
```

---

## Phase 5 — End-to-end

### Task 18: Playwright happy-path E2E using stub mode

**Files:**
- Create: `web/e2e/generate.spec.ts`
- Modify: `web/playwright.config.ts` (start the backend with stub env var)

- [ ] **Step 1: Update `web/playwright.config.ts` to launch both servers**

Replace the file:

```typescript
import { defineConfig } from "@playwright/test";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const stubImage = path.join(repoRoot, "tests/fixtures/stub.png");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: [
    {
      command: `uv run uvicorn server.main:app --port 8000`,
      cwd: repoRoot,
      url: "http://localhost:8000/api/used-words",
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FLASHCARD_STUB_IMAGE: stubImage },
    },
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
```

- [ ] **Step 2: Add an isolated `used_words.json` for the E2E**

To avoid permanently polluting the real `used_words.json`, the E2E should run against a copy. Add a Playwright global setup. Create `web/e2e/global-setup.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";

export default async function globalSetup() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const live = path.join(repoRoot, "used_words.json");
  const backup = path.join(repoRoot, "used_words.json.e2e-backup");
  fs.copyFileSync(live, backup);
  // Reset to a tiny fixture for predictability
  fs.writeFileSync(live, JSON.stringify(["alpha", "beta"]) + "\n");
  return async () => {
    fs.copyFileSync(backup, live);
    fs.unlinkSync(backup);
  };
}
```

Add `globalSetup: "./e2e/global-setup.ts"` to the Playwright config (inside `defineConfig({ ... })`).

- [ ] **Step 3: Write the happy-path E2E**

Create `web/e2e/generate.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

const ROWS = [
  { word: "carrot", sentence: "A rabbit eats a carrot." },
  { word: "tomato", sentence: "The tomato is red." },
  { word: "grapes", sentence: "I share my grapes." },
  { word: "potato", sentence: "We bake a potato." },
  { word: "broccoli", sentence: "I dip broccoli." },
  { word: "kiwi", sentence: "A kiwi is green." },
];

test("generate happy path", async ({ page }) => {
  // Install the print spy BEFORE the page loads so it survives navigation.
  await page.addInitScript(() => {
    (window as unknown as { __printCalled: boolean }).__printCalled = false;
    window.print = () => {
      (window as unknown as { __printCalled: boolean }).__printCalled = true;
    };
  });

  await page.goto("/");

  await expect(page.getByText("Used Words (2)")).toBeVisible();

  const wordInputs = page.getByPlaceholder("word");
  const sentInputs = page.getByPlaceholder("sentence");
  for (let i = 0; i < 6; i++) {
    await wordInputs.nth(i).fill(ROWS[i].word);
    await sentInputs.nth(i).fill(ROWS[i].sentence);
  }

  await page.getByRole("button", { name: "Generate" }).click();

  const preview = page.getByTestId("preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /\/generated\/image-carrot\.png$/);
  await expect(page.getByText("Used Words (8)")).toBeVisible();

  await page.getByRole("button", { name: "Print" }).click();
  const printed = await page.evaluate(
    () => (window as unknown as { __printCalled: boolean }).__printCalled,
  );
  expect(printed).toBe(true);
});
```

- [ ] **Step 4: Run the E2E**

Run:
```bash
cd web && npm run e2e
cd ..
```

Expected: 1 passed. Test takes ~10–20s (server startup + page load + stub generate).

- [ ] **Step 5: Confirm `used_words.json` was restored**

Run:
```bash
python3 -c "import json; print(len(json.load(open('used_words.json'))))"
```

Expected: matches the pre-test count (the original ~230).

- [ ] **Step 6: Commit**

```bash
git add web/e2e/generate.spec.ts web/e2e/global-setup.ts web/playwright.config.ts
git commit -m "test(web): playwright happy-path E2E using stub image"
```

---

## Final sanity sweep

- [ ] **Run the whole backend suite**

```bash
uv run pytest -v
```

Expected: all backend tests green.

- [ ] **Run the whole frontend Vitest suite**

```bash
cd web && npm test && cd ..
```

Expected: all component tests green.

- [ ] **Run the E2E one more time**

```bash
cd web && npm run e2e && cd ..
```

Expected: 1 passed.

- [ ] **Verify the CLI still works end-to-end (uses real OpenAI; only run if you intend to spend an API credit)**

```bash
uv run python generate_flash_cards.py
```

Expected: prints `Saved to server/generated/image-<word>.png`. (Will fail with `ConflictError` if the current `ITEMS` words are already used — pick fresh words first.)
