// Encodes a palette-index frame as a PNG agents can look at. No Arduino
// headers, so it builds on the Mac for tests too.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace vt {

// 4-bit palette PNG of a width*height frame of indices 0..6, in the panel's
// perceived colours. Uses uncompressed deflate blocks: about 135 KB for the full
// panel, which is simpler and faster on the ESP32 than compressing.
std::vector<std::uint8_t> encodePng(const std::uint8_t* pixels, int width, int height);

std::string base64Encode(const std::vector<std::uint8_t>& data);

}  // namespace vt
