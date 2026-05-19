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


from flashcard_lib import SuggestionError


SUGGEST_ITEMS = [
    {"word": "tiger",   "sentence": "A tiger roars loud."},
    {"word": "zebra",   "sentence": "Zebras have stripes."},
    {"word": "giraffe", "sentence": "A giraffe is tall."},
    {"word": "fox",     "sentence": "The fox runs fast."},
    {"word": "panda",   "sentence": "A panda eats bamboo."},
    {"word": "owl",     "sentence": "An owl hoots at night."},
]


def test_suggest_200_with_topic(client):
    with patch("server.main.flashcard_lib.suggest_items", return_value=SUGGEST_ITEMS) as m:
        r = client.post("/api/suggest", json={"topic": "animals"})
    assert r.status_code == 200
    assert r.json() == {"items": SUGGEST_ITEMS}
    # Verify the lib was called with the topic
    args, kwargs = m.call_args
    assert kwargs.get("topic") == "animals" or (len(args) >= 2 and args[1] == "animals")


def test_suggest_200_with_null_topic(client):
    with patch("server.main.flashcard_lib.suggest_items", return_value=SUGGEST_ITEMS):
        r = client.post("/api/suggest", json={"topic": None})
    assert r.status_code == 200
    assert r.json() == {"items": SUGGEST_ITEMS}


def test_suggest_200_with_missing_topic(client):
    with patch("server.main.flashcard_lib.suggest_items", return_value=SUGGEST_ITEMS):
        r = client.post("/api/suggest", json={})
    assert r.status_code == 200


def test_suggest_422_on_oversize_topic(client):
    r = client.post("/api/suggest", json={"topic": "a" * 101})
    assert r.status_code == 422


def test_suggest_502_on_SuggestionError(client):
    with patch(
        "server.main.flashcard_lib.suggest_items",
        side_effect=SuggestionError("model gave junk"),
    ):
        r = client.post("/api/suggest", json={"topic": "animals"})
    assert r.status_code == 502
    assert r.json() == {"error": "Couldn't generate suggestions: model gave junk"}


from flashcard_lib import PartialBatchError


BATCH_LIB_RESULT = [
    {"image_url_path": "/generated/image-tiger.png", "words": ["tiger", "zebra", "fox", "panda", "owl", "giraffe"]},
    {"image_url_path": "/generated/image-carrot.png", "words": ["carrot", "tomato", "grapes", "potato", "broccoli", "kiwi"]},
]


def test_batch_200_returns_translated_keys(client):
    with patch("server.main.flashcard_lib.batch_generate", return_value=BATCH_LIB_RESULT):
        r = client.post("/api/batch", json={"topic": "animals", "n": 2})
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "batches": [
            {"image_url": "/generated/image-tiger.png", "words": BATCH_LIB_RESULT[0]["words"]},
            {"image_url": "/generated/image-carrot.png", "words": BATCH_LIB_RESULT[1]["words"]},
        ]
    }


def test_batch_422_when_n_too_small(client):
    r = client.post("/api/batch", json={"topic": None, "n": 0})
    assert r.status_code == 422


def test_batch_422_when_n_too_large(client):
    r = client.post("/api/batch", json={"topic": None, "n": 11})
    assert r.status_code == 422


def test_batch_502_on_partial_failure_returns_completed(client):
    err = PartialBatchError(
        completed=[BATCH_LIB_RESULT[0]],
        reason="Batch 2 of 2 failed: model gave junk",
    )
    with patch("server.main.flashcard_lib.batch_generate", side_effect=err):
        r = client.post("/api/batch", json={"topic": "animals", "n": 2})
    assert r.status_code == 502
    assert r.json() == {
        "error": "Batch 2 of 2 failed: model gave junk",
        "completed": [
            {"image_url": "/generated/image-tiger.png", "words": BATCH_LIB_RESULT[0]["words"]},
        ],
    }
