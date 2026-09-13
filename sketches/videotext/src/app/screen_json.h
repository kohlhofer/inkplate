// Turns a request body (HTTP PUT /screen or an MCP tool call) into a Screen,
// and a Screen back into JSON. Shared by both entry points so they accept and
// reject exactly the same things.
#pragma once

#ifndef ARDUINOJSON_ENABLE_STD_STRING
#define ARDUINOJSON_ENABLE_STD_STRING 1
#endif
// The default on 32-bit boards caps strings at 65535 characters, and an MCP
// tool result carries the preview PNG as a ~180 KB base64 string. Every file
// that includes ArduinoJson must go through this header so the setting agrees.
#ifndef ARDUINOJSON_STRING_LENGTH_SIZE
#define ARDUINOJSON_STRING_LENGTH_SIZE 4
#endif
#include <ArduinoJson.h>

#include <string>

#include "../render/render.h"

namespace vt {

struct RequestError {
    std::string code;     // empty when the request is valid
    std::string message;  // says what to change
    bool ok() const { return code.empty(); }
};

// Fills `out` with title, body, footer, theme and chart from `in`. Header
// fields are left for the caller, since the board owns them.
RequestError parseScreenRequest(JsonVariantConst in, Screen& out);

// The sender-controlled fields, in the same shape parseScreenRequest accepts.
void writeScreenFields(JsonObject out, const Screen& screen);

}  // namespace vt
