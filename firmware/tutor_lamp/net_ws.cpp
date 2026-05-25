#include "net_ws.h"
#include "config.h"

#include <WebSocketsClient.h>
#include <esp_random.h>

namespace lumos {

namespace {

WebSocketsClient ws_;
String           jwt_;
ConnState        state_           = NET_DISCONNECTED;
FrameHandler     on_frame_cb_;
StateHandler     on_state_cb_;
uint32_t         next_ping_at_    = 0;
uint32_t         next_reconnect_at_ = 0;
uint8_t          backoff_step_    = 0;

void set_state(ConnState next) {
    if (state_ == next) return;
    state_ = next;
    if (on_state_cb_) on_state_cb_(next);
}

uint32_t backoff_ms() {
    // 2,4,8,16,30,30 seconds ±25% jitter (per IMPLEMENTATION_WEBSOCKET.md T8)
    static const uint32_t base[] = {2000, 4000, 8000, 16000, 30000, 30000};
    uint32_t step = backoff_step_ < 6 ? backoff_step_ : 5;
    uint32_t b = base[step];
    int32_t jitter = (int32_t)(b / 4);
    int32_t delta = (int32_t)(esp_random() % (jitter * 2 + 1)) - jitter;
    return (uint32_t)((int32_t)b + delta);
}

void on_ws_event(WStype_t type, uint8_t *payload, size_t length) {
    switch (type) {
        case WStype_CONNECTED:
            Serial.println("[ws] connected");
            backoff_step_ = 0;
            next_ping_at_ = millis() + LUMOS_HEARTBEAT_MS;
            set_state(NET_CONNECTED);
            break;

        case WStype_DISCONNECTED:
            // Close code is inside payload for some libraries; we lack reliable
            // accessors via WebSocketsClient. Treat 4401/4402/4426 as fatal by
            // probing payload bytes when present.
            if (length >= 2) {
                uint16_t code = (payload[0] << 8) | payload[1];
                if (code == 4401 || code == 4402 || code == 4426) {
                    Serial.printf("[ws] fatal close %u — clearing JWT\n", code);
                    set_state(NET_FATAL);
                    return;
                }
            }
            Serial.println("[ws] disconnected, scheduling reconnect");
            next_reconnect_at_ = millis() + backoff_ms();
            backoff_step_ += 1;
            set_state(NET_BACKOFF);
            break;

        case WStype_BIN: {
            if (length < 4) return;
            uint8_t  type_byte = payload[0];
            uint32_t declared  = ((uint32_t)payload[1] << 16) |
                                 ((uint32_t)payload[2] << 8)  |
                                 (uint32_t)payload[3];
            if (declared + 4 != length) return;
            if (on_frame_cb_) on_frame_cb_(type_byte, payload + 4, declared);
            break;
        }

        case WStype_ERROR:
            Serial.println("[ws] error");
            break;

        default:
            break;
    }
}

}  // namespace

bool ws_begin(const String &device_jwt) {
    if (device_jwt.length() == 0) return false;
    jwt_ = device_jwt;

    String extra_headers = String("Authorization: Bearer ") + jwt_;
    ws_.setExtraHeaders(extra_headers.c_str());
    ws_.onEvent(on_ws_event);

#if LUMOS_USE_TLS
    ws_.beginSSL(LUMOS_BACKEND_HOST, LUMOS_BACKEND_PORT, LUMOS_WS_PATH);
#else
    ws_.begin(LUMOS_BACKEND_HOST, LUMOS_BACKEND_PORT, LUMOS_WS_PATH);
#endif

    ws_.setReconnectInterval(0);  // we manage backoff ourselves
    set_state(NET_CONNECTING);
    return true;
}

void ws_connect() {
    if (state_ == NET_FATAL) return;
    next_reconnect_at_ = millis();
    set_state(NET_CONNECTING);
}

void ws_loop() {
    ws_.loop();

    if (state_ == NET_FATAL) {
        return;
    }
    if (state_ == NET_BACKOFF && (int32_t)(millis() - next_reconnect_at_) >= 0) {
        Serial.println("[ws] reconnecting");
        ws_.disconnect();
#if LUMOS_USE_TLS
        ws_.beginSSL(LUMOS_BACKEND_HOST, LUMOS_BACKEND_PORT, LUMOS_WS_PATH);
#else
        ws_.begin(LUMOS_BACKEND_HOST, LUMOS_BACKEND_PORT, LUMOS_WS_PATH);
#endif
        set_state(NET_CONNECTING);
    }

    if (state_ == NET_CONNECTED && (int32_t)(millis() - next_ping_at_) >= 0) {
        ws_send_frame(FRAME_PING, nullptr, 0);
        next_ping_at_ = millis() + LUMOS_HEARTBEAT_MS;
    }
}

bool ws_send_frame(uint8_t type, const uint8_t* payload, size_t len) {
    if (state_ != NET_CONNECTED) return false;
    if (len > 0x00FFFFFF) return false;

    size_t total = 4 + len;
    uint8_t *buf = (uint8_t *)malloc(total);
    if (!buf) return false;
    buf[0] = type;
    buf[1] = (uint8_t)((len >> 16) & 0xFF);
    buf[2] = (uint8_t)((len >> 8) & 0xFF);
    buf[3] = (uint8_t)(len & 0xFF);
    if (len && payload) memcpy(buf + 4, payload, len);
    bool ok = ws_.sendBIN(buf, total);
    free(buf);
    return ok;
}

void      ws_on_frame(FrameHandler cb)  { on_frame_cb_ = std::move(cb); }
void      ws_on_state(StateHandler cb)  { on_state_cb_ = std::move(cb); }
ConnState ws_state()                    { return state_; }

}  // namespace lumos
