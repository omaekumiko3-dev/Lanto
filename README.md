# Lanto

Lanto is a multi-device remote operation tool for high-speed personal area networks. Windows handles local gaming and serves as the operation entry point, Linux1 runs the desktop, agent, and development tools, Mac provides native applications and build execution, and N100 serves as both a software router and NAS. The goal is to switch quickly between the local machine and remote desktops with one keyboard and mouse.

An Electron + React + TypeScript client skeleton is now in place: device management, saving local configuration, display settings, Moonlight launch/pairing entry points, TCP port checks, and a shortcut to return to this machine. The initial display target is 2560×1440, 30fps. Remote streaming, input release, and switching latency still need validation on real devices.

## Run Locally

Requires Node.js 24.12 or a later 24.x LTS release, npm, and a separate installation of [Moonlight Qt](https://moonlight-stream.org/)。

```powershell
cd C:\Users\malou\Documents\GitHub\Lanto
npm ci
npm run dev
```

The first time Electron starts, it may download the corresponding runtime. To build and start the production version:

```powershell
npm run build
npm start
```

1. Select in Settings `Moonlight.exe`, or leave it blank to use automatic discovery.
2. Edit Linux1/Mac, entering the IP address or hostname and the application name in Sunshine, default `Desktop`。
3. Install and start Sunshine on the target machine, click “Open Pairing Window,” and complete pairing in Moonlight. After pairing, close its settings window, then start the session from Lanto.
4. Click Open Remote Desktop. The screen appears in a separate native Moonlight window.
5. Use `Ctrl + Alt + F12` to return to this machine. You can change it in Settings; if the shortcut cannot be registered, starting a remote session will be blocked.

Device addresses are left blank by default, so the interface does not pretend a device is online. The port check only checks whether TCP 47989 is reachable; it does not verify device identity, pairing, or video. Custom Sunshine ports are not yet supported.

This version manages one streaming process at a time. Switching to another device first closes the current client, then starts the next one; multi-device prewarming and embedded displays are not yet implemented. Returning to the local machine attempts to close the window normally, then terminates the client process created by Lanto if it times out. It does not send the remote application termination `quit` command. Moonlight’s own `Ctrl + Alt + Shift + Q`can be used as an emergency backup exit shortcut; it still needs verification in actual systems and games.

Configuration is saved in Electron’s `userData` directory, usually `%APPDATA%\Lanto\config.json`, and the actual path can be viewed in Settings. Pairing certificates are still managed by Moonlight; Lanto does not collect passwords or pairing PINs. If configuration is corrupted, the original file is preserved and an error is shown; it is not silently reset.

## Development and Checks

```powershell
npm run typecheck
npm run format:check
npm test
npm run test:smoke
```

Core tests cover configuration recovery, input validation, session switching order, launch/exit failures, and local subprocess cleanup. UI smoke tests use an isolated temporary configuration and an offscreen Electron window to cover adding, editing, and deleting devices, settings, error messages, and restart recovery; screenshots are written to the ignored `test-results/`. Tests do not connect to any real remote host or modify everyday user configuration. Installers and automatic updates will be added after the connection path is verified.

## Documentation

- [Open-Source Project Research](docs/open-source-research.md): 70 related project and component repositories, applicability boundaries, licenses, and selections.
- [Product and Technical Design](docs/design.md): device roles, connection and input states, NAS development, Mac automation, and staged verification.
- [Client Architecture and Boundaries](docs/architecture.md): Electron process separation, IPC, state management, first-version capabilities, and future interfaces.
- [First-Version Verification Record](docs/verification.md): local checks that have passed and real-machine capabilities not yet verified.
- [Repository Metadata Snapshot](research/repositories.json): upstream addresses, push times, archive status, and item-by-item assessments checked on 2026-10-16.
- [Key Project Version Snapshot](research/source-pins.json): commit and release records from the research period. A release record may refer to a prerelease and does not necessarily indicate a recommended version to install.
- [Code Evidence](research/code-sources.json): key source file addresses and blob SHAs; a blob SHA identifies a file content object, not a commit SHA.

## Preliminary Selections

Electron + React + TypeScript has been selected for the controller, with electron-vite for the build. The priority is to verify a Sunshine Host and the native Moonlight client. The Lanto controller manages devices, shortcuts, and the media worker process; the first version keeps the media process independent. Moonlight currently has a single active session structure, so the multi-machine hot-switching process isolation approach will be verified first.

Selkies is the main comparison for the browser integration approach, but the takeover boundaries of the existing Wayland desktop affect computer use on Linux1. RustDesk is the full remote-control comparison. Program execution on Mac uses SSH, and Peekaboo Bridge is the first choice for verifying UI operations. Credentials reuse KRU; form autofill on the Mac side will be verified separately end to end.

## Constraints Already Set

- Connect directly over the local network first, without relying on public internet accounts, cloud relays, or public port forwarding.
- Local Windows games display directly; switching back to the local machine must release all remote input capture.
- The Linux desktop operated by the agent and the desktop seen by the user must be the same session.
- The main source working directory is stored on the N100 NAS, and Linux1 mounts it to perform development tasks; build caches and dependencies may use Linux1’s local temporary storage.
- N100 is known to have 8GB of memory and 6 2.5G Ethernet ports; the disk interfaces, network cards for other devices, GPU, and desktop environment still need to be inventoried on site.
- Rust, Electron, JS, TS, Python, and Godot are the main development technologies. Build tasks requiring Windows-only toolchains can be handled by a Windows virtual machine on Linux1.
- The current repository remains private; no third-party implementation source code was copied or introduced, and a distribution license for the project itself has not yet been selected.

## Next Steps

First complete validation of Windows-to-Linux1 2K 30fps streaming, the same graphics session, Chinese input, returning to the local machine, and agent tasks continuing to run; then decide whether to modify the Moonlight worker process and how to add Mac. See[Technical Design](docs/design.md)。
