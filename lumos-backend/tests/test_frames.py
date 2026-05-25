import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from schemas.frames import (  # noqa: E402
    FrameDecodeError,
    FrameType,
    decode_frame,
    encode_frame,
)


class FrameProtocolTests(unittest.TestCase):
    def test_round_trips_binary_frame_with_uint24_big_endian_length(self):
        payload = b"\x01\x02hello"

        encoded = encode_frame(FrameType.AUDIO_CHUNK, payload)

        self.assertEqual(encoded[:4], b"\x02\x00\x00\x07")
        decoded = decode_frame(encoded)
        self.assertEqual(decoded.frame_type, FrameType.AUDIO_CHUNK)
        self.assertEqual(decoded.payload, payload)

    def test_rejects_declared_length_mismatch(self):
        with self.assertRaises(FrameDecodeError):
            decode_frame(b"\x02\x00\x00\x05abc")

    def test_rejects_payloads_over_uint24_limit(self):
        with self.assertRaises(ValueError):
            encode_frame(FrameType.IMAGE_JPEG, b"x" * 16_777_216)


if __name__ == "__main__":
    unittest.main()
