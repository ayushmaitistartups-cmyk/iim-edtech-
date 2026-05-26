"""Blob storage for turn artefacts (audio WAV + image JPEG).

Phase 5 ships two backends behind one interface:

- ``S3Blobs`` — S3 / Cloudflare R2 via ``aioboto3`` (only used when
  ``R2_BUCKET`` + creds are set).
- ``LocalBlobs`` — writes under ``<DATA_DIR>/blobs/`` for dev / when no
  cloud bucket is configured.

Both expose::

    async def put(self, key: str, body: bytes, content_type: str) -> str:
        '''Return a URL the rest of the app can store in `turns.audio_url`.'''
"""

from __future__ import annotations

import asyncio
import logging
import os
import wave
from pathlib import Path

from ..config import settings


logger = logging.getLogger(__name__)

DATA_DIR = Path(settings.device_store_path).parent / "blobs"


def pcm_to_wav_bytes(pcm: bytes, sample_rate: int = 16000) -> bytes:
    """Wrap raw int16 LE PCM into a WAV blob so the file is playable
    without backend context."""
    from io import BytesIO

    buf = BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


class LocalBlobs:
    """Filesystem fallback. Writes to ``DATA_DIR/blobs/`` and returns a
    ``file://`` URL. Trivially swappable for ``S3Blobs`` in prod."""

    name = "local"

    def __init__(self, root: Path = DATA_DIR):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    async def put(self, key: str, body: bytes, content_type: str = "application/octet-stream") -> str:
        loop = asyncio.get_event_loop()
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        await loop.run_in_executor(None, path.write_bytes, body)
        logger.info("blob put: %s (%d B, %s)", path, len(body), content_type)
        return path.as_uri()


class S3Blobs:
    """S3 / R2 backend. Activated when ``R2_BUCKET`` is set."""

    name = "s3"

    def __init__(
        self,
        bucket: str,
        access_key: str,
        secret_key: str,
        endpoint_url: str | None,
        region: str = "auto",
    ):
        try:
            import aioboto3  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("aioboto3 not installed; cannot use S3Blobs") from exc

        self._aioboto3 = aioboto3
        self.bucket = bucket
        self.access_key = access_key
        self.secret_key = secret_key
        self.endpoint_url = endpoint_url
        self.region = region

    async def put(self, key: str, body: bytes, content_type: str = "application/octet-stream") -> str:
        session = self._aioboto3.Session(
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name=self.region,
        )
        async with session.client("s3", endpoint_url=self.endpoint_url) as s3:
            await s3.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                ContentType=content_type,
            )
        return f"s3://{self.bucket}/{key}"


_backend = None


def get_blob_store():
    global _backend
    if _backend is not None:
        return _backend

    bucket = os.getenv("R2_BUCKET") or os.getenv("S3_BUCKET")
    access = os.getenv("R2_ACCESS_KEY_ID") or os.getenv("AWS_ACCESS_KEY_ID")
    secret = os.getenv("R2_SECRET_ACCESS_KEY") or os.getenv("AWS_SECRET_ACCESS_KEY")

    if bucket and access and secret:
        try:
            _backend = S3Blobs(
                bucket=bucket,
                access_key=access,
                secret_key=secret,
                endpoint_url=os.getenv("R2_ENDPOINT_URL") or os.getenv("S3_ENDPOINT_URL"),
            )
            logger.info("Blob store: S3 (%s)", bucket)
            return _backend
        except RuntimeError as exc:  # pragma: no cover
            logger.warning("Failed to init S3Blobs (%s); using LocalBlobs", exc)

    _backend = LocalBlobs()
    logger.info("Blob store: local (%s)", DATA_DIR)
    return _backend


def reset_for_testing(root: Path | None = None) -> None:
    global _backend
    _backend = LocalBlobs(root=root) if root else None
