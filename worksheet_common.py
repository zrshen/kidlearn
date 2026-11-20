"""Shared, worksheet-type-agnostic helpers. No FastAPI/CLI imports."""
from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Callable, Literal

from openai import OpenAI

TEXT_MODEL = "gpt-6.2-sol"
IMAGE_MODEL = "gpt-image-2.6-sunburst"

Quality = Literal["low", "medium", "high"]

GENERATED_DIR: Path = Path(__file__).parent / "server" / "generated"


def produce_png_bytes(
    prompt: str,
    quality: Quality,
    stub_env: str,
    client_factory: Callable[[], OpenAI],
) -> bytes:
    """Render one worksheet PNG, or return the bytes of the file named by `stub_env`."""
    stub = os.environ.get(stub_env)
    if stub:
        return Path(stub).read_bytes()
    result = client_factory().images.generate(
        model=IMAGE_MODEL,
        prompt=prompt,
        size="1536x1024",
        quality=quality,
        output_format="png",
        n=1,
    )
    assert result.data and result.data[0].b64_json, "image generation returned no data"
    return base64.b64decode(result.data[0].b64_json)
