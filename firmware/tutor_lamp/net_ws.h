#pragma once

#include <Arduino.h>
#include <functional>

namespace lumos {

enum FrameType : uint8_t {
    FRAME_IMAGE_JPEG   = 0x01,
    FRAME_AUDIO_CHUNK  = 0x02,
    FRAME_AUDIO_END    = 0x03,
    FRAME_CANCEL       = 0x04,
    FRAME_AUDIO_OUT    = 0x10,
    FRAME_AUDIO_OUT_END= 0x11,
    FRAME_TFT_FRAME    = 0x20,
    FRAME_TFT_TEXT     = 0x21,
    FRAME_TFT_CLEAR    = 0x22,
    FRAME_STATE        = 0x30,
    FRAME_PING         = 0xF0,
    FRAME_PONG         = 0xF1,
};

enum DeviceState : uint8_t {
    STATE_IDLE         = 0x00,
    STATE_LISTENING    = 0x01,
    STATE_THINKING     = 0x02,
    STATE_SPEAKING     = 0x03,
    STATE_ERROR        = 0x04,
    STATE_AUTH_REVOKED = 0x05,
};

enum ConnState : uint8_t {
    NET_DISCONNECTED,
    NET_CONNECTING,
    NET_CONNECTED,
    NET_BACKOFF,
    NET_FATAL,             // 4401/4402/4426: do not retry
};

// Callbacks
using FrameHandler = std::function<void(uint8_t type, const uint8_t* payload, size_t len)>;
using StateHandler = std::function<void(ConnState)>;

// Module API (mirrors update/changes/IMPLEMENTATION_WEBSOCKET.md §net_ws.h)
bool      ws_begin(const String &device_jwt);  // wire up callbacks, start state machine
void      ws_connect();                        // request connect (idempotent)
void      ws_loop();                           // call every loop() iteration
bool      ws_send_frame(uint8_t type, const uint8_t* payload, size_t len);
void      ws_on_frame(FrameHandler cb);
void      ws_on_state(StateHandler cb);
ConnState ws_state();

}  // namespace lumos
