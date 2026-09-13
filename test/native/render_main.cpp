// Host CLI around the board renderer, for test/native/compare.mjs.
//
//   render_main [--bench N] <screen.json> <pixels.bin> <result.json>
//   render_main --dump-font <font.json>
//   render_main --concurrent <threads> <iterations> <screen.json>...
//
// screen.json: {"title", "body", "theme": "dark"|"light", "headerLeft",
// "headerRight", "footer", "chart": {"type": "spark"|"bars", "values", "label"}}.
// Chart values may be JSON numbers or numeric strings. compare.mjs sends
// strings because ArduinoJson's float parsing is not correctly rounded
// (21.7 parses as 21.700000000000003), and this test is about the renderer,
// not the parser: strtod gives exactly the double JavaScript holds.
//
// pixels.bin gets FRAME_PIXELS palette indices; result.json gets
// {"warnings", "lintWarnings", "bench": {"runs", "minMicros", "meanMicros"}}.

#include <ArduinoJson.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "font_data.h"
#include "render.h"

namespace {

bool readFile(const char* path, std::string& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    out.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    return true;
}

bool writeFile(const char* path, const char* data, std::size_t size) {
    std::ofstream out(path, std::ios::binary);
    out.write(data, static_cast<std::streamsize>(size));
    return static_cast<bool>(out);
}

std::string stringField(JsonVariantConst v) {
    JsonString s = v.as<JsonString>();
    return s.isNull() ? std::string() : std::string(s.c_str(), s.size());
}

int dumpFont(const char* outPath) {
    using namespace vt::font;
    int errors = 0;
    for (int i = 1; i < GLYPH_COUNT; i++) {
        if (GLYPH_CODEPOINTS[i - 1] >= GLYPH_CODEPOINTS[i]) {
            std::fprintf(stderr, "codepoint table not ascending at %d\n", i);
            errors++;
        }
    }

    JsonDocument doc;
    JsonObject glyphs = doc["glyphs"].to<JsonObject>();
    for (int i = 0; i < GLYPH_COUNT; i++) {
        const std::uint32_t cp = GLYPH_CODEPOINTS[i];
        const std::uint16_t* rows = glyphRows(cp);
        if (rows != GLYPH_ROWS + i * GLYPH_HEIGHT) {
            std::fprintf(stderr, "glyphRows(U+%04X) did not find its own entry\n", static_cast<unsigned>(cp));
            errors++;
            continue;
        }
        JsonArray out = glyphs[std::to_string(cp)].to<JsonArray>();
        for (int r = 0; r < GLYPH_HEIGHT; r++) out.add(rows[r]);
    }

    // Every codepoint the table lacks must look up as absent.
    int tableIndex = 0;
    for (std::uint32_t cp = 0; cp <= 0x10FFFF; cp++) {
        const bool inTable = tableIndex < GLYPH_COUNT && GLYPH_CODEPOINTS[tableIndex] == cp;
        if (inTable) {
            tableIndex++;
        } else if (glyphRows(cp) != nullptr) {
            std::fprintf(stderr, "glyphRows(U+%04X) found a glyph the table lacks\n", static_cast<unsigned>(cp));
            errors++;
        }
    }

    std::string json;
    serializeJson(doc, json);
    if (!writeFile(outPath, json.data(), json.size())) {
        std::fprintf(stderr, "cannot write %s\n", outPath);
        return 2;
    }
    return errors == 0 ? 0 : 1;
}

bool loadScreen(const char* path, vt::Screen& screen) {
    std::string input;
    if (!readFile(path, input)) {
        std::fprintf(stderr, "cannot read %s\n", path);
        return false;
    }
    JsonDocument doc;
    const DeserializationError error = deserializeJson(doc, input);
    if (error) {
        std::fprintf(stderr, "%s: %s\n", path, error.c_str());
        return false;
    }

    screen.title = stringField(doc["title"]);
    screen.body = stringField(doc["body"]);
    screen.lightTheme = doc["theme"] == "light";
    screen.headerLeft = stringField(doc["headerLeft"]);
    screen.headerRight = stringField(doc["headerRight"]);
    screen.footer = stringField(doc["footer"]);
    JsonObjectConst chart = doc["chart"];
    if (!chart.isNull()) {
        screen.chart.present = true;
        screen.chart.bars = chart["type"] == "bars";
        screen.chart.label = stringField(chart["label"]);
        for (JsonVariantConst v : chart["values"].as<JsonArrayConst>()) {
            screen.chart.values.push_back(v.is<const char*>() ? std::strtod(v.as<const char*>(), nullptr)
                                                              : v.as<double>());
        }
    }
    return true;
}

// The board calls renderScreen and lintScreen from two FreeRTOS tasks at once.
// Each thread renders every screen, in its own order, into its own buffer and
// must reproduce the serial output exactly; shared scratch state would show
// up as mismatches.
int concurrent(int threadCount, int iterations, const std::vector<vt::Screen>& screens) {
    struct Output {
        std::vector<std::uint8_t> pixels;
        std::vector<std::string> warnings;
    };
    std::vector<Output> serial(screens.size());
    for (std::size_t i = 0; i < screens.size(); i++) {
        serial[i].pixels.resize(vt::FRAME_PIXELS);
        serial[i].warnings = vt::renderScreen(serial[i].pixels.data(), screens[i]);
    }

    std::atomic<int> mismatches{0};
    std::vector<std::thread> threads;
    for (int t = 0; t < threadCount; t++) {
        threads.emplace_back([&, t] {
            std::vector<std::uint8_t> pixels(vt::FRAME_PIXELS);
            for (int it = 0; it < iterations; it++) {
                for (std::size_t k = 0; k < screens.size(); k++) {
                    const std::size_t i = (k * (2 * t + 1) + t + it) % screens.size();
                    const bool lintOnly = (k + t + it) % 3 == 0;
                    const std::vector<std::string> warnings =
                        lintOnly ? vt::lintScreen(screens[i]) : vt::renderScreen(pixels.data(), screens[i]);
                    if (warnings != serial[i].warnings || (!lintOnly && pixels != serial[i].pixels)) mismatches++;
                }
            }
        });
    }
    for (std::thread& thread : threads) thread.join();

    const long total = static_cast<long>(threadCount) * iterations * static_cast<long>(screens.size());
    std::printf("%ld concurrent renders and lints on %d threads, %d mismatches\n", total, threadCount,
                mismatches.load());
    return mismatches.load() == 0 ? 0 : 1;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc == 3 && std::strcmp(argv[1], "--dump-font") == 0) return dumpFont(argv[2]);

    if (argc > 4 && std::strcmp(argv[1], "--concurrent") == 0) {
        std::vector<vt::Screen> screens(static_cast<std::size_t>(argc - 4));
        for (int i = 4; i < argc; i++) {
            if (!loadScreen(argv[i], screens[static_cast<std::size_t>(i - 4)])) return 2;
        }
        return concurrent(std::atoi(argv[2]), std::atoi(argv[3]), screens);
    }

    int argi = 1;
    long benchRuns = 0;
    if (argc > 2 && std::strcmp(argv[1], "--bench") == 0) {
        benchRuns = std::strtol(argv[2], nullptr, 10);
        argi = 3;
    }
    if (argc - argi != 3) {
        std::fprintf(stderr,
                     "usage: render_main [--bench N] <screen.json> <pixels.bin> <result.json>\n"
                     "       render_main --dump-font <font.json>\n"
                     "       render_main --concurrent <threads> <iterations> <screen.json>...\n");
        return 2;
    }
    const char* pixelsPath = argv[argi + 1];
    const char* resultPath = argv[argi + 2];

    vt::Screen screen;
    if (!loadScreen(argv[argi], screen)) return 2;

    std::vector<std::uint8_t> pixels(vt::FRAME_PIXELS, 0xFF);
    const std::vector<std::string> warnings = vt::renderScreen(pixels.data(), screen);
    const std::vector<std::string> lintWarnings = vt::lintScreen(screen);

    JsonDocument result;
    JsonArray w = result["warnings"].to<JsonArray>();
    for (const std::string& s : warnings) w.add(s);
    JsonArray lw = result["lintWarnings"].to<JsonArray>();
    for (const std::string& s : lintWarnings) lw.add(s);

    if (benchRuns > 0) {
        std::vector<std::uint8_t> scratch(vt::FRAME_PIXELS);
        double minMicros = 1e18;
        double totalMicros = 0;
        for (long i = 0; i < benchRuns; i++) {
            const auto start = std::chrono::steady_clock::now();
            vt::renderScreen(scratch.data(), screen);
            const auto end = std::chrono::steady_clock::now();
            const double micros = std::chrono::duration<double, std::micro>(end - start).count();
            if (micros < minMicros) minMicros = micros;
            totalMicros += micros;
        }
        result["bench"]["runs"] = benchRuns;
        result["bench"]["minMicros"] = minMicros;
        result["bench"]["meanMicros"] = totalMicros / static_cast<double>(benchRuns);
    }

    if (!writeFile(pixelsPath, reinterpret_cast<const char*>(pixels.data()), pixels.size())) {
        std::fprintf(stderr, "cannot write %s\n", pixelsPath);
        return 2;
    }
    std::string json;
    serializeJson(result, json);
    if (!writeFile(resultPath, json.data(), json.size())) {
        std::fprintf(stderr, "cannot write %s\n", resultPath);
        return 2;
    }
    return 0;
}
