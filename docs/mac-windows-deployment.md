# Initial Windows → Mac Deployment Record

Date: 2026-10-16. Deployed source: `3cfa8522c589665d8c6fbf1f4d68869f9a9cef61`. SSH and file transfer used KRU's `Kumiko_mac` project without reading or copying its hidden credentials.

## Deployed components

| Location | Component | Installation |
| --- | --- | --- |
| Windows | Lanto Electron controller | Production build of this repository; desktop `Lanto` shortcut |
| Windows | Moonlight Qt 6.2.0 x64 | `%LOCALAPPDATA%\Lanto\tools\Moonlight-6.2.0\Moonlight.exe` |
| Mac mini M2 | Lanto Host | `~/.lanto/releases/3cfa852/src/host/cli.ts` |
| Mac | Node.js 24.22.0 arm64 | `~/.lanto/runtime/node-v24.22.0-darwin-arm64`; existing system Node retained |
| Mac | Sunshine 2026.914.233613 arm64 | `~/Applications/Sunshine.app` |

The Mac was running macOS 26.3.1 with a logged-in graphical desktop and an LG UltraFine display. Deployment used Mac Ethernet address `192.168.31.27` and Windows address `192.168.31.43`. These were observations at the time, not proof of DHCP reservations; reserve leases by adapter MAC address on the router afterward.

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

On Windows, open desktop Lanto and enable the upper-right connection switch on the KumikoMac card. The initial connection used 2560×1440, 30fps, and 20Mbps; the local setup now uses the response configuration below. `Ctrl + Alt + F12` returns locally by closing the local streaming client. Video uses a separate Moonlight window; native Windows `Alt + Tab` switches windows while retaining the session without remapping system shortcuts.

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

On 2026-10-16, the entire Mac was restarted at the user's request. The first boot was at 11:59 (Asia/Shanghai). With FileVault enabled, SSH returned first while the machine remained at graphical login. The user explicitly selected disabling FileVault through `fdesetup`. After the user logged into the desktop, `sysadminctl -autologin` configured automatic login for the current account from that GUI session. KRU injected authentication without writing passwords to the project or logs. An `autoLoginUser` preference alone does not prove success; check the system tool's state and actually restart.

The second boot was at 12:09:14. Without another user login, the console user became the target account. The system reported FileVault Off and the automatic-login account configured. `dev.lanto.host`, native Sunshine, and KRU started automatically; Host and media HTTPS ports were available. Windows reused existing pairings. The Mac logged CLIENT CONNECTED, established a 2560×1440 HEVC VideoToolbox session with local cursor, and initialized system audio and Opus.

The current flow is boot → automatic desktop login → Host/Sunshine autostart → Windows connection. Automatic login enters the account desktop at startup; the user chose this behavior. Sleep, screen lock, and other applications' startup settings were unchanged, and automatic power-on after an outage was not configured. The two existing Lanto LaunchAgents required no changes.

## Development environment rebuild with macOS retained

On 2026-10-16, the user chose to keep macOS and the account while cleaning and redeploying the development environment. Source, keychain, signing identities, SSH, and Lanto pairings were retained; no disk erase or macOS reinstall occurred. Git metadata was removed from 19 project locations, including `.git` pointers in recovered worktrees. Those projects remained ordinary source directories without local commit history; Windows repositories and GitHub remotes were unaffected.

Old `node_modules`, virtual environments, Cargo package caches, Xcode DerivedData, device-support caches, old simulator devices, native build outputs, and duplicate installers were cleaned. Rust 1.88, Node 22, Go 1.25, JDK 17, and old uv Python versions were removed. Targeted deleted directories totaled about 17.36 GiB according to pre-cleanup `du`, not net APFS space recovered. Rebuilt tools and simulators also consume space.

Native Sunshine was redeployed at the same path as a Developer ID-signed app with bundled runtime libraries. Host moved to `~/.lanto/releases/d0bd3fd`, reusing the independent Node 24.22.0 runtime and preserving identity. The same KRU executable and browser extension moved to `~/.local/share/kru-runtime`; its LaunchAgent was updated so the old project `target` could be cleaned. Active runtime and recovery packages were separated. Earlier temporary native `.app` backups described above were deleted.

New terminals use `~/.config/lanto/development.zsh` for tool paths:

| Tool | Verified version/configuration |
| --- | --- |
| Node / npm | 24.21.0 LTS / 11.19.0, Homebrew `node@24` |
| Rust | stable 1.99.1 with rustfmt, clippy, macOS arm64, iOS arm64, and iOS Simulator arm64 targets |
| Python / uv | 3.13.16 / 0.12.24; separate project virtual environments, system Python retained |
| Xcode | 26.6 (17F113), working app retained and old build state cleaned |
| CMake / Ninja / pkgconf | 4.4.4 / 1.13.2 / 3.0.7 |
| Godot | 4.7.1 and matching export templates retained and verified |
| iOS Simulator | Working iOS 26.5 runtime retained; new `Lanto iPhone 17` created |

`~/Developer/Lanto` was a source working copy without Git metadata, with development dependencies installed. `~/Developer/BuildCheck` held compilation examples. `~/Developer/README.txt` documented usage, and `~/Developer/open-ios-simulator.command` opened the new simulator. A SwiftUI test app was actually displayed and then uninstalled. CMake/C++, native Rust, a Rust simulator static library, Python virtual environment, and Godot scripts compiled or ran successfully. Lanto's 19 tests, type checking, Electron production build, and Host build passed; the Electron 44.7.2 arm64 executable was started to verify its version.

Network inspection found system HTTP/HTTPS/SOCKS proxies pointing to inactive `127.0.0.1:10808`. Settings were backed up, and only matching stale proxies were disabled. Direct Mac downloads from GitHub Releases still timed out, so Windows downloaded the official Electron archive and transferred it through KRU. Both ends verified the npm package's SHA-256: `07d73d3d6dd0b8679c2f1849e30df179ea50c1d6b17630fcc398ae05221f0bd2`. TLS verification was not disabled, and no third-party mirror was configured.

Recovery packages and pairing materials were stored outside the repository in access-restricted local directories. Cleanup inventories, validation logs, and proxy backups were stored at Mac `~/.lanto/maintenance`; they must not be committed.

The final full boot was at 12:36:03, with automatic desktop login. Host `d0bd3fd`, bundled native Sunshine, and relocated KRU all started automatically. At 12:37, Windows reused pairing to reconnect; new host logs confirmed HEVC, local cursor, and system audio. Tool paths and versions were rechecked after reboot. After reopening the simulator and saving the final recovery package, measured APFS free space was about 167.54 GB, about 16.0 GB above the roughly 151.5 GB after the second pre-cleanup reboot. This includes newly installed tools, simulator, and recovery-package space and will fluctuate.

The final `lanto-ready.tar.gz` contained the running native app, Host release files and independent Node, Lanto identity and media configuration, KRU runtime, three LaunchAgents, and development-environment entry instructions. It excluded the account keychain and old project source. Windows and Mac SHA-256 matched: `498aadb8e52a78eb4367a66ea95b0a076750ce99f0a9aea9b182f18d9bb1e8e5`. The Windows copy was in the Codex-mapped local Lanto recovery directory, restricted to the current user, administrators, and SYSTEM.

## Subsequent Mac source removal

The user then chose to delete source only and defer keychain cleanup. Deleted items included old Mac project directories, `~/Developer/Lanto`, `~/Developer/BuildCheck`, old build-service workspaces, Sunshine source and debugging scripts, and Mac-local deployment/recovery archives containing source. The 54 targets occupied about 5.45 GiB before removal and were individually confirmed absent afterward. Keychain, signing materials, iCloud sync settings, compilers, simulator, and Windows repositories were retained.

To preserve services, verified Host outputs and production dependencies were first installed at `~/.lanto/runtime/host-d0bd3fd`, with the LaunchAgent entry changed to `app/host/cli.js`. Host was restarted after source removal, and management and Sunshine-reachability checks passed. The existing Windows media session continued with local cursor enabled. New Mac projects can use the installed tools; `~/Developer/README.txt` and the simulator launcher remain.

The Mac recovery package became `~/.lanto/maintenance/recovery/lanto-runtime-only.tar.gz`, containing runtime files, configuration, and entry instructions without deleted project source. JavaScript runtime files and third-party production dependencies remain necessary service components. The package was transferred to Windows and verified with SHA-256 `443957e1cca86fdcf60dce29bb52cde25ef64645c185e60bac36e22d750e1231`. Earlier Windows recovery packages were not deleted; old Mac archives containing source were removed. The removal inventory was `~/.lanto/maintenance/source-removal-completed.json`.

## Subsequent personal-data cleanup and sync disabling

The user requested further cleanup while retaining the Apple account and disabling personal-data sync. After the user operated System Settings, Drive, Photos, Messages, Notes, and password sync were confirmed off; Find My Mac remained enabled. The system removed the local iCloud Drive directory. No cloud deletion was performed.

After source cleanup, another 62 old application, cache, and Mac-local maintenance-archive targets were deleted, including Blender, old Sunshine, and old application settings. A further 75 personal-data targets included Photos library, Messages, Notes, Contacts, Calendar, Safari data, old signing materials, and third-party application containers. Desktop, Documents, Downloads, Pictures, Music, and Movies were checked empty. Before removal, targets were confirmed inside the current user directory or explicitly named application paths; recursive removal did not follow internal symbolic links. The OS can still create normal caches and empty databases.

The Mac restarted again at 13:25:38, logged in automatically, and ran all three LaunchAgents. At 13:27:19, Windows reused pairing; new logs confirmed 2560×1440 HEVC, local cursor, and Opus audio. Main sync switches remained off, and KRU's connection list remained empty. The system recreated an approximately 5 MiB empty Photos library with zero database photos and zero original files. APFS free space was then about 165.75 GB and will vary with caches and simulator use.

The system `security` tool removed 12 identified third-party login credentials and three code-signing identities, including certificates and private keys. Personal signing files were also deleted. Existing Lanto apps passed strict signature verification; future signing requires reimporting certificates. Apple account authentication, the account keychain, SSH access, TCC permissions, and Lanto pairing were retained. Protected keychains were not reset wholesale, so complete clearing of Apple-protected storage is not claimed.

The old Mac KRU credential database and backups were deleted. After its app restarted, both connection and draft counts were zero; Windows KRU projects were unaffected. Old Node 22 and Go 1.25 shell paths were removed. Node, npm, Rust and its three targets, Python, uv, Xcode, and the sole iOS 26.5 simulator were rechecked as usable.

This section supersedes earlier current-state statements that keychain/signing cleanup was deferred and Mac maintenance recovery packages were retained. Earlier sections remain as operation history. Mac `~/.lanto/maintenance`, `~/.lanto/deploy`, and temporary inventories were deleted. Runtime recovery packages remain only on Windows and include service runtime and pairing materials, excluding account keychains and private signing files. Cleanup results are in Windows-local ignored `work/maintenance`.

## Everyday startup simplification

The user then requested that only the remote-access system start daily. User LaunchAgents now contain only `dev.lanto.host` and `dev.lanto.sunshine`, managing connections and video/input/audio respectively. SSH and necessary macOS services remain.

`dev.kru.app` was stopped and disabled through `launchctl disable`; its plist moved to `~/.config/lanto/disabled-startup`. The executable remains available on demand through `~/.local/share/kru-runtime/kru gui`. Old ToDesk and screenshot-tool startup labels were disabled. System-level third-party LaunchAgents/LaunchDaemons directories are empty. Xcode Quick Look and Spotlight extensions are on-demand system integrations, not automatic Xcode startup.

Login application restoration and reopening windows after quitting were disabled. Simulator, System Settings, Activity Monitor, and Magnifier were quit normally, and the simulator device was shut down. Xcode, Godot, KRU, and Simulator are now used on demand. Application restoration and login items are separate mechanisms; see [Apple startup restoration](https://support.apple.com/en-ie/102318).

The final restart was at 13:59:55 with automatic login. Host ran normally, the login item launched Sunshine, and KRU was not loaded. Simulator, Xcode, Godot, System Settings, Activity Monitor, and Magnifier were not running. Host reported Sunshine reachable, Windows accessed the Host identity endpoint using its existing pinned certificate with the same identity, and SSH maintenance access worked. The Windows controller was not launched and no new video stream was started in this round.

## Download sources and checksums

Verified downloads were official release assets:

| Asset | SHA-256 |
| --- | --- |
| [Node.js 24.22.0 darwin-arm64](https://nodejs.org/dist/v24.22.0/node-v24.22.0-darwin-arm64.tar.gz) | `6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5` |
| [Sunshine macOS arm64 DMG](https://github.com/LizardByte/Sunshine/releases/download/v2026.914.233613/Sunshine-macOS-arm64.dmg) | `795f03a389c5726f9a7b15f501dc1ddf204b442cae565859ac83aae027a9e07c` |
| [Moonlight 6.2.0 portable x64](https://github.com/moonlight-stream/moonlight-qt/releases/download/v6.2.0/MoonlightPortable-x64-6.2.0.zip) | `6f91d268b41ed5ca8066d9d7578dc403b8db190991ff48f00b1700465f8f7ebf` |

Sunshine passed `codesign --verify --deep --strict`; `spctl` reported an unnotarized Developer ID. The app launched through normal `open`, without removing quarantine attributes or disabling Gatekeeper. Deployment installers and debugging scripts were stored in ignored `work/` or Mac `~/.lanto/deploy`, outside repository contents.
