// Model Context Protocol over Streamable HTTP, stateless: each POST /mcp
// carries one JSON-RPC message and gets one JSON response. The tools only talk
// to the wall through the Wall interface, so the protocol code runs on the Mac
// in tests with a fake wall.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "../render/render.h"

namespace vt {

struct ToolOutput {
    bool isError = false;
    std::string text;
    std::vector<std::uint8_t> png;  // attached as an image when not empty
};

class Wall {
public:
    virtual ~Wall() = default;
    virtual ToolOutput showScreen(const Screen& screen) = 0;
    virtual ToolOutput previewScreen(const Screen& screen) = 0;
    virtual ToolOutput getScreen() = 0;
    virtual ToolOutput clearScreen() = 0;
};

struct HttpReply {
    int status = 200;
    std::string body;  // empty for 202
};

HttpReply handleMcpRequest(const std::string& requestBody, Wall& wall);

}  // namespace vt
