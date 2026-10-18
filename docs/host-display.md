# Sharp 4K host desktops

The stream resolution and the host desktop resolution are separate. A 3840 × 2160 video can contain a 1920 × 1080 desktop enlarged by the encoder. Increasing bitrate cannot recover text detail that the host never rendered.

For a 4K controller, use a 3840 × 2160 host framebuffer and a 3840 × 2160 stream. New profiles request 60 FPS / 120 Mbps per stream; 30 FPS / 60 Mbps remains a lower-bandwidth option. Use the host's display scaling setting to make text larger while retaining the full framebuffer resolution.

The controller's resolution selector configures the video stream. Host display changes remain a separate, optional setup step. The SSH setup wizard does not install virtual displays automatically.

## Check the source first

- **Windows:** Sunshine should report both `Capture size: 3840x2160` and `Desktop resolution [3840x2160]` during the actual session. A 4K decoder message alone is insufficient.
- **macOS:** inspect `system_profiler SPDisplaysDataType`. A HiDPI desktop can correctly show a 3840 × 2160 resolution and a 1920 × 1080 “UI Looks like” size. `CGDisplayModeGetPixelWidth/Height` report framebuffer pixels; logical screen bounds report points.
- **Linux:** inspect the active compositor output and Sunshine's capture dimensions. An Xwayland mode list can differ from the Wayland output actually captured.

If a physical display already exposes 4K, select that supported mode in the operating system. If it is limited to 1080p or 1440p, a virtual display can provide a larger framebuffer for streaming.

## Headless macOS

The optional [virtual-display helper](../scripts/display/macos-virtual-display.m) creates one display named **Lanto 4K**, with 3840 × 2160 framebuffer pixels, 1920 × 1080 logical points, and a 60 Hz display refresh rate. The stream may still run at 30 FPS. The process must remain alive; exiting it removes its display.

This original MIT-licensed helper uses private CoreGraphics virtual-display interfaces. It was checked on an Apple M2 running macOS 26.3.1. Other macOS versions and multi-display arrangements require separate validation. The interface declarations can be compared with [Chromium's virtual-display utility](https://chromium.googlesource.com/chromium/src/+/cca923fbde2d338f3730885e0dbe734eee8465a2/ui/display/mac/test/virtual_display_mac_util.mm).

Build on the Mac with Xcode Command Line Tools, from the repository root:

```sh
mkdir -p "$HOME/.lanto/display"
chmod 700 "$HOME/.lanto/display"
clang -fobjc-arc -Wall -Wextra -Werror \
  -framework Foundation -framework CoreGraphics \
  scripts/display/macos-virtual-display.m \
  -o "$HOME/.lanto/display/lanto-virtual-display"
codesign --force --sign - "$HOME/.lanto/display/lanto-virtual-display"
cp scripts/display/start-macos-sunshine.sh "$HOME/.lanto/display/"
chmod 700 "$HOME/.lanto/display/start-macos-sunshine.sh"
```

Run the helper in the logged-in graphical session. For automatic startup, create a user LaunchAgent with label `dev.lanto.virtual-display`, the helper as its sole program argument, `RunAtLoad` and `KeepAlive` enabled, a 30-second throttle, and `LimitLoadToSessionType` set to `Aqua`. Do not create it as a system LaunchDaemon. It does not provide a desktop before login.

The helper's `--check-ready` command returns success only when its own display exposes a 3840 × 2160 pixel mode. To order startup, prefix the existing Sunshine LaunchAgent's `ProgramArguments` with these two arguments:

1. The absolute path to `start-macos-sunshine.sh`.
2. The absolute path to `lanto-virtual-display`.

Keep the original Sunshine command and all its arguments after those two. The wrapper waits up to 30 seconds for the display, then launches the original command. Back up the original plist first. After introducing the virtual display, restart Sunshine once: a running capture process may retain information about the old headless display. The existing app signature, pairing, and capture permissions stay in place.

To remove the display, disconnect the stream, unload `dev.lanto.virtual-display`, restore the backed-up Sunshine LaunchAgent, and restart Sunshine. The helper neither modifies a system display driver nor writes display overrides.

## Windows with a lower-resolution physical monitor

An optional [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver) can provide the 4K source. Follow its installation instructions and use its signed x64 release. The 25.7.23 driver-only archive used for this verification had SHA-256 `e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a`; its catalog and driver signatures validated as SignPath Foundation. The driver is a separate upstream dependency and is not bundled with Lanto.

Configure one virtual monitor with 3840 × 2160 at 30 and 60 Hz, select the encoding GPU in the driver's configuration, and leave HDR disabled for an SDR setup. Record its stable `device_id` from Sunshine's startup log. Back up `sunshine.conf`, then configure:

```ini
output_name = <the virtual display device_id from this host>
dd_configuration_option = ensure_only_display
dd_resolution_option = manual
dd_manual_resolution = 3840x2160
dd_refresh_rate_option = manual
dd_manual_refresh_rate = 60
dd_hdr_option = disabled
dd_config_revert_on_disconnect = enabled
```

These are [Sunshine display configuration options](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2configuration.html#dd_configuration_option). The physical display is temporarily disabled during streaming so existing applications move onto the streamed desktop. Sunshine restores the previous display arrangement after the last client disconnects. Its default restoration delay is about three seconds.

Before the first connection, leave the physical screen active and disconnect the virtual screen in Windows Display Settings. Keep the virtual display adapter installed and enabled so Sunshine can activate its monitor when needed. Do not select the physical monitor's identifier in `output_name`.

Validate both directions: connect and confirm a real 4K capture, then disconnect and confirm that the original physical screen is active again. If the first connection times out after installing a driver, wait until Sunshine finishes initializing and reconnect; then check repeated connections. Keep the upstream driver's removal instructions available when updating GPU drivers.

To roll back, disconnect, restore the original Sunshine configuration, restart Sunshine, and uninstall the virtual display through its normal installer or Device Manager. Preserve the physical GPU driver.
