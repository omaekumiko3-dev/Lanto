#include "lanto_cursor.h"
#import <AppKit/AppKit.h>
#import <CommonCrypto/CommonDigest.h>
#include <boost/property_tree/ptree.hpp>
#include <boost/property_tree/xml_parser.hpp>
#include <cmath>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <sstream>

namespace lanto {
namespace {
struct Cursor {
  std::string id, png;
  double width = 0, height = 0, hot_x = 0, hot_y = 0;
  double screen_width = 0, screen_height = 0;
};

std::string hex(const unsigned char *bytes, size_t count) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string out(count * 2, '0');
  for (size_t i = 0; i < count; ++i) {
    out[i * 2] = digits[bytes[i] >> 4];
    out[i * 2 + 1] = digits[bytes[i] & 15];
  }
  return out;
}

Cursor capture_cursor() {
  @autoreleasepool {
    NSCursor *cursor = [NSCursor currentSystemCursor];
    if (!cursor) return {};
    NSImage *image = cursor.image;
    NSSize size = image.size;
    NSPoint hot = cursor.hotSpot;
    if (!std::isfinite(size.width) || !std::isfinite(size.height) ||
        !std::isfinite(hot.x) || !std::isfinite(hot.y) ||
        size.width < 1 || size.height < 1 || size.width > 128 || size.height > 128 ||
        hot.x < 0 || hot.y < 0 || hot.x >= size.width || hot.y >= size.height) return {};

    CGImageRef cg = [image CGImageForProposedRect:nullptr context:nil hints:nil];
    if (!cg || CGImageGetWidth(cg) > 256 || CGImageGetHeight(cg) > 256) return {};
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:cg];
    NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (!png || png.length > 65536) { [bitmap release]; return {}; }

    CGRect screen = CGDisplayBounds(CGMainDisplayID());
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(png.bytes, static_cast<CC_LONG>(png.length), digest);
    Cursor result;
    result.width = size.width;
    result.height = size.height;
    result.hot_x = hot.x;
    result.hot_y = hot.y;
    result.screen_width = screen.size.width;
    result.screen_height = screen.size.height;
    result.png = hex(static_cast<const unsigned char *>(png.bytes), png.length);
    // Geometry is part of the identity, so a display/scale change is not lost.
    result.id = hex(digest, sizeof(digest)) + ":" + std::to_string(size.width) + ":" +
      std::to_string(size.height) + ":" + std::to_string(hot.x) + ":" +
      std::to_string(hot.y) + ":" + std::to_string(screen.size.width) + ":" +
      std::to_string(screen.size.height);
    [bitmap release];
    return result;
  }
}
} // namespace

std::string cursor_xml(const std::string &previous_id) {
  // AppKit work stays on the existing main run loop, away from video encoding.
  Cursor cursor;
  if ([NSThread isMainThread]) cursor = capture_cursor();
  else {
    struct Cache {
      std::mutex mutex;
      std::condition_variable ready;
      Cursor latest;
      bool pending = false;
    };
    static const auto cache = std::make_shared<Cache>();
    const auto state = cache;
    std::unique_lock lock(state->mutex);
    if (!state->pending) {
      state->pending = true;
      dispatch_async(dispatch_get_main_queue(), ^{
        auto next = capture_cursor();
        {
          std::lock_guard guard(state->mutex);
          state->latest = std::move(next);
          state->pending = false;
        }
        state->ready.notify_all();
      });
    }
    // A stopped/busy main loop must not hang HTTPS shutdown or enqueue unbounded work.
    state->ready.wait_for(lock, std::chrono::milliseconds(40), [&]{ return !state->pending; });
    cursor = state->latest;
  }

  boost::property_tree::ptree tree;
  tree.put("root.<xmlattr>.status_code", 200);
  tree.put("root.cursorProtocol", 1);
  tree.put("root.changed", !cursor.id.empty() && cursor.id != previous_id ? 1 : 0);
  if (!cursor.id.empty() && cursor.id != previous_id) {
    tree.put("root.id", cursor.id);
    tree.put("root.width", cursor.width);
    tree.put("root.height", cursor.height);
    tree.put("root.hotX", cursor.hot_x);
    tree.put("root.hotY", cursor.hot_y);
    tree.put("root.screenWidth", cursor.screen_width);
    tree.put("root.screenHeight", cursor.screen_height);
    tree.put("root.png", cursor.png);
  }
  std::ostringstream out;
  boost::property_tree::write_xml(out, tree);
  return out.str();
}
} // namespace lanto
