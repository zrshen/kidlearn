import json
from pathlib import Path

import pytest

import gt_lib


def _write_stub_png(dir_path: Path) -> Path:
    p = dir_path / "stub.png"
    p.write_bytes(bytes.fromhex("89504e470d0a1a0a") + b"stub")
    return p


def _panel(t="odd_one_out", **over):
    p = {
        "type": t,
        "heading": "Odd One Out",
        "question": "Which one does not belong?",
        "items": ["apple", "banana", "teddy bear"],
        "choices": [],
        "instruction": "Circle the odd one.",
        "answer": "teddy bear",
        "explanation": "It is not a fruit.",
    }
    p.update(over)
    return p


def _spec(panels=None):
    return {
        "title": "Kindergarten GT Thinking Practice",
        "theme": "fruits",
        "panels": panels or [_panel(t) for t in list(gt_lib.GENERAL_CATALOG)[:6]],
    }


def test_general_catalog_has_expected_seed_types():
    for t in ["odd_one_out", "pattern", "analogy", "sequence", "compare", "matrix"]:
        assert t in gt_lib.GENERAL_CATALOG


def test_profiles_carry_label_title_and_catalog():
    for pid in ["general", "cogat", "nnat", "olsat"]:
        prof = gt_lib.PROFILES[pid]
        assert prof["label"] and prof["title"] and prof["catalog"]


def test_resolve_profile_known_id():
    prof = gt_lib.resolve_profile("cogat")
    assert prof["id"] == "cogat"
    assert "figure_matrices" in prof["catalog"]


def test_resolve_profile_defaults_to_general():
    assert gt_lib.resolve_profile(None)["id"] == "general"


def test_resolve_profile_custom_name():
    prof = gt_lib.resolve_profile("Iowa Assessments")
    assert prof["id"] == "custom"
    assert "Iowa Assessments" in prof["framing"]
    assert "Iowa Assessments" in prof["title"]


def test_validate_spec_accepts_well_formed_spec():
    spec = _spec()
    assert gt_lib.validate_spec(spec) is spec


def test_validate_spec_accepts_arbitrary_type_strings():
    spec = _spec(panels=[_panel("figure_matrices")] + [_panel(t) for t in list(gt_lib.GENERAL_CATALOG)[:5]])
    assert gt_lib.validate_spec(spec) is spec


def test_validate_spec_rejects_wrong_panel_count():
    with pytest.raises(ValueError, match="6 panels"):
        gt_lib.validate_spec(_spec(panels=[_panel()]))


def test_validate_spec_rejects_empty_type():
    bad = [_panel(type="  ")] + [_panel(t) for t in list(gt_lib.GENERAL_CATALOG)[:5]]
    with pytest.raises(ValueError, match="type"):
        gt_lib.validate_spec(_spec(panels=bad))


def test_validate_spec_rejects_missing_answer():
    bad = [_panel(answer="  ")] + [_panel(t) for t in list(gt_lib.GENERAL_CATALOG)[:5]]
    with pytest.raises(ValueError, match="answer"):
        gt_lib.validate_spec(_spec(panels=bad))


from unittest.mock import MagicMock, patch


def _stub_chat(content: str) -> MagicMock:
    m = MagicMock()
    m.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content=content))]
    )
    return m


def test_suggest_gt_spec_happy_path_stamps_title_and_test():
    client = _stub_chat(json.dumps(_spec()))
    with patch.object(gt_lib, "_openai_client", lambda: client):
        spec = gt_lib.suggest_gt_spec(topic=None)
    assert len(spec["panels"]) == 6
    assert spec["title"] == gt_lib.GT_TITLE
    assert spec["test"] == "General GT"


def test_suggest_gt_spec_passes_topic_into_prompt():
    client = _stub_chat(json.dumps(_spec()))
    with patch.object(gt_lib, "_openai_client", lambda: client):
        gt_lib.suggest_gt_spec(topic="ocean")
    msgs = client.chat.completions.create.call_args.kwargs["messages"]
    assert "ocean" in "\n".join(m["content"] for m in msgs)


def test_suggest_gt_spec_cogat_profile_steers_prompt_and_title():
    client = _stub_chat(json.dumps(_spec()))
    with patch.object(gt_lib, "_openai_client", lambda: client):
        spec = gt_lib.suggest_gt_spec(topic=None, test="cogat")
    msgs = client.chat.completions.create.call_args.kwargs["messages"]
    prompt = "\n".join(m["content"] for m in msgs)
    assert "figure_matrices" in prompt and "CogAT" in prompt
    assert spec["title"] == "Kindergarten CogAT Practice"
    assert spec["test"] == "CogAT"


def test_suggest_gt_spec_custom_test_names_it_in_prompt():
    client = _stub_chat(json.dumps(_spec()))
    with patch.object(gt_lib, "_openai_client", lambda: client):
        spec = gt_lib.suggest_gt_spec(topic=None, test="Iowa Assessments")
    msgs = client.chat.completions.create.call_args.kwargs["messages"]
    assert "Iowa Assessments" in "\n".join(m["content"] for m in msgs)
    assert spec["test"] == "Iowa Assessments"


def test_suggest_gt_spec_retries_then_raises_on_bad_json():
    client = _stub_chat("not json")
    with patch.object(gt_lib, "_openai_client", lambda: client):
        with pytest.raises(gt_lib.SuggestionError):
            gt_lib.suggest_gt_spec(topic=None)
    assert client.chat.completions.create.call_count == gt_lib.SUGGEST_MAX_RETRIES + 1


def test_suggest_gt_spec_stub_mode_skips_openai(monkeypatch):
    monkeypatch.setenv("GT_STUB_SPEC", str(Path("tests/fixtures/gt_spec_stub.json").resolve()))
    crash = MagicMock()
    crash.chat.completions.create.side_effect = AssertionError("should not be called")
    with patch.object(gt_lib, "_openai_client", lambda: crash):
        spec = gt_lib.suggest_gt_spec(topic="anything", test="cogat")
    assert spec["theme"] == "fruits & animals"
    assert spec["test"] == "CogAT"
    crash.chat.completions.create.assert_not_called()


def test_front_prompt_hides_answers_back_prompt_reveals():
    spec = _spec()
    front = gt_lib.render_front_prompt(spec)
    back = gt_lib.render_back_prompt(spec)
    # The "ANSWER:" reveal label appears only on the back.
    assert "ANSWER:" not in front
    assert "ANSWER:" in back
    # The explanation text leaks only on the back.
    assert "It is not a fruit." not in front
    assert "It is not a fruit." in back
    # "Back (Answers)" marking only on the back.
    assert "Back (Answers)" in back
    assert "Back (Answers)" not in front


def test_both_prompts_contain_every_heading_and_question():
    spec = _spec()
    front = gt_lib.render_front_prompt(spec)
    back = gt_lib.render_back_prompt(spec)
    for p in spec["panels"]:
        assert p["heading"] in front and p["heading"] in back
        assert p["question"] in front and p["question"] in back


PNG_BYTES = bytes.fromhex("89504e470d0a1a0a") + b"stub"


@pytest.fixture
def gt_gen_dir(tmp_path, monkeypatch):
    gen = tmp_path / "generated"
    gen.mkdir()
    monkeypatch.setattr(gt_lib, "GENERATED_DIR", gen)
    return gen


def test_generate_gt_pair_writes_two_pngs_and_manifest(gt_gen_dir, monkeypatch):
    monkeypatch.setenv("GT_STUB_IMAGE", str(_write_stub_png(gt_gen_dir)))
    result = gt_lib.generate_gt_pair(_spec(), quality="low")
    assert result["id"].startswith("fruits-")
    front = gt_gen_dir / f"gt-{result['id']}-front.png"
    back = gt_gen_dir / f"gt-{result['id']}-back.png"
    manifest = gt_gen_dir / f"gt-{result['id']}.json"
    assert front.is_file() and back.is_file() and manifest.is_file()
    assert result["front_url"] == f"/generated/{front.name}"
    assert result["back_url"] == f"/generated/{back.name}"
    data = json.loads(manifest.read_text())
    assert data["kind"] == "gt" and data["theme"] == "fruits"


def test_generate_gt_pair_cleans_up_orphan_front_when_back_fails(gt_gen_dir):
    from unittest.mock import patch
    calls = {"n": 0}

    def fake_produce(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            return PNG_BYTES
        raise RuntimeError("back image failed")

    with patch.object(gt_lib, "produce_png_bytes", side_effect=fake_produce):
        with pytest.raises(RuntimeError, match="back image failed"):
            gt_lib.generate_gt_pair(_spec())
    # No half-pair left behind.
    assert list(gt_gen_dir.glob("gt-*")) == []


def test_batch_generate_gt_happy_path(gt_gen_dir, monkeypatch):
    monkeypatch.setenv("GT_STUB_IMAGE", str(_write_stub_png(gt_gen_dir)))
    from unittest.mock import patch
    with patch.object(gt_lib, "suggest_gt_spec", side_effect=[_spec(), _spec()]):
        results = gt_lib.batch_generate_gt(n=2, topic="fruits", quality="low")
    assert len(results) == 2
    assert all(r["front_url"].endswith("-front.png") for r in results)
    assert all(r["theme"] == "fruits" for r in results)


def test_batch_generate_gt_partial_failure(gt_gen_dir, monkeypatch):
    monkeypatch.setenv("GT_STUB_IMAGE", str(_write_stub_png(gt_gen_dir)))
    from unittest.mock import patch
    effects = [_spec(), gt_lib.SuggestionError("bad spec")]
    with patch.object(gt_lib, "suggest_gt_spec", side_effect=effects):
        with pytest.raises(gt_lib.PartialBatchError) as exc:
            gt_lib.batch_generate_gt(n=2, topic=None)
    assert len(exc.value.completed) == 1
    assert "bad spec" in exc.value.reason


def test_batch_generate_gt_rejects_nonpositive_n(gt_gen_dir):
    with pytest.raises(ValueError):
        gt_lib.batch_generate_gt(n=0, topic=None)


def test_list_gt_pairs_returns_newest_first(gt_gen_dir, monkeypatch):
    monkeypatch.setenv("GT_STUB_IMAGE", str(_write_stub_png(gt_gen_dir)))
    a = gt_lib.generate_gt_pair({**_spec(), "theme": "alpha"})
    b = gt_lib.generate_gt_pair({**_spec(), "theme": "beta"})
    items = gt_lib.list_gt_pairs()
    ids = [it["id"] for it in items]
    assert set(ids) == {a["id"], b["id"]}
    assert items[0]["mtime"] >= items[1]["mtime"]
    assert items[0]["front_url"].startswith("/generated/gt-")


def test_delete_gt_removes_pngs_and_manifest(gt_gen_dir, monkeypatch):
    monkeypatch.setenv("GT_STUB_IMAGE", str(_write_stub_png(gt_gen_dir)))
    r = gt_lib.generate_gt_pair(_spec())
    out = gt_lib.delete_gt([r["id"]])
    assert out["deleted"] == [r["id"]]
    assert list(gt_gen_dir.glob(f"gt-{r['id']}*")) == []


def test_delete_gt_ignores_unknown_id(gt_gen_dir):
    assert gt_lib.delete_gt(["does-not-exist"]) == {"deleted": []}


def test_delete_gt_rejects_unsafe_ids(gt_gen_dir):
    # Path-traversal / out-of-grammar ids are silently skipped, never deleted.
    out = gt_lib.delete_gt(["../secret", "BAD", "a/b", ".."])
    assert out == {"deleted": []}
