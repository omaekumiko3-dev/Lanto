# Lanto Client Architecture

Selected on 2026-10-16. The controller uses Electron + React + TypeScript; Host uses headless Node.js + TypeScript. See [Responsibilities](roles.md) for their contract. Actual Mac, Ubuntu Linux, and Windows hosts have working pairing, authorization, status, and independent media sessions. Each deployment record defines its platform's input-validation scope. Agent orchestration and NAS integration are exploratory ideas outside the released feature set.

## Module boundaries

```text
src/
  common/       Atomic JSON, queues, TCP probes
  protocol/     Host message validation, TLS requests, discovery, pairing tickets
  host/         CLI, configuration, pairing authorization, HTTPS service, lifecycle
  controller/   Host client and trusted-device storage
  shared/       Device/settings/session types, fixed IPC names, main-process input validation
  main/         Electron lifecycle, windows, IPC, shortcuts, workspace orchestration
    config-store.ts      Local configuration reads and writes
    session-manager.ts   Session state and process switching order
    moonlight.ts         Client discovery, arguments, process startup and cleanup
    probe.ts             Sunshine default TCP port probe
  preload/      Limited capabilities exposed through contextBridge
  renderer/     App composition, state hook, connection/device/dialog components and styles
tests/          Core state, persistence, arguments, and process cleanup tests
scripts/        Electron UI smoke tests
```

The renderer only displays state and sends typed requests; it has no Node.js capabilities. The main process verifies the sender window and main frame, validates arguments, and calls configuration and media modules. The native Moonlight process handles the capture protocol, decoding, audio, and keyboard/mouse return channel. Electron does not copy per-frame video through React or IPC.

`Titlebar` owns branding and window buttons. `DeviceCards` uses the top-right switch to connect, disconnect, or switch devices, and provides renaming, settings, and status probing. Settings and pairing remain separate dialogs. Switches reflect session state and turn off when the client exits; the bottom session bar has been removed. Names and configuration can be saved while connected: names display immediately, while connection parameters reach the media process on its next launch. The active device cannot be removed until disconnected. Window control exposes only `minimize`, `maximize`, and `close`, using the same source validation. Electron creates a 900×620 window with `frame: false` and a 680×480 minimum. CSS drag regions exclude buttons, using [Electron custom window interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions). Advanced settings are collapsible, forms scroll independently, and errors appear inside dialogs without covering their action buttons.

```mermaid
flowchart LR
    UI[React device and settings UI] -->|Limited API| P[Isolated preload]
    P -->|Validated IPC| M[Electron main process]
    M --> C[Local configuration and encrypted authorization]
    M <-->|Certificate-pinned HTTPS| B[Headless Lanto Host]
    M --> S[Session manager]
    S --> A[Moonlight adapter]
    A --> Q[Separate Moonlight window]
    Q <-->|Direct media and keyboard/mouse| H[Target Sunshine host]
```

`contextIsolation` and sandboxing are enabled; Node integration is disabled. Pages load only local application resources, and production CSP disallows inline scripts. Navigation, popups, and permission requests are denied by default. External links are limited to two fixed help URLs. Development allows inline scripts/styles for Vite hot reload; production retains strict rules. See [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) and [electron-vite](https://electron-vite.org/guide/).

## Configuration and device identity

Local JSON uses `schemaVersion: 1`. Devices have independent UUIDs and store name, operating system, address, and Sunshine application name; addresses may initially be blank. Optional `hostId` links a paired Host without requiring migration of old configuration. Pairing establishes Host identity; manually editing a device cannot forge this association. User-triggered mDNS discovery reads announcements without treating addresses or discovery results as authorization.

Configuration and session mutations are queued to prevent parallel saves from overwriting each other. Configuration is validated, written to a temporary file in the same directory, and replaced atomically. Corrupt configuration reports its original path and stops startup without overwriting it. `config.json` contains no tokens. `trusted-hosts.json` stores public Host certificates and tokens encrypted through system secure storage. The renderer and activity log do not receive these secrets; activity records remain in memory. Each Host identity file holds its private key and management credential in the user's separate runtime directory.

Paired devices allow editing their nonempty IP address or hostname. Device configuration is the source of the address. Saving synchronizes the trusted Host management address, preserves its port, identity, certificate, and encrypted token, and clears stale probe results. If saving configuration fails, the management address rolls back. Startup repairs address discrepancies from interrupted writes, and in-flight probes of an old address cannot overwrite new status. Streaming uses the device configuration address on the next connection.

## Current session behavior

Each media process has state `idle → launching → running → stopping → idle`, with errors entering `failed`. `running` means the operating system successfully started the process. The card shows **Selected** for the chosen remote window and **Client started** for a background process; neither establishes first-frame receipt or the requested frame rate. Unexpected exits remain visible as errors.

The session manager retains up to two owned streaming processes in connection order, with a separate selected input owner. Connecting the second hides and releases the first before launching; a third is rejected without stopping either existing stream. The cycle is local, first remote, second remote, local. Each transition hides the other owned windows before showing its target. Switch requests are serialized without a time debounce, so rapid taps are retained. Each card disconnects its own process; disconnect-all and shutdown attempt every owned process, retaining failed-stop handles for retry. Delayed exits cannot remove a replacement process, and one exit does not stop the other stream.

On Windows, Lanto first requests a normal close of its own client window and waits 2.5 seconds, then terminates that child if necessary. Other platforms send SIGTERM before forceful timeout cleanup. Only handles created by Lanto are tracked; unrelated programs are not terminated by process name. The remote Moonlight `quit` command is never used, and `--no-quit-after` is explicit. Timely release of remote keyboard/mouse state after normal or forced exits still requires physical Sunshine/Moonlight verification.

The Moonlight pairing/settings window belongs to the user, not the active streaming process; close it after pairing. Certificates use Moonlight's own storage. This architecture record's initial version has no automatic pairing or isolated certificate directory.

## Shortcuts and return path

The default is Ctrl plus backtick; custom bindings remain intact. Windows uses a small native helper with its own message loop, `RegisterHotKey` conflict detection, and a low-level keyboard hook. Other controller platforms retain Electron `globalShortcut`. Registration and persistence are transactional; a failed save restores the previous binding. Remote sessions cannot start without an available binding.

On Windows, default lockInput mode has an explicit local/remote state independent of foreground detection. Local mode hides the owned player with SW_HIDE, removing mouse and task-switcher activation targets. Remote mode restores and verifies focus. A 50 ms ownership-checked watcher hides unexpected local-mode activations; unexpected focus loss from remote mode releases control and returns locally. The original process handle prevents PID reuse from targeting another application. Window operations and configuration writes are serialized. Cleanup closes the watcher and handle without terminating the player.

The player advertises `lockedInputProtocol=1` and `sharedSwitchProtocol=1`. Each session receives a private atomic input file; SDL checks it at most every 50 ms, clips the pointer, captures system keys remotely, and releases keys/buttons when hidden or unfocused. Each foreground player installs the shared switch hook after SDL's keyboard hook, before SDL consumes Alt/Ctrl. The helper and players share only physical down/up flags, the binding, and a switch sequence in randomly named local memory. The foreground owner records edges; the helper handles local windows. A held modifier therefore survives process changes, while a swallowed key stays swallowed until its release, preventing repeat or key-up leakage. The helper emits one ordered notification per press. Controller/helper death or invalid control data releases native input and hides the player. No key text is recorded.

The old minimization field is accepted only for migration. The card's Show action is unavailable and its IPC is rejected while locked. Free window mode uses ordinary focus and local system shortcuts. Windows secure-desktop combinations remain local; exclusive fullscreen and privileged applications require physical validation.

## Probe and verification boundaries

Manual-device TCP probes connect only to port 47989 on the user-specified host, with a fixed two-second deadline. Paired Hosts return identity and local Sunshine port status through certificate-pinned HTTPS. Reachability does not prove streaming. Custom Sunshine ports, Moonlight UUID addressing, and wake-on-LAN are not yet implemented.

Automated checks cover local configuration, IPC, React operations, process state, real loopback TLS, and pairing/revocation without starting actual remote desktops. Smoke tests use separate temporary directories and offscreen Electron; everyday use remains a normal native window. Host has an independent source entry, TypeScript build, runtime packaging, Linux user-service installer, and Windows startup-task installer, with no Electron runtime dependency. Separate physical acceptance records cover Mac, Linux, and Windows.

Linux validation covers the same GNOME Wayland desktop, NVIDIA HEVC 2K60, keyboard/mouse, Chinese Pinyin input, and restart recovery. The local-cursor protocol remains limited to the bundled Mac host and is disabled per platform for Linux/Windows without changing the global preference. Sustained two-stream performance and physical held-modifier switching need separate hardware acceptance. Performance targets follow the [design validation table](design.md#performance-records-and-initial-acceptance-targets); short client statistics do not establish end-to-end input latency.
