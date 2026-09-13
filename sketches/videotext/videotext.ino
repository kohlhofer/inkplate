// Videotext: a teletext-style wall that shows one screen at a time and serves
// it from the board. Agents and scripts on the local network replace the screen
// over HTTP or MCP; the side button shows how to connect. See README.md.

#ifndef ARDUINO_INKPLATECOLOR
#error "Select the Soldered Inkplate 6COLOR board."
#endif

// The renderer's headers come before Inkplate.h: InkplateLibrary defines BLACK
// and WHITE as macros, which would break vt::Color's enumerators.
#include "src/app/guide.h"
#include "src/app/mcp.h"
#include "src/app/png.h"
#include "src/app/screen_json.h"
#include "src/render/render.h"

#include <ESPmDNS.h>
#include <Inkplate.h>
#include <LittleFS.h>
#include <WebServer.h>
#include <WiFi.h>

#include <ctime>
#include <string>
#include <vector>

#if __has_include("config.h")
#include "config.h"
#else
#warning "config.h not found; using config.example.h (WiFi will not connect)."
#include "config.example.h"
#endif

#define FW_VERSION "2.0.0"
#define BUTTON_PIN 36
#define SCREEN_FILE "/screen.json"
#define DRAWN_HASH_FILE "/drawn.hash"
#define MAX_REQUEST_BYTES 32768
// display() measured 29.4 s; a few seconds more covers rendering and the copy.
#define REFRESH_SECONDS 32

Inkplate display;
WebServer server(80);

// Everything both tasks touch lives here, behind stateMutex. The web server and
// button run in loop() on core 1; drawTask owns the panel on core 0, so a
// 30-second refresh never stalls a request.
struct State {
    bool hasScreen = false;
    vt::Screen screen;         // sender fields only
    std::string updated;       // "Sun 13 Sep 14:05", fixed when the screen was sent
    bool infoRequested = false;
    std::string ip;
    uint32_t wantedVersion = 1;  // bumped whenever what the wall should show changes
    uint32_t drawnVersion = 0;
    bool drawing = false;
    unsigned long drawStartedMs = 0;
    unsigned long lastDrawMs = 0;
    float battery = 0;
};

// What a sender learns after a screen is accepted. Declared up here because
// the Arduino builder puts function prototypes above the first function.
struct Sent {
    std::vector<std::string> warnings;
    int visibleInSeconds;
    bool afterCurrentRefresh;
};

State state;
SemaphoreHandle_t stateMutex;
TaskHandle_t drawTaskHandle;

struct Lock {
    Lock() { xSemaphoreTake(stateMutex, portMAX_DELAY); }
    ~Lock() { xSemaphoreGive(stateMutex); }
};

// ---------------------------------------------------------------- screens

std::string nowDisplay() {
    time_t now = time(nullptr);
    struct tm local;
    localtime_r(&now, &local);
    if (local.tm_year < 124) return "";  // clock not set yet (before 2024)
    static const char* DAYS[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
    static const char* MONTHS[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    char buf[32];
    snprintf(buf, sizeof(buf), "%s %d %s %02d:%02d", DAYS[local.tm_wday], local.tm_mday, MONTHS[local.tm_mon], local.tm_hour,
             local.tm_min);
    return buf;
}

vt::Screen withHeader(vt::Screen screen, const std::string& updated) {
    screen.headerLeft = "VIDEOTEXT";
    screen.headerRight = updated.empty() ? "" : "updated " + updated;
    return screen;
}

// Shown when there is no screen, or when someone presses the button. It has to
// be enough for a person or agent standing at the wall to connect.
vt::Screen infoScreen(const std::string& ip, bool returnsToScreen) {
    vt::Screen s;
    s.headerLeft = "VIDEOTEXT";
    s.headerRight = ip.empty() ? "not on WiFi" : ip;
    if (ip.empty()) {
        s.title = "Joining WiFi…";
        s.body = std::string("Looking for the network {yellow}") + WIFI_SSID +
                 "{/}.\n\nIf this stays up, check WIFI_SSID and WIFI_PASS\nin config.h and flash the board again.";
        return s;
    }
    s.title = "Send a screen to this wall";
    // Fenced so the labels line up: outside a fence, runs of spaces collapse.
    // The Claude Code command uses the IP because Claude Code can't resolve
    // .local names; browsers, curl and Node can.
    s.body = std::string("Agents and scripts on this network can replace\nwhat this wall shows.\n\n```\n") +
             "{yellow}MCP{/}   http://" + ip + "/mcp\n" + "{yellow}HTTP{/}  http://" + ip + "/screen\n" +
             "{yellow}Key{/}   X-Api-Key: " API_KEY "\n" + "{yellow}Guide{/} http://" HOSTNAME ".local/\n```\n\n" +
             "Claude Code:\n```\n" + "claude mcp add --transport http videotext \\\n" + "  http://" + ip + "/mcp \\\n" +
             "  --header \"X-Api-Key: " API_KEY "\"\n```";
    s.footer = returnsToScreen ? "Press the button again to return to the screen" : "";
    return s;
}

// What the wall should show right now. Caller holds the lock.
vt::Screen wantedScreenLocked() {
    if (state.hasScreen && !state.infoRequested) return withHeader(state.screen, state.updated);
    return infoScreen(state.ip, state.hasScreen);
}

// A copy taken under the lock, so rendering it doesn't hold up the draw task.
vt::Screen wantedScreen() {
    Lock lock;
    return wantedScreenLocked();
}

uint64_t fnv1a(const uint8_t* data, size_t len) {
    uint64_t h = 1469598103934665603ULL;
    for (size_t i = 0; i < len; i++) h = (h ^ data[i]) * 1099511628211ULL;
    return h;
}

std::vector<uint8_t> renderPng(const vt::Screen& screen, std::vector<std::string>* warnings) {
    uint8_t* frame = static_cast<uint8_t*>(ps_malloc(vt::FRAME_PIXELS));
    if (!frame) return {};
    std::vector<std::string> w = vt::renderScreen(frame, screen);
    if (warnings) *warnings = w;
    std::vector<uint8_t> png = vt::encodePng(frame, vt::PANEL_WIDTH, vt::PANEL_HEIGHT);
    free(frame);
    return png;
}

// ---------------------------------------------------------------- storage

void saveScreen() {
    JsonDocument doc;
    {
        Lock lock;
        if (!state.hasScreen) {
            LittleFS.remove(SCREEN_FILE);
            return;
        }
        vt::writeScreenFields(doc["screen"].to<JsonObject>(), state.screen);
        doc["updated"] = state.updated;
    }
    File f = LittleFS.open(SCREEN_FILE ".tmp", "w");
    if (!f) return;
    serializeJson(doc, f);
    f.close();
    LittleFS.rename(SCREEN_FILE ".tmp", SCREEN_FILE);
}

void loadScreen() {
    File f = LittleFS.open(SCREEN_FILE, "r");
    if (!f) return;
    JsonDocument doc;
    const bool parsed = deserializeJson(doc, f) == DeserializationError::Ok;
    f.close();
    vt::Screen screen;
    if (!parsed || !vt::parseScreenRequest(doc["screen"], screen).ok()) {
        Serial.println("videotext: stored screen unreadable, ignoring it");
        return;
    }
    state.screen = screen;
    state.updated = doc["updated"] | "";
    state.hasScreen = true;
}

uint64_t readDrawnHash() {
    File f = LittleFS.open(DRAWN_HASH_FILE, "r");
    if (!f) return 0;
    const String s = f.readString();
    f.close();
    return strtoull(s.c_str(), nullptr, 16);
}

void writeDrawnHash(uint64_t hash) {
    File f = LittleFS.open(DRAWN_HASH_FILE, "w");
    if (!f) return;
    char buf[20];
    snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(hash));
    f.print(buf);
    f.close();
}

// ---------------------------------------------------------------- drawing

// Draws the newest wanted screen whenever it changes. Screens that arrive
// during a refresh bump wantedVersion, and the loop picks up only the latest
// once the panel is free. A frame identical to the one already on the panel
// (after a reboot, say) is never redrawn.
void drawTask(void*) {
    uint8_t* frame = static_cast<uint8_t*>(ps_malloc(vt::FRAME_PIXELS));
    if (!frame) {
        Serial.println("videotext: no PSRAM for the frame; the wall can't draw");
        vTaskDelete(nullptr);
    }
    uint64_t drawnHash = readDrawnHash();
    unsigned long lastBatteryMs = 0;

    for (;;) {
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000));

        if (millis() - lastBatteryMs > 60000 || lastBatteryMs == 0) {
            const float v = display.readBattery();
            Lock lock;
            state.battery = v;
            lastBatteryMs = millis();
        }

        vt::Screen screen;
        uint32_t version;
        {
            Lock lock;
            if (state.wantedVersion == state.drawnVersion) continue;
            screen = wantedScreenLocked();
            version = state.wantedVersion;
        }

        const unsigned long renderStart = millis();
        vt::renderScreen(frame, screen);
        const uint64_t hash = fnv1a(frame, vt::FRAME_PIXELS);
        const unsigned long renderMs = millis() - renderStart;

        if (hash == drawnHash) {
            Serial.printf("videotext: screen v%u already on the panel (render_ms=%lu)\n", version, renderMs);
            Lock lock;
            state.drawnVersion = version;
            continue;
        }

        {
            Lock lock;
            state.drawing = true;
            state.drawStartedMs = millis();
        }
        const unsigned long copyStart = millis();
        for (int y = 0; y < vt::PANEL_HEIGHT; y++) {
            const uint8_t* row = frame + y * vt::PANEL_WIDTH;
            for (int x = 0; x < vt::PANEL_WIDTH; x++) display.drawPixel(x, y, row[x]);
        }
        const unsigned long displayStart = millis();
        display.display();
        const unsigned long displayMs = millis() - displayStart;
        drawnHash = hash;
        writeDrawnHash(hash);

        Lock lock;
        state.drawing = false;
        state.drawnVersion = version;
        state.lastDrawMs = millis();
        Serial.printf("videotext: drew v%u render_ms=%lu copy_ms=%lu display_ms=%lu\n", version, renderMs,
                      displayStart - copyStart, displayMs);
    }
}

void requestDraw() {
    xTaskNotifyGive(drawTaskHandle);
}

// Whether a screen sent now has to wait for another refresh first. A change
// the draw task hasn't picked up yet counts, since it may already be rendering.
bool busyLocked() {
    return state.drawing || state.wantedVersion != state.drawnVersion;
}

// Seconds until a screen sent now is readable on the panel.
int secondsUntilVisibleLocked() {
    if (!busyLocked()) return REFRESH_SECONDS;
    const int elapsed = state.drawing ? static_cast<int>((millis() - state.drawStartedMs) / 1000) : 0;
    return (elapsed < REFRESH_SECONDS ? REFRESH_SECONDS - elapsed : 0) + REFRESH_SECONDS;
}

// ---------------------------------------------------------------- wall actions

Sent sendScreen(const vt::Screen& screen) {
    Sent sent;
    const std::string updated = nowDisplay();
    sent.warnings = vt::lintScreen(withHeader(screen, updated));
    {
        Lock lock;
        sent.afterCurrentRefresh = busyLocked();
        sent.visibleInSeconds = secondsUntilVisibleLocked();
        state.screen = screen;
        state.updated = updated;
        state.hasScreen = true;
        state.infoRequested = false;
        state.wantedVersion++;
    }
    saveScreen();
    requestDraw();
    return sent;
}

void clearScreen() {
    {
        Lock lock;
        state.hasScreen = false;
        state.infoRequested = false;
        state.wantedVersion++;
    }
    saveScreen();
    requestDraw();
}

std::string warningsText(const std::vector<std::string>& warnings) {
    if (warnings.empty()) return "No warnings.";
    std::string text = "Warnings (fix these and send again):";
    for (const auto& w : warnings) text += "\n- " + w;
    return text;
}

std::string stateName() {
    Lock lock;
    if (state.drawing) return "drawing";
    return state.wantedVersion == state.drawnVersion ? "shown" : "waiting";
}

class BoardWall : public vt::Wall {
public:
    vt::ToolOutput showScreen(const vt::Screen& screen) override {
        const Sent sent = sendScreen(screen);
        vt::ToolOutput out;
        out.text = sent.afterCurrentRefresh
                       ? "Accepted. The wall is finishing another refresh and draws this screen right after it, readable in about " +
                             std::to_string(sent.visibleInSeconds) + " seconds."
                       : "Accepted. The wall is refreshing now and this screen is readable in about " +
                             std::to_string(sent.visibleInSeconds) + " seconds.";
        out.text += "\n" + warningsText(sent.warnings) + "\nThe attached image is exactly what the wall draws.";
        out.png = renderPng(wantedScreen(), nullptr);
        return out;
    }

    vt::ToolOutput previewScreen(const vt::Screen& screen) override {
        vt::ToolOutput out;
        std::vector<std::string> warnings;
        out.png = renderPng(withHeader(screen, nowDisplay()), &warnings);
        out.text = "Preview only; the wall has not changed.\n" + warningsText(warnings);
        return out;
    }

    vt::ToolOutput getScreen() override {
        JsonDocument doc;
        vt::Screen wanted;
        {
            Lock lock;
            if (state.hasScreen) {
                vt::writeScreenFields(doc["screen"].to<JsonObject>(), state.screen);
                doc["updated"] = state.updated;
            } else {
                doc["screen"] = nullptr;
            }
            doc["showing"] = state.hasScreen && !state.infoRequested ? "screen" : "connection details";
            wanted = wantedScreenLocked();
        }
        doc["state"] = stateName();
        vt::ToolOutput out;
        serializeJson(doc, out.text);
        out.text = (doc["screen"].isNull() ? "There is no screen; the wall shows its connection details.\n"
                                           : "The current screen:\n") +
                   out.text;
        out.png = renderPng(wanted, nullptr);
        return out;
    }

    vt::ToolOutput clearScreen() override {
        ::clearScreen();
        vt::ToolOutput out;
        out.text = "Cleared. The wall now shows its address and setup instructions.";
        out.png = renderPng(wantedScreen(), nullptr);
        return out;
    }
};

BoardWall boardWall;

// ---------------------------------------------------------------- HTTP

bool authorized() {
    const String key = server.header("X-Api-Key");
    const String bearer = server.header("Authorization");
    const String expected = API_KEY;
    const String given = key.length() ? key : (bearer.startsWith("Bearer ") ? bearer.substring(7) : String(""));
    if (given.length() != expected.length()) return false;
    uint8_t diff = 0;
    for (size_t i = 0; i < expected.length(); i++) diff |= given[i] ^ expected[i];
    return diff == 0;
}

void sendJson(int status, const JsonDocument& doc) {
    std::string body;
    serializeJson(doc, body);
    server.send(status, "application/json", body.c_str());
}

void sendError(int status, const char* code, const std::string& message) {
    JsonDocument doc;
    doc["error"]["code"] = code;
    doc["error"]["message"] = message;
    sendJson(status, doc);
}

bool requireKey() {
    if (authorized()) return true;
    sendError(401, "unauthorized",
              "send the key as \"X-Api-Key: <key>\" or \"Authorization: Bearer <key>\"; press the button on the wall to see it");
    return false;
}

bool readJsonBody(JsonDocument& doc) {
    // WebServer only keeps a raw body for non-form content types; curl -d
    // without a header sends a form, which arrives here as no body at all.
    if (!server.hasArg("plain")) {
        sendError(400, "invalid_json", "send the screen as JSON with the header \"Content-Type: application/json\"");
        return false;
    }
    const String& body = server.arg("plain");
    if (body.length() > MAX_REQUEST_BYTES) {
        sendError(413, "too_large", "the request body is larger than 32 KB");
        return false;
    }
    if (deserializeJson(doc, body) != DeserializationError::Ok) {
        sendError(400, "invalid_json", "the request body is not valid JSON");
        return false;
    }
    return true;
}

void sendPng(const std::vector<uint8_t>& png) {
    if (png.empty()) {
        sendError(500, "out_of_memory", "could not allocate a frame for the preview");
        return;
    }
    server.setContentLength(png.size());
    server.send(200, "image/png", "");
    server.sendContent(reinterpret_cast<const char*>(png.data()), png.size());
}

void handleGuide() {
    String ip;
    {
        Lock lock;
        ip = state.ip.c_str();
    }
    String text = "videotext wall at http://" HOSTNAME ".local (" + ip + "), firmware " FW_VERSION "\n\n";
    text += vt::GUIDE_WALL;
    text += "\n\n";
    String http = vt::GUIDE_HTTP;
    http.replace("<ip>", ip.length() ? ip : String("<board IP>"));
    text += http;
    text += "\n";
    server.send(200, "text/plain; charset=utf-8", text);
}

void handleGetScreen() {
    if (!requireKey()) return;
    JsonDocument doc;
    {
        Lock lock;
        if (state.hasScreen) {
            vt::writeScreenFields(doc["screen"].to<JsonObject>(), state.screen);
            doc["updated"] = state.updated;
        } else {
            doc["screen"] = nullptr;
        }
        doc["showing"] = state.hasScreen && !state.infoRequested ? "screen" : "connection details";
    }
    doc["state"] = stateName();
    sendJson(200, doc);
}

void handlePutScreen() {
    if (!requireKey()) return;
    JsonDocument request;
    if (!readJsonBody(request)) return;
    vt::Screen screen;
    const vt::RequestError err = vt::parseScreenRequest(request, screen);
    if (!err.ok()) {
        sendError(400, err.code.c_str(), err.message);
        return;
    }
    const Sent sent = sendScreen(screen);
    JsonDocument doc;
    doc["state"] = sent.afterCurrentRefresh ? "waiting" : "drawing";
    doc["visibleInSeconds"] = sent.visibleInSeconds;
    JsonArray warnings = doc["warnings"].to<JsonArray>();
    for (const auto& w : sent.warnings) warnings.add(w);
    sendJson(202, doc);
}

void handleDeleteScreen() {
    if (!requireKey()) return;
    clearScreen();
    JsonDocument doc;
    doc["state"] = "drawing";
    doc["showing"] = "connection details";
    sendJson(202, doc);
}

void handlePostPreview() {
    if (!requireKey()) return;
    JsonDocument request;
    if (!readJsonBody(request)) return;
    vt::Screen screen;
    const vt::RequestError err = vt::parseScreenRequest(request, screen);
    if (!err.ok()) {
        sendError(400, err.code.c_str(), err.message);
        return;
    }
    std::vector<std::string> warnings;
    const std::vector<uint8_t> png = renderPng(withHeader(screen, nowDisplay()), &warnings);
    JsonDocument w;
    JsonArray arr = w.to<JsonArray>();
    for (const auto& s : warnings) arr.add(s);
    std::string header;
    serializeJson(w, header);
    server.sendHeader("X-Warnings", header.c_str());
    sendPng(png);
}

void handleGetPreview() {
    if (!requireKey()) return;
    sendPng(renderPng(wantedScreen(), nullptr));
}

void handleStatus() {
    if (!requireKey()) return;
    JsonDocument doc;
    {
        Lock lock;
        doc["ip"] = state.ip;
        doc["hasScreen"] = state.hasScreen;
        doc["showing"] = state.hasScreen && !state.infoRequested ? "screen" : "connection details";
        doc["battery"] = state.battery;
        doc["lastDrawSecondsAgo"] = state.lastDrawMs ? static_cast<long>((millis() - state.lastDrawMs) / 1000) : -1;
    }
    doc["state"] = stateName();
    doc["hostname"] = HOSTNAME ".local";
    doc["firmware"] = FW_VERSION;
    doc["uptimeSeconds"] = millis() / 1000;
    doc["rssi"] = WiFi.RSSI();
    doc["freeHeap"] = ESP.getFreeHeap();
    doc["freePsram"] = ESP.getFreePsram();
    sendJson(200, doc);
}

void handleMcp() {
    if (server.method() != HTTP_POST) {
        server.sendHeader("Allow", "POST");
        sendError(405, "method_not_allowed", "this MCP endpoint only takes POST (Streamable HTTP without server-sent events)");
        return;
    }
    if (!requireKey()) return;
    const String& body = server.arg("plain");
    if (body.length() > MAX_REQUEST_BYTES) {
        sendError(413, "too_large", "the request body is larger than 32 KB");
        return;
    }
    const vt::HttpReply reply = vt::handleMcpRequest(std::string(body.c_str(), body.length()), boardWall);
    if (reply.body.empty()) {
        server.send(reply.status);
        return;
    }
    server.setContentLength(reply.body.size());
    server.send(reply.status, "application/json", "");
    server.sendContent(reply.body.data(), reply.body.size());
}

void handleNotFound() {
    sendError(404, "not_found", "no such endpoint; GET / lists the API");
}

void setupServer() {
    static const char* headerKeys[] = {"X-Api-Key", "Authorization"};
    server.collectHeaders(headerKeys, 2);
    server.on("/", HTTP_GET, handleGuide);
    server.on("/screen", HTTP_GET, handleGetScreen);
    server.on("/screen", HTTP_PUT, handlePutScreen);
    server.on("/screen", HTTP_POST, handlePutScreen);
    server.on("/screen", HTTP_DELETE, handleDeleteScreen);
    server.on("/preview", HTTP_POST, handlePostPreview);
    server.on("/preview", HTTP_GET, handleGetPreview);
    server.on("/status", HTTP_GET, handleStatus);
    server.on("/mcp", handleMcp);
    server.onNotFound(handleNotFound);
    server.begin();
}

// ---------------------------------------------------------------- setup and loop

void connectWifi() {
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(HOSTNAME);
    WiFi.setAutoReconnect(true);
    // With a link-local IPv6 address, mDNS can answer the AAAA query macOS sends
    // for videotext.local; without one the lookup waits 5 s before trying IPv4.
    WiFi.enableIPv6();
    // The wall runs on USB power, so trade WiFi power saving for quick replies.
    WiFi.setSleep(false);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    const unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) delay(50);
}

void setup() {
    Serial.begin(115200);
    display.begin();
    pinMode(BUTTON_PIN, INPUT);
    stateMutex = xSemaphoreCreateMutex();

    if (!LittleFS.begin(true)) Serial.println("videotext: LittleFS mount failed; screens won't survive a restart");
    loadScreen();
    Serial.printf("videotext: firmware %s, stored screen: %s\n", FW_VERSION, state.hasScreen ? "yes" : "no");

    // Join WiFi before the first draw, so a board without a stored screen draws
    // its connection details once instead of "joining WiFi" and then again.
    connectWifi();
    if (WiFi.status() == WL_CONNECTED) state.ip = WiFi.localIP().toString().c_str();
    Serial.printf("videotext: wifi %s ip=%s\n", WiFi.status() == WL_CONNECTED ? "joined" : "not joined", state.ip.c_str());

    xTaskCreatePinnedToCore(drawTask, "draw", 16384, nullptr, 1, &drawTaskHandle, 0);
    configTzTime(TIMEZONE, "pool.ntp.org", "time.google.com");
    setupServer();
    requestDraw();
}

void startMdnsOnce() {
    static bool started = false;
    if (started || WiFi.status() != WL_CONNECTED) return;
    if (MDNS.begin(HOSTNAME)) {
        MDNS.addService("http", "tcp", 80);
        started = true;
        Serial.println("videotext: answering as " HOSTNAME ".local");
    }
}

void loop() {
    server.handleClient();

    // Keep the address on the connection screen current if DHCP moves us.
    static unsigned long lastWifiCheck = 0;
    if (millis() - lastWifiCheck > 2000) {
        lastWifiCheck = millis();
        startMdnsOnce();
        const std::string ip = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "";
        bool changed = false;
        {
            Lock lock;
            if (ip != state.ip) {
                state.ip = ip;
                if (!state.hasScreen || state.infoRequested) {
                    state.wantedVersion++;
                    changed = true;
                }
            }
        }
        if (changed) {
            Serial.printf("videotext: ip now %s\n", ip.c_str());
            requestDraw();
        }
    }

    // The side button toggles between the screen and the connection details.
    static int lastLevel = HIGH;
    static unsigned long lastChangeMs = 0;
    const int level = digitalRead(BUTTON_PIN);
    if (level != lastLevel && millis() - lastChangeMs > 50) {
        lastChangeMs = millis();
        lastLevel = level;
        if (level == LOW) {
            {
                Lock lock;
                state.infoRequested = state.hasScreen ? !state.infoRequested : false;
                state.wantedVersion++;
            }
            Serial.println("videotext: button");
            requestDraw();
        }
    }
    delay(2);
}
