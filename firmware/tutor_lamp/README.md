# tutor_lamp — LUMOS Phase 0 firmware

Arduino sketch for the ESP32-S3 tutor lamp. Phase 0 scope: pairing flow,
device JWT storage in NVS, persistent WSS connection to `/lamp/ws`,
binary-frame protocol, 10 s heartbeat, exponential backoff reconnect.

Wake-word, audio capture, TTS playback, and TFT renderer arrive in
later phases. See [`update/changes/IMPLEMENTATION_WEBSOCKET.md`](../../update/changes/IMPLEMENTATION_WEBSOCKET.md)
and [`update/changes/IMPLEMENTATION_AUTH_PAIRING.md`](../../update/changes/IMPLEMENTATION_AUTH_PAIRING.md).

## Build

Arduino IDE 2 or `arduino-cli`. Required libraries:

- `WebSockets` (Links2004 / arduinoWebSockets)
- `ArduinoJson` (^7.0)
- `Preferences` (bundled with ESP32 core)

Set WiFi + backend host via build flags (recommended) or edit `config.h`:

```
arduino-cli compile \
  --fqbn esp32:esp32:esp32s3 \
  --build-property "build.extra_flags=-DLUMOS_WIFI_SSID=\"my-wifi\" -DLUMOS_WIFI_PASSWORD=\"my-pwd\" -DLUMOS_BACKEND_HOST=\"192.168.1.42\"" \
  firmware/tutor_lamp
```

## Flash

```
arduino-cli upload --fqbn esp32:esp32:esp32s3 --port COM5 firmware/tutor_lamp
```

## Smoke test

1. Open the serial monitor at 115200 baud.
2. The lamp prints `device_id=lamp-…` and `[pair] open http://<host>:8000/pair/<code>`.
3. Sign in to the web app and visit that URL to claim the lamp.
4. Lamp logs `[pair] success, JWT saved` and `[ws] connected`.
5. Every 30 s the lamp emits `AUDIO_END` for a smoke turn; the gateway
   replies with `STATE(thinking) → TFT_TEXT → AUDIO_OUT_END → STATE(idle)`.
6. Power-cycle to confirm the JWT in NVS persists and re-pairing is skipped.
