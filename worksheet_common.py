"""Shared, worksheet-type-agnostic helpers. No FastAPI/CLI imports."""
from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Callable, Literal

from openai import OpenAI

Quality = Literal["low", "medium", "high"]

GENERATED_DIR: Path = Path(__file__).parent / "server" / "generated"


def produce_png_bytes(
    prompt: str,
    quality: Quality,
    stub_env: str,
    client_factory: Callable[[], OpenAI],
) -> bytes:
    """Render one gpt-image-2 image, or return the bytes of the file named by `stub_env`."""
    stub = os.environ.get(stub_env)
    if stub:
        return Path(stub).read_bytes()
    result = client_factory().images.generate(
        model="gpt-image-2",
        prompt=prompt,
        size="1536x1024",
        quality=quality,
        n=1,
    )
    assert result.data and result.data[0].b64_json, "image generation returned no data"
    return base64.b64decode(result.data[0].b64_json)
