"""Liveness + readiness probes."""

from fastapi import APIRouter

from ..providers.llm_gemini import get_llm
from ..providers.tts_cartesia import get_tts


router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "lumos-gateway", "phase": "1"}


@router.get("/readyz")
async def readyz() -> dict[str, object]:
    return {
        "llm": get_llm().name,
        "tts": get_tts().name,
    }
