import json
from pathlib import Path

import pytest

import gt_lib


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
