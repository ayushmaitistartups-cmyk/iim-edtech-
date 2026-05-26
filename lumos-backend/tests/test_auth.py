import time
import unittest

from app.auth.device_jwt import (
    DeviceJwtError,
    JWT_ISSUER,
    JWT_VERSION,
    create_device_jwt,
    generate_pairing_code,
    hash_device_secret,
    normalize_pairing_code,
    verify_device_jwt,
    verify_device_secret,
)


class DeviceAuthTests(unittest.TestCase):
    def test_hashes_and_verifies_device_secret_without_storing_plaintext(self):
        secret = "lamp-only-secret"
        digest = hash_device_secret(secret, salt=b"0" * 16)
        self.assertNotIn(secret, digest)
        self.assertTrue(verify_device_secret(secret, digest))
        self.assertFalse(verify_device_secret("wrong-secret", digest))

    def test_mints_backend_owned_jwt_and_rejects_tampering(self):
        token = create_device_jwt(
            device_id="lamp-ABC123",
            user_id="user_123",
            signing_secret="backend-device-secret",
            issued_at=int(time.time()),
        )
        claims = verify_device_jwt(token, "backend-device-secret")
        self.assertEqual(claims["sub"], "lamp-ABC123")
        self.assertEqual(claims["uid"], "user_123")
        self.assertEqual(claims["iss"], JWT_ISSUER)
        self.assertEqual(claims["ver"], JWT_VERSION)
        with self.assertRaises(DeviceJwtError):
            verify_device_jwt(token + "x", "backend-device-secret")

    def test_pairing_code_is_six_readable_characters_and_normalized(self):
        code = generate_pairing_code()
        self.assertRegex(code, r"^[A-Z0-9]{6}$")
        self.assertEqual(normalize_pairing_code("ab-c 123"), "ABC123")


if __name__ == "__main__":
    unittest.main()
