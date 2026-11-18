import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import flashcard_lib as fc
import gt_lib as gt
from server.main import app


@pytest.fixture(autouse=True)
def no_live_calls(monkeypatch):
    monkeypatch.setattr(fc, "_openai_client", MagicMock(side_effect=AssertionError("No live API calls in unit tests")))
    monkeypatch.setattr(gt, "_openai_client", MagicMock(side_effect=AssertionError("No live API calls in unit tests")))


ITEMS = [{"word": w, "sentence": f"我喜欢{w}。"} for w in ["苹果", "香蕉", "桃子", "梨", "西瓜", "葡萄"]]
SPEC = {"title": "幼儿思维练习", "theme": "水果", "language": "zh-CN", "panels": [
    {"type": "count", "heading": "数一数", "question": "有几个苹果？", "scene": "three apples",
     "answer": "三个", "instruction": "圈出答案", "items": [], "choices": [], "explanation": "一共有三个。"}
    for _ in range(4)
]}


def test_chinese_flashcard_prompts():
    prompt = fc._render_prompt(ITEMS, language="zh-CN")
    assert "pinyin" in prompt and "tone" in prompt
    assert "lowercase" not in prompt
    assert "我喜欢苹果。" in prompt
    messages = fc._build_suggest_messages(set(), "fruits", language="zh-CN")
    text = messages[-1]["content"]
    assert "simplified Chinese" in text
    assert "4-8 words" not in text
    assert "Lowercase" not in text


def test_chinese_flashcard_save_conflict_release(tmp_path, monkeypatch):
    monkeypatch.setattr(fc, "GENERATED_DIR", tmp_path)
    monkeypatch.setattr(fc, "USED_WORDS_PATH", tmp_path / "used.json")
    monkeypatch.setenv("FLASHCARD_STUB_IMAGE", str(tmp_path / "stub.png"))
    (tmp_path / "stub.png").write_bytes(b"image")
    path = fc.generate_and_record(ITEMS, language="zh-CN")
    assert path.name == "image-苹果.png"
    assert json.loads(path.with_suffix(".json").read_text())["language"] == "zh-CN"
    assert fc.read_sidecar_words(path) == [i["word"] for i in ITEMS]
    with pytest.raises(fc.ConflictError):
        fc.generate_and_record(ITEMS, language="zh-CN")
    fc.delete_generated([path.name])
    assert fc.load_used_words() == set()


def test_gt_chinese_prompts_and_finalization():
    spec = gt._finalize_spec(json.loads(json.dumps(SPEC)), gt.resolve_profile("cogat"), 4, language="zh-CN")
    assert spec["title"] == "幼儿思维练习"
    assert spec["language"] == "zh-CN"
    for render in [gt.render_front_prompt, gt.render_back_prompt]:
        prompt = render(spec)
        assert "pinyin" in prompt and "tone" in prompt
        assert "Great job!" not in prompt and "Think carefully" not in prompt
        assert "Back (Answers)" not in prompt
    text = gt._build_suggest_messages(None, gt.resolve_profile(None), 4, language="zh-CN")[-1]["content"]
    assert "simplified Chinese" in text


@pytest.mark.parametrize("url,payload", [
    ("/api/suggest", {}), ("/api/generate", {"items": ITEMS}), ("/api/batch", {"n": 1}),
    ("/api/gt/suggest", {}), ("/api/gt/batch", {"n": 1}),
])
def test_api_rejects_unknown_language(url, payload):
    assert TestClient(app).post(url, json={**payload, "language": "xx"}).status_code == 422


def test_gt_rejects_unknown_spec_language():
    with pytest.raises(ValueError, match="language"):
        gt.validate_spec({**SPEC, "language": "xx"})


def test_chinese_api_suggest_propagates_language():
    with patch.object(fc, "suggest_items", return_value=ITEMS) as suggest:
        res = TestClient(app).post("/api/suggest", json={"language": "zh-CN"})
    assert res.status_code == 200
    assert suggest.call_args.kwargs["language"] == "zh-CN"


def test_chinese_gt_save_and_legacy_history(tmp_path, monkeypatch):
    monkeypatch.setattr(gt, "GENERATED_DIR", tmp_path)
    monkeypatch.setattr(gt, "_generate_verified_side", MagicMock(return_value=b"image"))
    pair = gt.generate_gt_pair(SPEC)
    assert pair["language"] == "zh-CN"
    history = gt.list_gt_pairs()
    assert history[0]["language"] == "zh-CN"
    manifest = tmp_path / "gt-legacy.json"
    manifest.write_text(json.dumps({"id": "legacy", "theme": "old"}))
    assert next(p for p in gt.list_gt_pairs() if p["id"] == "legacy")["language"] == "en"
    assert gt.delete_gt([pair["id"]])["deleted"] == [pair["id"]]


def test_chinese_gt_model_response_keeps_language():
    client = MagicMock()
    client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content=json.dumps(SPEC)))]
    )
    with patch.object(gt, "_openai_client", return_value=client):
        spec = gt.suggest_gt_spec("fruits", panels=4, language="zh-CN")
    assert spec["language"] == "zh-CN"
    assert spec["title"] == "幼儿思维练习"


def test_retry_preserves_chinese_render_rules():
    client = MagicMock()
    client.chat.completions.create.return_value = MagicMock(choices=[MagicMock(message=MagicMock(content="Corrected counts"))])
    with patch.object(gt, "_openai_client", return_value=client):
        revised = gt.revise_prompt(gt.render_front_prompt(SPEC), [{"panel": 1, "note": "wrong count"}])
    assert "Mandarin pinyin with tone marks" in revised
    assert "simplified Chinese" in revised


def test_backfill_chinese_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(fc, "GENERATED_DIR", tmp_path)
    image = tmp_path / "image-苹果.png"
    image.write_bytes(b"old")
    monkeypatch.setattr(fc, "extract_words_from_image", lambda p: [i["word"] for i in ITEMS])
    fc.backfill_missing_sidecars()
    assert fc.read_sidecar_language(image) == "zh-CN"


def test_chinese_flashcard_batch_and_archive(tmp_path, monkeypatch):
    monkeypatch.setattr(fc, "GENERATED_DIR", tmp_path)
    monkeypatch.setattr(fc, "USED_WORDS_PATH", tmp_path / "used.json")
    (tmp_path / "used.json").write_text("[]")
    stub = tmp_path / "stub.png"
    stub.write_bytes(b"png")
    monkeypatch.setenv("FLASHCARD_STUB_IMAGE", str(stub))
    with patch.object(fc, "suggest_items", return_value=ITEMS) as suggest:
        response = TestClient(app).post("/api/batch", json={"n": 1, "language": "zh-CN"})
    assert response.status_code == 200
    assert suggest.call_args.kwargs["language"] == "zh-CN"
    listing = TestClient(app).get("/api/generated").json()["items"]
    assert listing[0]["language"] == "zh-CN"
    assert listing[0]["word"] == "苹果"
    assert listing[0]["url"].endswith("image-苹果.png")
    # Legacy metadata keeps its English default.
    (tmp_path / "image-cat.png").write_bytes(b"old")
    (tmp_path / "image-cat.json").write_text('{"words": ["cat"]}')
    listing = TestClient(app).get("/api/generated").json()["items"]
    assert next(e for e in listing if e["word"] == "cat")["language"] == "en"


def test_chinese_gt_batch_propagates_language(tmp_path, monkeypatch):
    monkeypatch.setattr(gt, "GENERATED_DIR", tmp_path)
    monkeypatch.setattr(gt, "_generate_verified_side", MagicMock(return_value=b"png"))
    with patch.object(gt, "suggest_gt_spec", return_value=SPEC) as suggest:
        response = TestClient(app).post("/api/gt/batch", json={"n": 1, "language": "zh-CN"})
    assert response.status_code == 200
    assert suggest.call_args.kwargs["language"] == "zh-CN"
    events = [json.loads(line) for line in response.text.splitlines()]
    done = next(e for e in events if e["type"] == "done")
    assert done["pair"]["language"] == "zh-CN"
    assert done["pair"]["spec"]["language"] == "zh-CN"
    assert events[-1]["type"] == "batch_done"
