# Lanto

Lanto is a multi-device remote operation tool for high-speed personal area networks. Windows handles local gaming and serves as the operation entry point, Linux1 runs the desktop, agent, and development tools, Mac provides native applications and build execution, and N100 serves as both a software router and NAS. The goal is to switch quickly between the local machine and remote desktops with one keyboard and mouse.

The current phase is research and design; the client has not yet been implemented, and there are no local performance test results. The initial display target is 2560×1440, 30fps; switching time and input response need to be verified on actual devices.

## Documentation

- [Open-Source Project Research](docs/open-source-research.md): 70 related project and component repositories, applicability boundaries, licenses, and selections.
- [Product and Technical Design](docs/design.md): device roles, connection and input states, NAS development, Mac automation, and staged verification.
- [Repository Metadata Snapshot](research/repositories.json): upstream addresses, push times, archive status, and item-by-item assessments checked on 2026-10-16.
- [Key Project Version Snapshot](research/source-pins.json): commit and release records from the research period. A release record may refer to a prerelease and does not necessarily indicate a recommended version to install.
- [Code Evidence](research/code-sources.json): key source file addresses and blob SHAs; a blob SHA identifies a file content object, not a commit SHA.

## Preliminary Selections

Prioritize verifying a Sunshine host and the native Moonlight client. The Lanto console manages devices, shortcut keys, and media worker processes. In the first version, keep the media process separate to avoid forcing native video rendering into a WebView. Moonlight currently has a single active-session structure; first verify a process isolation approach for hot switching between multiple machines.

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
