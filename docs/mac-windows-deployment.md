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

These services depend on the user being logged in. Automatic login was not configured during the initial deployment; it was later configured at the user’s request and verified by restarting the entire machine. See “Unattended Startup Acceptance” below.

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

On Windows, open the Lanto desktop app and turn on the connection switch in the upper-right corner of the KumikoMac card. For the initial connection, use 2560×1440, 30fps, and 20Mbps; this local machine currently uses the response-optimization settings below. The shortcut key to return to this machine is `Ctrl + Alt + F12`, which will close the local streaming client. The display is hosted in a separate Moonlight window; use Windows native `Alt + Tab` Switching windows can retain the session without rewriting system keyboard shortcuts.

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

Later, at the user’s request, a native decoding/rendering investigation and eight short comparisons were conducted, adding reversible Windows shared-device and texture experiment items. They are enabled locally, and the user confirmed “Normal, the controls feel more responsive.” The data supports a reduction in average rendering time; there is not yet a complete end-to-end measurement. See[Performance Investigation](performance-investigation.md). The temporary test animation on the Mac has exited, and the normal desktop connection has been restored.

## Local Cursor and Native VideoToolbox Experiment

Windows deployed `Moonlight-Lanto-native-3`(update the icon based on the v2 fix) and Mac `~/Applications/LantoSunshineNative.app`. Mac uses a separate identifier `dev.lanto.sunshine.native`, independent `~/.lanto/native-video/profile`, retaining the original application and configuration. The bypass test used port 48989; after this fix was accepted, it was switched to the production port 47989, and the local cursor was enabled. See the fixed source code and build entry point at[Native component](../native/README.md)。

The initial temporary signing version encountered input rejection, Core Audio initialization blocking, and H.264 decoding errors. TCC logs then clearly indicated `PostEvent` and `AudioCapture` Records still require the old binary signature; resetting only screen recording or Accessibility did not resolve the issue. It has now switched to the stable Developer ID already available on this machine, using only the official `tccutil` Clear the corresponding old records for the experimental app, then have the user allow it again in the system interface. After restarting, recordings and input both showed granted, and system audio capture and Opus initialization worked normally; the TCC database was not modified and system protection was not disabled.

The H.264 decoding error came from the client changing the SPS reference frame limit to 1, which is incompatible with multi-reference-frame streams in native VideoToolbox. The v2 client, based on the host `LantoPreserveH264Sps` The capability retains the actual SPS; ordinary hosts continue to use the original logic. This fix negotiates independently of cursor mode. Both H.264 sessions with the local cursor on and off received their first video and audio packets, and no errors related to that reference frame, slice, or decoder input occurred again; fallback from the capability was also verified with a regular stable-version HEVC connection.

The real input probe received click, drag, and keyboard events. After each of three disconnections, waiting more than 10 seconds did not cause the service to be terminated by the old-audio-exit watchdog, and reconnection then succeeded. The last time, the service was restarted deliberately; authorization remained active and a native HEVC connection was established. The current settings retain a 2K60 request, 20Mbps, D3D11VA shared device and texture, prioritize responsiveness, and use the local cursor; the normal Mac desktop has been restored. No performance conclusion showing the native backend outperforming others was reached, and long-duration stability or sustained frame-rate acceptance has not been completed.

`dev.lanto.sunshine` The login startup item now points to the native app and separate configuration. The original startup item backup is at `~/.lanto/native-video/sunshine-stable-launchagent.plist`; when rollback is needed, first turn off the Lanto local cursor, exit the native service, restore the backed-up startup item, and start the original Sunshine. The original Moonlight and Sunshine are both retained; see below for the subsequent full-machine-restart acceptance check.

## Subsequent cursor shape synchronization deployment

Windows has been updated to `Moonlight-Lanto-native-4`, Mac updates the one at the same path `LantoSunshineNative.app`. The added cursor modules are implemented separately in C++/Objective-C++; they sync transparent images, dimensions, and hotspots over the existing paired HTTPS connection. Local rendering is retained, and performance statistics remain disabled. The user confirmed that the cursor changes normally over text areas, links, and window edges.

The specified signing requirements for the old and new Mac applications are the same, and strict signature verification passed, so no reauthorization was needed this time. The native application from before the update is retained as `~/.lanto/native-video/LantoSunshineNative-before-cursor.app`The final version established an HEVC session after restarting, and system audio initialization was normal. This round’s test window has exited. For the implementation, patch order, and test entry point, see[Native component](../native/README.md)。

## Unattended Startup Acceptance

Restarted the entire Mac as requested by the user on 2026-10-16. The first restart was at 11:59 (Asia/Shanghai); with FileVault enabled, SSH was restored first, but the system remained at the graphical login screen. At the user’s explicit choice, use the system `fdesetup` Turn off FileVault; after the user logs in to the desktop, use `sysadminctl -autologin` Configure automatic login for the current account. Authentication is injected by KRU; the password has not been written to the project or logs. Only `autoLoginUser` The preference being present does not mean it succeeded; check the system tool’s status and actually restart.

The second launch time was 12:09:14. No user login was needed again; the console user automatically switched to the target account, and the system reported FileVault Off and that the automatic login account had been set.`dev.lanto.host`, native Sunshine and KRU auto-start; the Host and media HTTPS ports are available. Windows then reuses the existing pairing reconnection, while Mac records CLIENT CONNECTED and establishes a 2560×1440 HEVC VideoToolbox session, with the local cursor enabled and system audio and Opus initialized.

The current flow is “boot → automatic desktop login → Host/Sunshine start automatically → connection initiated from Windows.” Automatic login takes the user directly to the account desktop after startup; the user chose this method. This time, sleep, screen lock, and startup settings for other applications were not changed, and this does not mean automatic startup after a power outage has been configured. The two existing Lanto LaunchAgents do not need to be modified.

## Rebuilding the development environment on the retained system

2026-10-16 The user chose to retain macOS and the account, and redeploy after cleaning up the old development environment. The source code, keychain, signing identities, SSH, and Lanto pairing were actually retained; the disk was not erased and macOS was not reinstalled. Deleted 19 instances of project Git metadata, including the recovery worktrees of `.git` pointer. The old project is still an ordinary source-code directory and no longer retains its local commit history; the Windows repository and GitHub remote are unaffected.

Also clean up the old `node_modules`, virtual environments, Cargo package caches, Xcode DerivedData, real-device support caches, old simulator devices, native build outputs, and duplicate installation packages; remove old Rust 1.88, Node 22, Go 1.25, JDK 17, and old uv Python versions. For the targeted directories already deleted, according to the pre-cleanup `du` The estimated total is approximately 17.36 GiB, which is not equivalent to net space freed on APFS. Rebuild tools and simulators also take up space.

Native Sunshine was redeployed along the same path as a Developer ID-signed app containing runtime libraries. Host updated to `~/.lanto/releases/d0bd3fd`, using the existing standalone Node 24.22.0 runtime and retaining its identity. The same executable and browser extension for KRU have been moved to `~/.local/share/kru-runtime`, and the corresponding LaunchAgent has been updated; the old project’s `target` Can be safely cleaned up. The current working version and recovery package have been separated; several native temporary `.app` The backup has been deleted.

A new terminal uses `~/.config/lanto/development.zsh` Unified tool path:

| Tool | Verified version/configuration |
| --- | --- |
| Node / npm | 24.21.0 LTS / 11.19.0，Homebrew `node@24` |
| Rust | stable 1.99.1, including rustfmt, clippy, macOS arm64, iOS arm64, and iOS Simulator arm64 targets |
| Python / uv | 3.13.16 / 0.12.24; the project uses an independent virtual environment and preserves the system Python |
| Xcode | 26.6 (17F113), keep usable applications and clean up old build state |
| CMake / Ninja / pkgconf | 4.4.4 / 1.13.2 / 3.0.7 |
| Godot | Retain and verify 4.7.1 and the corresponding export template |
| iOS Simulator | Keep the usable iOS 26.5 runtime and create a new `Lanto iPhone 17` |

`~/Developer/Lanto` is a source working copy without Git metadata, with development dependencies installed;`~/Developer/BuildCheck` Save the build check example.`~/Developer/README.txt` To explain how to use it, double-click `~/Developer/open-ios-simulator.command` A new simulator can be opened. The SwiftUI test app was actually displayed in the simulator and was uninstalled after acceptance. CMake/C++, the Rust native program, the Rust simulator static library, the Python virtual environment, and the Godot script all ran/compiled successfully; Lanto’s 19 tests, type checking, Electron production build, and Host compilation passed, and the Electron 44.7.2 arm64 executable was launched to verify its version.

The network check found that the system’s HTTP/HTTPS/SOCKS proxy points to a `127.0.0.1:10808`. These settings have been backed up; only matching stale proxy entries were disabled. Direct access to GitHub Release from the Mac still timed out, so the official Electron archive was downloaded on Windows and transferred via KRU, with SHA-256 checked against the npm package at both ends:`07d73d3d6dd0b8679c2f1849e30df179ea50c1d6b17630fcc398ae05221f0bd2`. TLS verification was not disabled, and no third-party mirror was configured.

Recovery packages and pairing materials are stored in an access-restricted local directory outside the repository; cleanup checklists, verification logs, and proxy backups are saved on the Mac `~/.lanto/maintenance`. They should not be committed to Git.

The final full-machine startup time was 12:36:03, and the account automatically entered the desktop. Host `d0bd3fd`Both the native Sunshine with runtime libraries included and the migrated KRU launch automatically; at 12:37, Windows reused the pairing to reconnect, and new host logs confirmed initialization of HEVC, the local cursor, and system audio. The tool paths and versions in the new terminal were confirmed again after reboot. After reopening the emulator and saving the final recovery package, APFS had about 167.54 GB remaining in actual measurements, a net increase of about 16.0 GB compared with the approximately 151.5 GB after the second reboot before cleanup; this figure includes space used by tools, the emulator, and the recovery package added during that time, and will continue to fluctuate.

Final `lanto-ready.tar.gz` Includes the running native app, Host release files and standalone Node, Lanto identity and media configuration, KRU runtime directory, descriptions of the three LaunchAgents and development environment entry points; it does not include the account keychain or old project source code. SHA-256 matches on Windows and Mac:`498aadb8e52a78eb4367a66ea95b0a076750ce99f0a9aea9b182f18d9bb1e8e5`. The Windows files are in the local Lanto recovery directory mapped by the Codex application, with access restricted to the current user, administrators, and SYSTEM.

## Remove Mac source code later

The user then chose to delete only the source code and defer the keychain. The old project directory on the Mac has been deleted,`~/Developer/Lanto`、`~/Developer/BuildCheck`, old build-service workspaces, Sunshine source code and debugging scripts, as well as deployment/recovery archives on the Mac that contain project source code. The 54 cleanup targets totaled approximately 5.45 GiB before deletion; each was confirmed absent after cleanup. The keychain, signing materials, iCloud sync settings, build tools, simulators, and Windows repositories were retained.

To prevent source code deletion from affecting the service, first install the verified compiled Host artifacts and production dependencies to `~/.lanto/runtime/host-d0bd3fd`, the LaunchAgent entry point is updated to `app/host/cli.js`. After cleaning up the source, restarted Host; the management API and Sunshine reachability checks passed. The existing Windows media session continued running, and the local cursor remained enabled. Later, you can create a new project on Mac to use the existing tools,`~/Developer/README.txt` and the simulator launch entry are retained.

The current Mac recovery package is `~/.lanto/maintenance/recovery/lanto-runtime-only.tar.gz`, and contains only runtime files, configuration, and entry-point instructions. It does not contain the deleted project source code; the JavaScript runtime files and third-party production dependencies are required by the service. The package has been copied back to Windows and its SHA-256 verified:`443957e1cca86fdcf60dce29bb52cde25ef64645c185e60bac36e22d750e1231`. The previous recovery package on Windows was not deleted; the old source-containing archive on the Mac has been removed. The source cleanup checklist is located at `~/.lanto/maintenance/source-removal-completed.json`。

## Download Sources and Verification

The following downloads were verified this time; all are official release assets:

| Asset | SHA-256 |
| --- | --- |
| [Node.js 24.22.0 darwin-arm64](https://nodejs.org/dist/v24.22.0/node-v24.22.0-darwin-arm64.tar.gz) | `6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5` |
| [Sunshine macOS arm64 DMG](https://github.com/LizardByte/Sunshine/releases/download/v2026.914.233613/Sunshine-macOS-arm64.dmg) | `795f03a389c5726f9a7b15f501dc1ddf204b442cae565859ac83aae027a9e07c` |
| [Moonlight 6.2.0 portable x64](https://github.com/moonlight-stream/moonlight-qt/releases/download/v6.2.0/MoonlightPortable-x64-6.2.0.zip) | `6f91d268b41ed5ca8066d9d7578dc403b8db190991ff48f00b1700465f8f7ebf` |

Sunshine’s `codesign --verify --deep --strict` passed;`spctl` reported an unnotarized Developer ID. The application was launched through the normal `open` . No quarantine attributes were removed and Gatekeeper was not disabled this time. The installer and debug scripts used for deployment are in the ignored `work/` or the Mac’s `~/.lanto/deploy`, not included in the repository.
