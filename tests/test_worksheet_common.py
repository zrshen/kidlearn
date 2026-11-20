import base64
from unittest.mock import MagicMock

import pytest

from worksheet_common import produce_png_bytes


@pytest.mark.parametrize("quality", ["low", "medium", "high"])
def test_sunburst_render_preserves_png_size_and_quality(quality, monkeypatch):
    monkeypatch.delenv("TEST_WORKSHEET_STUB", raising=False)
    png = b"\x89PNG\r\n\x1a\nrendered worksheet"
    client = MagicMock()
    client.images.generate.return_value = MagicMock(data=[MagicMock(b64_json=base64.b64encode(png).decode())])
    assert produce_png_bytes("worksheet prompt", quality, "TEST_WORKSHEET_STUB", lambda: client) == png
    kwargs = client.images.generate.call_args.kwargs
    assert kwargs["model"] == "gpt-image-2.6-sunburst"
    assert kwargs["size"] == "1536x1024"
    assert kwargs["quality"] == quality
    assert kwargs["output_format"] == "png"
    assert kwargs["n"] == 1


def test_image_stub_does_not_create_api_client(tmp_path, monkeypatch):
    stub = tmp_path / "stub.png"
    stub.write_bytes(b"stub image")
    monkeypatch.setenv("TEST_WORKSHEET_STUB", str(stub))
    factory = MagicMock(side_effect=AssertionError("No API calls in stub mode"))
    assert produce_png_bytes("prompt", "medium", "TEST_WORKSHEET_STUB", factory) == b"stub image"
