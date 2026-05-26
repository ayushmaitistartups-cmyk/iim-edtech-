"""Binary frame protocol shared by the ESP32 lamp firmware and the gateway.

Wire format: 4-byte header (1 type + 3-byte big-endian payload length) then
``payload_length`` bytes of payload. See
``update/changes/IMPLEMENTATION_WEBSOCKET.md``.

Phase 1 adds two chunking frame types — IMAGE_PART (lamp → backend) and
TFT_PART (backend → lamp) — because the lamp's WS RX cannot allocate
``std::string`` larger than ~4 KB reliably under load.
"""

from dataclasses import dataclass
from enum import IntEnum


MAX_UINT24 = 0xFFFFFF
HEADER_SIZE = 4


class FrameType(IntEnum):
    # ---- lamp → backend ---------------------------------------------
    IMAGE_JPEG = 0x01     # terminator of a chunked JPEG (or whole image if small)
    AUDIO_CHUNK = 0x02    # int16 LE PCM, 16 kHz mono, ~640 bytes (~20 ms)
    AUDIO_END = 0x03      # empty; user finished speaking
    CANCEL = 0x04         # empty; user pressed cancel / barge-in
    IMAGE_PART = 0x05     # intermediate JPEG chunk; payload concatenates to image_accum

    # ---- backend → lamp ---------------------------------------------
    AUDIO_OUT = 0x10      # int16 LE PCM, 24 kHz mono, 4 KB chunks paced at 85 ms
    AUDIO_OUT_END = 0x11  # empty; TTS done, lamp can release I2S
    TFT_FRAME = 0x20      # terminator of a chunked TFT frame; commits to display
    TFT_TEXT = 0x21       # UTF-8 plain text, ≤200 bytes (rendered by on-device font)
    TFT_CLEAR = 0x22      # empty; clear the TFT
    TFT_PART = 0x23       # intermediate TFT pixel chunk; lamp accumulates in PSRAM

    # ---- bidirectional ----------------------------------------------
    STATE = 0x30          # 1-byte DeviceState payload
    PING = 0xF0
    PONG = 0xF1


class DeviceState(IntEnum):
    IDLE = 0x00
    LISTENING = 0x01
    THINKING = 0x02
    SPEAKING = 0x03
    ERROR = 0x04
    AUTH_REVOKED = 0x05


class FrameDecodeError(ValueError):
    pass


@dataclass(frozen=True)
class DecodedFrame:
    frame_type: int
    payload: bytes


def _coerce_frame_type(frame_type: int | FrameType) -> int:
    value = int(frame_type)
    if not 0 <= value <= 0xFF:
        raise ValueError("Frame type must fit in one byte")
    return value


def encode(
    frame_type: int | FrameType,
    payload: bytes | bytearray | memoryview | None = None,
) -> bytes:
    body = bytes(payload or b"")
    length = len(body)
    if length > MAX_UINT24:
        raise ValueError("Frame payload exceeds uint24 length limit")

    type_byte = _coerce_frame_type(frame_type)
    return bytes(
        [
            type_byte,
            (length >> 16) & 0xFF,
            (length >> 8) & 0xFF,
            length & 0xFF,
        ]
    ) + body


def decode(message: bytes | bytearray | memoryview) -> DecodedFrame:
    data = bytes(message)
    if len(data) < HEADER_SIZE:
        raise FrameDecodeError("Frame is shorter than the 4-byte header")

    declared_length = (data[1] << 16) | (data[2] << 8) | data[3]
    payload = data[HEADER_SIZE:]
    if declared_length != len(payload):
        raise FrameDecodeError("Frame payload length does not match header")

    raw_type = data[0]
    try:
        frame_type: int = FrameType(raw_type)
    except ValueError:
        frame_type = raw_type

    return DecodedFrame(frame_type=frame_type, payload=payload)


def state_payload(state: DeviceState) -> bytes:
    return bytes([int(state)])


# ---- Legacy aliases (Phase 0 callers) ------------------------------
# Keep the old names alive for one minor cycle so Phase 0 imports
# continue to compile while the renames propagate.
encode_frame = encode
decode_frame = decode
