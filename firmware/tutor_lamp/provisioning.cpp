#include "provisioning.h"
#include "config.h"

#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_random.h>

#include <ArduinoJson.h>

namespace lumos {

namespace {

Preferences prefs;

String hex_random(size_t bytes) {
    static const char hexchars[] = "0123456789abcdef";
    String out;
    out.reserve(bytes * 2);
    for (size_t i = 0; i < bytes; ++i) {
        uint8_t byte = esp_random() & 0xFF;
        out += hexchars[(byte >> 4) & 0x0F];
        out += hexchars[byte & 0x0F];
    }
    return out;
}

String backend_base_url() {
    const char *scheme = LUMOS_USE_TLS ? "https" : "http";
    String url(scheme);
    url += "://";
    url += LUMOS_BACKEND_HOST;
    url += ':';
    url += String(LUMOS_BACKEND_PORT);
    return url;
}

bool post_json(const String &path, const String &body, String &response_body, int &status_code) {
    if (WiFi.status() != WL_CONNECTED) {
        return false;
    }

    HTTPClient http;
    String url = backend_base_url() + path;
    if (!http.begin(url)) {
        return false;
    }
    http.addHeader("Content-Type", "application/json");
    status_code = http.POST(body);
    response_body = http.getString();
    http.end();
    return status_code >= 0;
}

}  // namespace

String generate_device_id() {
    return String("lamp-") + hex_random(6);
}

String generate_device_secret() {
    return hex_random(24);
}

void provisioning_begin() {
    prefs.begin(LUMOS_NVS_NAMESPACE, /*readOnly=*/false);

    String stored_id = prefs.getString(LUMOS_NVS_DEVICE_ID, "");
    if (stored_id.length() == 0) {
        stored_id = generate_device_id();
        prefs.putString(LUMOS_NVS_DEVICE_ID, stored_id);
    }
    String stored_secret = prefs.getString(LUMOS_NVS_DEVICE_SEC, "");
    if (stored_secret.length() == 0) {
        stored_secret = generate_device_secret();
        prefs.putString(LUMOS_NVS_DEVICE_SEC, stored_secret);
    }
}

String device_id() {
    return prefs.getString(LUMOS_NVS_DEVICE_ID, "");
}

String device_jwt() {
    return prefs.getString(LUMOS_NVS_DEVICE_JWT, "");
}

void clear_jwt() {
    prefs.remove(LUMOS_NVS_DEVICE_JWT);
}

void factory_reset() {
    prefs.clear();
}

static String request_pairing_code(String &display_code_out, uint32_t &expires_at_out) {
    StaticJsonDocument<256> req;
    req["device_id"] = device_id();
    req["device_secret"] = prefs.getString(LUMOS_NVS_DEVICE_SEC, "");
    String body;
    serializeJson(req, body);

    String resp;
    int status = 0;
    if (!post_json(LUMOS_REGISTER_PATH, body, resp, status) || status != 200) {
        Serial.printf("[pair] register failed status=%d body=%s\n", status, resp.c_str());
        return "";
    }

    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, resp);
    if (err) {
        Serial.printf("[pair] register response parse error: %s\n", err.c_str());
        return "";
    }
    display_code_out = doc["display_code"].as<String>();
    expires_at_out = doc["expires_at"].as<uint32_t>();
    return doc["pairing_code"].as<String>();
}

static bool poll_for_jwt(const String &pairing_code) {
    StaticJsonDocument<256> req;
    req["device_id"] = device_id();
    req["device_secret"] = prefs.getString(LUMOS_NVS_DEVICE_SEC, "");
    req["pairing_code"] = pairing_code;
    String body;
    serializeJson(req, body);

    String resp;
    int status = 0;
    if (!post_json(LUMOS_POLL_PATH, body, resp, status) || status != 200) {
        Serial.printf("[pair] poll failed status=%d body=%s\n", status, resp.c_str());
        return false;
    }

    StaticJsonDocument<1024> doc;
    if (deserializeJson(doc, resp)) return false;

    String s = doc["status"].as<String>();
    if (s == "paired") {
        prefs.putString(LUMOS_NVS_DEVICE_JWT, doc["device_jwt"].as<String>());
        return true;
    }
    return false;
}

bool ensure_paired() {
    if (device_jwt().length() > 0) {
        return true;
    }

    String display_code;
    uint32_t expires_at = 0;
    String pairing_code = request_pairing_code(display_code, expires_at);
    if (pairing_code.length() == 0) {
        return false;
    }

    Serial.printf("[pair] open %s/pair/%s to link this lamp\n",
                  backend_base_url().c_str(), pairing_code.c_str());
    Serial.printf("[pair] display code: %s\n", display_code.c_str());
    // TODO Phase 0.5: render QR + display_code on TFT here.

    uint32_t deadline = millis() + LUMOS_PAIR_TIMEOUT_S * 1000UL;
    while (millis() < deadline) {
        if (poll_for_jwt(pairing_code)) {
            Serial.println("[pair] success, JWT saved");
            return true;
        }
        delay(LUMOS_PAIR_POLL_MS);
    }
    Serial.println("[pair] timeout");
    return false;
}

}  // namespace lumos
