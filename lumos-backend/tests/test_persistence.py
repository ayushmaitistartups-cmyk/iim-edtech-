"""Phase 5 persistence — blob + ledger writes off the hot path."""

import asyncio
from pathlib import Path

import pytest

from app.schemas import Display, LlmReply
from app.services import persistence
from app.storage import blobs, turns_repo


@pytest.fixture()
def _tmp_storage(tmp_path: Path):
    blobs.reset_for_testing(root=tmp_path / "blobs")
    turns_repo.reset_for_testing(root=tmp_path / "turns")
    yield tmp_path
    blobs.reset_for_testing()
    turns_repo.reset_for_testing()


@pytest.mark.asyncio
async def test_commit_turn_writes_wav_jpeg_and_ledger_row(_tmp_storage):
    pcm = b"\x00\x00" * 16000  # 1 s of silence
    image = b"\xFF\xD8\xFF\xE0" + b"\x00" * 100  # short fake JPEG

    reply = LlmReply(
        speech="Try splitting the integral at infinity.",
        display=Display(kind="latex", content=r"\int_0^\infty e^{-x^2}\,dx"),
        is_confident=0.92,
    )
    turn_id = turns_repo.new_turn_id()

    await persistence.commit_turn(
        turn_id=turn_id,
        device_id="dev-lamp",
        user_id="user-1",
        asked_at=1234567890.0,
        image_bytes=image,
        audio_pcm=pcm,
        reply=reply,
        llm_model="mock-llm",
        ttft_ms=420,
        total_ms=1180,
        issues=["voice_truncated"],
    )

    # WAV blob exists and has a RIFF header.
    wav_path = _tmp_storage / "blobs" / "dev-lamp" / f"{turn_id}.wav"
    assert wav_path.exists()
    assert wav_path.read_bytes()[:4] == b"RIFF"

    # JPEG blob is the raw image bytes.
    jpg_path = _tmp_storage / "blobs" / "dev-lamp" / f"{turn_id}.jpg"
    assert jpg_path.read_bytes() == image

    # Ledger row is appended.
    repo = turns_repo.get_turns_repo()
    rows = await repo.read_latest("dev-lamp", limit=10)
    assert len(rows) == 1
    row = rows[0]
    assert row.id == turn_id
    assert row.response_text == reply.speech
    assert row.display_kind == "latex"
    assert row.is_confident == pytest.approx(0.92)
    assert row.issues == ["voice_truncated"]
    assert row.audio_url and row.audio_url.endswith(".wav")
    assert row.image_url and row.image_url.endswith(".jpg")
    assert row.total_ms == 1180


@pytest.mark.asyncio
async def test_pcm_to_wav_wraps_correctly():
    pcm = b"\x01\x02" * 100
    wav = blobs.pcm_to_wav_bytes(pcm, sample_rate=16000)
    assert wav[:4] == b"RIFF"
    assert b"WAVE" in wav[:12]
    assert len(wav) > len(pcm) + 40  # WAV header is at least 44 bytes


@pytest.mark.asyncio
async def test_read_latest_returns_newest_last(_tmp_storage):
    repo = turns_repo.get_turns_repo()
    for i in range(3):
        await repo.write(
            turns_repo.TurnRow(
                id=f"turn-{i}",
                device_id="dev-lamp",
                user_id="user-1",
                asked_at=1234567890.0 + i,
                response_text=f"Answer {i}",
            )
        )
    rows = await repo.read_latest("dev-lamp", limit=5)
    assert [r.id for r in rows] == ["turn-0", "turn-1", "turn-2"]


@pytest.mark.asyncio
async def test_local_blobs_writes_under_root(_tmp_storage):
    store = blobs.get_blob_store()
    assert store.name == "local"
    url = await store.put("a/b/file.bin", b"hello", "application/octet-stream")
    assert url.startswith("file://")
    written = (_tmp_storage / "blobs" / "a" / "b" / "file.bin").read_bytes()
    assert written == b"hello"


def test_new_turn_id_is_unique_and_starts_with_a_ms_prefix():
    ids = [turns_repo.new_turn_id() for _ in range(20)]
    assert len(set(ids)) == 20
    # All ids share the same shape: 12 hex chars (ms) + "-" + 16 hex chars (rand).
    for tid in ids:
        prefix, _, suffix = tid.partition("-")
        assert len(prefix) == 12
        assert len(suffix) == 16
        int(prefix, 16)  # valid hex
