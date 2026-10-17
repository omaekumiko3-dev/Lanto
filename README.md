# Lanto

Lanto is a multi-device remote workspace for a fast personal LAN. Windows provides local gaming and the control interface, Linux1 runs the desktop, agents, and development tools, Mac provides native applications and builds, and the N100 serves as both router and NAS. The goal is to switch quickly between local and remote desktops using one keyboard and mouse.

The current system includes an Electron + React + TypeScript controller and a headless Node.js + TypeScript Host. It supports device management, Host discovery and single-use pairing, authenticated status checks, authorization revocation, Moonlight launching, display settings, and a shortcut to return locally. The Windows controller has connected to Mac, Linux, and Windows hosts with 2560×1440 at 60fps, audio, and basic input. Linux validation covers the same GNOME Wayland desktop, Chinese Pinyin input, service restarts, and reconnection after automatic desktop login following a reboot. Windows host validation covers keyboard, mouse, Chinese Pinyin input, and session reconnection. Switching latency and long-term stability still need measurement.

## Running the controller

The Windows portable package includes the controller, bundled player, and Host deployment resources. Extract it and open `Lanto.exe`. Select **Add device**, enter the target SSH address and credentials, confirm its fingerprint, then select **Deploy**. Windows, macOS, and Linux are supported. Existing Sunshine and Host configuration and identities are reused; missing components are downloaded, verified, and installed before the device is added and display pairing completes automatically. See [SSH deployment](docs/ssh-deployment.md) for prerequisites and system permissions.

Source development requires Node.js 24.12 or a newer 24.x LTS release, npm, and the bundled native player. Stock [Moonlight Qt](https://moonlight-stream.org/) remains usable for manual pairing and basic streaming.

```powershell
cd C:\Users\malou\Documents\GitHub\Lanto
npm ci
npm run dev
```

The corresponding Electron runtime may be downloaded on first startup. To build and run production output:

```powershell
npm run build
npm start
```

1. Open **Settings → Advanced settings** at the top right and select `Moonlight.exe`, or leave it blank for automatic discovery.
2. The recommended setup is **Add device → Connect and inspect → Deploy**. The target must have SSH enabled and be signed in to its desktop. Windows requires an administrator SSH account; Linux may require a sudo password to install missing system components.
3. For an existing Host, use **Connect Host** and paste a single-use ticket. **Add device → Add manually** retains the original Sunshine address workflow, which requires manual display pairing.
4. Turn on the connection switch at the top right of a device card. The display opens in a separate native Moonlight window.
5. Turn the switch off to disconnect, or use `Ctrl + Alt + F12`. This shortcut is configurable; failure to register it blocks remote session startup.

Each device card has a 0–100% volume slider and mute button for that device's locally played streaming audio. Volume and mute are saved independently per device and can be preset while disconnected. Changes apply immediately during a connection; unmuting restores the previous volume, and moving the slider resumes playback. Audio continues when returning to the device list so it can be adjusted while listening. This requires the bundled Lanto native player with `audioVolumeProtocol=1`. Stock Moonlight can still connect at the default 100% volume and reports clearly when live volume control is unavailable.

Connections preserve audio playback on the target machine while also sending it to the controller. Card volume and mute controls affect only the controller, without changing the target's system volume.

The device page provides a **Shared clipboard** switch. Its adjacent arrow opens separate **Share files** controls, transfer progress, cancellation, and the received-files directory. When enabled, this computer and all paired, online Hosts signed in to their desktops share newly copied text and images. Enabling file sharing also includes files and folders. A remote display connection is unnecessary; keep the Lanto controller running. Files stream without an application-level byte limit, remain subject to disk and filesystem limits, and can be pasted only after complete verification. See [Shared clipboard and files](docs/clipboard-sync.md).

Actual output volume, mute recovery, reconnection persistence, device isolation, and persistence across controller restarts have been verified on macOS, Linux, and Windows hosts. Measurements are recorded in [Volume regression across three host platforms](docs/verification.md#real-volume-regression-on-three-host-platforms).

For quick everyday switching, use Windows `Alt + Tab`: Moonlight stays connected, so returning does not establish a new session. `Ctrl + Alt + F12` closes the local streaming client. If mouse and display response feel slow, try 60fps and **Prioritize response**. This disables Moonlight VSync and frame-pacing waits and may cause tearing; frame rate remains a separate setting.

The console is a compact window without a system title bar. Drag the empty top area; minimize, maximize/restore, and close controls are at the top right. Client paths and graphics-pipeline options are under Advanced settings. The dark icon identifies the console, while the same design on a mist-blue background identifies the remote display. Native client builds replace both icon resources.

The **Performance data** switch controls the frame-rate and latency overlay at the top left of the remote display. Changes save automatically and apply on the next connection. Moonlight's `Ctrl + Alt + Shift + S` toggles it temporarily during streaming. With statistics enabled, that client's log is stored in `media-logs/` under the Electron user directory. After disabling statistics, the next connection does not create a diagnostic log. Logs may contain host addresses, device details, and application information and are excluded from Git. See [statistics field definitions](https://github.com/moonlight-stream/moonlight-docs/wiki/Frequently-Asked-Questions#what-do-the-numbers-mean-in-the-on-screen-connection-statistics).

Windows offers an experimental **Shared device and textures** graphics pipeline. Short local comparisons reduced average rendering time from 0.19–0.21ms to 0.07–0.08ms, without a consistent decoding advantage. Auto remains the default; some drivers and VRR need further testing. See [Performance investigation](docs/performance-investigation.md) for evidence, rewrite boundaries, and measurement tools.

The **Local cursor** option currently applies only to the bundled native Mac host. Linux and Windows connections automatically use the remote cursor while preserving the global preference, so local cursor support resumes when returning to Mac.

The initial device list is empty; no example devices are added automatically. Paired Hosts expose authenticated identity and Sunshine status checks. Manually added devices only probe TCP 47989. Neither check proves that video is connected. Custom Sunshine ports are not yet supported.

This version manages one streaming process at a time. Switching devices closes the current client before starting the next; multiple prewarmed sessions and embedded video are not implemented. Returning locally requests a normal window close and terminates the Lanto-created client process if it times out. It does not send the remote application's `quit` command. Moonlight's `Ctrl + Alt + Shift + Q` is an emergency exit fallback that still needs validation in actual systems and games.

Configuration is stored in Electron's `userData` directory, usually `%APPDATA%\Lanto\config.json`; Settings shows the actual location. Host tokens are encrypted with system secure storage and written to `trusted-hosts.json` in the same directory, without being returned to the UI. Moonlight manages its own streaming certificates. Corrupt configuration is preserved and reported instead of being silently reset.

## Headless Host

The target requires Node.js 24.12 or a newer 24.x release. Host does not load Electron or React. Obtain this repository's source on the target and enter its directory:

```bash
npm ci --omit=dev
npm run host -- init --name Linux1 --address 192.168.1.20
npm run host -- start
```

Replace the example address with the target's actual LAN IP. Open another terminal in the same directory to generate a pairing ticket:

```bash
npm run host -- pair
```

Paste the entire ticket beginning with `LANTO1.` into the controller. Tickets expire after five minutes or one use; generating a new ticket replaces the previous one. Direct ticket-based connection works even when LAN multicast is unavailable. Data defaults to `~/.lanto/host` in the target user's home; every command accepts `--data-dir` for another local directory.

```bash
npm run host -- status
npm run host -- controllers
npm run host -- revoke <controller-UUID>
```

Host listens on TCP 48199 by default, with mDNS discovery on UDP 5353. The CLI does not adjust the system firewall automatically; the Windows installer provides rules limited to the local subnet. Local CLI administration uses loopback only. Host and Sunshine are separate processes that the SSH wizard can configure together. See the [Host guide](docs/host.md) for manual installation and permission boundaries.

Alternatively, run `npm run host:build` and `node scripts/package-host.mjs out/host-runtime` on a development machine. Copy the generated runtime to a permanent Linux location and run `install-linux-host.sh` as the desktop user. It installs systemd user services while preserving existing Host identity, without requiring Electron or the full source tree on the target. See the [Linux deployment record](docs/linux-windows-deployment.md).

The Windows runtime includes `install-windows-host.ps1`, which configures a LOCAL SERVICE startup task, private data ACLs, and LAN firewall rules. Windows-to-Windows validation includes actual Host and media pairing, 2K60 HEVC video, audio, keyboard/mouse, Chinese input, and reconnection. See the [Windows deployment record](docs/windows-windows-deployment.md).

## Development and checks

```powershell
npm run typecheck
npm run host:build
npm run format:check
npm test
npm run test:smoke
```

Core tests cover configuration, sessions, real TLS, ticket invalidation, authorization revocation, Host CLI, SSH fingerprint confirmation/rejection/change, authentication failures, timeouts, cancellation, and component selection. UI smoke tests use a loopback Host, isolated configuration, and offscreen Electron; screenshots go to the ignored `test-results/` directory. Standard tests do not connect to real remote machines. Reuse deployment over SSH and pairing with new media identities have separately been completed on three physical hosts; see [Verification](docs/verification.md). Portable packaging is described in [SSH deployment](docs/ssh-deployment.md#packaging). Automatic updates are not yet included.

Icon sources are in `assets/*.svg`. PNGs and ICOs containing 16–256px sizes are tracked. Run `npm run icons` after changing SVGs. This requires Playwright Chromium, installable with `npx playwright install chromium`, or an existing Chromium executable selected with `LANTO_ICON_BROWSER`. Icons are rendered only during development; the running client does not depend on browser tooling.

## Documentation

- [Open-source research](docs/open-source-research.md): 70 relevant projects and component repositories, their scope, licenses, and selection rationale.
- [Product and technical design](docs/design.md): device roles, connection/input state, NAS development, Mac automation, and staged verification.
- [UI and brand guidelines](docs/design-system.md): minimal component research, graphite/mist-blue colors, interaction rules, and logo origins.
- [Client architecture and boundaries](docs/architecture.md): Electron processes, IPC, state management, initial capabilities, and future interfaces.
- [Controller and Host responsibilities](docs/roles.md): responsibilities of the controller, Host, shared protocol, and media engine.
- [Host guide](docs/host.md): initialization, pairing, authorization revocation, and background Linux operation.
- [Encrypted direct tunnel](docs/direct-tunnel.md): account-free WireGuard setup and network prerequisites. Live tests used LAN endpoints; connections across separate public networks remain untested.
- [Shared clipboard and files](docs/clipboard-sync.md): sharing across three platforms, large files, desktop component installation, and verification scope.
- [Windows → Mac deployment](docs/mac-windows-deployment.md): physical installation, login startup, dual pairing, and desktop permission acceptance status.
- [Windows → Linux deployment](docs/linux-windows-deployment.md): Ubuntu/NVIDIA deployment, the same Wayland session, Chinese input, and restart checks.
- [Windows → Windows deployment](docs/windows-windows-deployment.md): Windows services, Host startup tasks, ACLs, dual pairing, and audiovisual validation scope.
- [Performance investigation](docs/performance-investigation.md): physical decoding/rendering comparisons, native media options, and measurement evidence.
- [Native media experiments](native/README.md): local cursor and pinned Mac ScreenCaptureKit/VideoToolbox patches, builds, and rollback.
- [Initial verification record](docs/verification.md): passed local checks and physical-machine capabilities still awaiting validation.
- [Repository metadata snapshot](research/repositories.json): upstream addresses, push times, archive status, and individual assessments checked on 2026-10-16.
- [Key project version snapshot](research/source-pins.json): research-time commits and releases. Releases may be prereleases and are not necessarily recommended installation versions.
- [Code evidence](research/code-sources.json): key source URLs and blob SHAs; a blob SHA identifies file content, not a commit.

## Initial technology choices

The console uses Electron + React + TypeScript with electron-vite. Sunshine hosts and native Moonlight clients are the first validation target. Lanto manages devices, shortcuts, and media worker processes; the initial media process remains separate. Moonlight currently has a single-active-session structure, so process isolation will be evaluated first for rapid multi-device switching.

Selkies is the main browser-integration comparison, but its boundaries around taking over an existing Wayland desktop affect Linux1 computer use. RustDesk is the full remote-control comparison. Mac program execution uses SSH; GUI operations prioritize Peekaboo Bridge validation. Credentials continue through KRU, with Mac autofill to be verified end to end separately.

## Established constraints

- Start with direct LAN connections without public accounts, cloud relays, or public port forwarding.
- Windows games render locally. Returning locally must release all remote input capture.
- The Linux desktop operated by an agent must be the same session visible to the user.
- The primary source working directory lives on the N100 NAS and is mounted by Linux1 for development; build caches and dependencies may use local temporary storage on Linux1.
- Known N100 hardware is 8GB RAM and six 2.5G network ports. Linux1 is confirmed as Ryzen 5 7500F, RTX 3080, and Ubuntu 26.04 GNOME Wayland. NAS drive interfaces and the complete network topology still need on-site inventory.
- Primary development technologies are Rust, Electron, JS, TS, Python, and Godot. A Windows VM on Linux1 may handle builds requiring a Windows-specific toolchain.
- The repository remains private. `native/patches` contains small GPL-upstream patches governed by the corresponding upstream licenses. A distribution license for the project's own code has not been selected.

## Next steps

Continue validating GUI-agent operation on the current Linux graphical session, NAS working directories, device-switching time, and long-term stability. Basic streaming, keyboard/mouse, Chinese Pinyin, and restart recovery have physical-machine records; these do not establish that GUI-agent or NAS deployment is complete. See the [technical design](docs/design.md) for acceptance steps.
