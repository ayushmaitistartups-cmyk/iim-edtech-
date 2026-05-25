// LUMOS Tutor Lamp — ESP32-S3 firmware, Phase 0 entrypoint.
//
// Boot sequence:
//   1. Init NVS (device_id/secret/JWT)
//   2. Connect WiFi
//   3. If no JWT: enter pairing mode (POST register → poll until paired)
//   4. Open WSS to /lamp/ws with Bearer JWT
//   5. Service ws_loop() + react to incoming TFT_TEXT / STATE frames
//
// Audio capture, TTS playback, wake-word detection arrive in Phases 1-3.

#include "config.h"
#include "net_ws.h"
#include "provisioning.h"

#include <Arduino.h>
#include <WiFi.h>

namespace {

void connect_wifi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(LUMOS_WIFI_SSID, LUMOS_WIFI_PASSWORD);
    Serial.print("[wifi] connecting");
    uint32_t deadline = millis() + 30000;
    while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
        Serial.print('.');
        delay(500);
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[wifi] up: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[wifi] connect failed — restarting in 5s");
        delay(5000);
        ESP.restart();
    }
}

void on_state(lumos::ConnState st) {
    switch (st) {
        case lumos::NET_CONNECTED:
            Serial.println("[lamp] backend connected");
            break;
        case lumos::NET_BACKOFF:
            Serial.println("[lamp] backend dropped, waiting for backoff");
            break;
        case lumos::NET_FATAL:
            Serial.println("[lamp] fatal close — clearing JWT, will re-pair on next boot");
            lumos::clear_jwt();
            delay(2000);
            ESP.restart();
            break;
        default:
            break;
    }
}

void on_frame(uint8_t type, const uint8_t* payload, size_t len) {
    switch (type) {
        case lumos::FRAME_PONG:
            // No-op; cadence enforcement happens server-side.
            break;
        case lumos::FRAME_STATE:
            if (len >= 1) {
                Serial.printf("[lamp] STATE 0x%02X\n", payload[0]);
                // TODO Phase 0.5: drive WS2812B status LED:
                //   0x00 idle → cyan, 0x02 thinking → orange,
                //   0x03 speaking → yellow, 0x05 → red.
            }
            break;
        case lumos::FRAME_TFT_TEXT:
            Serial.printf("[lamp] TFT_TEXT: %.*s\n", (int)len, (const char*)payload);
            // TODO Phase 0.5: render on ILI9341 in the conceptual-track text style.
            break;
        case lumos::FRAME_TFT_CLEAR:
            Serial.println("[lamp] TFT_CLEAR");
            break;
        case lumos::FRAME_AUDIO_OUT:
        case lumos::FRAME_AUDIO_OUT_END:
            // Phase 3 will route these to MAX98357A I2S out.
            break;
        case lumos::FRAME_TFT_FRAME:
            // Phase 3 will render pre-rendered LaTeX pixels on the TFT.
            break;
        default:
            Serial.printf("[lamp] unhandled frame 0x%02X (%u bytes)\n", type, (unsigned)len);
            break;
    }
}

}  // namespace

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n[lamp] booting");

    lumos::provisioning_begin();
    Serial.printf("[lamp] device_id=%s\n", lumos::device_id().c_str());

    connect_wifi();

    if (!lumos::ensure_paired()) {
        Serial.println("[lamp] pairing failed — restarting in 5s");
        delay(5000);
        ESP.restart();
    }

    lumos::ws_on_state(on_state);
    lumos::ws_on_frame(on_frame);
    if (!lumos::ws_begin(lumos::device_jwt())) {
        Serial.println("[lamp] ws_begin failed — restarting in 5s");
        delay(5000);
        ESP.restart();
    }
}

void loop() {
    lumos::ws_loop();
    // Phase 0 quick test: every 30s emit AUDIO_END to exercise the stub turn.
    // Phases 1+ replace this with wake-word + audio capture from INMP441.
    static uint32_t next_smoke = 0;
    if ((int32_t)(millis() - next_smoke) >= 0 && lumos::ws_state() == lumos::NET_CONNECTED) {
        lumos::ws_send_frame(lumos::FRAME_AUDIO_END, nullptr, 0);
        next_smoke = millis() + 30000;
    }
    delay(2);
}
