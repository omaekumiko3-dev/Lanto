// SPDX-License-Identifier: MIT
// A persistent 4K HiDPI display for a logged-in, headless Mac.
// CoreGraphics virtual-display interfaces are private and may change between OS releases.
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#include <string.h>

@interface CGVirtualDisplayDescriptor : NSObject
@property(nonatomic) unsigned int vendorID, productID, serialNum;
@property(nonatomic, strong) NSString *name;
@property(nonatomic) CGSize sizeInMillimeters;
@property(nonatomic) unsigned int maxPixelsWide, maxPixelsHigh;
@property(nonatomic) CGPoint redPrimary, greenPrimary, bluePrimary, whitePoint;
@property(nonatomic, strong) dispatch_queue_t queue;
@end
@interface CGVirtualDisplaySettings : NSObject
@property(nonatomic, strong) NSArray *modes;
@property(nonatomic) unsigned int hiDPI;
@end
@interface CGVirtualDisplayMode : NSObject
- (instancetype)initWithWidth:(unsigned int)width height:(unsigned int)height refreshRate:(double)rate;
@end
@interface CGVirtualDisplay : NSObject
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@property(nonatomic, readonly) unsigned int displayID;
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc == 2 && strcmp(argv[1], "--check-ready") == 0) {
      CGDirectDisplayID displays[32];
      uint32_t count = 0;
      if (CGGetOnlineDisplayList(32, displays, &count) != kCGErrorSuccess) return 1;
      for (uint32_t index = 0; index < count; index++) {
        CGDirectDisplayID identifier = displays[index];
        if (CGDisplayVendorNumber(identifier) != 0x4c41 || CGDisplayModelNumber(identifier) != 0x4e54) continue;
        CGDisplayModeRef mode = CGDisplayCopyDisplayMode(identifier);
        if (!mode) continue;
        BOOL ready = CGDisplayModeGetPixelWidth(mode) == 3840 && CGDisplayModeGetPixelHeight(mode) == 2160;
        CGDisplayModeRelease(mode);
        if (ready) return 0;
      }
      return 1;
    }
    if (argc != 1) {
      fprintf(stderr, "Usage: lanto-virtual-display [--check-ready]\n");
      return 64;
    }
    if (!NSClassFromString(@"CGVirtualDisplay")) {
      fprintf(stderr, "CoreGraphics virtual displays are unavailable.\n");
      return 1;
    }
    CGVirtualDisplayDescriptor *descriptor = [CGVirtualDisplayDescriptor new];
    descriptor.name = @"Lanto 4K";
    descriptor.vendorID = 0x4c41;
    descriptor.productID = 0x4e54;
    descriptor.serialNum = 1;
    descriptor.maxPixelsWide = 3840;
    descriptor.maxPixelsHigh = 2160;
    descriptor.sizeInMillimeters = CGSizeMake(597, 336);
    descriptor.redPrimary = CGPointMake(0.64, 0.33);
    descriptor.greenPrimary = CGPointMake(0.30, 0.60);
    descriptor.bluePrimary = CGPointMake(0.15, 0.06);
    descriptor.whitePoint = CGPointMake(0.3127, 0.3290);
    descriptor.queue = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
    CGVirtualDisplay *display = [[CGVirtualDisplay alloc] initWithDescriptor:descriptor];
    CGVirtualDisplaySettings *settings = [CGVirtualDisplaySettings new];
    settings.hiDPI = 1;
    settings.modes = @[[[CGVirtualDisplayMode alloc] initWithWidth:1920 height:1080 refreshRate:60]];
    if (!display || ![display applySettings:settings]) {
      fprintf(stderr, "Could not create the Lanto 4K display.\n");
      return 2;
    }
    // Keep the display object alive for the entire GUI-session lifetime.
    __attribute__((objc_precise_lifetime)) CGVirtualDisplay *persistentDisplay = display;
    printf("Created Lanto 4K display %u (1920x1080 points, 3840x2160 pixels).\n", persistentDisplay.displayID);
    fflush(stdout);
    [[NSRunLoop currentRunLoop] run];
    (void)persistentDisplay;
  }
  return 0;
}
