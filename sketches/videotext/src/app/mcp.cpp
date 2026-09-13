#include "mcp.h"

#include <cstring>

#include "guide.h"
#include "png.h"
#include "screen_json.h"

namespace vt {

namespace {

const char* const SERVER_VERSION = "1.0.0";
const char* const LATEST_PROTOCOL = "2025-06-18";
const char* const KNOWN_PROTOCOLS[] = {"2025-06-18", "2025-03-26", "2024-11-05"};

std::string serialize(const JsonDocument& doc) {
    std::string out;
    out.reserve(measureJson(doc) + 1);
    serializeJson(doc, out);
    return out;
}

HttpReply rpcError(JsonVariantConst id, int code, const std::string& message, int httpStatus = 200) {
    JsonDocument doc;
    doc["jsonrpc"] = "2.0";
    if (id.isNull()) {
        doc["id"] = nullptr;
    } else {
        doc["id"] = id;
    }
    doc["error"]["code"] = code;
    doc["error"]["message"] = message;
    return {httpStatus, serialize(doc)};
}

void addScreenSchema(JsonObject schema) {
    schema["type"] = "object";
    schema["additionalProperties"] = false;
    JsonObject props = schema["properties"].to<JsonObject>();

    props["title"]["type"] = "string";
    props["title"]["description"] = "What this screen is, drawn in double-height letters. At most 48 characters; longer titles are cut.";

    props["body"]["type"] = "string";
    props["body"]["description"] =
        "Up to 14 rows of 48 characters. Use \\n for new lines. Colour tags {red}...{/} (needs a person now), "
        "{yellow} (attention), {green} (fine), {blue} (information), {orange}, {white}, {black}. A line of ``` opens "
        "and closes a block that is cropped instead of wrapped, for tables and box or block-character pictures. "
        "No emoji. See the tool description for the full rules.";

    JsonObject chart = props["chart"].to<JsonObject>();
    chart["type"] = "object";
    chart["additionalProperties"] = false;
    chart["description"] = "Optional chart drawn under the chart label and above the body text. Pass the numbers, not an image.";
    JsonObject chartProps = chart["properties"].to<JsonObject>();
    chartProps["type"]["type"] = "string";
    JsonArray types = chartProps["type"]["enum"].to<JsonArray>();
    types.add("spark");
    types.add("bars");
    chartProps["type"]["description"] = "spark (default): a trend scaled from min to max with both printed. bars: amounts from zero.";
    chartProps["values"]["type"] = "array";
    chartProps["values"]["items"]["type"] = "number";
    chartProps["values"]["minItems"] = 1;
    chartProps["values"]["maxItems"] = MAX_CHART_VALUES;
    chartProps["values"]["description"] = "1 to 600 numbers, in order. Wider series are averaged to fit.";
    chartProps["label"]["type"] = "string";
    chartProps["label"]["description"] = "One-line caption above the chart, e.g. \"°F by hour\".";
    chart["required"].to<JsonArray>().add("values");

    props["footer"]["type"] = "string";
    props["footer"]["description"] = "Optional single line under the body, at most 48 characters, e.g. a source.";

    props["theme"]["type"] = "string";
    JsonArray themes = props["theme"]["enum"].to<JsonArray>();
    themes.add("dark");
    themes.add("light");
    props["theme"]["description"] = "dark (default): black background, yellow title. light: white background, title on a blue band.";

    schema["required"].to<JsonArray>().add("title");
}

void addTool(JsonArray tools, const char* name, const std::string& description, bool takesScreen, bool readOnly) {
    JsonObject tool = tools.add<JsonObject>();
    tool["name"] = name;
    tool["description"] = description;
    JsonObject schema = tool["inputSchema"].to<JsonObject>();
    if (takesScreen) {
        addScreenSchema(schema);
    } else {
        schema["type"] = "object";
        schema["properties"].to<JsonObject>();
        schema["additionalProperties"] = false;
    }
    tool["annotations"]["readOnlyHint"] = readOnly;
}

HttpReply toolResult(JsonVariantConst id, const ToolOutput& output) {
    JsonDocument doc;
    doc["jsonrpc"] = "2.0";
    doc["id"] = id;
    JsonObject result = doc["result"].to<JsonObject>();
    JsonArray content = result["content"].to<JsonArray>();
    JsonObject text = content.add<JsonObject>();
    text["type"] = "text";
    text["text"] = output.text;
    if (!output.png.empty()) {
        JsonObject image = content.add<JsonObject>();
        image["type"] = "image";
        image["mimeType"] = "image/png";
        image["data"] = base64Encode(output.png);
    }
    result["isError"] = output.isError;
    return {200, serialize(doc)};
}

HttpReply initialize(JsonVariantConst id, JsonVariantConst params) {
    const char* requested = params["protocolVersion"] | "";
    const char* version = LATEST_PROTOCOL;
    for (const char* known : KNOWN_PROTOCOLS) {
        if (std::strcmp(requested, known) == 0) version = known;
    }

    JsonDocument doc;
    doc["jsonrpc"] = "2.0";
    doc["id"] = id;
    JsonObject result = doc["result"].to<JsonObject>();
    result["protocolVersion"] = version;
    result["capabilities"]["tools"]["listChanged"] = false;
    result["serverInfo"]["name"] = "videotext";
    result["serverInfo"]["title"] = "Videotext wall display";
    result["serverInfo"]["version"] = SERVER_VERSION;
    result["instructions"] = GUIDE_WALL;
    return {200, serialize(doc)};
}

HttpReply listTools(JsonVariantConst id) {
    JsonDocument doc;
    doc["jsonrpc"] = "2.0";
    doc["id"] = id;
    JsonArray tools = doc["result"]["tools"].to<JsonArray>();
    addTool(tools, "show_screen",
            std::string("Replace what the wall shows with this screen. The result says when it becomes visible, lists any "
                        "warnings, and attaches an image of exactly what will be drawn.\n\n") +
                GUIDE_WALL,
            true, false);
    addTool(tools, "preview_screen",
            "Render a screen exactly as show_screen would, without changing the wall, and return the image and any warnings. "
            "Takes the same arguments as show_screen, whose description has the layout and markup rules.",
            true, true);
    addTool(tools, "get_screen",
            "Return what the wall shows now: the screen's fields as JSON, when it was last updated, whether a refresh is in "
            "progress, and an image of it. Call this before replacing the screen.",
            false, true);
    addTool(tools, "clear_screen",
            "Remove the current screen. The wall then shows its own address and setup instructions. Only use this when "
            "someone asks to clear the wall.",
            false, false);
    return {200, serialize(doc)};
}

HttpReply callTool(JsonVariantConst id, JsonVariantConst params, Wall& wall) {
    const char* name = params["name"] | "";
    const bool takesScreen = std::strcmp(name, "show_screen") == 0 || std::strcmp(name, "preview_screen") == 0;

    if (takesScreen) {
        Screen screen;
        const RequestError err = parseScreenRequest(params["arguments"], screen);
        if (!err.ok()) {
            ToolOutput output;
            output.isError = true;
            output.text = err.message;
            return toolResult(id, output);
        }
        return toolResult(id, std::strcmp(name, "show_screen") == 0 ? wall.showScreen(screen) : wall.previewScreen(screen));
    }
    if (std::strcmp(name, "get_screen") == 0) return toolResult(id, wall.getScreen());
    if (std::strcmp(name, "clear_screen") == 0) return toolResult(id, wall.clearScreen());
    return rpcError(id, -32602, std::string("unknown tool \"") + name + "\"; the tools are show_screen, preview_screen, get_screen, clear_screen");
}

}  // namespace

HttpReply handleMcpRequest(const std::string& requestBody, Wall& wall) {
    JsonDocument request;
    if (deserializeJson(request, requestBody) != DeserializationError::Ok) {
        return rpcError(JsonVariantConst(), -32700, "the request body is not valid JSON", 400);
    }
    if (request.is<JsonArrayConst>()) {
        return rpcError(JsonVariantConst(), -32600, "batched requests are not supported; send one JSON-RPC message per request", 400);
    }
    if (!request.is<JsonObjectConst>() || !request["method"].is<const char*>()) {
        // Responses from the client, or anything that isn't a request: nothing to answer.
        return {202, ""};
    }

    const JsonVariantConst id = request["id"];
    const char* method = request["method"];
    if (id.isNull()) return {202, ""};  // notifications, e.g. notifications/initialized

    if (std::strcmp(method, "initialize") == 0) return initialize(id, request["params"]);
    if (std::strcmp(method, "ping") == 0) {
        JsonDocument doc;
        doc["jsonrpc"] = "2.0";
        doc["id"] = id;
        doc["result"].to<JsonObject>();
        return {200, serialize(doc)};
    }
    if (std::strcmp(method, "tools/list") == 0) return listTools(id);
    if (std::strcmp(method, "tools/call") == 0) return callTool(id, request["params"], wall);
    return rpcError(id, -32601, std::string("method \"") + method + "\" is not supported");
}

}  // namespace vt
