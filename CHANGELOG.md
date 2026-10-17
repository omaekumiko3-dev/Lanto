# Changelog

## Unreleased

- Add selectable 4K (3840 × 2160) streaming alongside 1440p and 1080p.
- Start new profiles at 4K, 30 FPS, and 60 Mbps. Existing profiles retain their saved values.
- Keep resolution, frame rate, and bitrate independently adjustable, with guidance for desktop text clarity and bandwidth.
- Document true 4K host display setup, including an optional macOS HiDPI virtual-display helper and Windows display restoration after streaming.

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
