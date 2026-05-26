"""Shared pytest config — keeps the project root on ``sys.path`` so tests
can ``from app...`` without a venv-install of the package, and forces
provider/auth env into a known dev state.
"""

import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Test-mode env — must be set before ``app.config`` imports.
os.environ.setdefault("DEVICE_JWT_SECRET", "test-device-jwt-secret")
os.environ.setdefault("FRONTEND_BASE_URL", "https://app.test.local")
os.environ.setdefault("ENABLE_AUTH", "0")
os.environ.setdefault("LLM_PROVIDER", "gemini")
os.environ.setdefault("TTS_PROVIDER", "cartesia")
# Force the mock paths unless a test explicitly sets the keys.
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("CARTESIA_API_KEY", None)
