"""Env-driven settings for the LUMOS gateway.

Everything is read once at import time; values are immutable thereafter.
"""

import os
from dataclasses import dataclass
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    # ---- runtime --------------------------------------------------------
    enable_auth: bool = _bool("ENABLE_AUTH", False)
    cors_allow_origins: tuple[str, ...] = tuple(
        s.strip() for s in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",") if s.strip()
    )

    # ---- providers ------------------------------------------------------
    llm_provider: str = os.getenv("LLM_PROVIDER", "gemini")
    tts_provider: str = os.getenv("TTS_PROVIDER", "cartesia")
    gemini_api_key: str | None = os.getenv("GEMINI_API_KEY")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    gemini_pro_model: str = os.getenv("GEMINI_PRO_MODEL", "gemini-2.5-pro")
    groq_api_key: str | None = os.getenv("GROQ_API_KEY")
    cartesia_api_key: str | None = os.getenv("CARTESIA_API_KEY")
    cartesia_voice_id: str | None = os.getenv("CARTESIA_VOICE_ID")

    # ---- Phase 3: escalation -------------------------------------------
    confidence_escalate_below: float = float(os.getenv("CONFIDENCE_ESCALATE_BELOW", "0.60"))
    confidence_review_below: float = float(os.getenv("CONFIDENCE_REVIEW_BELOW", "0.85"))

    # ---- Phase 6: latency optimisation ---------------------------------
    streaming_tts: bool = _bool("STREAMING_TTS", False)
    gemini_context_cache: bool = _bool("GEMINI_CONTEXT_CACHE", True)
    gemini_cache_ttl_s: int = int(os.getenv("GEMINI_CACHE_TTL_S", "3600"))

    # ---- pairing / auth (deferred per BACKEND_TODO Layer 10) ------------
    device_jwt_secret: str = os.getenv("DEVICE_JWT_SECRET", "dev-device-jwt-secret-change-me")
    frontend_base_url: str = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")
    device_store_path: Path = Path(
        os.getenv("DEVICE_STORE_PATH", str(Path(__file__).resolve().parents[1] / ".device_store.json"))
    )
    trust_unsigned_clerk_jwt: bool = _bool("TRUST_UNSIGNED_CLERK_JWT", True)

    # ---- protocol -------------------------------------------------------
    # Lamp's ArduinoWebsockets RX cannot allocate >4 KB std::string under
    # load. Stay well below that — BACKEND_DESIGN §4.5 + BACKEND_TODO §6.2.
    ws_inbound_max_bytes: int = 2 * 1024
    # Cartesia output → 4 KB int16 chunks paced at 85 ms (matches the lamp's
    # 64 KB I2S ring drain rate at 24 kHz mono — BACKEND_TODO §7.3).
    tts_chunk_bytes: int = 4 * 1024
    tts_chunk_pace_s: float = 0.085

    # ---- turn budget ----------------------------------------------------
    audio_min_seconds: float = 0.5
    audio_max_seconds: float = 30.0
    image_max_bytes: int = 200 * 1024
    llm_max_output_tokens: int = 200
    llm_total_timeout_s: float = 8.0


settings = Settings()
