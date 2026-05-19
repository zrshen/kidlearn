"""Pure helpers and (later) the OpenAI-backed generator. No FastAPI/CLI imports."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Literal, TypedDict

Quality = Literal["low", "medium", "high"]


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


import base64
import fcntl
import os
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
    if not USED_WORDS_PATH.exists():
        USED_WORDS_PATH.write_text("[]\n")
    with open(USED_WORDS_PATH, "r+") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def _produce_png_bytes(items: list[WordSentence], quality: Quality = "medium") -> bytes:
    stub = os.environ.get("FLASHCARD_STUB_IMAGE")
    if stub:
        return Path(stub).read_bytes()
    result = _openai_client().images.generate(
        model="gpt-image-2",
        prompt=_render_prompt(items),
        size="1536x1024",
        quality=quality,
        n=1,
    )
    assert result.data and result.data[0].b64_json, "image generation returned no data"
    return base64.b64decode(result.data[0].b64_json)


def generate_and_record(items: list[WordSentence], quality: Quality = "medium") -> Path:
    if len(items) != 6:
        raise ValueError(f"expected 6 items, got {len(items)}")
    items = [{**i, "word": i["word"].strip().lower()} for i in items]
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    new_words = [i["word"] for i in items]
    with _used_words_lock():
        used = load_used_words()
        conflicts = find_conflicts(new_words, used)
        if conflicts:
            raise ConflictError(conflicts)
        png_bytes = _produce_png_bytes(items, quality=quality)
        out_path = GENERATED_DIR / f"image-{items[0]['word']}.png"
        out_path.write_bytes(png_bytes)
        save_used_words(used | set(new_words))
    return out_path


SUGGEST_MODEL = "gpt-5.4"
SUGGEST_REASONING_EFFORT = "low"
SUGGEST_MAX_RETRIES = 3


class SuggestionError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _build_suggest_messages(used: set[str], topic: str | None) -> list[dict]:
    sorted_used = sorted(used)
    topic_rule = (
        f'- All 6 words must belong to the same topic: "{topic}". '
        "Every word should clearly fit this topic — do not mix in unrelated words."
        if topic and topic.strip()
        else "- Pick a single coherent topic (e.g. animals, food, transportation, weather) "
        "and choose all 6 words from that one topic. Do not mix multiple topics."
    )
    used_block = ", ".join(sorted_used) if sorted_used else "(none yet)"
    system = (
        "You pick vocabulary words and example sentences for Kindergarten "
        "flashcard worksheets. Respond with JSON only."
    )
    user = f"""Pick 6 vocabulary words and short example sentences for a Kindergarten flashcard worksheet.

Rules:
- Pick 6 distinct, age-appropriate (K-level) single words.
- Each sentence: short (4-8 words), uses the word exactly once.
- Lowercase the words.
- Capitalize the first letter of each sentence and end with a period.
{topic_rule}
- Do NOT pick any of these already-used words: {used_block}.

Return JSON in this exact shape:
{{"items": [{{"word": "...", "sentence": "..."}}, ...]}}
"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _parse_suggest_response(content: str) -> list[WordSentence]:
    data = json.loads(content)
    raw = data["items"]
    if len(raw) != 6:
        raise ValueError(f"expected 6 items, got {len(raw)}")
    items: list[WordSentence] = []
    for entry in raw:
        word = str(entry["word"]).strip().lower()
        sentence = str(entry["sentence"]).strip()
        if not word or not sentence:
            raise ValueError("empty word or sentence in response")
        sentence = sentence[0].upper() + sentence[1:]
        items.append({"word": word, "sentence": sentence})
    return items


def suggest_items(used: set[str], topic: str | None) -> list[WordSentence]:
    stub = os.environ.get("FLASHCARD_STUB_SUGGEST")
    if stub:
        return _parse_suggest_response(Path(stub).read_text())
    used_lower = {w.lower() for w in used}
    messages = _build_suggest_messages(used, topic)
    last_reason = "no attempts made"
    last_content: str | None = None
    for _ in range(SUGGEST_MAX_RETRIES + 1):
        try:
            resp = _openai_client().chat.completions.create(
                model=SUGGEST_MODEL,
                messages=messages,
                response_format={"type": "json_object"},
                reasoning_effort=SUGGEST_REASONING_EFFORT,
            )
            content = resp.choices[0].message.content
            if not content:
                last_reason = "empty response from model"
                continue
            last_content = content
            items = _parse_suggest_response(content)
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            last_reason = f"could not parse model response: {e}"
            continue
        conflicts = sorted({it["word"] for it in items if it["word"] in used_lower})
        if conflicts:
            last_reason = f"model returned already-used words: {conflicts}"
            messages = messages + [
                {"role": "assistant", "content": last_content or ""},
                {
                    "role": "user",
                    "content": (
                        f"These words are already used and must NOT appear: {conflicts}. "
                        "Replace every one of them with a different K-level word that is NOT in the already-used list. "
                        "Return the full 6-item JSON again in the same shape."
                    ),
                },
            ]
            continue
        return items
    raise SuggestionError(last_reason)


class BatchEntry(TypedDict):
    image_url_path: str
    words: list[str]


class PartialBatchError(Exception):
    def __init__(self, completed: list[BatchEntry], reason: str) -> None:
        super().__init__(reason)
        self.completed = completed
        self.reason = reason


def batch_generate(n: int, topic: str | None, quality: Quality = "medium") -> list[BatchEntry]:
    if n < 1:
        raise ValueError(f"n must be >= 1, got {n}")
    completed: list[BatchEntry] = []
    for i in range(n):
        used = load_used_words()
        try:
            items = suggest_items(used, topic)
            out_path = generate_and_record(items, quality=quality)
        except Exception as e:
            raise PartialBatchError(
                completed=completed,
                reason=f"Batch {i + 1} of {n} failed: {e}",
            )
        completed.append(
            {
                "image_url_path": f"/generated/{out_path.name}",
                "words": [it["word"] for it in items],
            }
        )
    return completed
