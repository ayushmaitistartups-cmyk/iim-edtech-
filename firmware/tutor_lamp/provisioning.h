#pragma once

#include <Arduino.h>

// Provisioning — owns device identity stored in NVS:
//   device_id     stable lamp identifier (assigned on first boot)
//   device_secret HMAC-friendly secret used to prove device identity to backend
//   device_jwt    backend-signed bearer token used for /lamp/ws connections
//
// API mirrors `update/changes/IMPLEMENTATION_AUTH_PAIRING.md` §firmware.

namespace lumos {

void provisioning_begin();                   // open NVS, initialise IDs if absent

bool ensure_paired();                        // full pairing flow if no JWT — returns true when JWT present
String device_id();                          // 16-char hex assigned on first boot
String device_jwt();                         // empty if not yet paired
void   clear_jwt();                          // wipes JWT, re-enter pairing on next boot
void   factory_reset();                      // wipes device_id, secret, JWT

// Internal helpers, exposed for unit testing.
String generate_device_id();
String generate_device_secret();

}  // namespace lumos
