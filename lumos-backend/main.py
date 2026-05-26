"""LUMOS v4 gateway entrypoint.

Phase 1 surface:
- WebSocket ``/lamp/ws`` — binary frame protocol, multimodal Gemini brain,
  Cartesia TTS, matplotlib LaTeX renderer.
- REST: pairing endpoints (gated behind ``ENABLE_AUTH``), health probes.

Run with::

    uvicorn main:app --reload --port 8000 --app-dir lumos-backend
"""

import logging

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


load_dotenv()

# Side-effect imports must come AFTER load_dotenv() so settings sees the env.
from app.config import settings  # noqa: E402
from app.logging import setup_logging  # noqa: E402
from app.auth.devices import DeviceRegistry  # noqa: E402
from app.providers import latex_renderer  # noqa: E402
from app.routes import health, pairing  # noqa: E402
from app.routes import ws_lamp  # noqa: E402


setup_logging("INFO")
logger = logging.getLogger("lumos_backend")


# ---- Wiring ---------------------------------------------------------------
device_registry = DeviceRegistry(settings.device_store_path)


def _get_device_registry_override() -> DeviceRegistry:
    return device_registry


# Self-test the LaTeX renderer at boot so we fail loudly if mathtext shifted.
try:
    latex_renderer.selftest()
    logger.info("LaTeX renderer self-test OK")
except Exception as exc:  # pragma: no cover
    logger.warning("LaTeX renderer self-test failed: %s — display kind=latex will fall back to text", exc)


app = FastAPI(title="LUMOS v4 Gateway", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_allow_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inject the registry singleton where routers expect it.
app.dependency_overrides[pairing.get_device_registry] = _get_device_registry_override
app.dependency_overrides[ws_lamp._get_device_registry] = _get_device_registry_override

app.include_router(health.router)
app.include_router(pairing.router)
app.include_router(ws_lamp.router)


@app.get("/")
async def root() -> dict[str, object]:
    return {
        "service": "lumos-gateway",
        "phase": "1",
        "auth_enabled": settings.enable_auth,
        "llm_provider": settings.llm_provider,
        "tts_provider": settings.tts_provider,
    }
