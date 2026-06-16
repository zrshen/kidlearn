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
    key = (test or DEFAULT_PROFILE).strip().lower()
    if key in PROFILES:
        return {"id": key, **PROFILES[key]}
    name = (test or "").strip()
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
