// Host tests for the board's protocol code: MCP JSON-RPC handling, screen
// request validation and the PNG encoder. Built by `make test-native` without
// the renderer's pixels mattering: the fake wall below never renders.

#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>

#include "../../sketches/videotext/src/app/mcp.h"
#include "../../sketches/videotext/src/app/png.h"
#include "../../sketches/videotext/src/app/screen_json.h"

namespace {

int failures = 0;

void check(bool ok, const char* what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) failures++;
}

struct FakeWall : vt::Wall {
    int shows = 0;
    vt::Screen last;
    vt::ToolOutput showScreen(const vt::Screen& s) override {
        shows++;
        last = s;
        vt::ToolOutput out;
        out.text = "accepted";
        out.png = {1, 2, 3};
        return out;
    }
    vt::ToolOutput previewScreen(const vt::Screen& s) override {
        last = s;
        vt::ToolOutput out;
        out.text = "preview";
        return out;
    }
    vt::ToolOutput getScreen() override {
        vt::ToolOutput out;
        out.text = "current";
        return out;
    }
    vt::ToolOutput clearScreen() override {
        vt::ToolOutput out;
        out.text = "cleared";
        return out;
    }
};

JsonDocument parse(const std::string& s) {
    JsonDocument doc;
    deserializeJson(doc, s);
    return doc;
}

vt::HttpReply call(FakeWall& wall, const std::string& body) {
    return vt::handleMcpRequest(body, wall);
}

}  // namespace

int main(int argc, char** argv) {
    FakeWall wall;

    // initialize: negotiates a known protocol version and hands over the guide.
    {
        auto reply = call(wall, R"({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}})");
        auto doc = parse(reply.body);
        check(reply.status == 200, "initialize answers 200");
        check(std::strcmp(doc["result"]["protocolVersion"] | "", "2025-03-26") == 0, "initialize echoes a supported protocol version");
        check(std::strstr(doc["result"]["instructions"] | "", "48 characters") != nullptr, "initialize carries the wall guide as instructions");
        check(!doc["result"]["capabilities"]["tools"].isNull(), "initialize advertises tools");
    }
    {
        auto doc = parse(call(wall, R"({"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"1999-01-01"}})").body);
        check(std::strcmp(doc["result"]["protocolVersion"] | "", "2025-06-18") == 0, "an unknown protocol version gets the latest");
    }

    // Notifications and client responses have nothing to answer.
    check(call(wall, R"({"jsonrpc":"2.0","method":"notifications/initialized"})").status == 202, "notifications get 202");
    check(call(wall, "not json").status == 400, "invalid JSON gets 400");
    check(call(wall, R"([{"jsonrpc":"2.0","id":1,"method":"ping"}])").status == 400, "batches are refused");
    {
        auto doc = parse(call(wall, R"({"jsonrpc":"2.0","id":"p","method":"ping"})").body);
        check(doc["result"].is<JsonObject>() && std::strcmp(doc["id"] | "", "p") == 0, "ping answers with the same id");
    }
    {
        auto doc = parse(call(wall, R"({"jsonrpc":"2.0","id":3,"method":"resources/list"})").body);
        check((doc["error"]["code"] | 0) == -32601, "unsupported methods get -32601");
    }

    // tools/list: four tools, show_screen fully self-describing.
    {
        auto doc = parse(call(wall, R"({"jsonrpc":"2.0","id":4,"method":"tools/list"})").body);
        JsonArray tools = doc["result"]["tools"];
        check(tools.size() == 4, "tools/list has four tools");
        bool describesMarkup = false, requiresTitle = false, previewReadOnly = false;
        for (JsonObject t : tools) {
            const char* name = t["name"] | "";
            if (std::strcmp(name, "show_screen") == 0) {
                const char* d = t["description"] | "";
                describesMarkup = std::strstr(d, "{red}") && std::strstr(d, "```") && std::strstr(d, "30 seconds");
                requiresTitle = std::strcmp(t["inputSchema"]["required"][0] | "", "title") == 0;
            }
            if (std::strcmp(name, "preview_screen") == 0) previewReadOnly = t["annotations"]["readOnlyHint"] | false;
        }
        check(describesMarkup, "show_screen's description explains tags, fences and refresh time");
        check(requiresTitle, "show_screen requires a title");
        check(previewReadOnly, "preview_screen is marked read-only");
    }

    // tools/call
    {
        auto doc = parse(call(wall, R"({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"show_screen","arguments":{"title":"Hi","body":"{green}ok{/}","chart":{"values":[1,2,3],"label":"x"},"footer":"src","theme":"light"}}})").body);
        check(wall.shows == 1 && wall.last.title == "Hi" && wall.last.chart.present && wall.last.lightTheme && wall.last.footer == "src",
              "show_screen passes a valid screen to the wall");
        check((doc["result"]["isError"] | true) == false, "a valid show_screen is not an error");
        check(std::strcmp(doc["result"]["content"][1]["type"] | "", "image") == 0 &&
                  std::strcmp(doc["result"]["content"][1]["data"] | "", "AQID") == 0,
              "show_screen attaches the preview as a base64 PNG image");
    }
    {
        // A real preview is ~135 KB; its base64 must survive ArduinoJson's string length limit.
        struct BigWall : FakeWall {
            vt::ToolOutput getScreen() override {
                vt::ToolOutput out;
                out.text = "big";
                out.png.assign(135000, 0xAB);
                return out;
            }
        } big;
        auto doc = parse(call(big, R"({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"get_screen","arguments":{}}})").body);
        const char* data = doc["result"]["content"][1]["data"] | "";
        check(std::strlen(data) == 180000, "a full-size preview image survives JSON serialization intact");
    }
    {
        auto doc = parse(call(wall, R"({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"show_screen","arguments":{"body":"no title"}}})").body);
        check((doc["result"]["isError"] | false) == true, "a screen without a title is a tool error, not a protocol error");
        check(std::strstr(doc["result"]["content"][0]["text"] | "", "title") != nullptr, "the error says what to fix");
        check(wall.shows == 1, "an invalid screen never reaches the wall");
    }
    {
        auto doc = parse(call(wall, R"({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"draw_pixels","arguments":{}}})").body);
        check((doc["error"]["code"] | 0) == -32602, "an unknown tool is an invalid-params error");
    }

    // Screen validation
    {
        auto check_rejects = [](const char* json, const char* why) {
            vt::Screen s;
            check(!vt::parseScreenRequest(parse(json), s).ok(), why);
        };
        check_rejects(R"({"title":"t","colour":"red"})", "unknown fields are rejected");
        check_rejects(R"({"title":"   "})", "a blank title is rejected");
        check_rejects(R"({"title":"t","theme":"sepia"})", "an unknown theme is rejected");
        check_rejects(R"({"title":"t","chart":{"type":"pie","values":[1]}})", "an unknown chart type is rejected");
        check_rejects(R"({"title":"t","chart":{"values":[]}})", "an empty chart is rejected");
        check_rejects(R"({"title":"t","chart":{"values":[1,"2"]}})", "non-numeric chart values are rejected");
        std::string big = R"({"title":"t","body":")" + std::string(8193, 'a') + R"("})";
        check_rejects(big.c_str(), "a body over 8192 bytes is rejected");

        {
            vt::Screen c;
            const bool ok = vt::parseScreenRequest(parse(R"({"title":"t","chart":{"values":[21.7,-19.55,3]}})"), c).ok();
            check(ok && c.chart.values[0] == 21.7 && c.chart.values[1] == -19.55 && c.chart.values[2] == 3,
                  "chart values keep their decimal value despite ArduinoJson's float storage");
        }

        vt::Screen s;
        const auto err = vt::parseScreenRequest(parse(R"({"title":"  Hi ","body":"a\tb\nc"})"), s);
        check(err.ok() && s.title == "Hi" && s.body == "a b\nc", "control characters are stripped, tabs become spaces");

        JsonDocument out;
        vt::Screen round;
        s.chart.present = true;
        s.chart.values = {1.5, 2};
        s.chart.label = "l";
        vt::writeScreenFields(out.to<JsonObject>(), s);
        check(vt::parseScreenRequest(out, round).ok() && round.chart.values.size() == 2 && round.chart.label == "l",
              "writeScreenFields output parses back to the same screen");
    }

    // PNG: write a pattern for compare.mjs to decode with pngjs.
    {
        const int w = 600, h = 448;
        std::vector<std::uint8_t> frame(w * h);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) frame[y * w + x] = static_cast<std::uint8_t>((x / 7 + y / 5) % 7);
        }
        const auto png = vt::encodePng(frame.data(), w, h);
        check(png.size() > 100000 && png.size() < 140000, "a full-panel PNG is about 135 KB");
        if (argc > 1) {
            std::ofstream f(argv[1], std::ios::binary);
            f.write(reinterpret_cast<const char*>(png.data()), static_cast<std::streamsize>(png.size()));
        }
    }
    check(vt::base64Encode({}).empty() && vt::base64Encode({'M'}) == "TQ==" && vt::base64Encode({'M', 'a'}) == "TWE=" &&
              vt::base64Encode({'M', 'a', 'n'}) == "TWFu",
          "base64 pads correctly");

    std::printf("%s: %d failure(s)\n", failures ? "FAILED" : "passed", failures);
    return failures ? 1 : 0;
}
