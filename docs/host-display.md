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

## GNOME Wayland without a physical display

Turning off a monitor can remove its HDMI/DisplayPort output from Linux entirely. KMS capture then loses its framebuffer even though Sunshine and the network remain healthy. Increasing bitrate or restarting the client cannot restore a missing display.

The optional [Linux display helper](../scripts/display/linux-virtual-display.py) uses Mutter's `RecordVirtual` interface and a GStreamer PipeWire consumer to keep a 3840 × 2160, 60 Hz desktop output alive in the existing graphical session. It makes that output primary and uses 150% scaling when supported. The included service passes `--virtual-only`, keeping physical outputs inactive while the helper runs so windows and the pointer cannot remain outside the streamed desktop. Remove that argument if you deliberately want an extended desktop; other outputs are then arranged to its right. It does not start a separate desktop or install a kernel driver. The [Mutter ScreenCast interface](https://github.com/GNOME/mutter/blob/main/data/dbus-interfaces/org.gnome.Mutter.ScreenCast.xml) is private and requires validation after desktop upgrades.

The helper embeds the cursor. Using hidden or metadata cursor mode inhibits Mutter's cursor overlay on the virtual view, so even a separate Sunshine monitor capture can lose the pointer.

This requires GNOME Wayland, Python GObject bindings, GStreamer with `pipewiresrc`, `pw-dump`, and a Sunshine version with XDG Portal capture. Install the distribution packages `python3-gi`, `gir1.2-gstreamer-1.0`, `gstreamer1.0-pipewire`, `gstreamer1.0-tools` and `pipewire-bin` if missing. Back up the current Sunshine configuration and any existing helper service before installation.

```sh
mkdir -p "$HOME/.lanto/display" "$HOME/.config/systemd/user"
cp scripts/display/linux-virtual-display.py scripts/display/wait-linux-display.sh "$HOME/.lanto/display/"
chmod 700 "$HOME/.lanto/display/"*.py "$HOME/.lanto/display/wait-linux-display.sh"
cp scripts/display/lanto-virtual-display.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now lanto-virtual-display.service
python3 "$HOME/.lanto/display/linux-virtual-display.py" --check-ready
```

The checked Ubuntu 26.04 / GNOME 50 configuration uses the official [Sunshine v2026.1017.185028 pre-release](https://github.com/LizardByte/Sunshine/releases/tag/v2026.1017.185028). The previous stable build, v2026.914.233613, stalled during Portal negotiation on live connections and on restart. Disabling its tray allowed one connection but did not resolve the restart failure. The newer build contains [Portal lifecycle fixes](https://github.com/LizardByte/Sunshine/pull/5774); verify the exact version you deploy and retain the previous package for rollback.

Set these Sunshine options and remove an old physical `output_name`:

```ini
capture = portal
system_tray = disabled
```

Restart Sunshine, select **MetaVendor** in GNOME's Remote Desktop sharing dialog, keep **Remember This Selection** enabled, enable **Allow Remote Interaction**, and share that output. This system authorization must complete before Portal capture is usable. Keep other selected displays unchecked so capture stays on the virtual screen. With the machine owner's authorization, the normal dialog can also be operated through accessibility actions over SSH; no portal permission database edits are needed.

For startup ordering, add `~/.config/systemd/user/app-dev.lizardbyte.app.Sunshine.service.d/lanto-display.conf`:

```ini
[Unit]
Requires=lanto-virtual-display.service
After=lanto-virtual-display.service

[Service]
ExecStartPre=%h/.lanto/display/wait-linux-display.sh
```

Run `systemctl --user daemon-reload` after adding the drop-in. Both services start with the logged-in graphical session; this does not create a desktop before login. Verify the actual host PipeWire capture dimensions and a client stream with physical outputs disabled. A healthy helper alone does not confirm Sunshine capture or keyboard input.

On the tested NVIDIA/GNOME host, Portal DMA-BUF capture flickered despite healthy stream statistics. The optional [Sunshine memory-capture drop-in](../scripts/display/sunshine-memory-capture.conf) selects Mesa software EGL for the Sunshine process, making capture use memory buffers while retaining NVENC encoding. It leaves GNOME and applications on their normal GPU renderer. This adds a frame copy and can cost CPU/memory bandwidth. It requires the Mesa EGL vendor file at the path in the drop-in; verify that file exists before using it. `NoNewPrivileges=yes` also prevents Sunshine from acquiring its file capabilities, so this configuration targets Portal rather than KMS capture.

```sh
test -f /usr/share/glvnd/egl_vendor.d/50_mesa.json
cp scripts/display/sunshine-memory-capture.conf "$HOME/.config/systemd/user/app-dev.lizardbyte.app.Sunshine.service.d/lanto-memory-capture.conf"
systemctl --user daemon-reload
systemctl --user restart app-dev.lizardbyte.app.Sunshine.service
```

Verify that Sunshine logs `using memory buffers` and `Creating encoder [hevc_nvenc]` during the actual connection. Test moving windows and the cursor, not just receipt of video. To remove this workaround, delete only `lanto-memory-capture.conf`, reload the user service manager, and restart Sunshine.

Do not stop the virtual display's screen-sharing session from GNOME's status indicator. Mutter assigns a new serial when the virtual output is recreated, which can invalidate a saved Portal selection; a new selection may therefore be required after recreating the helper or the desktop session. Restarting Sunshine alone was checked without another prompt. This setup does not guarantee unattended access across logout or reboot. The helper's runtime status is `$XDG_RUNTIME_DIR/lanto-virtual-display.json`; its `--check-ready` command verifies the owning process, active 4K/60 mode, and an active PipeWire link between the running source and that helper's running consumer. A surviving monitor alone is insufficient. The helper has a five-second service stop timeout because a stalled PipeWire teardown can block GStreamer cleanup.

If the screen is black while the monitor still exists, inspect `pw-dump` or `wpctl status` and Sunshine's journal. In one observed failure, the helper link stayed `negotiating`, Sunshine stayed `paused`, audio capture timed out, and even an independent monitor capture could not produce a frame. Restarting WirePlumber alone did not recover it. Disconnecting the Linux client, stopping Sunshine and the helper, restarting the user's PipeWire/PulseAudio/WirePlumber services, then recreating the helper and Portal sessions restored capture. Re-authorize the virtual output through the normal sharing dialog if its identity changed, and reconnect only after the readiness check passes. This recovery temporarily interrupts that user's multimedia streams; it does not require closing desktop applications or rebooting. Verify actual pixels and Sunshine's `paused -> streaming` transition, because incoming packets can still encode a black fallback frame. No automatic restart of the user's entire media stack is installed.

To roll back, stop Sunshine, restore the backed-up Sunshine configuration and remove only the `lanto-display.conf` and optional `lanto-memory-capture.conf` drop-ins added above. Then disable and stop `lanto-virtual-display.service`, reload the user service manager, and restart Sunshine with the physical monitor connected. Keep the backup until physical capture has been checked.
