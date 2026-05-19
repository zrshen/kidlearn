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


def test_generate_and_record_creates_used_words_file_if_missing(tmp_path, monkeypatch):
    used = tmp_path / "used_words.json"  # does NOT exist yet
    gen = tmp_path / "generated"
    gen.mkdir()
    monkeypatch.setattr(flashcard_lib, "USED_WORDS_PATH", used)
    monkeypatch.setattr(flashcard_lib, "GENERATED_DIR", gen)
    fixture = Path("tests/fixtures/stub.png").resolve()
    monkeypatch.setenv("FLASHCARD_STUB_IMAGE", str(fixture))

    path = flashcard_lib.generate_and_record(SIX_ITEMS)

    assert path.exists()
    assert json.loads(used.read_text()) == sorted(i["word"] for i in SIX_ITEMS)


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


def test_generate_and_record_normalizes_case_and_whitespace(isolated_lib, monkeypatch):
    used, gen = isolated_lib
    fixture = Path("tests/fixtures/stub.png").resolve()
    monkeypatch.setenv("FLASHCARD_STUB_IMAGE", str(fixture))

    # mixed case + leading/trailing spaces; one collides with the seeded "apple"
    items = [
        {"word": "  APPLE ", "sentence": "Apples are red."},
        {"word": "Banana", "sentence": "I peel a Banana."},
        {"word": "Cherry", "sentence": "Cherries are tart."},
        {"word": "DATE",   "sentence": "Dates are sweet."},
        {"word": " elderberry", "sentence": "Elderberries grow wild."},
        {"word": "fig",    "sentence": "Figs are soft."},
    ]
    with pytest.raises(flashcard_lib.ConflictError) as exc:
        flashcard_lib.generate_and_record(items)
    assert exc.value.conflicts == ["apple"]


def test_generate_and_record_lowercases_words_in_storage(isolated_lib, monkeypatch):
    used, gen = isolated_lib
    fixture = Path("tests/fixtures/stub.png").resolve()
    monkeypatch.setenv("FLASHCARD_STUB_IMAGE", str(fixture))

    items = [
        {"word": "Carrot",   "sentence": "A rabbit eats a carrot."},
        {"word": "TOMATO",   "sentence": "Red tomato."},
        {"word": "Grapes",   "sentence": "Sweet grapes."},
        {"word": "potato",   "sentence": "Bake potato."},
        {"word": "Broccoli", "sentence": "Dip broccoli."},
        {"word": "KIWI",     "sentence": "Green kiwi."},
    ]
    path = flashcard_lib.generate_and_record(items)
    assert path.name == "image-carrot.png"
    saved = sorted(json.loads(used.read_text()))
    assert "Carrot" not in saved and "carrot" in saved
    assert "TOMATO" not in saved and "tomato" in saved


SUGGEST_RAW_OK = json.dumps({
    "items": [
        {"word": "tiger",   "sentence": "A tiger roars loud."},
        {"word": "zebra",   "sentence": "Zebras have stripes."},
        {"word": "giraffe", "sentence": "A giraffe is tall."},
        {"word": "fox",     "sentence": "The fox runs fast."},
        {"word": "panda",   "sentence": "A panda eats bamboo."},
        {"word": "owl",     "sentence": "An owl hoots at night."},
    ]
})


def _stub_chat_response(content: str) -> MagicMock:
    """Build a mock OpenAI client whose chat.completions.create() returns `content`."""
    m = MagicMock()
    m.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content=content))]
    )
    return m


def test_suggest_items_happy_path_returns_6_items():
    used = {"apple", "banana"}
    client = _stub_chat_response(SUGGEST_RAW_OK)
    with patch.object(flashcard_lib, "_openai_client", lambda: client):
        items = flashcard_lib.suggest_items(used, topic=None)
    assert len(items) == 6
    assert items[0] == {"word": "tiger", "sentence": "A tiger roars loud."}
    # All words present and lowercase
    assert [it["word"] for it in items] == ["tiger", "zebra", "giraffe", "fox", "panda", "owl"]


def test_suggest_items_passes_topic_into_prompt():
    used = set()
    client = _stub_chat_response(SUGGEST_RAW_OK)
    with patch.object(flashcard_lib, "_openai_client", lambda: client):
        flashcard_lib.suggest_items(used, topic="animals")
    call = client.chat.completions.create.call_args
    full_prompt = "\n".join(m["content"] for m in call.kwargs["messages"])
    assert "animals" in full_prompt


def test_suggest_items_passes_used_words_into_prompt():
    used = {"apple", "banana"}
    client = _stub_chat_response(SUGGEST_RAW_OK)
    with patch.object(flashcard_lib, "_openai_client", lambda: client):
        flashcard_lib.suggest_items(used, topic=None)
    call = client.chat.completions.create.call_args
    full_prompt = "\n".join(m["content"] for m in call.kwargs["messages"])
    assert "apple" in full_prompt and "banana" in full_prompt


def _suggest_raw_with(words: list[str]) -> str:
    items = [{"word": w, "sentence": f"This is a {w}."} for w in words]
    return json.dumps({"items": items})


def test_suggest_items_retries_when_response_conflicts_then_succeeds():
    used = {"apple"}
    bad = _suggest_raw_with(["apple", "tiger", "zebra", "fox", "owl", "panda"])
    good = SUGGEST_RAW_OK
    client = MagicMock()
    client.chat.completions.create.side_effect = [
        MagicMock(choices=[MagicMock(message=MagicMock(content=bad))]),
        MagicMock(choices=[MagicMock(message=MagicMock(content=good))]),
    ]
    with patch.object(flashcard_lib, "_openai_client", lambda: client):
        items = flashcard_lib.suggest_items(used, topic=None)
    assert client.chat.completions.create.call_count == 2
    assert [it["word"] for it in items] == ["tiger", "zebra", "giraffe", "fox", "panda", "owl"]


def test_suggest_items_raises_when_all_attempts_conflict():
    used = {"apple"}
    bad = _suggest_raw_with(["apple", "tiger", "zebra", "fox", "owl", "panda"])
    client = MagicMock()
    client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content=bad))]
    )
    with patch.object(flashcard_lib, "_openai_client", lambda: client):
        with pytest.raises(flashcard_lib.SuggestionError) as exc:
            flashcard_lib.suggest_items(used, topic=None)
    assert "already-used" in exc.value.reason.lower() or "conflict" in exc.value.reason.lower()
    assert client.chat.completions.create.call_count == flashcard_lib.SUGGEST_MAX_RETRIES + 1


def test_suggest_items_raises_on_malformed_json():
    client = _stub_chat_response("not json at all")
    with patch.object(flashcard_lib, "_openai_client", lambda: client):
        with pytest.raises(flashcard_lib.SuggestionError) as exc:
            flashcard_lib.suggest_items(set(), topic=None)
    assert "parse" in exc.value.reason.lower() or "json" in exc.value.reason.lower()
    assert client.chat.completions.create.call_count == flashcard_lib.SUGGEST_MAX_RETRIES + 1


def test_suggest_items_retry_message_names_specific_conflicts():
    used = {"apple"}
    bad = _suggest_raw_with(["apple", "tiger", "zebra", "fox", "owl", "panda"])
    good = SUGGEST_RAW_OK
    client = MagicMock()
    client.chat.completions.create.side_effect = [
        MagicMock(choices=[MagicMock(message=MagicMock(content=bad))]),
        MagicMock(choices=[MagicMock(message=MagicMock(content=good))]),
    ]
    with patch.object(flashcard_lib, "_openai_client", lambda: client):
        flashcard_lib.suggest_items(used, topic=None)
    # Second call's messages must include a corrective user turn naming "apple"
    second_call_messages = client.chat.completions.create.call_args_list[1].kwargs["messages"]
    last = second_call_messages[-1]
    assert last["role"] == "user"
    assert "apple" in last["content"]
    assert "already used" in last["content"].lower() or "not" in last["content"].lower()


def test_suggest_items_lowercases_words_and_capitalizes_sentences():
    raw = json.dumps({
        "items": [
            {"word": "duck",    "sentence": "i see a duck swim."},
            {"word": "CAKE",    "sentence": "we eat cake today."},
            {"word": "Shirt",   "sentence": "My shirt is wet."},
            {"word": " tooth ", "sentence": " this tooth feels loose. "},
            {"word": "slide",   "sentence": "the slide is fast."},
            {"word": "cookie",  "sentence": "dad has a cookie."},
        ]
    })
    client = _stub_chat_response(raw)
    with patch.object(flashcard_lib, "_openai_client", lambda: client):
        items = flashcard_lib.suggest_items(set(), topic=None)
    assert [it["word"] for it in items] == ["duck", "cake", "shirt", "tooth", "slide", "cookie"]
    assert items[0]["sentence"] == "I see a duck swim."
    assert items[1]["sentence"] == "We eat cake today."
    assert items[3]["sentence"] == "This tooth feels loose."


def test_suggest_items_stub_mode_reads_fixture_and_skips_openai(monkeypatch):
    monkeypatch.setenv(
        "FLASHCARD_STUB_SUGGEST",
        str(Path("tests/fixtures/suggest_stub.json").resolve()),
    )
    crash = MagicMock()
    crash.chat.completions.create.side_effect = AssertionError("should not be called")
    with patch.object(flashcard_lib, "_openai_client", lambda: crash):
        items = flashcard_lib.suggest_items(set(), topic="animals")
    assert [it["word"] for it in items] == [
        "tiger", "zebra", "giraffe", "fox", "panda", "owl",
    ]
    crash.chat.completions.create.assert_not_called()


def test_batch_generate_happy_path_writes_n_images_and_grows_used(isolated_lib, monkeypatch):
    used, gen = isolated_lib
    fixture = Path("tests/fixtures/stub.png").resolve()
    monkeypatch.setenv("FLASHCARD_STUB_IMAGE", str(fixture))

    batch1 = [
        {"word": "tiger",   "sentence": "A tiger roars loud."},
        {"word": "zebra",   "sentence": "Zebras have stripes."},
        {"word": "giraffe", "sentence": "A giraffe is tall."},
        {"word": "fox",     "sentence": "The fox runs fast."},
        {"word": "panda",   "sentence": "A panda eats bamboo."},
        {"word": "owl",     "sentence": "An owl hoots at night."},
    ]
    batch2 = [
        {"word": "carrot",   "sentence": "A rabbit eats a carrot."},
        {"word": "tomato",   "sentence": "The tomato is red."},
        {"word": "grapes",   "sentence": "I share my grapes."},
        {"word": "potato",   "sentence": "We bake a potato."},
        {"word": "broccoli", "sentence": "I dip broccoli."},
        {"word": "kiwi",     "sentence": "A kiwi is green."},
    ]

    with patch.object(flashcard_lib, "suggest_items", side_effect=[batch1, batch2]):
        results = flashcard_lib.batch_generate(n=2, topic=None)

    assert len(results) == 2
    assert results[0]["image_url_path"] == "/generated/image-tiger.png"
    assert results[1]["image_url_path"] == "/generated/image-carrot.png"
    assert results[0]["words"] == [i["word"] for i in batch1]
    assert results[1]["words"] == [i["word"] for i in batch2]
    # Both image files were actually written
    assert (gen / "image-tiger.png").exists()
    assert (gen / "image-carrot.png").exists()
    # used_words grew by 12
    assert set(json.loads(used.read_text())) == {"apple"} | {i["word"] for i in batch1 + batch2}


def test_batch_generate_partial_failure_returns_completed(isolated_lib, monkeypatch):
    used, gen = isolated_lib
    fixture = Path("tests/fixtures/stub.png").resolve()
    monkeypatch.setenv("FLASHCARD_STUB_IMAGE", str(fixture))

    good = [
        {"word": "tiger",   "sentence": "A tiger roars loud."},
        {"word": "zebra",   "sentence": "Zebras have stripes."},
        {"word": "giraffe", "sentence": "A giraffe is tall."},
        {"word": "fox",     "sentence": "The fox runs fast."},
        {"word": "panda",   "sentence": "A panda eats bamboo."},
        {"word": "owl",     "sentence": "An owl hoots at night."},
    ]

    side_effects = [good, flashcard_lib.SuggestionError("LLM gave junk")]
    with patch.object(flashcard_lib, "suggest_items", side_effect=side_effects):
        with pytest.raises(flashcard_lib.PartialBatchError) as exc:
            flashcard_lib.batch_generate(n=2, topic=None)

    err = exc.value
    assert len(err.completed) == 1
    assert err.completed[0]["image_url_path"] == "/generated/image-tiger.png"
    assert "LLM gave junk" in err.reason
    # First batch's image was kept on disk
    assert (gen / "image-tiger.png").exists()
    # used_words only grew by the first batch (file lock + generate_and_record persisted it)
    assert set(json.loads(used.read_text())) == {"apple"} | {i["word"] for i in good}


def test_batch_generate_n_must_be_positive(isolated_lib):
    with pytest.raises(ValueError):
        flashcard_lib.batch_generate(n=0, topic=None)
