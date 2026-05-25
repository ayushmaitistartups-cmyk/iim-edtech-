"""Shared pytest config — ensures ``lumos-backend/`` is importable as
top-level packages (gateway, schemas, storage) and sets test-mode env."""

import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("DEVICE_JWT_SECRET", "test-device-jwt-secret")
os.environ.setdefault("FRONTEND_BASE_URL", "https://app.test.local")
