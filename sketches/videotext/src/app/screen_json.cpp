#include "screen_json.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace vt {

namespace {

const char* const SCREEN_KEYS[] = {"title", "body", "chart", "footer", "theme"};
const char* const CHART_KEYS[] = {"type", "values", "label"};

bool isOneOf(const char* key, const char* const* list, std::size_t n) {
    for (std::size_t i = 0; i < n; i++) {
        if (std::strcmp(key, list[i]) == 0) return true;
    }
    return false;
}

// Control characters would reach the renderer as blank cells or garble the
// JSON that GET /screen hands back; tabs become a space.
std::string clean(const char* s, bool keepNewlines) {
    std::string out;
    for (const char* p = s; *p; p++) {
        const unsigned char c = static_cast<unsigned char>(*p);
        if (c == '\t') {
            out += ' ';
        } else if (c == '\n' && keepNewlines) {
            out += '\n';
        } else if (c >= 0x20 && c != 0x7f) {
            out += static_cast<char>(c);
        }
    }
    return out;
}

std::string trim(const std::string& s) {
    const std::size_t start = s.find_first_not_of(' ');
    if (start == std::string::npos) return "";
    return s.substr(start, s.find_last_not_of(' ') - start + 1);
}

// ArduinoJson keeps numbers that fit a float as floats, so "21.7" comes back as
// 21.700000762939453 and a chart label can round the wrong way. A value that is
// exactly a float is taken back through its 7 significant digits.
double exactDecimal(double v) {
    const float f = static_cast<float>(v);
    if (static_cast<double>(f) != v) return v;
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.7g", v);
    return std::strtod(buf, nullptr);
}

RequestError error(const std::string& message) {
    return {"invalid_screen", message};
}

}  // namespace

RequestError parseScreenRequest(JsonVariantConst in, Screen& out) {
    if (!in.is<JsonObjectConst>()) return error("send a JSON object with at least a \"title\"");
    const JsonObjectConst obj = in.as<JsonObjectConst>();
    for (JsonPairConst kv : obj) {
        if (!isOneOf(kv.key().c_str(), SCREEN_KEYS, sizeof(SCREEN_KEYS) / sizeof(*SCREEN_KEYS))) {
            return error(std::string("unknown field \"") + kv.key().c_str() +
                         "\"; valid fields are title, body, chart, footer, theme");
        }
    }

    Screen screen;

    if (!obj["title"].is<const char*>()) return error("\"title\" is required and must be a string");
    screen.title = trim(clean(obj["title"].as<const char*>(), false));
    if (screen.title.empty()) return error("\"title\" must not be empty");

    if (!obj["body"].isNull()) {
        if (!obj["body"].is<const char*>()) return error("\"body\" must be a string");
        screen.body = clean(obj["body"].as<const char*>(), true);
        if (screen.body.size() > MAX_BODY_BYTES) return error("\"body\" is longer than 8192 bytes");
    }

    if (!obj["footer"].isNull()) {
        if (!obj["footer"].is<const char*>()) return error("\"footer\" must be a string");
        screen.footer = trim(clean(obj["footer"].as<const char*>(), false));
    }

    if (!obj["theme"].isNull()) {
        const char* theme = obj["theme"].is<const char*>() ? obj["theme"].as<const char*>() : "";
        if (std::strcmp(theme, "light") == 0) {
            screen.lightTheme = true;
        } else if (std::strcmp(theme, "dark") != 0) {
            return error("\"theme\" must be \"dark\" or \"light\"");
        }
    }

    if (!obj["chart"].isNull()) {
        if (!obj["chart"].is<JsonObjectConst>()) return error("\"chart\" must be an object like {\"type\": \"spark\", \"values\": [1, 2, 3]}");
        const JsonObjectConst chart = obj["chart"].as<JsonObjectConst>();
        for (JsonPairConst kv : chart) {
            if (!isOneOf(kv.key().c_str(), CHART_KEYS, sizeof(CHART_KEYS) / sizeof(*CHART_KEYS))) {
                return error(std::string("unknown chart field \"") + kv.key().c_str() + "\"; valid fields are type, values, label");
            }
        }
        screen.chart.present = true;
        if (!chart["type"].isNull()) {
            const char* type = chart["type"].is<const char*>() ? chart["type"].as<const char*>() : "";
            if (std::strcmp(type, "bars") == 0) {
                screen.chart.bars = true;
            } else if (std::strcmp(type, "spark") != 0) {
                return error("chart \"type\" must be \"spark\" or \"bars\"");
            }
        }
        if (!chart["values"].is<JsonArrayConst>()) return error("chart \"values\" must be an array of numbers");
        const JsonArrayConst values = chart["values"].as<JsonArrayConst>();
        if (values.size() == 0 || values.size() > MAX_CHART_VALUES) return error("chart \"values\" must hold 1 to 600 numbers");
        for (JsonVariantConst v : values) {
            if (!v.is<double>() || !std::isfinite(v.as<double>())) return error("chart \"values\" must all be finite numbers");
            screen.chart.values.push_back(exactDecimal(v.as<double>()));
        }
        if (!chart["label"].isNull()) {
            if (!chart["label"].is<const char*>()) return error("chart \"label\" must be a string");
            screen.chart.label = trim(clean(chart["label"].as<const char*>(), false));
        }
    }

    out = std::move(screen);
    return {};
}

void writeScreenFields(JsonObject out, const Screen& screen) {
    out["title"] = screen.title;
    out["body"] = screen.body;
    if (!screen.footer.empty()) out["footer"] = screen.footer;
    out["theme"] = screen.lightTheme ? "light" : "dark";
    if (screen.chart.present) {
        JsonObject chart = out["chart"].to<JsonObject>();
        chart["type"] = screen.chart.bars ? "bars" : "spark";
        JsonArray values = chart["values"].to<JsonArray>();
        for (double v : screen.chart.values) values.add(v);
        if (!screen.chart.label.empty()) chart["label"] = screen.chart.label;
    }
}

}  // namespace vt
