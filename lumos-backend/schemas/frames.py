"""Binary frame protocol shared by ESP32 lamp firmware and the gateway WebSocket.

Wire format: 4-byte header (1 type + 3-byte big-endian payload length) followed
by ``payload_length`` bytes of payload. See ``update/changes/IMPLEMENTATION_WEBSOCKET.md``.
"""

from dataclasses import dataclass
from enum import IntEnum


MAX_UINT24 = 0xFFFFFF
HEADER_SIZE = 4


class FrameType(IntEnum):
    IMAGE_JPEG = 0x01
    AUDIO_CHUNK = 0x02
    AUDIO_END = 0x03
    CANCEL = 0x04
    AUDIO_OUT = 0x10
    AUDIO_OUT_END = 0x11
    TFT_FRAME = 0x20
    TFT_TEXT = 0x21
    TFT_CLEAR = 0x22
    STATE = 0x30
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


def encode_frame(
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


def decode_frame(message: bytes | bytearray | memoryview) -> DecodedFrame:
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
