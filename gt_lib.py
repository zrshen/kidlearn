"""GT (gifted-and-talented) thinking worksheet generator. No FastAPI/CLI imports."""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

from openai import OpenAI

from worksheet_common import GENERATED_DIR, Quality, produce_png_bytes

GT_TITLE = "Kindergarten GT Thinking Practice"

GENERAL_CATALOG: dict[str, str] = {
    "odd_one_out": "Show several pictures; one does not belong. Child picks the odd one and tells why.",
    "pattern": "Show a repeating sequence ending in a blank; child picks what comes next from A/B/C.",
    "analogy": "X is to Y as Z is to ___; child picks the matching item from A/B/C.",
    "sequence": "Show stage pictures out of order; child puts them in the correct 1-4 order.",
    "compare": "Compare one property (taller, bigger, heavier) across pictures; single A/B/C answer.",
    "matrix": "2x2 grid with one blank cell; child picks the shape/color that completes it from A/B/C.",
    "classification": "Show items; child picks which one belongs to (or is outside) a named category.",
    "counting": "Show a small group of objects; child picks the correct count from A/B/C.",
    "spatial": "Ask about position (above/below/next to); child picks the correct A/B/C answer.",
    "same_different": "Show pairs; child picks which two are the same (or which one is different).",
}

COGAT_CATALOG: dict[str, str] = {
    "picture_analogies": "Verbal: top picture pair shows a relationship; child completes the bottom pair from A/B/C.",
    "picture_classification": "Verbal: three pictures share a trait; child picks the one that belongs from A/B/C.",
    "sentence_completion": "Verbal: a short spoken-style clue; child picks the matching picture from A/B/C.",
    "number_analogies": "Quantitative: top number/quantity pair shows a rule; child completes the bottom pair from A/B/C.",
    "number_series": "Quantitative: a short quantity series with a blank; child picks what comes next from A/B/C.",
    "number_puzzles": "Quantitative: a simple balance/equation; child picks the missing quantity from A/B/C.",
    "figure_matrices": "Nonverbal: 2x2 figure matrix with one blank; child picks the completing figure from A/B/C.",
    "figure_classification": "Nonverbal: three figures share a trait; child picks the figure that belongs from A/B/C.",
    "paper_folding": "Nonverbal: a folded, hole-punched paper; child picks how it looks unfolded from A/B/C.",
}

NNAT_CATALOG: dict[str, str] = {
    "pattern_completion": "A picture with a missing piece; child picks the piece that completes it from A/B/C.",
    "reasoning_by_analogy": "Figures change by a rule across a 2x2 grid; child picks the figure that fits from A/B/C.",
    "serial_reasoning": "A row/grid of figures changing in sequence; child picks what comes next from A/B/C.",
    "spatial_visualization": "How two shapes combine or rotate; child picks the result from A/B/C.",
}

OLSAT_CATALOG: dict[str, str] = {
    "following_directions": "Read a short direction; child picks the picture that matches it from A/B/C.",
    "picture_classification": "Pictures share a trait; child picks the one that belongs from A/B/C.",
    "picture_analogies": "Top picture pair shows a relationship; child completes the bottom pair from A/B/C.",
    "picture_series": "A series of pictures with a blank; child picks what comes next from A/B/C.",
    "aural_reasoning": "A short spoken-style riddle; child picks the matching picture from A/B/C.",
    "arithmetic_reasoning": "A simple counting/quantity word problem; child picks the answer from A/B/C.",
}

PROFILES: dict[str, dict] = {
    "general": {
        "label": "General GT",
        "title": GT_TITLE,
        "catalog": GENERAL_CATALOG,
        "framing": "an open Kindergarten gifted-and-talented thinking worksheet",
    },
    "cogat": {
        "label": "CogAT",
        "title": "Kindergarten CogAT Practice",
        "catalog": COGAT_CATALOG,
        "framing": "in the style of the CogAT (Cognitive Abilities Test), spanning verbal, quantitative, and nonverbal reasoning",
    },
    "nnat": {
        "label": "NNAT",
        "title": "Kindergarten NNAT Practice",
        "catalog": NNAT_CATALOG,
        "framing": "in the style of the NNAT (Naglieri Nonverbal Ability Test) — picture/figure based, no reading required",
    },
    "olsat": {
        "label": "OLSAT",
        "title": "Kindergarten OLSAT Practice",
        "catalog": OLSAT_CATALOG,
        "framing": "in the style of the OLSAT (Otis-Lennon School Ability Test), verbal and nonverbal reasoning",
    },
}

DEFAULT_PROFILE = "general"


def _openai_client() -> OpenAI:
    return OpenAI()


def resolve_profile(test: str | None) -> dict:
    name = (test or "").strip()
    key = name.lower() or DEFAULT_PROFILE
    if key in PROFILES:
        return {"id": key, **PROFILES[key]}
    return {
        "id": "custom",
        "label": name,
        "title": f"Kindergarten {name} Practice",
        "catalog": GENERAL_CATALOG,
        "framing": f'in the style of the "{name}" test — use that test\'s characteristic question subtypes',
    }


def validate_spec(spec: dict) -> dict:
    panels = spec.get("panels")
    if not isinstance(panels, list) or len(panels) != 6:
        got = len(panels) if isinstance(panels, list) else "none"
        raise ValueError(f"expected 6 panels, got {got}")
    for i, p in enumerate(panels, start=1):
        for field in ("type", "heading", "question", "answer"):
            if not str(p.get(field, "")).strip():
                raise ValueError(f"panel {i}: missing {field}")
    return spec


SUGGEST_MODEL = "gpt-5.5"
SUGGEST_REASONING_EFFORT = "low"
SUGGEST_MAX_RETRIES = 3


class SuggestionError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _build_suggest_messages(topic: str | None, profile: dict) -> list[dict]:
    catalog_lines = "\n".join(f"- {k}: {v}" for k, v in profile["catalog"].items())
    theme_rule = (
        f'Theme every panel around: "{topic}".'
        if topic and topic.strip()
        else "Pick ONE cohesive kid-friendly theme (animals, food, shapes, weather) for all panels."
    )
    system = (
        "You design Kindergarten gifted-and-talented thinking worksheets. "
        "Respond with JSON only."
    )
    user = f"""Design ONE Kindergarten worksheet, {profile['framing']}, with EXACTLY 6 panels.

Choose 6 DISTINCT panel types. Prefer these subtypes for this test (use the keys verbatim
when they apply; for a custom test you may use that test's own subtype names):
{catalog_lines}

{theme_rule}

For each panel provide:
- type: a short subtype key (snake_case)
- heading: short title (e.g. "Picture Analogies")
- question: the question a child reads
- items: list of picture words to draw (or [] if none)
- choices: list like ["A = red circle", "B = blue square"] (or [] if none)
- instruction: short bottom instruction
- answer: the correct answer stated clearly (e.g. "B (doghouse)")
- explanation: short reason (or "" if none)

Rules:
- Everything must be K-level, age-appropriate, and visual.
- The answer MUST be correct and consistent with the question.
- Return JSON exactly: {{"title": "...", "theme": "...", "panels": [ ...6 panels... ]}}
"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _finalize_spec(spec: dict, profile: dict) -> dict:
    validate_spec(spec)
    spec["title"] = profile["title"]
    spec["test"] = profile["label"]
    return spec


def suggest_gt_spec(topic: str | None, test: str | None = None) -> dict:
    profile = resolve_profile(test)
    stub = os.environ.get("GT_STUB_SPEC")
    if stub:
        return _finalize_spec(json.loads(Path(stub).read_text()), profile)
    messages = _build_suggest_messages(topic, profile)
    last_reason = "no attempts made"
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
            return _finalize_spec(json.loads(content), profile)
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            last_reason = f"could not parse model response: {e}"
            continue
    raise SuggestionError(last_reason)


_PAGE_FORMAT = """PAGE FORMAT:
- Landscape worksheet. White background.
- Bright, cheerful, colorful classroom worksheet style with large, easy-to-read text.
- Clean 3-column x 2-row grid layout. Exactly 6 panels.
- Rounded panel boxes with thin colorful borders, each clearly numbered 1 through 6.
- Cute kid-friendly cartoon illustrations. Clean, uncluttered spacing.
- No watermark, no logo, no extra panels."""


def _panel_block(p: dict, *, reveal: bool) -> str:
    lines = [
        f"Panel: {p['heading']} (type: {p['type']})",
        f"Question: {p['question']}",
    ]
    if p.get("items"):
        lines.append("Pictures: " + ", ".join(p["items"]))
    if p.get("choices"):
        lines.append("Choices: " + "; ".join(p["choices"]))
    if str(p.get("instruction", "")).strip():
        lines.append(f"Instruction: {p['instruction']}")
    if reveal:
        lines.append(f"ANSWER: {p['answer']}")
        if str(p.get("explanation", "")).strip():
            lines.append(f"Explanation: {p['explanation']}")
    return "\n".join(lines)


def render_front_prompt(spec: dict) -> str:
    title = spec.get("title", GT_TITLE)
    panels = "\n\n".join(_panel_block(p, reveal=False) for p in spec["panels"])
    return f"""Create ONE educational worksheet image for a Kindergarten student.

TITLE: "{title}"

OUTPUT: FRONT side only. Do NOT include answers. One image only.

{_PAGE_FORMAT}

USE EXACTLY THIS CONTENT:

{panels}

BOTTOM BANNER: "Think carefully and choose the best answer!"

IMPORTANT:
- FRONT side only. No answers visible. Do not circle any answer. Do not reveal the solution.
- Keep all text spelled correctly. Make it printable and classroom-friendly."""


def render_back_prompt(spec: dict) -> str:
    title = spec.get("title", GT_TITLE)
    panels = "\n\n".join(_panel_block(p, reveal=True) for p in spec["panels"])
    return f"""Create ONE educational worksheet image for a Kindergarten student.

TITLE: "{title}"

OUTPUT: BACK side only (answer key). One image only. Match the front worksheet's layout.
Clearly mark this as the answer page with the words "Back (Answers)".

{_PAGE_FORMAT}

USE EXACTLY THIS CONTENT:

{panels}

BACK-SIDE RULES:
- Show the same question content and images as the front page.
- Reveal the correct answer clearly; circle or highlight the correct choice.
- Add a short answer label in each panel. Keep the layout aligned with the front.

BOTTOM BANNER: "Great job! Keep thinking and learning!"

IMPORTANT:
- BACK side only. Keep all text spelled correctly. Make the answer key visually clear and classroom-friendly."""


def _slug(theme: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (theme or "gt").lower()).strip("-")
    return s or "gt"


def _new_id(theme: str) -> str:
    return f"{_slug(theme)}-{int(time.time() * 1000)}"


def generate_gt_pair(spec: dict, quality: Quality = "medium") -> dict:
    validate_spec(spec)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    theme = str(spec.get("theme", ""))
    gid = _new_id(theme)
    front_path = GENERATED_DIR / f"gt-{gid}-front.png"
    back_path = GENERATED_DIR / f"gt-{gid}-back.png"
    manifest_path = GENERATED_DIR / f"gt-{gid}.json"

    front_bytes = produce_png_bytes(render_front_prompt(spec), quality, "GT_STUB_IMAGE", _openai_client)
    front_path.write_bytes(front_bytes)
    try:
        back_bytes = produce_png_bytes(render_back_prompt(spec), quality, "GT_STUB_IMAGE", _openai_client)
    except Exception:
        front_path.unlink(missing_ok=True)
        raise
    back_path.write_bytes(back_bytes)

    manifest = {
        "kind": "gt",
        "id": gid,
        "theme": theme,
        "test": str(spec.get("test", "")),
        "spec": spec,
        "front": front_path.name,
        "back": back_path.name,
    }
    manifest_path.write_text(json.dumps(manifest) + "\n")
    return {"id": gid, "front_url": f"/generated/{front_path.name}", "back_url": f"/generated/{back_path.name}"}
