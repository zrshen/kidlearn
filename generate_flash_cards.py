"""CLI: generate one worksheet from a hard-coded list."""
from dotenv import load_dotenv

from flashcard_lib import ConflictError, generate_and_record

load_dotenv()

ITEMS = [
    {"word": "banana", "sentence": "I peel a banana."},
    {"word": "carrot", "sentence": "A rabbit eats a carrot."},
    {"word": "tomato", "sentence": "The tomato is red and round."},
    {"word": "grapes", "sentence": "I share my grapes with mom."},
    {"word": "potato", "sentence": "We bake a big potato."},
    {"word": "broccoli", "sentence": "I dip broccoli in cheese."},
]

if __name__ == "__main__":
    try:
        out = generate_and_record(ITEMS)
        print(f"Saved to {out}")
    except ConflictError as e:
        raise SystemExit(f"Already-used words: {e.conflicts}. Pick fresh words.")
