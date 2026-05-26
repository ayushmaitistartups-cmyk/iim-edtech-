import tempfile
import time
import unittest
from pathlib import Path

from app.auth.device_jwt import verify_device_jwt
from app.auth.devices import DeviceRegistry


class DeviceRegistryTests(unittest.TestCase):
    def test_pairing_flow_returns_device_jwt_to_lamp_poll_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = DeviceRegistry(Path(tmp) / "devices.json", ttl_seconds=300)
            registered = registry.register_device(
                device_id="lamp-ABC123",
                device_secret="lamp-secret",
                frontend_base_url="https://app.example.com",
                now=int(time.time()),
            )
            info = registry.get_pairing_info(registered["pairing_code"], now=int(time.time()))
            completed = registry.complete_pairing(
                pairing_code=registered["pairing_code"],
                user_id="user_123",
                signing_secret="backend-secret",
                now=int(time.time()),
            )
            first_poll = registry.poll_pairing(
                device_id="lamp-ABC123",
                device_secret="lamp-secret",
                pairing_code=registered["pairing_code"],
                now=int(time.time()),
            )
            second_poll = registry.poll_pairing(
                device_id="lamp-ABC123",
                device_secret="lamp-secret",
                pairing_code=registered["pairing_code"],
                now=int(time.time()),
            )

            self.assertEqual(info["device_id"], "lamp-ABC123")
            self.assertEqual(completed["device_id"], "lamp-ABC123")
            self.assertEqual(first_poll["status"], "paired")
            self.assertEqual(
                verify_device_jwt(first_poll["device_jwt"], "backend-secret")["uid"],
                "user_123",
            )
            self.assertEqual(second_poll["status"], "not_found")

    def test_unlink_revokes_device_and_hides_it_from_user_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = DeviceRegistry(Path(tmp) / "devices.json", ttl_seconds=300)
            registered = registry.register_device(
                "lamp-ABC123", "lamp-secret", "https://app.example.com"
            )
            registry.complete_pairing(registered["pairing_code"], "user_123", "backend-secret")
            self.assertEqual(len(registry.list_devices("user_123")), 1)
            registry.unlink_device("lamp-ABC123", "user_123")
            self.assertEqual(registry.list_devices("user_123"), [])
            self.assertIsNone(registry.get_active_device_for_jwt("lamp-ABC123", "user_123"))


if __name__ == "__main__":
    unittest.main()
