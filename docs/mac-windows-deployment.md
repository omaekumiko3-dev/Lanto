# First Deployment Record: Windows → Mac

Date: 2026-10-16. Deployed source version:`3cfa8522c589665d8c6fbf1f4d68869f9a9cef61`This time, through KRU’s `Kumiko_mac` The project used SSH and file transfer; it did not read or copy the hidden credentials in them.

## Components deployed

| Position | Component | Installation method |
| --- | --- | --- |
| Windows | Lanto Electron control client | This repository’s production build; desktop `Lanto` Shortcut |
| Windows | Moonlight Qt 6.2.0 x64 | `%LOCALAPPDATA%\Lanto\tools\Moonlight-6.2.0\Moonlight.exe` |
| Mac mini M2 | Lanto Host | `~/.lanto/releases/3cfa852/src/host/cli.ts` |
| Mac | Node.js 24.22.0 arm64 | `~/.lanto/runtime/node-v24.22.0-darwin-arm64`, while retaining the system’s existing Node |
| Mac | Sunshine 2026.914.233613 arm64 | `~/Applications/Sunshine.app` |

The Mac is currently running macOS 26.3.1, is logged into the graphical desktop, and has detected an LG UltraFine display. During deployment, use the Mac’s Ethernet address `192.168.31.27`, Windows is `192.168.31.43`. These are the values observed at the time; they do not mean that a DHCP address reservation has been set. It is recommended to reserve the lease on the router afterward using the network card’s MAC address.

## Launch After Login

Mac created two user LaunchAgents:

- `~/Library/LaunchAgents/dev.lanto.host.plist`: Start the specified versions of Node and Host, then restart after an abnormal exit; logs are located at `~/.lanto/logs/host.log` and `host-error.log`。
- `~/Library/LaunchAgents/dev.lanto.sunshine.plist`: after logging into the desktop, via `/usr/bin/open -g` Open Sunshine.app. This launcher has no KeepAlive, so manually quitting Sunshine will not cause it to reopen repeatedly right away.

Host’s `ProgramArguments` the absolute path of the above Node, the absolute path of the above CLI, and `start`After moving the installation directory, update the plist, using `plutil -lint` Check, then in the corresponding user’s `gui/<uid>` domain reload. The CLI’s `service-file` still only generates Linux systemd files; this launchd file was manually deployed.

Check Host:

```bash
~/.lanto/runtime/node-v24.22.0-darwin-arm64/bin/node \
  ~/.lanto/releases/3cfa852/src/host/cli.ts status
launchctl print gui/$(id -u)/dev.lanto.host
```

These services depend on user login; automatic login was not configured, and FileVault unlocking or control of the system login screen was not verified.

## Pairing and Local Machine Status

Two separate authorizations have been completed:

1. The Lanto controller verifies the Mac Host’s certificate and identity using one-time credentials, then establishes a management connection. Windows system security storage encrypts subsequent tokens.
2. Moonlight on Windows initiates PIN pairing with Sunshine on the Mac, and the Sunshine API returns success. Temporary pairing credentials and the PIN file are deleted after use.

Sunshine had no admin account on its first launch. This time, a separate random admin password was created for it, without reusing the SSH password; stored on the Mac `~/.lanto/sunshine-admin.json`, permissions `0600`. This file contains plaintext administrative credentials and is for this local deployment only; do not commit or sync it. The SSH session cannot access the macOS login Keychain, so it is not claimed to have been saved to the Keychain. Do not use `cat` or logs send it to the agent; subsequent automated management programs can read it locally on the Mac and authenticate directly to the loopback API.

Lanto’s runtime configuration is stored in the Windows Electron user directory, and Moonlight uses its own paired certificate store. Deleting Lanto’s Host authorization will not also delete Sunshine’s media authorization; the two must be revoked separately.

## Mac Desktop Permissions and Screen Acceptance

The first-run log clearly reports `No screen capture permission!`. Allow Sunshine’s screen recording and accessibility permissions in Mac “System Settings → Privacy & Security,” then quit and reopen it as prompted by the system. The user grants permissions in the system interface; this task did not modify the TCC database or disable system protections.

The Mac then restarted and returned to the desktop; the original Host identity and both pairings were retained, and the service recovered after login. During startup for the first time, the Host was temporarily unreachable; wait for the system to finish starting and then try again.

After reboot, Sunshine’s screen capture initialization succeeded and the H.264/HEVC VideoToolbox encoders were detected. After Lanto started a Desktop stream, Sunshine logged `New streaming session started` and `CLIENT CONNECTED`, and an HEVC hardware encoding session was established. Windows Lanto also recorded that the managed Moonlight client was running.

Current status: management connection, media pairing, media handshake, and encoder startup have passed; the user has seen the desktop and confirmed that basic input works. Subsequent responsiveness optimization is described below. Stable frame rate, full Chinese input compatibility, and dedicated keyboard shortcuts still require separate acceptance.`sunshineReachable: true` This only indicates that the local TCP port is reachable; it cannot replace visual acceptance.

Open Lanto on the Windows desktop, select KumikoMac, then click Open Remote Desktop. For the first connection, use 2560×1440, 30fps, and 20Mbps; this machine currently uses the response optimized settings below. The shortcut to return to this machine is `Ctrl + Alt + F12`, which will close the local streaming client. The display is hosted in a separate Moonlight window; use Windows native `Alt + Tab` Switching windows can retain the session without rewriting system keyboard shortcuts.

## Response Optimization

After first use, the user reported slow mouse/input response and sluggish window dragging. On-site checks: Windows has an RTX 3080 and 2.5GbE; the Mac Ethernet link negotiated at 1Gbps; all 12 LAN pings were under 1ms with no packet loss. This only indicates the small-packet round-trip and link state for that check; it cannot replace video-link or end-to-end latency measurements. The Mac’s startup load has subsided, and Sunshine uses VideoToolbox HEVC hardware encoding.

This time, keep 2K and 20Mbps, set the frame rate to 60fps, and enable “Prioritize Response” and “Performance Statistics” in Lanto settings. Prioritize Response only explicitly appends `--no-vsync --no-frame-pacing`; does not force codec changes, adjust the Mac display, or modify the network. When the old configuration lacks the newly added fields, these options default to off for continued compatibility.

After reconnection, client diagnostic logs confirmed:

- Video format is `2560x1440x60`。
- Select NVIDIA RTX 3080, use D3D11VA accelerated decoding/rendering, and use the hardware-accelerated path for HEVC.
- `V-sync disabled`，`Frame pacing disabled`。
- Sunshine recorded again `CLIENT CONNECTED` and establish a HEVC VideoToolbox session.

The user subsequently confirmed that the mouse, typing, and dragging experience had “clearly improved.” This is user experience feedback; host processing, decoding, frame queue, or rendering times before and after optimization have not yet been recorded, so specific end-to-end milliseconds, stable frame rate, or frame drop rate cannot be reported based on this.

When statistics are enabled, Lanto writes Moonlight stderr to Windows `%APPDATA%\Lanto\media-logs\moonlight-<Timestamp>.log`, making it easier to investigate later. Logs are saved locally and may contain device and application information; Moonlight 6.2.0, used here, redacts streaming session keys in its log handler and limits the size of each log. No new diagnostic logs are created when statistics are off. The settings and media adapter handle interface parameters and log saving separately; Host does not control image parameters.

If tearing occurs, you can change “Latency Strategy” back to “Follow Moonlight Settings”; it takes effect on the next connection. The statistics overlay can use Moonlight’s `Ctrl + Alt + Shift + S` Temporarily hidden; starts with the settings saved by Lanto when reconnected.

## Download Sources and Verification

The following downloads were verified this time; all are official release assets:

| Asset | SHA-256 |
| --- | --- |
| [Node.js 24.22.0 darwin-arm64](https://nodejs.org/dist/v24.22.0/node-v24.22.0-darwin-arm64.tar.gz) | `6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5` |
| [Sunshine macOS arm64 DMG](https://github.com/LizardByte/Sunshine/releases/download/v2026.914.233613/Sunshine-macOS-arm64.dmg) | `795f03a389c5726f9a7b15f501dc1ddf204b442cae565859ac83aae027a9e07c` |
| [Moonlight 6.2.0 portable x64](https://github.com/moonlight-stream/moonlight-qt/releases/download/v6.2.0/MoonlightPortable-x64-6.2.0.zip) | `6f91d268b41ed5ca8066d9d7578dc403b8db190991ff48f00b1700465f8f7ebf` |

Sunshine’s `codesign --verify --deep --strict` passed;`spctl` reported an unnotarized Developer ID. The application was launched through the normal `open` . No quarantine attributes were removed and Gatekeeper was not disabled this time. The installer and debug scripts used for deployment are in the ignored `work/` or the Mac’s `~/.lanto/deploy`, not included in the repository.
