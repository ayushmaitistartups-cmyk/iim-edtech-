"""Frame protocol round-trip + Phase 1 additions (IMAGE_PART, TFT_PART)."""

import unittest

from app.protocol import (
    FrameDecodeError,
    FrameType,
    decode,
    encode,
)


class FrameProtocolTests(unittest.TestCase):
    def test_round_trips_binary_frame_with_uint24_big_endian_length(self):
        payload = b"\x01\x02hello"
        encoded = encode(FrameType.AUDIO_CHUNK, payload)
        self.assertEqual(encoded[:4], b"\x02\x00\x00\x07")
        decoded = decode(encoded)
        self.assertEqual(decoded.frame_type, FrameType.AUDIO_CHUNK)
        self.assertEqual(decoded.payload, payload)

    def test_rejects_declared_length_mismatch(self):
        with self.assertRaises(FrameDecodeError):
            decode(b"\x02\x00\x00\x05abc")

    def test_rejects_payloads_over_uint24_limit(self):
        with self.assertRaises(ValueError):
            encode(FrameType.IMAGE_JPEG, b"x" * 16_777_216)

    def test_image_part_and_image_jpeg_terminator_codes(self):
        # Phase 1 chunked-image protocol: 0x05 IMAGE_PART, 0x01 IMAGE_JPEG.
        self.assertEqual(int(FrameType.IMAGE_PART), 0x05)
        self.assertEqual(int(FrameType.IMAGE_JPEG), 0x01)
        part = encode(FrameType.IMAGE_PART, b"abcd")
        self.assertEqual(part[0], 0x05)
        term = encode(FrameType.IMAGE_JPEG, b"efgh")
        self.assertEqual(term[0], 0x01)

    def test_tft_part_and_tft_frame_terminator_codes(self):
        # Phase 1 chunked-TFT protocol: 0x23 TFT_PART, 0x20 TFT_FRAME.
        self.assertEqual(int(FrameType.TFT_PART), 0x23)
        self.assertEqual(int(FrameType.TFT_FRAME), 0x20)

    def test_decode_accepts_zero_length_frames(self):
        for ft in (
            FrameType.AUDIO_END,
            FrameType.CANCEL,
            FrameType.AUDIO_OUT_END,
            FrameType.TFT_CLEAR,
            FrameType.PING,
            FrameType.PONG,
        ):
            wire = encode(ft)
            self.assertEqual(len(wire), 4)
            decoded = decode(wire)
            self.assertEqual(decoded.frame_type, ft)
            self.assertEqual(decoded.payload, b"")


if __name__ == "__main__":
    unittest.main()
