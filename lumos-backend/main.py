"""LUMOS v4 gateway entrypoint.

Phase 0 surface:
- REST: device pairing + management endpoints (``/api/device/*``, ``/api/devices``,
  ``/api/pairing-info/{code}``)
- WebSocket: ``/lamp/ws`` (binary frame protocol, device JWT auth)

Run with::

    uvicorn main:app --reload --port 8000 --app-dir lumos-backend
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from gateway import pairing as pairing_module
from gateway import websocket as websocket_module
from storage.devices import DeviceRegistry


load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lumos_backend")

DEVICE_STORE_PATH = Path(
    os.getenv("DEVICE_STORE_PATH", str(Path(__file__).with_name(".device_store.json")))
)

device_registry = DeviceRegistry(DEVICE_STORE_PATH)


def _get_device_registry_override() -> DeviceRegistry:
    return device_registry


app = FastAPI(title="LUMOS v4 Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.dependency_overrides[pairing_module.get_device_registry] = _get_device_registry_override

app.include_router(pairing_module.router)
app.include_router(websocket_module.router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "lumos-gateway", "phase": "0"}
