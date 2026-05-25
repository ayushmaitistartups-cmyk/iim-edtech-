#pragma once

// =====================================================================
//   LUMOS Tutor Lamp — ESP32-S3 firmware build-time configuration
// =====================================================================
//
// Phase 0 surface: WiFi connect → pairing → WSS bearer-JWT connect →
// PING/PONG heartbeat → render TFT_TEXT → STATE LED updates.
//
// Audio capture / TTS playback / wake-word are added in Phases 1-3.
// =====================================================================

// ---- WiFi (override per-device via build flags or runtime provisioning) ----
#ifndef LUMOS_WIFI_SSID
#define LUMOS_WIFI_SSID "ChangeMeAtBuildTime"
#endif

#ifndef LUMOS_WIFI_PASSWORD
#define LUMOS_WIFI_PASSWORD "ChangeMeAtBuildTime"
#endif

// ---- Backend endpoints ----
// Set LUMOS_BACKEND_HOST to your dev/prod gateway host. Use HTTPS/WSS in prod.
#ifndef LUMOS_BACKEND_HOST
#define LUMOS_BACKEND_HOST "192.168.1.100"
#endif

#ifndef LUMOS_BACKEND_PORT
#define LUMOS_BACKEND_PORT 8000
#endif

#ifndef LUMOS_USE_TLS
#define LUMOS_USE_TLS 0   // 1 = wss/https, 0 = ws/http (dev only)
#endif

#define LUMOS_WS_PATH         "/lamp/ws"
#define LUMOS_REGISTER_PATH   "/api/device/register"
#define LUMOS_POLL_PATH       "/api/device/poll-pairing"

// ---- NVS keys ----
#define LUMOS_NVS_NAMESPACE   "lumos"
#define LUMOS_NVS_DEVICE_ID   "device_id"
#define LUMOS_NVS_DEVICE_SEC  "device_secret"
#define LUMOS_NVS_DEVICE_JWT  "device_jwt"

// ---- Pin map (ESP32-S3 dev board; adjust to your PCB) ----
// Per HARDWARE_CONTEXT.md: INMP441 mic, OV5640 cam, MAX98357A speaker,
// ILI9341 TFT 240×320, WS2812B status LED. Phase 0 only uses TFT + LED.

#define LUMOS_PIN_TFT_CS      10
#define LUMOS_PIN_TFT_DC      11
#define LUMOS_PIN_TFT_RST     12
#define LUMOS_PIN_TFT_BL      13

#define LUMOS_PIN_LED_STATUS  48   // WS2812B data pin
#define LUMOS_LED_COUNT       1

// ---- Timings ----
#define LUMOS_HEARTBEAT_MS    10000   // PING cadence per protocol spec
#define LUMOS_PAIR_POLL_MS     3000   // pairing-poll cadence
#define LUMOS_PAIR_TIMEOUT_S    300   // pairing-code TTL on backend
