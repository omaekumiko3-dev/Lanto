# Initial Windows → Mac Deployment Record

> Historical hardware verification. Addresses and device labels are anonymized examples; this is not a universal setup guarantee.

Date: 2026-10-16. Deployed source: `3cfa8522c589665d8c6fbf1f4d68869f9a9cef61`. SSH and file transfer used the local credential manager's `macOS test host` project without reading or copying its hidden credentials.

## Deployed components

| Location | Component | Installation |
| --- | --- | --- |
| Windows | Lanto Electron controller | Production build of this repository; desktop `Lanto` shortcut |
| Windows | Moonlight Qt 6.2.0 x64 | `%LOCALAPPDATA%\Lanto\tools\Moonlight-6.2.0\Moonlight.exe` |
| Mac mini M2 | Lanto Host | `~/.lanto/releases/3cfa852/src/host/cli.ts` |
| Mac | Node.js 24.22.0 arm64 | `~/.lanto/runtime/node-v24.22.0-darwin-arm64`; existing system Node retained |
| Mac | Sunshine 2026.914.233613 arm64 | `~/Applications/Sunshine.app` |

The Mac was running macOS 26.3.1 with a logged-in graphical desktop and an LG UltraFine display. Deployment used Mac Ethernet address `192.0.2.10` and Windows address `192.0.2.1`. These were observations at the time, not proof of DHCP reservations; reserve leases by adapter MAC address on the router afterward.

## Startup after login

Two user LaunchAgents were created on the Mac:

- `~/Library/LaunchAgents/dev.lanto.host.plist`: starts the specified Node and Host versions and restarts after unexpected exit; logs are `~/.lanto/logs/host.log` and `host-error.log`.
- `~/Library/LaunchAgents/dev.lanto.sunshine.plist`: opens Sunshine.app through `/usr/bin/open -g` after desktop login. It has no KeepAlive, so manually quitting Sunshine does not immediately reopen it repeatedly.

Host `ProgramArguments` contains the absolute Node path above, the absolute CLI path above, and `start`. After moving the installation, update the plist, check it with `plutil -lint`, and reload it in the user's `gui/<uid>` domain. The CLI's `service-file` command still generates Linux systemd files only; these launchd files were deployed manually.

Check Host:

```bash
~/.lanto/runtime/node-v24.22.0-darwin-arm64/bin/node \
  ~/.lanto/releases/3cfa852/src/host/cli.ts status
launchctl print gui/$(id -u)/dev.lanto.host
```

These services require user login. Automatic login was not configured during initial deployment; it was later requested by the user and verified with full restarts, as recorded under Unattended startup acceptance below.

## Pairing and local state

Two independent authorizations were completed:

1. The Lanto controller verified the Mac Host certificate and identity using one-time credentials and established management access. Windows system secure storage encrypts subsequent tokens.
2. Windows Moonlight initiated PIN pairing with Mac Sunshine, whose API returned success. Temporary pairing credentials and PIN files were deleted after use.

Sunshine initially had no administrator account. A separate random administrator password was created without reusing the SSH password and stored at Mac `~/.lanto/sunshine-admin.json` with mode `0600`. This file contains plaintext administrator credentials for this local deployment and must not be committed or synchronized. The SSH session could not access the macOS login keychain, so no keychain-storage claim was made. Do not send it to an agent through `cat` or logs; future automation can read it locally on the Mac and authenticate directly to the loopback API.

Lanto runtime configuration is in the Windows Electron user directory; Moonlight uses its own pairing-certificate store. Removing Host authorization from Lanto does not remove Sunshine media authorization. Revoke them separately.

## Mac desktop permissions and video acceptance

First-run logs explicitly reported `No screen capture permission!`. Allow Sunshine Screen Recording and Accessibility in Mac System Settings → Privacy & Security, then quit and reopen as directed by the OS. The user granted permissions through the system interface; no TCC database or system protections were modified.

The Mac then restarted and returned to the desktop. Host identity and both pairings were retained, and services resumed after login. Host was briefly unreachable during startup; wait for startup to finish before retrying.

After restart, Sunshine initialized screen capture and found H.264/HEVC VideoToolbox encoders. When Lanto started a Desktop stream, Sunshine logged `New streaming session started` and `CLIENT CONNECTED` and created a hardware HEVC session. Windows Lanto also reported its managed Moonlight client running.

At this stage, management access, media pairing, handshake, and encoder startup passed. The user saw the desktop and confirmed basic input; response improvements follow below. Stable frame rate, complete Chinese-input compatibility, and dedicated shortcuts still need separate acceptance. `sunshineReachable: true` means only that the local TCP port is reachable, not that video works.

On Windows, open desktop Lanto and enable the upper-right connection switch on the StudioMac card. The initial connection used 2560×1440, 30fps, and 20Mbps; the local setup now uses the response configuration below. `Ctrl + Alt + F12` returns locally by closing the local streaming client. Video uses a separate Moonlight window; native Windows `Alt + Tab` switches windows while retaining the session without remapping system shortcuts.

## Response improvements

After initial use, the user reported slow pointer/input response and dragging that lagged behind. Inspection found RTX 3080 and 2.5GbE on Windows, with Mac Ethernet negotiated at 1Gbps. Twelve LAN pings were under 1ms with no loss. This describes that small-packet round trip and link state, not video or end-to-end latency. Mac startup load had subsided, and Sunshine used hardware VideoToolbox HEVC.

Keeping 2K and 20Mbps, frame rate was raised to 60fps and Response priority and Performance statistics enabled in Lanto. Response priority only adds `--no-vsync --no-frame-pacing`; it does not force a codec change, adjust the Mac display, or alter the network. Old configurations without these fields default to both options disabled.

After reconnection, client diagnostics confirmed:

- Video format `2560x1440x60`.
- NVIDIA RTX 3080 with D3D11VA decoding/rendering and hardware HEVC.
- `V-sync disabled` and `Frame pacing disabled`.
- Sunshine again logged `CLIENT CONNECTED` and created a VideoToolbox HEVC session.

The user then reported a clear improvement in pointer, typing, and dragging. This is user feedback; host processing, decoding, frame-queue, and rendering timings were not recorded before and after, so no specific end-to-end milliseconds, sustained frame rate, or loss rate can be reported from it.

With statistics enabled, Lanto writes Moonlight stderr to Windows `%APPDATA%\Lanto\media-logs\moonlight-<timestamp>.log` for diagnosis. Local logs may contain device and application information. Moonlight 6.2.0 redacts streaming session keys in its log handler and bounds each log's size. Disabling statistics prevents creation of new diagnostic logs. Settings and the media adapter own display parameters and log storage respectively; Host does not control video parameters.

If tearing appears, change Latency policy back to Follow Moonlight settings for the next connection. Moonlight's `Ctrl + Alt + Shift + S` temporarily hides the statistics overlay; reconnecting uses Lanto's saved setting.

At the user's request, a native decoding/rendering investigation and eight short comparisons added a reversible Windows shared-device-and-texture experiment. It is enabled locally, and the user confirmed normal, more responsive operation. Data supports lower average rendering time, but no full end-to-end measurement exists. See [performance investigation](performance-investigation.md) for the process and source evidence. The temporary Mac animation exited, and normal desktop access was restored.

## Local cursor and native VideoToolbox experiment

Windows `Moonlight-Lanto-native-3` (v2 fixes with updated icons) and Mac `~/Applications/LantoSunshineNative.app` were deployed. The Mac uses separate identifier `dev.lanto.sunshine.native` and profile `~/.lanto/native-video/profile`, preserving the original app and configuration. Side-by-side testing used port 48989; after acceptance, it moved to normal port 47989 with local cursor enabled. See [native components](../native/README.md) for pinned source and builds.

The initial temporary-signature version encountered input rejection, blocked Core Audio initialization, and H.264 decoding errors. TCC logs identified `PostEvent` and `AudioCapture` records still requiring the old binary signature; resetting only Screen Recording or Accessibility did not resolve it. The app now uses an existing stable local Developer ID. Only official `tccutil` was used to clear the experimental app's relevant old records, and the user granted permissions again in the system UI. After restart, screen capture and input were granted, and system audio capture and Opus initialized normally. No TCC database or system protections were modified.

The H.264 error came from the client reducing the SPS reference-frame limit to one, incompatible with native VideoToolbox's multiple-reference stream. The v2 client preserves actual SPS when the host advertises `LantoPreserveH264Sps`; ordinary hosts retain the original behavior. This is negotiated independently of cursor mode. H.264 with local cursor on and off received initial video and audio packets without the earlier reference-frame, slice, or decoder-submission errors. A normal stable HEVC connection also verified capability fallback.

Real input probes received clicks, dragging, and keyboard events. After each of three disconnects, waiting more than ten seconds did not trigger the old audio-exit watchdog, and reconnection succeeded. A final intentional service restart preserved permissions and established native HEVC. The setup retains a 2K60 request, 20Mbps, D3D11VA shared device and textures, response priority, and local cursor; the normal Mac desktop is restored. Native-backend performance superiority, long-term stability, and sustained frame-rate acceptance are not established.

The `dev.lanto.sunshine` login item now points to the native app and separate profile. The original item is backed up at `~/.lanto/native-video/sunshine-stable-launchagent.plist`. To roll back, disable local cursor in Lanto, quit the native service, restore that login item, and start original Sunshine. Original Moonlight and Sunshine were retained; later full-restart acceptance is below.

## Subsequent cursor-shape synchronization

Windows was updated to `Moonlight-Lanto-native-4`, and the Mac app was updated at the same path. New C++/Objective-C++ cursor modules synchronize transparent images, dimensions, and hotspots through existing paired HTTPS, retaining local drawing. Performance statistics remain off. The user confirmed correct shape changes over text, links, and window edges.

Old and new Mac apps have identical designated signing requirements and passed strict signature verification, so no new permissions were required. The previous native app was kept as `~/.lanto/native-video/LantoSunshineNative-before-cursor.app`. After the final build restarted, HEVC and system audio initialized successfully. Test windows exited. See [native components](../native/README.md) for implementation, patch order, and test entry points.

## Unattended startup acceptance

The tested Mac resumed its Host and native Sunshine after graphical login. A second reboot test used a desktop account already configured for automatic login by the machine owner. The existing controller pairing was reused; HEVC video, system audio, and local cursor resumed without another application launch or permission prompt.

This checks startup on that configured desktop. Lanto does not configure automatic login, change disk-encryption policy, or guarantee remote access before a graphical session starts. A login-screen SSH connection alone does not establish a usable desktop stream.

## Download sources and checksums

Verified downloads were official release assets:

| Asset | SHA-256 |
| --- | --- |
| [Node.js 24.22.0 darwin-arm64](https://nodejs.org/dist/v24.22.0/node-v24.22.0-darwin-arm64.tar.gz) | `6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5` |
| [Sunshine macOS arm64 DMG](https://github.com/LizardByte/Sunshine/releases/download/v2026.914.233613/Sunshine-macOS-arm64.dmg) | `795f03a389c5726f9a7b15f501dc1ddf204b442cae565859ac83aae027a9e07c` |
| [Moonlight 6.2.0 portable x64](https://github.com/moonlight-stream/moonlight-qt/releases/download/v6.2.0/MoonlightPortable-x64-6.2.0.zip) | `6f91d268b41ed5ca8066d9d7578dc403b8db190991ff48f00b1700465f8f7ebf` |

Sunshine passed `codesign --verify --deep --strict`; `spctl` reported an unnotarized Developer ID. The app launched through normal `open`, without removing quarantine attributes or disabling Gatekeeper. Deployment installers and debugging scripts were stored in ignored `work/` or Mac `~/.lanto/deploy`, outside repository contents.
