from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import flashcard_lib

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/used-words")
def used_words() -> dict:
    words = sorted(flashcard_lib.load_used_words())
    return {"words": words, "count": len(words)}


from pathlib import Path
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

Quality = Literal["low", "medium", "high"]


class WordSentenceIn(BaseModel):
    word: str = Field(min_length=1)
    sentence: str = Field(min_length=1)


class GenerateRequest(BaseModel):
    items: Annotated[list[WordSentenceIn], Field(min_length=6, max_length=6)]
    quality: Quality = "medium"


@app.post("/api/generate")
def generate(req: GenerateRequest) -> dict:
    items = [{"word": i.word, "sentence": i.sentence} for i in req.items]
    try:
        out_path: Path = flashcard_lib.generate_and_record(items, quality=req.quality)
    except flashcard_lib.ConflictError as e:
        raise HTTPException(status_code=409, detail={"conflicts": e.conflicts})
    except Exception as e:  # OpenAI or filesystem failure
        raise HTTPException(status_code=500, detail={"error": f"image generation failed: {e}"})
    return {"image_url": f"/generated/{out_path.name}"}


class SuggestRequest(BaseModel):
    topic: Annotated[str | None, Field(default=None, max_length=100)] = None


@app.post("/api/suggest")
def suggest(req: SuggestRequest) -> dict:
    try:
        items = flashcard_lib.suggest_items(flashcard_lib.load_used_words(), topic=req.topic)
    except flashcard_lib.SuggestionError as e:
        raise HTTPException(status_code=502, detail={"error": f"Couldn't generate suggestions: {e.reason}"})
    return {"items": items}


from fastapi.requests import Request
from fastapi.responses import JSONResponse


@app.exception_handler(HTTPException)
async def _http_exc(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.detail)


class BatchRequest(BaseModel):
    topic: Annotated[str | None, Field(default=None, max_length=100)] = None
    n: Annotated[int, Field(ge=1, le=10)]
    quality: Quality = "medium"


def _translate_entry(entry: dict) -> dict:
    return {"image_url": entry["image_url_path"], "words": entry["words"]}


@app.post("/api/batch")
def batch(req: BatchRequest) -> dict:
    try:
        completed = flashcard_lib.batch_generate(n=req.n, topic=req.topic, quality=req.quality)
    except flashcard_lib.PartialBatchError as e:
        raise HTTPException(
            status_code=502,
            detail={
                "error": e.reason,
                "completed": [_translate_entry(c) for c in e.completed],
            },
        )
    return {"batches": [_translate_entry(c) for c in completed]}


from fastapi.staticfiles import StaticFiles

flashcard_lib.GENERATED_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/generated", StaticFiles(directory=flashcard_lib.GENERATED_DIR), name="generated")
