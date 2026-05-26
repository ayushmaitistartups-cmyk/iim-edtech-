"""Long-term per-user memory backed by vector similarity.

The shape mirrors what Phase 5 will eventually back with Postgres + pgvector:

    memories(user_id text, kind text, content text, embedding vector(1536), created_at)

For Phase 4 we ship a **file-backed fallback** so the feature works without
provisioning Postgres. It writes one JSON record per memory under
``<DATA_DIR>/memories/{user_id}.jsonl`` and does an in-process cosine-sim
search on top-K queries. The interface is async + identical to the Postgres
version, so Phase 5 swaps the implementation by changing one factory.

Embeddings:
- If ``GEMINI_API_KEY`` is set and the SDK is importable, we use
  ``text-embedding-004`` (Google's small embedding model).
- Otherwise we use a deterministic ``HashEmbedder`` — *not* semantic, but
  good enough to round-trip the storage layer in tests.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..config import settings


logger = logging.getLogger(__name__)


EMBEDDING_DIM = 256                 # HashEmbedder dim; matches storage shape.
EMBEDDING_MODEL = "text-embedding-004"
DEFAULT_TOP_K = 3
DATA_DIR = Path(settings.device_store_path).parent / "memories"


@dataclass(frozen=True)
class Memory:
    user_id: str
    kind: str         # "qa" | "fact" | "preference"
    content: str
    created_at: float = field(default_factory=time.time)


class HashEmbedder:
    """Deterministic text → fixed-length vector. NOT semantic — used only
    when a real embedding provider isn't available.

    Same input → same vector, so similarity works *within* the same
    embedder; cross-embedder comparisons are meaningless.
    """

    name = "hash-embedder"
    dim = EMBEDDING_DIM

    async def embed(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        # Repeat the digest to fill `dim` floats in [-1, 1].
        n_bytes = self.dim
        repeats = (n_bytes + len(digest) - 1) // len(digest)
        raw = (digest * repeats)[:n_bytes]
        return [(b - 128) / 128.0 for b in raw]


class GeminiEmbedder:
    """text-embedding-004 wrapper. Lazily imports google-genai."""

    def __init__(self, api_key: str, model: str = EMBEDDING_MODEL):
        from google import genai
        self._client = genai.Client(api_key=api_key)
        self.model = model

    @property
    def name(self) -> str:
        return f"gemini:{self.model}"

    @property
    def dim(self) -> int:
        return 768  # text-embedding-004 default

    async def embed(self, text: str) -> list[float]:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: self._client.models.embed_content(
                model=self.model,
                contents=text,
            ),
        )
        # SDK returns either result.embeddings[0].values or result.embedding.values
        emb = getattr(result, "embeddings", None) or getattr(result, "embedding", None)
        if isinstance(emb, list):
            vec = emb[0].values
        else:
            vec = emb.values
        return list(vec)


_embedder = None


def get_embedder():
    global _embedder
    if _embedder is not None:
        return _embedder
    if settings.gemini_api_key:
        try:
            _embedder = GeminiEmbedder(settings.gemini_api_key)
            logger.info("Embedder: %s", _embedder.name)
            return _embedder
        except Exception as exc:  # pragma: no cover
            logger.warning("Gemini embedder unavailable (%s); using HashEmbedder", exc)
    _embedder = HashEmbedder()
    logger.info("Embedder: %s", _embedder.name)
    return _embedder


def reset_embedder_for_testing() -> None:
    global _embedder
    _embedder = None


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _user_file(user_id: str) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c for c in user_id if c.isalnum() or c in "-_") or "anon"
    return DATA_DIR / f"{safe}.jsonl"


async def remember(user_id: str, content: str, kind: str = "qa") -> None:
    """Embed + append the memory to the user's file. Best-effort."""
    try:
        embedder = get_embedder()
        vec = await embedder.embed(content)
        record = {
            "user_id": user_id,
            "kind": kind,
            "content": content,
            "embedding": vec,
            "created_at": time.time(),
            "embedder": embedder.name,
        }
        path = _user_file(user_id)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as exc:  # pragma: no cover
        logger.warning("vector_memory.remember failed for %s: %s", user_id, exc)


async def recall(user_id: str, query: str, top_k: int = DEFAULT_TOP_K) -> list[Memory]:
    """Top-K cosine-sim recall for ``query`` over this user's memories."""
    try:
        path = _user_file(user_id)
        if not path.exists():
            return []
        embedder = get_embedder()
        q_vec = await embedder.embed(query)

        rows: list[tuple[float, dict]] = []
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # Skip cross-embedder rows — similarity would be meaningless.
                if rec.get("embedder") != embedder.name:
                    continue
                score = _cosine(q_vec, rec.get("embedding", []))
                rows.append((score, rec))

        rows.sort(key=lambda x: x[0], reverse=True)
        out: list[Memory] = []
        for score, rec in rows[:top_k]:
            out.append(
                Memory(
                    user_id=rec["user_id"],
                    kind=rec.get("kind", "qa"),
                    content=rec["content"],
                    created_at=rec.get("created_at", 0.0),
                )
            )
        return out
    except Exception as exc:  # pragma: no cover
        logger.warning("vector_memory.recall failed for %s: %s", user_id, exc)
        return []


def render_recall_for_prompt(memories: list[Memory]) -> str:
    if not memories:
        return ""
    lines = ["Long-term memory — things this learner has discussed before:"]
    for m in memories:
        lines.append(f"- ({m.kind}) {m.content[:200]}")
    lines.append("Use only if relevant to the current question.\n")
    return "\n".join(lines)


def clear_user_for_testing(user_id: str) -> None:
    path = _user_file(user_id)
    if path.exists():
        path.unlink()
