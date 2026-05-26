"""mock_lamp — pretend-to-be-an-ESP32 dev tool.

Connects to ``ws://localhost:8000/lamp/ws``, ships a JPEG + a few seconds of
PCM as if a real lamp had spoken, and dumps every inbound frame to stdout
(saving AUDIO_OUT to ``out.wav``).

Usage::

    python scripts/mock_lamp.py --audio test.wav --image desk.jpg
    python scripts/mock_lamp.py --silent           # generates 2 s of silence

Reads ``LUMOS_BACKEND_URL`` (default ``ws://localhost:8000``).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import struct
import sys
import wave
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from app.protocol import DeviceState, FrameType, decode, encode  # noqa: E402


WS_INBOUND_MAX = 2 * 1024  # match settings.ws_inbound_max_bytes


def _load_audio_pcm(path: str | None, fallback_seconds: float = 2.0) -> bytes:
    if not path:
        return b"\x00\x00" * int(16000 * fallback_seconds)
    with wave.open(path, "rb") as w:
        if w.getframerate() != 16000:
            raise SystemExit(f"audio must be 16 kHz; got {w.getframerate()}")
        if w.getnchannels() != 1:
            raise SystemExit("audio must be mono")
        if w.getsampwidth() != 2:
            raise SystemExit("audio must be int16 PCM")
        return w.readframes(w.getnframes())


def _load_image(path: str | None) -> bytes:
    if not path:
        # A 1×1 JPEG (smallest valid placeholder).
        return bytes(
            [
                0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
                0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
                0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
                0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
                0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
                0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
                0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
                0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
                0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
                0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
                0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
                0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
                0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
                0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0xFF, 0xDA, 0x00, 0x08,
                0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD0, 0xFF, 0xD9,
            ]
        )
    return Path(path).read_bytes()


async def _send_image_chunked(ws, image_bytes: bytes) -> None:
    """Mirror the real lamp: split into IMAGE_PART chunks + terminator IMAGE_JPEG."""
    if len(image_bytes) <= WS_INBOUND_MAX:
        await ws.send(encode(FrameType.IMAGE_JPEG, image_bytes))
        return
    sent = 0
    n = len(image_bytes)
    while n - sent > WS_INBOUND_MAX:
        await ws.send(encode(FrameType.IMAGE_PART, image_bytes[sent : sent + WS_INBOUND_MAX]))
        sent += WS_INBOUND_MAX
    await ws.send(encode(FrameType.IMAGE_JPEG, image_bytes[sent:]))


async def _send_audio_stream(ws, pcm: bytes) -> None:
    """20 ms chunks (320 samples = 640 bytes), paced at 20 ms to mimic real timing."""
    chunk = 640
    for i in range(0, len(pcm), chunk):
        await ws.send(encode(FrameType.AUDIO_CHUNK, pcm[i : i + chunk]))
        await asyncio.sleep(0.02)
    await ws.send(encode(FrameType.AUDIO_END))


async def _ping_loop(ws, period_s: float = 10.0) -> None:
    try:
        while True:
            await asyncio.sleep(period_s)
            await ws.send(encode(FrameType.PING))
    except asyncio.CancelledError:
        return


async def _consume(ws, out_wav: Path) -> None:
    """Receive frames; save AUDIO_OUT to out.wav, log everything else."""
    pcm_chunks: list[bytes] = []
    tft_accum = bytearray()

    async for message in ws:
        if not isinstance(message, (bytes, bytearray)):
            continue
        frame = decode(message)
        t = int(frame.frame_type)
        n = len(frame.payload)
        if t == FrameType.STATE:
            state = DeviceState(frame.payload[0]) if n == 1 else "?"
            print(f"[RX] STATE {state.name if hasattr(state, 'name') else state}")
        elif t == FrameType.TFT_TEXT:
            print(f"[RX] TFT_TEXT {frame.payload.decode('utf-8', errors='replace')!r}")
        elif t == FrameType.TFT_PART:
            tft_accum.extend(frame.payload)
            print(f"[RX] TFT_PART +{n} B (accum={len(tft_accum)})")
        elif t == FrameType.TFT_FRAME:
            tft_accum.extend(frame.payload)
            print(f"[RX] TFT_FRAME {len(tft_accum)} B total")
            if len(tft_accum) >= 6:
                w, h, nf, _ = struct.unpack(">HHBB", bytes(tft_accum[:6]))
                print(f"      → {w}×{h} ×{nf} frames")
            tft_accum.clear()
        elif t == FrameType.TFT_CLEAR:
            print("[RX] TFT_CLEAR")
        elif t == FrameType.AUDIO_OUT:
            pcm_chunks.append(bytes(frame.payload))
            print(f"[RX] AUDIO_OUT {n} B (total {sum(len(c) for c in pcm_chunks)})")
        elif t == FrameType.AUDIO_OUT_END:
            print("[RX] AUDIO_OUT_END")
            _save_wav(out_wav, b"".join(pcm_chunks), 24000)
            print(f"      → saved {out_wav} ({sum(len(c) for c in pcm_chunks)} B)")
            pcm_chunks.clear()
            return
        elif t == FrameType.PONG:
            print("[RX] PONG")
        else:
            print(f"[RX] type=0x{t:02X} payload={n} B")


def _save_wav(path: Path, pcm: bytes, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


async def amain(args: argparse.Namespace) -> None:
    import websockets

    url = os.getenv("LUMOS_BACKEND_URL", "ws://localhost:8000") + "/lamp/ws"
    headers = [("Authorization", "Bearer dev-mode-no-auth")]
    print(f"[mock_lamp] connecting to {url}")
    async with websockets.connect(url, additional_headers=headers, max_size=2 * 1024 * 1024) as ws:
        print("[mock_lamp] connected")
        ping_task = asyncio.create_task(_ping_loop(ws))
        consume_task = asyncio.create_task(_consume(ws, Path(args.out)))

        # Send the image first (the spec wants it pre-uploaded during speech).
        image = _load_image(args.image)
        print(f"[mock_lamp] sending image ({len(image)} B)")
        await _send_image_chunked(ws, image)

        # Stream audio.
        pcm = _load_audio_pcm(args.audio)
        print(f"[mock_lamp] streaming audio ({len(pcm)} B = {len(pcm) / 2 / 16000:.2f} s)")
        await _send_audio_stream(ws, pcm)

        try:
            await asyncio.wait_for(consume_task, timeout=60.0)
        except asyncio.TimeoutError:
            print("[mock_lamp] timeout waiting for AUDIO_OUT_END")
        finally:
            ping_task.cancel()


def main() -> int:
    parser = argparse.ArgumentParser(description="Mock lamp client")
    parser.add_argument("--audio", help="path to 16 kHz mono int16 WAV", default=None)
    parser.add_argument("--image", help="path to JPEG", default=None)
    parser.add_argument("--out", help="where to write received TTS WAV", default="out.wav")
    args = parser.parse_args()

    try:
        import websockets  # noqa: F401
    except ImportError:
        print("Install websockets first: pip install websockets")
        return 1

    logging.basicConfig(level=logging.INFO)
    asyncio.run(amain(args))
    return 0


if __name__ == "__main__":
    sys.exit(main())
