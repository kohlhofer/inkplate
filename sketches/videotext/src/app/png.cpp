#include "png.h"

namespace vt {

namespace {

// The panel's perceived colours, matching the archived relay's preview palette.
const std::uint8_t PALETTE[7][3] = {
    {57, 48, 57}, {255, 255, 255}, {58, 91, 70}, {61, 59, 94}, {156, 72, 75}, {208, 190, 71}, {177, 106, 73},
};

std::uint32_t crc32Update(std::uint32_t crc, const std::uint8_t* data, std::size_t len) {
    crc = ~crc;
    for (std::size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

void putU32(std::vector<std::uint8_t>& out, std::uint32_t v) {
    out.push_back(v >> 24);
    out.push_back(v >> 16);
    out.push_back(v >> 8);
    out.push_back(v);
}

void putChunk(std::vector<std::uint8_t>& out, const char* type, const std::vector<std::uint8_t>& data) {
    putU32(out, static_cast<std::uint32_t>(data.size()));
    const std::size_t typeStart = out.size();
    out.insert(out.end(), type, type + 4);
    out.insert(out.end(), data.begin(), data.end());
    putU32(out, crc32Update(0, out.data() + typeStart, 4 + data.size()));
}

}  // namespace

std::vector<std::uint8_t> encodePng(const std::uint8_t* pixels, int width, int height) {
    const int rowBytes = (width + 1) / 2;

    // Scanlines: filter type 0, then two pixels per byte, high nibble first.
    std::vector<std::uint8_t> raw;
    raw.reserve(static_cast<std::size_t>(height) * (rowBytes + 1));
    for (int y = 0; y < height; y++) {
        raw.push_back(0);
        const std::uint8_t* row = pixels + y * width;
        for (int x = 0; x < width; x += 2) {
            const std::uint8_t hi = row[x] & 0x0f;
            const std::uint8_t lo = (x + 1 < width) ? (row[x + 1] & 0x0f) : 0;
            raw.push_back(static_cast<std::uint8_t>((hi << 4) | lo));
        }
    }

    // zlib stream of stored (uncompressed) deflate blocks.
    std::vector<std::uint8_t> idat;
    idat.reserve(raw.size() + raw.size() / 65535 * 5 + 16);
    idat.push_back(0x78);
    idat.push_back(0x01);
    std::size_t pos = 0;
    do {
        const std::size_t len = raw.size() - pos > 65535 ? 65535 : raw.size() - pos;
        const bool last = pos + len == raw.size();
        idat.push_back(last ? 1 : 0);
        idat.push_back(len & 0xff);
        idat.push_back(len >> 8);
        idat.push_back(~len & 0xff);
        idat.push_back((~len >> 8) & 0xff);
        idat.insert(idat.end(), raw.begin() + pos, raw.begin() + pos + len);
        pos += len;
    } while (pos < raw.size());
    std::uint32_t a = 1, b = 0;
    for (std::uint8_t byte : raw) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
    }
    putU32(idat, (b << 16) | a);

    std::vector<std::uint8_t> png = {0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a};
    std::vector<std::uint8_t> ihdr;
    putU32(ihdr, width);
    putU32(ihdr, height);
    ihdr.insert(ihdr.end(), {4, 3, 0, 0, 0});  // bit depth 4, palette colour, deflate, no filter set, no interlace
    putChunk(png, "IHDR", ihdr);

    std::vector<std::uint8_t> plte;
    for (const auto& rgb : PALETTE) plte.insert(plte.end(), rgb, rgb + 3);
    putChunk(png, "PLTE", plte);
    putChunk(png, "IDAT", idat);
    putChunk(png, "IEND", {});
    return png;
}

std::string base64Encode(const std::vector<std::uint8_t>& data) {
    static const char ALPHABET[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve((data.size() + 2) / 3 * 4);
    std::size_t i = 0;
    for (; i + 2 < data.size(); i += 3) {
        const std::uint32_t n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        out += ALPHABET[(n >> 18) & 63];
        out += ALPHABET[(n >> 12) & 63];
        out += ALPHABET[(n >> 6) & 63];
        out += ALPHABET[n & 63];
    }
    if (i < data.size()) {
        std::uint32_t n = data[i] << 16;
        if (i + 1 < data.size()) n |= data[i + 1] << 8;
        out += ALPHABET[(n >> 18) & 63];
        out += ALPHABET[(n >> 12) & 63];
        out += i + 1 < data.size() ? ALPHABET[(n >> 6) & 63] : '=';
        out += '=';
    }
    return out;
}

}  // namespace vt
