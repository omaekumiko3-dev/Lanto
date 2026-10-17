# Lanto Open-Source Project Research

Verified: 2026-10-16, Asia/Shanghai.

Lanto needs to display Linux and Mac desktops on Windows over the LAN, switch quickly with one keyboard/mouse, and let a Linux agent invoke Mac commands, native interfaces, and credentials. The first round prioritizes native Sunshine/Moonlight streaming, with Selkies and RustDesk as comparisons. Input sharing, browser screen sharing, and complete remote desktops operate at different layers and are not interchangeable.

This round covers 69 GitHub repositories and one GitLab upstream, including full remote control, streaming forks, RDP/VNC, input, Mac automation, and foundation components. It covers major approaches and representative implementations without claiming to exhaust all open-source repositories. Mixed-license and unresolved-license projects are marked separately and are not treated as directly reusable complete open-source foundations.

## Assessments directly relevant to the requirements

| Route | Suitable use | Main cost or boundary | Conclusion |
| --- | --- | --- | --- |
| Sunshine with native Moonlight processes | Linux/Mac desktops on Windows, hardware codecs, and keyboard/mouse return | Persistent multi-host sessions, focus handover, input release, and background resources require validation | Preferred streaming baseline |
| Selkies browser view | Linux desktops inside Web UI, multiple connection pages | Can attach to existing X.Org; its Wayland backend owns its session and cannot capture arbitrary existing Wayland desktops | Linux browser-route comparison |
| Complete RustDesk application | Cross-platform remote control, clipboard, device entry | Complete Rust/Flutter product with substantial embedding/fork maintenance cost; AGPL | Fallback and experience comparison |
| RDP with FreeRDP/IronRDP | Windows build VMs and RDP-capable services such as GNOME | Protocol capabilities and server session modes differ; does not uniformly solve Mac desktops | Second-stage adapter |
| noVNC/Guacamole/KasmVNC | Browser management, recovery, and light interaction | Target frame rate/input response need measurement; some create separate sessions | Management and recovery comparison |
| Deskflow/Lan Mouse | Keyboard/mouse sharing, clipboard, input-backend references | No video; enabling alongside stream input may inject twice | Reference, not a default parallel input channel |
| Peekaboo with SSH | Linux agent access to Mac commands and GUI | Requires GUI Bridge, logged-in session, and macOS permission setup | Preferred Mac executor validation |

These are engineering selections based on source structure and upstream capability descriptions, not performance rankings on the available hardware. Projects' latency, frame-rate, and success-rate claims are not Lanto acceptance measurements.

## Moonlight multi-session boundaries

Moonlight Qt `Session` uses a static active-session pointer and a semaphore with capacity one, acquired at startup and released after cleanup. `moonlight-common-c` also holds process-wide connection state. Instantiating the existing library twice therefore does not create independent concurrent streams.

- [Moonlight Qt session source](https://github.com/moonlight-stream/moonlight-qt/blob/b0af84ead19e711a55db46f8900182d2e0fa3716/app/streaming/session.cpp): active pointer, semaphore, and `Session::start`.
- [Moonlight protocol connection source](https://github.com/moonlight-stream/moonlight-common-c/blob/aeba988e0a302145eff2e70fa3e11cd98ec01f5d/src/Connection.c): connection state and start/stop API.
- [Moonlight CLI parsing](https://github.com/moonlight-stream/moonlight-qt/blob/b0af84ead19e711a55db46f8900182d2e0fa3716/app/cli/commandlineparser.cpp): host, application, resolution, fps, bitrate, window mode, mouse, and system-shortcut options.

The first experiment uses one media process per remote host, retaining connections on Windows while switching windows and input ownership. This is a testable isolation approach, still requiring checks for configuration writes, certificate stores, window activation, background decoding, and shutdown across processes. CLI launch support alone does not establish automatic background frame-rate/bitrate reduction or free prewarming.

The MVP requires one foreground stream, with at most one experimental prewarmed stream. If hidden processes keep sending keys, retain controllers, or cannot reliably regain focus, return to safe single-connection switching before modifying media workers.

## Selkies session boundaries

Current Selkies is no longer limited to its older GStreamer WebRTC design: WebSocket is the default transport and WebRTC optional. Native packages can attach to existing X.Org displays and audio services. Attaching to an existing Wayland desktop is unsupported; its Wayland backend owns a headless-compositor session.

This matters for computer use: if the agent operates Linux1's existing GNOME/KDE Wayland desktop, the user must not be shown a different empty container desktop. With a Selkies-owned desktop, the agent, browser, IDE, and user view must all enter that session. [Native deployment](https://docs.selkies.io/latest/native/), [session documentation](https://docs.selkies.io/latest/reference/session).

## Mac automation and credentials

Mac video streaming and automation use separate adapters. Sunshine/RustDesk provide a human remote desktop; SSH handles scripts/builds; Peekaboo supplies accessibility inspection, screenshots, and GUI operations. SSH calls to Peekaboo must reach an authorized GUI Bridge. Permission on a CLI process does not imply permission on another capture process. [Peekaboo Quickstart](https://peekaboo.sh/quickstart.html).

Credentials follow the existing the local credential manager tool contract, never passwords from source repositories, NAS documents, or chat. Linux SSH/HTTP injection and Mac field autofill execute in different places; the latter requires verification of a Mac-local executor. the local credential manager is an existing integration and is not represented as having a verified open-source license in this inventory. Touch ID, MFA, startup unlocking, and system permissions require separate handling.

## Selections affected by licensing and maintenance

- **Cua:** upstream separates MIT SDK/Driver components from FSL-1.1-MIT Spaces, some streaming clients, and related modules. A top-level MIT marker does not make the whole product MIT. [Component licenses](https://github.com/trycua/cua#license).
- **libvirtualhid:** the cross-platform library is MIT, but some Windows drivers, Mac broker, and generated packages use LizardByte Source-Available License. Check dependencies and release manifests for the specific Sunshine package to determine inclusion. [License map](https://github.com/LizardByte/libvirtualhid/blob/master/LICENSE.md).
- **Moonlight/Sunshine** use GPL; **RustDesk/HopToDesk** use AGPL. Check actual combined files/components before distributing binaries or modifications. External processes provide engineering isolation, not automatic license exemptions.
- **noVNC** core uses MPL 2.0, with separate licenses for HTML/CSS and other assets. **FFmpeg/GStreamer** licensing depends on enabled codecs, plugins, and external libraries. [noVNC](https://github.com/novnc/noVNC/blob/master/LICENSE.txt), [FFmpeg](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md), [GStreamer](https://github.com/GStreamer/gstreamer).
- **Input Leap** is archived, and **Barrier** has an old latest public push. They are protocol references rather than preferred long-term foundations for a new product.
- **RemoteCtl** has no confirmed explicit license. **nut.js** requires directory-, version-, and package-specific review. Neither enters the first dependency list.

No third-party implementation source was copied in this round. License summaries below identify conditions only. Pin commits, inspect licenses and binary dependencies, and generate third-party notices before actual integration.

## Inventory fields

Each row links upstream. Latest push dates use Asia/Shanghai and represent repository push time, not the last functional change, stability, or a default-branch release. Original UTC timestamps, README blob SHAs, and archive flags are in the [JSON snapshot](../research/repositories.json). Key-project commits/releases are in the [version snapshot](../research/source-pins.json), which may include prereleases and is not automatically an installation recommendation.


## Desktop streaming and screen sharing

| Project | Responsibilities and platform boundaries | Use in this project | License summary | Latest push |
| --- | --- | --- | --- | --- |
| [LizardByte/Sunshine](https://github.com/LizardByte/Sunshine) | Cross-platform streaming host; Linux/Windows/macOS; capture and encoding depend on the OS and GPU | Preferred host baseline; validate the existing Linux desktop and Mac separately | GPL-3.0 | 2026-10-16 |
| [moonlight-stream/moonlight-qt](https://github.com/moonlight-stream/moonlight-qt) | Native streaming client; Windows/Linux/macOS; Qt, SDL, hardware decoding | Preferred Windows media worker; account for the single active session per process | GPL-3.0 | 2026-10-15 |
| [moonlight-stream/moonlight-common-c](https://github.com/moonlight-stream/moonlight-common-c) | GameStream protocol and connection library; C library without a complete desktop UI, decoding, or rendering product | Global connection state prevents simple multi-session instantiation; isolate processes initially | GPL-3.0 | 2026-10-15 |
| [ClassicOldSong/Apollo](https://github.com/ClassicOldSong/Apollo) | Sunshine-derived host; Virtual-display advantages currently target Windows; the Artemis ecosystem is diverging | Reference device identity and display configuration; do not infer Linux support from Windows features | GPL-3.0 | 2026-05-21 |
| [ClassicOldSong/moonlight-android](https://github.com/ClassicOldSong/moonlight-android) | Artemis Android client; Android; not a Windows desktop client | Reference client experience and permission design | GPL-3.0 | 2026-09-09 |
| [moonlight-stream/moonlight-embedded](https://github.com/moonlight-stream/moonlight-embedded) | Embedded Moonlight client; Embedded Linux environments | Reference protocol integration; not the Windows main UI | GPL-3.0 | 2026-06-06 |
| [games-on-whales/wolf](https://github.com/games-on-whales/wolf) | Containerized multi-user streaming host; Linux, Docker/Podman; on-demand virtual desktops | Reference multi-user isolation; does not mean controlling Linux1's existing desktop | MIT | 2026-10-15 |
| [selkies-project/selkies](https://github.com/selkies-project/selkies) | Browser-based remote Linux desktop; WebSocket by default, optional WebRTC; existing desktop capture requires X.Org | Preferred browser comparison; distinguish owned Wayland sessions from attaching to existing sessions | MPL-2.0 | 2026-10-15 |
| [pavlobu/deskreen](https://github.com/pavlobu/deskreen) | Browser screen sharing and second display; Cross-platform sender and browser receiver; not automatically full remote control | Reference pairing, discovery, and screen-sharing UI | AGPL-3.0 | 2026-07-08 |
| [H-M-H/Weylus](https://github.com/H-M-H/Weylus) | Tablet input and screen sharing; Browser client; more complete input support on Linux | Reference pen input and sharing; not the general multi-device switching core | AGPL-3.0-or-later; some contributions BSD-3-Clause | 2026-04-23 |


## Complete remote desktops and protocol components

| Project | Responsibilities and platform boundaries | Use in this project | License summary | Latest push |
| --- | --- | --- | --- | --- |
| [rustdesk/rustdesk](https://github.com/rustdesk/rustdesk) | Complete remote desktop application; Windows/Linux/macOS; self-hosted or direct connections | Full remote-control comparison and fallback; Rust/Flutter product rather than stable embeddable SDK | AGPL-3.0 | 2026-10-15 |
| [rustdesk/rustdesk-server](https://github.com/rustdesk/rustdesk-server) | Rendezvous and relay services; Server components, not desktop clients | Consider for cross-network access or centralized management; LAN connections need no relay by default | AGPL-3.0 | 2026-10-10 |
| [Ylianst/MeshCentral](https://github.com/Ylianst/MeshCentral) | Self-hosted device-management platform; Browser console and device agents | Reference inventory, permissions, auditing, and background-task management | Apache-2.0 | 2026-09-24 |
| [Ylianst/MeshAgent](https://github.com/Ylianst/MeshAgent) | Device-side management executor; Windows/Linux/macOS/FreeBSD | Reference persistent executors; README declares Apache 2.0, but verify each component | Apache-2.0 (README declaration) | 2026-10-08 |
| [immense/Remotely](https://github.com/immense/Remotely) | Remote assistance and script management; .NET/Blazor/SignalR; public repository pushes are relatively old | Reference remote tasks and support workflows; not the preferred new foundation | GPL-3.0 | 2024-12-17 |
| [apache/guacamole-client](https://github.com/apache/guacamole-client) | Browser remote-management client; RDP/VNC/SSH with guacd | Compare management pages and multiple connections; do not assume target media latency | Apache-2.0 | 2026-10-15 |
| [apache/guacamole-server](https://github.com/apache/guacamole-server) | guacd protocol proxy; Connects to RDP/VNC/SSH hosts | Fallback management gateway; main LAN media need not pass through a proxy | Apache-2.0 | 2026-10-13 |
| [FreeRDP/FreeRDP](https://github.com/FreeRDP/FreeRDP) | Native RDP protocol and client library; Cross-platform; suited to Windows VMs and RDP-capable Linux services | Candidate fallback RDP worker | Apache-2.0 | 2026-10-15 |
| [Devolutions/IronRDP](https://github.com/Devolutions/IronRDP) | Modular Rust RDP implementation; Native, WASM, .NET; applications supply I/O and runtime | Candidate embedded Rust RDP; do not assume every graphics codec is implemented | MIT OR Apache-2.0 | 2026-10-15 |
| [neutrinolabs/xrdp](https://github.com/neutrinolabs/xrdp) | Linux RDP server; Usually creates desktop sessions with xorgxrdp | Suitable for separate sessions; verify whether it is the agent's desktop | Apache-2.0 | 2026-10-14 |
| [GNOME/gnome-remote-desktop](https://github.com/GNOME/gnome-remote-desktop) | GNOME remote desktop service; RDP/VNC; PipeWire, libei, Mutter | Important GNOME Wayland comparison; GitHub is an upstream mirror | GPL-2.0-or-later | 2026-10-08 |
| [TigerVNC/tigervnc](https://github.com/TigerVNC/tigervnc) | VNC clients and servers; Platform support and server session modes differ | Management/recovery fallback; VNC alone is no frame-rate guarantee | GPL-2.0 | 2026-10-12 |
| [LibVNC/libvncserver](https://github.com/LibVNC/libvncserver) | VNC client and server C libraries; Applications must provide platform capture and UI | Embedded VNC candidate; evaluate GPL integration boundaries | GPL-2.0 | 2026-10-07 |
| [novnc/noVNC](https://github.com/novnc/noVNC) | Browser VNC client; JavaScript; requires a VNC service and WebSocket connection | Fallback web control view; core MPL 2.0 with separately licensed assets | Core MPL-2.0; page assets separately licensed | 2026-10-05 |
| [novnc/websockify](https://github.com/novnc/websockify) | WebSocket-to-TCP bridge; Common noVNC companion | Protocol adapter, not desktop capture or encoding | LGPL-3.0 | 2026-05-24 |
| [any1/wayvnc](https://github.com/any1/wayvnc) | wlroots Wayland VNC service; Does not support GNOME, KDE, or Weston | Consider only with the appropriate compositor | ISC | 2026-09-28 |
| [Xpra-org/xpra](https://github.com/Xpra-org/xpra) | Persistent remote applications and desktop sessions; Primarily Linux/X11 sessions with cross-platform clients | Reference persistent sessions and application forwarding; distinguish physical desktop mirroring | GPL-2.0 | 2026-10-15 |
| [kasmtech/KasmVNC](https://github.com/kasmtech/KasmVNC) | Browser Linux desktop service; Linux server, browser client | Browser desktop comparison; does not mean the whole commercial Kasm platform is open source | GPL-2.0 | 2026-10-12 |
| [m1k1o/neko](https://github.com/m1k1o/neko) | Shared container desktop in the browser; Linux containers, WebRTC | Reference collaboration and control ownership; does not control the real host desktop by default | Apache-2.0 | 2026-10-08 |
| [veyon/veyon](https://github.com/veyon/veyon) | Classroom multi-device monitoring and control; Windows/Linux management | Reference multi-device thumbnails and batch operations | GPL-2.0 | 2026-10-16 |


## Keyboard/mouse sharing and input components

| Project | Responsibilities and platform boundaries | Use in this project | License summary | Latest push |
| --- | --- | --- | --- | --- |
| [deskflow/deskflow](https://github.com/deskflow/deskflow) | Keyboard, mouse, and clipboard sharing; Windows/macOS/Linux; no video | Reference input mechanisms; do not enable alongside streaming input by default | GPL-2.0 | 2026-10-15 |
| [feschber/lan-mouse](https://github.com/feschber/lan-mouse) | Rust keyboard and mouse sharing; Mainstream Wayland/Windows/macOS; directional X11 limitations | Reference Rust input backend; cannot switch video by itself | GPL-3.0 | 2026-09-26 |
| [input-leap/input-leap](https://github.com/input-leap/input-leap) | Barrier-derived keyboard/mouse sharing; Archived repository | Historical reference only; not a primary dependency for a new project | GPL-2.0 with OpenSSL exception | 2025-12-01 |
| [debauchee/barrier](https://github.com/debauchee/barrier) | Keyboard and mouse sharing; Cross-platform; latest public push is relatively old | Historical protocol reference; not preferred | GPL-2.0 with OpenSSL exception | 2024-06-22 |
| [symless/synergy](https://github.com/symless/synergy) | Keyboard and mouse sharing; The old synergy-core URL redirects; commercial editions have different boundaries | Evaluate the public repository version without conflating paid-product capabilities | GPL-2.0 | 2026-10-15 |
| [microsoft/PowerToys](https://github.com/microsoft/PowerToys) | Windows desktop utilities; Mouse Without Borders targets Windows devices | Reference shortcuts and Windows interaction; does not cover Mac/Linux | MIT | 2026-10-16 |
| [enigo-rs/enigo](https://github.com/enigo-rs/enigo) | Rust input simulation library; Backend and desktop-session requirements vary by platform | Fallback for a custom executor, not a remote transport layer | MIT | 2026-10-09 |
| [Narsil/rdev](https://github.com/Narsil/rdev) | Rust global input listening and simulation; Verify platform permissions and Wayland support individually | Reference shortcuts and low-level input | MIT | 2026-05-12 |
| [asweigart/pyautogui](https://github.com/asweigart/pyautogui) | Python desktop automation; Local screenshots and coordinate-based keyboard/mouse control | Useful for prototypes; prefer accessibility targeting for complex desktops | BSD-3-Clause | 2024-08-21 |
| [nut-tree/nut.js](https://github.com/nut-tree/nut.js) | Native Node desktop automation; Public source and prebuilt packages have different access arrangements | No complete root license file found; mark unresolved and do not adopt directly | Verify directory- and version-specific licenses | 2024-05-02 |
| [octalmage/robotjs](https://github.com/octalmage/robotjs) | Native Node desktop automation module; Cross-platform input/pixel access with native-build maintenance cost | Historical reference; verify compatibility with actual Node versions separately | MIT | 2026-10-01 |


## Mac and agent automation

| Project | Responsibilities and platform boundaries | Use in this project | License summary | Latest push |
| --- | --- | --- | --- | --- |
| [openclaw/Peekaboo](https://github.com/openclaw/Peekaboo) | Mac GUI automation CLI and MCP; macOS; Bridge, Screen Recording, and Accessibility permissions | Preferred Mac executor validation; SSH screenshots must reach the GUI session | MIT | 2026-10-16 |
| [Hammerspoon/hammerspoon](https://github.com/Hammerspoon/hammerspoon) | Mac Lua automation framework; macOS; system APIs and event extensions | Candidate for fixed workflows, application control, and personal bridges | MIT | 2026-07-09 |
| [asmvik/yabai](https://github.com/asmvik/yabai) | Mac window manager; macOS; advanced features have extra system requirements | Reference window positioning; avoid extra system changes for the MVP | MIT | 2026-06-14 |
| [trycua/cua](https://github.com/trycua/cua) | Computer-use tools and desktop infrastructure; Driver/SDK and other MIT components; Spaces-related paths use FSL | Evaluate per component; do not label the entire repository or streaming clients MIT open source | MIT components + FSL-1.1-MIT paths + other components | 2026-10-16 |
| [mediar-ai/terminator](https://github.com/mediar-ai/terminator) | Accessibility-based desktop automation; Current support table explicitly states Windows only | Future Windows VM executor candidate, not a Mac executor | MIT | 2026-06-02 |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Browser automation; Cross-platform browsers and testing tools | Preferred for website operations; does not replace system-desktop control | Apache-2.0 | 2026-10-16 |
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | Browser agent framework; Python/browser; external models and browser sessions | Reference browser tasks; does not operate native Mac applications | MIT | 2026-10-16 |
| [modelcontextprotocol/rust-sdk](https://github.com/modelcontextprotocol/rust-sdk) | Rust MCP SDK; Client/server tool protocol | Candidate tool control plane; source licensing is transitioning between Apache and MIT | Apache-2.0 / existing MIT contributions; in transition | 2026-10-16 |


## Media and client foundation components

| Project | Responsibilities and platform boundaries | Use in this project | License summary | Latest push |
| --- | --- | --- | --- | --- |
| [webrtc-rs/webrtc](https://github.com/webrtc-rs/webrtc) | Rust WebRTC implementation; ICE/DTLS/media transport, not a complete remote desktop | Evaluate for a custom media path; do not rewrite the protocol in version one | MIT OR Apache-2.0 | 2026-10-12 |
| [paullouisageneau/libdatachannel](https://github.com/paullouisageneau/libdatachannel) | C/C++ WebRTC data and media library; Cross-platform; applications handle capture and codecs | Alternative native WebRTC component | MPL-2.0 | 2026-10-07 |
| [pion/webrtc](https://github.com/pion/webrtc) | Go WebRTC implementation; Primarily pure-Go WebRTC protocol components | Alternative-stack reference; not tightly coupled to the Rust direction | MIT | 2026-10-16 |
| [GStreamer/gstreamer](https://github.com/GStreamer/gstreamer) | Multimedia pipelines and plugins; Cross-platform; GPU encoding depends on plugins and drivers | Media prototyping tool; verify plugin licenses and packaging individually | LGPL family; plugins and external dependencies require separate review | 2026-10-15 |
| [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg) | Codec and multimedia libraries; Cross-platform; licensing varies with configuration and external libraries | Reference measurement, transcoding, and media components; not uniformly permissive | LGPL/GPL depending on build configuration | 2026-10-16 |
| [quinn-rs/quinn](https://github.com/quinn-rs/quinn) | Rust QUIC implementation; Network transport library | Future custom transport candidate; does not automatically provide desktop features | MIT OR Apache-2.0 | 2026-10-16 |
| [tauri-apps/tauri](https://github.com/tauri-apps/tauri) | Rust and Web UI desktop shell; Windows/Linux/macOS with system WebViews | Preferred console candidate at research time; keep native video workers separate | MIT / MIT OR Apache-2.0 by component | 2026-10-16 |
| [tauri-apps/global-hotkey](https://github.com/tauri-apps/global-hotkey) | System global-hotkey library; Behavior and reserved keys vary by platform | Candidate for Windows emergency return and device switching | MIT OR Apache-2.0 | 2026-10-16 |
| [tauri-apps/tray-icon](https://github.com/tauri-apps/tray-icon) | Native tray-icon library; Cross-platform with graphical-runtime requirements | Candidate persistent tray entry point | MIT OR Apache-2.0 | 2026-10-16 |
| [electron/electron](https://github.com/electron/electron) | Chromium/Node desktop shell; Cross-platform with a larger runtime | Console alternative aligned with the user's existing stack | MIT | 2026-10-16 |
| [nashaofu/xcap](https://github.com/nashaofu/xcap) | Rust screenshot and screen-capture library; Cross-platform; verify Linux backends for the chosen version | Candidate screenshot/diagnostic tool; do not assume video-streaming suitability | Apache-2.0 | 2026-08-25 |
| [CapSoftware/scap](https://github.com/CapSoftware/scap) | Cross-platform Rust screen capture; ScreenCaptureKit/WGC/PipeWire; public pushes are relatively old | Capture-layer alternative; test API and maintenance state | MIT | 2025-08-05 |
| [smasherprog/screen_capture_lite](https://github.com/smasherprog/screen_capture_lite) | Cross-platform C++ screen capture; Windows/macOS/Linux | Capture reference, not a codec or remote-control product | MIT | 2026-05-05 |
| [VirtualDrivers/Virtual-Display-Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver) | Windows virtual display driver; Windows; driver installation and signing have separate requirements | Extension for headless Windows VMs/hosts; not required initially | MIT | 2026-09-19 |
| [LizardByte/libvirtualhid](https://github.com/LizardByte/libvirtualhid) | Cross-platform virtual input components; MIT library; some Windows drivers and Mac broker components have SAL restrictions | Evaluate paths and binary licenses; not a fully open-source default driver | MIT library; some drivers and broker components use SAL | 2026-10-15 |


## Emerging remote-tool watchlist

| Project | Responsibilities and platform boundaries | Use in this project | License summary | Latest push |
| --- | --- | --- | --- | --- |
| [huaying/phantom](https://github.com/huaying/phantom) | Native Rust and browser remote desktop; README currently lists Mac as client-only | Watchlist project; do not assume Mac host support | MIT | 2026-09-16 |
| [bsh888/remotectl](https://github.com/bsh888/remotectl) | WebRTC remote desktop candidate; README claims cross-platform support; no clear root license | License unresolved; not a directly reusable open-source dependency | No confirmed license | 2026-04-20 |
| [itsF4LCON/desk](https://github.com/itsF4LCON/desk) | Linux browser remote desktop; Depends on specific Wayland/PipeWire environments; includes a Cloudflare route | Reference a small implementation; verify cloud-free LAN mode | MIT | 2026-09-23 |
| [bybrooklyn/wavry](https://github.com/bybrooklyn/wavry) | Rust/Tauri streaming platform; Multiple components; README capabilities are project claims | Observe custom design; do not treat advertised latency as measured results | AGPL-3.0 | 2026-03-29 |
| [sidecar-app/sidecar](https://github.com/sidecar-app/sidecar) | Collaborative WebRTC screen sharing; README currently focuses control support on Linux Wayland | Reference control handover; do not assume full Windows/Mac control | MIT | 2026-08-18 |

## GitLab upstream project

| Project | Responsibilities and boundaries | Use in this project | License summary |
| --- | --- | --- | --- |
| [HopToDesk](https://gitlab.com/hoptodesk/hoptodesk) | Complete cross-platform remote control; upstream on GitLab | Compare with RustDesk; do not obtain source from unrelated GitHub mirrors | [AGPL-3.0](https://gitlab.com/hoptodesk/hoptodesk/-/blob/main/LICENSE) |
