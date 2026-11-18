"""Shared worksheet language settings; the application UI remains English."""
from typing import Literal

Language = Literal["en", "zh-CN"]


def validate_language(language: str) -> Language:
    if language not in ("en", "zh-CN"):
        raise ValueError(f"unsupported worksheet language: {language}")
    return language


CHINESE_RENDER_RULES = """
LANGUAGE AND PRONUNCIATION:
- All child-facing text must use simplified Chinese characters, without English translations.
- Use only standard simplified glyphs: 爱, 圆, 苹, not traditional 愛, 圓, 蘋.
  Never substitute traditional forms when copying supplied text.
- Add correctly aligned Mandarin pinyin with tone marks above ALL child-facing Chinese text,
  including titles, vocabulary, sentences, headings, questions, choices, instructions,
  answers, explanations, and banners. Use context-correct pronunciation for polyphonic characters.
- Preserve the supplied Chinese text exactly. Do not print technical drawing descriptions.
- Keep A/B/C choice labels and numbers unchanged; they do not need pinyin.
- Leave enough vertical spacing for pinyin. Use a clear Chinese font, legible characters,
  and short lines; never overlap text, pictures, or card/panel boundaries.
"""
