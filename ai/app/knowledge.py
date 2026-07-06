"""RAG for "Teach Penny your business": chunking, embeddings, retrieval.

Embeddings via Gemini's embedding model (free tier). Retrieval is exact
cosine over the user's chunks fetched from the Node store — at SMB scale
(dozens of chunks) that's faster and simpler than a vector database, and the
swap to Atlas $vectorSearch later is a one-module change.
"""
import hashlib
import math
import os

from .node_client import request

EMBED_MODEL = os.getenv("PENNY_EMBED_MODEL", "models/gemini-embedding-001")
_FALLBACK_EMBED = "models/text-embedding-004"

_embedder = None


class _HashEmbedder:
    """Zero-key fallback: 256-dim hashed bag-of-words. Crude but deterministic —
    keeps the feature working (exact-phrase-ish matching) without any API key."""

    DIM = 256

    @staticmethod
    def _bucket(token: str) -> int:
        # Stable across processes. Python's built-in hash() is salted per run
        # (PYTHONHASHSEED), so using it would put stored doc vectors and a later
        # query's vector in different buckets after any restart — breaking search.
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        return int.from_bytes(digest, "big")

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * self.DIM
        for token in text.lower().split():
            v[self._bucket(token) % self.DIM] += 1.0
        return v

    def embed_documents(self, texts):
        return [self._vec(t) for t in texts]

    def embed_query(self, text):
        return self._vec(text)


def _get_embedder():
    global _embedder, EMBED_MODEL
    if _embedder is None:
        try:
            from langchain_google_genai import GoogleGenerativeAIEmbeddings

            try:
                _embedder = GoogleGenerativeAIEmbeddings(model=EMBED_MODEL)
                _embedder.embed_query("ping")  # validate the model name once
            except Exception:
                EMBED_MODEL = _FALLBACK_EMBED
                _embedder = GoogleGenerativeAIEmbeddings(model=EMBED_MODEL)
                _embedder.embed_query("ping")
        except Exception:
            EMBED_MODEL = "hashed-bow (no API key)"
            _embedder = _HashEmbedder()
    return _embedder


def chunk_text(text: str, target: int = 900, overlap: int = 120) -> list[str]:
    """Paragraph-aware splitting near `target` chars with a little overlap."""
    paragraphs = [p.strip() for p in text.replace("\r\n", "\n").split("\n\n") if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paragraphs:
        if len(buf) + len(p) + 2 <= target:
            buf = f"{buf}\n\n{p}" if buf else p
            continue
        if buf:
            chunks.append(buf)
        while len(p) > target:  # very long paragraph: hard-split
            chunks.append(p[:target])
            p = p[target - overlap :]
        buf = p
    if buf:
        chunks.append(buf)
    return chunks[:120]


def ingest(text: str, source: str) -> list[dict]:
    chunks = chunk_text(text)
    embedder = _get_embedder()
    vectors = embedder.embed_documents([f"{source}\n{c}" for c in chunks])
    return [{"chunk": c, "embedding": v} for c, v in zip(chunks, vectors)]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def search(user_id: str, query: str, k: int = 3) -> list[dict]:
    chunks = request(user_id, "GET", "/api/knowledge/chunks")["chunks"]
    if not chunks:
        return []
    qv = _get_embedder().embed_query(query)
    comparable = [c for c in chunks if len(c["embedding"]) == len(qv)]  # guard mixed embedders
    scored = sorted(
        ({"source": c["source"], "chunk": c["chunk"], "score": _cosine(qv, c["embedding"])} for c in comparable),
        key=lambda x: -x["score"],
    )
    return [s for s in scored[:k] if s["score"] > 0.3]
