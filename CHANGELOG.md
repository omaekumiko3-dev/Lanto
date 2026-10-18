# Changelog

## Unreleased

- Keep locked remote sessions selected when local popups take focus; protect foreground placement, block input during restoration, and release protection on explicit return. Delayed stream startup also acquires protection when its window becomes visible.
- Complete focus handoffs through the target window's input queue for both remote streams and the local controller. Keep the input barrier without a global foreground lock, and allow an opening player to release selection before its window exists.
- Allow atomic input-state file replacement, retry brief Windows sharing conflicts, and roll back settings on every affected client if a live update fails.

- Add selectable 4K (3840 × 2160) streaming alongside 1440p and 1080p.
- Keep up to two remote streams open and cycle Local → remote 1 → remote 2 → Local in connection order. Disconnect and volume controls apply independently.
- Preserve held modifiers across Windows/native-player handoffs; each separate switch-key press advances once, with no timed debounce or autorepeat cycling.
- Start new profiles at 4K, 60 FPS, and 120 Mbps per stream, with a 150 Mbps settings ceiling. Existing profiles retain their saved values.
- Keep resolution, frame rate, and bitrate independently adjustable, with guidance for desktop text clarity and bandwidth.
- Document true 4K host display setup, including an optional macOS HiDPI virtual-display helper and Windows display restoration after streaming.
- Add an optional GNOME Wayland virtual-display helper, user service, Sunshine startup ordering, and Portal setup for 4K60 streaming with physical outputs inactive.
- Keep the GNOME virtual screen's cursor visible and use a single virtual desktop by default; document a memory-buffer capture workaround for NVIDIA Portal flicker.
- Check the virtual display's active PipeWire link and consumer ownership before reporting readiness, and bound teardown of a stalled helper to five seconds.

## 0.3.1 — 2026-10-17

First public open-source release.

### Included

- Windows x64 portable controller with a native Moonlight player and SSH provisioning resources.
- Named Windows, macOS, and Linux devices; one active desktop stream; local disconnect shortcut.
- Per-device volume and mute, optional performance overlay, and persistent settings.
- Paired Host discovery and authorization; text/image clipboard and optional file/folder sharing.
- Direct userspace WireGuard transport with account-free provisioning and pinned tunnel helpers.
- Linux clipboard recovery after a graphical-session change.
- Native runtime dependency verification, with required Qt support libraries and Microsoft C++ runtime files included for portable use.
- English product, setup, architecture, contribution, security, and build documentation.
- MIT licensing for original Lanto code; preserved GPL terms and notices for native integrations.
- Real UI screenshots and ImageGen product illustrations.

### Known limitations

- Windows x64 is the only packaged controller. Hardware validation covers selected Windows, Apple Silicon macOS, and Ubuntu setups.
- Direct tunnel tests cover LAN operation; internet connectivity and restrictive NAT remain unverified.
- Remote IME works through the host's input method; local IME forwarding is absent.
- Native Mac cursor synchronization and Windows shared-bind rendering remain experimental.
- No automatic updater, no signed Windows executable, and no guarantee of unattended access before graphical login.

Earlier 0.3.0 builds were private development packages. This changelog starts with the first public release rather than assigning public release status to those builds.
