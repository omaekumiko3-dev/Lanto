# Local Verification Records

Date: 2026-10-16. Environment: local Windows, Node.js 24.12.0, Electron 44.7.2. These records cover the Electron controller and standalone Node.js Host.

| Check | Result |
| --- | --- |
| `npm run build` | Type checking and main/preload/renderer builds passed |
| `npm run host:build` | Standalone Node.js Host built; compiled CLI runs |
| `npm run format:check` | Passed |
| `npm test` | All 20 tests passed |
| `npm run test:smoke` | Real Electron operations and loopback Host pairing passed with isolated configuration |
| npm dependency audit | Reported zero known vulnerabilities after installation; this does not exclude unknown issues |
| `git diff --check` | Passed |

Core tests cover configuration save/reload, retaining corrupt configurations, address/argument validation, duplicate device IDs, Moonlight arguments, TCP probing, real local child-process cleanup, switching order, returning during startup, abnormal exit, and preventing replacement sessions after stop failure.

Host tests cover real HTTPS, rejection of wrong certificates and unauthenticated requests, expired/replaced/replayed one-time credentials, token-digest storage, authorization restoration/revocation, the local CLI management interface, discovery-record validation, and systemd service-file escaping. Host/protocol/common sources were checked for unwanted Electron, React, or main imports.

UI checks cover isolated preload, disabled Node integration, enabled sandbox, device CRUD, input errors, settings persistence, invalid-shortcut rollback, and configuration restoration after exit/restart. Added coverage includes loopback Host pairing, OS secure-storage encryption/decryption, keeping tokens out of the renderer, restoring Host state after restart, and revoking authorization when removing a device. Screenshots are `test-results/workbench.png` and `test-results/host-paired.png`, excluded from Git.

Real Windows → Mac components were also deployed: Node.js Host runs through launchd on Mac M2, and the Windows controller completed real HTTPS pairing and status reads. Independent Moonlight/Sunshine media pairing succeeded. Screen Recording permission was initially missing; capture initialized after a Mac restart. Lanto started a Desktop session, and Sunshine logged `CLIENT CONNECTED` with hardware HEVC VideoToolbox encoding. At this stage the Windows first frame, actual input, and frame rate were still awaiting confirmation. Versions, paths, and current status are in the [Mac deployment record](mac-windows-deployment.md).

Windows → Mac was subsequently changed to 2K60 with response priority and statistics. Client logs confirmed `2560x1440x60`, RTX 3080 D3D11VA hardware decoding/rendering, and disabled V-sync/frame pacing; the host confirmed hardware encoding. The user reported a clear improvement in pointer, typing, and dragging. New settings were saved through the real UI and the connection restarted. Diagnostic files remained writable by the child after the parent closed its handle. No before/after end-to-end latency values were recorded.

Real Linux1 had not been connected at this early stage; later hardware acceptance is recorded below. Firewall, router, and NAS were unchanged. Cross-device mDNS discovery, shortcuts during games, remote key release after abnormal disconnects, long-term frame rate, game frame times, and multi-device switching latency still lack complete measurements.

Eight real media comparisons were completed. Shared devices and direct decoding-texture binding had lower average rendering time in this round, without a stable decoding win; see [performance investigation](performance-investigation.md). The Windows experiment was then enabled locally, with shared/bind/D3D11VA confirmed in logs and the user reporting normal, more responsive video/input. A real child-process test verifies environment parameters affect only the designated child, not the parent or later ordinary children. PresentMon ETW collection could not run with current privileges, so no physical-display or end-to-end latency was reported.

The real Windows → Linux1 Sunshine/Moonlight baseline was completed later. Continue validating agents, NAS, media telemetry, and prewarmed sessions according to the [design stages](design.md#validation-stages).

## Local cursor and native Mac backend

New checks cover client capability manifests, rejecting local cursor for mismatched/corrupt protocol versions, continued ordinary-mode operation with old clients, and platform boundaries for Windows graphics environment variables. Real Electron smoke testing verifies local-cursor persistence with a separate shortcut so it can coexist with the everyday controller. Type checking, build, and formatting passed.

The Moonlight C++ client was compiled, deployed, and used for real streaming on Windows. Pinned Sunshine PR #5817 source and patches compiled on Mac M2. Initial builds used temporary signatures; current v2 uses a stable Developer ID and passes strict signature verification. All patches applied in documented order to clean source. The Mac uses ScreenCaptureKit and native VideoToolbox; the client retains D3D11VA shared-device/direct-texture binding.

The device-independent subset of upstream native tests ran 647 cases: 638 passed and nine skipped. Full hardware testing encountered five fixture setup/cleanup errors related to SSH, permissions, and device context, so it did not pass as a complete suite. CTest registered no tests; execution used `tests/test_sunshine`. Native code coverage was not reported.

The initial experimental stream received 2K60 video and negotiated local cursor, but an audio-thread block during disconnection caused the watchdog to terminate the service. Follow-up changes preserved the no-tray main-thread event loop and fixed nullable ScreenCaptureKit error diagnostics. Official `tccutil` reset only the experimental app's old Screen Recording signature record, followed by user reauthorization. This demonstrates that process startup or encoder probing does not replace reconnect acceptance. Final hardware state is in the [deployment record](mac-windows-deployment.md).

Two root causes were later identified and fixed: the client now stops incorrectly shrinking H.264 SPS reference-frame limits when the host advertises the capability; TCC diagnostics guided removal of old `PostEvent`/`AudioCapture` requirements during stable-signature migration. User authorization and restart restored input and system audio. The no-tray event-loop patch alone did not fix the permission block and must not be presented as the same repair.

v2 hardware regression: stable Sunshine in ordinary mode reported `preserve SPS=false`; native H.264 with local cursor both on and off reported `preserve SPS=true`, received first video/audio packets, and showed none of the original reference-frame/slice/decoder-submission errors. After three ended native sessions, twelve-second waits left the Mac service alive. Two reconnects reused it directly; the third followed an intentional launchd restart, retained permissions, and received native HEVC audio/video. The current session keeps local cursor enabled.

A dedicated window provided a real end-to-end input probe. Windows injected clicks, dragging, and scan-code key events into foreground Moonlight; the Mac AppKit window recorded two clicks, 16 drag events, and one key event. Only counts were stored, no text, and the probe exited afterward. Event delivery does not establish full Chinese input, all shortcuts, or long-term interaction coverage.

Build-script validation included PowerShell parsing, Bash syntax, rejection of temporary signatures, incremental patch application, and `git diff --check`. This native fix did not change controller TypeScript, so it reused existing results above; later UI validation follows. Native coverage, sustained 60fps, long-term stability, and end-to-end latency were not measured. Mixed static-desktop/animation log averages are not performance rankings.

## Compact window and icon update

The controller became a 900×620 frameless window, minimum 680×480. New icons, window controls, and a bottom session bar replaced decorative previews, duplicate navigation, setup checklists, and a permanent activity log. Graphics pipeline, media paths, and statistics moved into advanced settings. Window actions still use source-validated IPC without exposing arbitrary windows or Electron APIs.

All 19 tests, type checking, production build, and real Electron smoke testing passed. Added smoke coverage checks frameless dimensions, drag/button regions, rejection of non-allowlisted window actions, settings scrolling and footer reachability at minimum size, and actual application exit from Close. Existing pairing, CRUD, and error validation remain covered. An error-message overlap with dialog actions was found and fixed. Visible-window checks also verified minimize, maximize, and restore.

Controller window and desktop-shortcut icons and native v3 media-client window/executable icons were replaced. Win32 retrieved icons from both running windows for inspection. PNG, SVG, and multi-size ICO assets are in the repository; screenshots remain in ignored `test-results/`. v3 uses the same media patches. A real Mac reconnect retained local cursor and HEVC/D3D11VA and received first video/audio packets. No Mac binary or system permissions changed.

## Device connection switches and live editing

Each device card now has a keyboard-operable connection switch at the upper right, replacing the bottom session bar and separate return button. Connected devices can be renamed and settings saved. Names update immediately; media parameters apply on the next connection. The current device cannot be removed before disconnection. Paired-device addresses are editable, while OS type remains controlled by pairing identity; pairing again preserves user names.

All 19 tests, type checking, production build, formatting, and Electron smoke testing passed. New isolated smoke tests with real local child processes cover connection/disconnection/device switching, Space activation, rename/settings changes without PID changes, rejection of current-device removal, new arguments on the next startup, and automatic switch reset/reconnection after client crashes. These local process tests are not network-stream acceptance.

The local app restarted and established a real connection through the new StudioMac switch. Logs confirmed 2560×1440, 60fps, HEVC, D3D11VA, local cursor, and first video/audio packets. Manual screenshot inspection confirmed only the real Mac card, its upper-right sliding switch, and a usable edit entry.

## Mac cursor-shape and hotspot synchronization

Moonlight v4 and the Mac Objective-C++ cursor module compiled natively. Qt parsing tests passed for PNG transparency, logical dimensions, fractional hotspots, protocol versions, status codes, duplicate fields, malformed XML/hex, dimensions, and response limits. The Mac retained the previous Developer ID and designated signing requirements, passed strict signature verification, and required no permission reset.

A real AppKit window provided arrow, I-beam, hand, and horizontal/vertical resize regions; the actual right window edge was also checked. Win32 read cursor pixels, dimensions, and hotspots from the running media window. All six shapes had different pixel hashes; sizes and hotspots matched Mac samples scaled by 1.5 and rounded. For example, the text cursor was 35×33 with hotspot (18,17), and horizontal resize was 45×36 with hotspot (23,18). The user confirmed correct changes over window edges, text, and links. The test window closed afterward.

Unpaired HTTPS cursor requests were rejected by TLS; HTTP at the same path returned XML `status_code=404` without cursor data. The final build coalesces AppKit sampling and bounds waits so HTTPS cannot block on main-thread shutdown. After restart, real HEVC streaming resumed with local cursor and normal system-audio/Opus initialization. Statistics stayed off. No end-to-end latency, long-duration, or multi-monitor conclusion was established. Automated focus-switch testing was interrupted by user focus changes and was not counted as passing.

All 19 controller tests, type checking, production build, formatting, and real Electron smoke testing passed again. Both sides' patches applied in order to clean pinned sources; PowerShell/Bash build-script syntax and whitespace checks passed.

## Full Mac restart and automatic login

Two full restart checks completed on 2026-10-16. Host and native Sunshine resumed after graphical login. A separate test used an owner-configured automatic-login desktop and reconnected with existing pairing, HEVC 2560x1440 video, local cursor, and system audio. Lanto did not implement login or disk-encryption configuration. These checks do not establish pre-login desktop access.

Startup items and storage were also inventoried read-only, without deleting files or disabling other apps. Restart released about 10.7 GB of swap. Observed internal APFS capacity was about 245.1 GB, with 93.6 GB used and 151.5 GB free; these values vary with runtime activity. Storage details are in local ignored `work/maintenance/mac-2026-10-16.html`, without committing personal project inventories.

## Changing a paired device's IP

Paired-device address fields are no longer read-only. Saving updates management and streaming addresses while retaining device identity and OS restrictions. All 20 tests, type checking, production build, and Electron smoke testing passed. New real TLS tests cover address migration, token reuse after restart, and rejection of a different certificate at the new address.

Isolated Electron tests cover editable addresses, byte-for-byte preservation of certificate/encrypted-token fields, rollback after configuration write failure, repair of inconsistent duplicated configuration at startup, unchanged current-session PID, and new addresses in the next stream's arguments. Tests used loopback addresses and isolated configuration without changing the user's Mac network or saved address. The screenshot is local `test-results/edit-host-address.png`.

## Linux hardware deployment and restart

Official stable Sunshine and standalone Node.js Host were installed on Ubuntu 26.04.1/RTX 3080, and both user services enabled. Windows completed both pairings. HEVC 2K60, first audio packet, clicks, dragging, and keyboard input passed. Remote Pinyin input produced the six-character Chinese input-test phrase in a GTK field in the same GNOME Wayland session. After a full restart, automatic login, Host, Sunshine, and existing pairings recovered; audio/video and Chinese input passed again. See [Linux deployment](linux-windows-deployment.md).

The controller gates local-cursor protocol by device platform: Linux/Windows use remote cursors automatically while Mac preferences remain. All 20 tests, type checking, production build, formatting, and isolated Electron smoke testing passed. Native environment tests verify a Mac local-cursor preference does not make Linux/Windows reject ordinary clients. The new runtime packager and Linux user-service installer were used in this deployment; runtime packages exclude Electron, the full repository, and identity data.

## Device volume control

On 2026-10-17, device cards gained independent 0–100% volume and mute controls, with existing devices defaulting to 100% unmuted. Mute retains the previous volume. Preconnection settings apply to the first audio frame; active sessions update native PCM gain through separate per-session control files. Audio continues when returning to the device list.

All 23 tests, type checking, production build, and Electron smoke testing passed. Coverage includes old-configuration migration, out-of-range rejection, device isolation, continuous slider and keyboard changes, unmute restoration, initially muted connections, persistence through rename/reconnect/app restart, and current-gain rollback after disk-save failure. Screenshots at 680×480 and 900×620 were inspected. Qt native tests cover Int16/Float32 PCM, unchanged 100% output, zero-sample mute, invalid control data, live atomic replacement, and thread exit.

The local native client was updated to v5 with existing pairing retained. A real Linux session used HEVC 2560×1440 at 60fps and the existing D3D11VA pipeline; first audio arrived at about 400ms. A low-amplitude PipeWire tone played in the Linux desktop session, and Windows read that Moonlight process's audio-session peaks:

| Card setting | Mean Windows audio-session peak |
| ---------------------- | ------------------------------: |
| 100% | 0.0250318 |
| 50% | 0.0125154 |
| 25% | 0.0062579 |
| Muted | 0 |
| Unmuted, restoring 25% | 0.0062580 |

This verifies real output gain follows the card, not perceptually linear loudness. The tone stopped, everyday volume and diagnostics were restored, and remote system volume/services were unchanged.

## Windows controlled-host deployment

On 2026-10-17, official stable Sunshine MSI, standalone Node.js Host, and a LOCAL SERVICE startup task were installed on Windows 11 Pro/RTX 3080. Host and Sunshine pairings completed. The Windows controller displayed a real 2560×1440 HEVC desktop, received first video at about 300ms, and decoded through D3D11VA. Short animation samples were 59.66/60.17fps, approximately 1ms network latency, and 0% network frame loss. A low-amplitude tone played in the existing remote console session; reading only that Moonlight process's WASAPI session yielded mean peak `0.00300045`, confirming real output.

Repeating the Windows installer preserved identity/authorization file hashes and restored Host availability. Startup trigger, LOCAL SERVICE account, retry policy, unlimited runtime, and private-file ACLs were checked. After Sunshine service restart, existing media pairing still authenticated access to Desktop/Steam Big Picture application listings. Host and Sunshine firewall entries were limited to the local subnet. No full machine restart occurred.

Foreground input passed: Moonlight sent clicks, dragging, and scan-code keyboard events to a window in the same remote console session. It recorded one click, 128 drag updates, and exact English text `lanto123`. Remote Pinyin produced the six-character Chinese input-test phrase with every character matching. After disconnect/reconnect, the window and text remained, animation measured 59.89fps, and the new client audio session averaged `0.00300156`. Temporary windows and audio tasks were removed; statistics returned to off. Full restart, game Raw Input, controllers, and long-term stability remain unverified. See [Windows deployment](windows-windows-deployment.md) for versions, paths, and limits.

All 23 core tests, Host TypeScript build, formatting, PowerShell parsing, and whitespace checks passed. Controller UI and native-player code were unchanged, and no implementation-mirroring unit tests were added. Initial installation, repeat installation, real service recovery, and permission checks ran on the target machine.

## Real volume regression on three host platforms

On 2026-10-17, StudioMac, LinuxWorkstation, and WindowsDesktop were connected individually at the user's request. Each existing desktop session played a low-amplitude tone. Device-card sliders and mute buttons were operated, and the controller read the corresponding Moonlight WASAPI session. Results below use each host's stable 100% output as baseline; percentages describe PCM peak ratios, not perceived loudness.

| Host | Measured output at 50% | At 25% | Zero volume / mute | Unmute back to 25% | Restore 37% after reconnect |
| ------- | ---------------------: | -----: | ------------------ | -----------------: | --------------------------: |
| macOS | 50.00% | 25.01% | Both 0 | 24.98% | 36.97% |
| Linux | 50.00% | 25.00% | Both 0 | 25.00% | 37.01% |
| Windows | 50.00% | 25.00% | Both 0 | 25.00% | 36.99% |

All three completed 100% → 50% → 25% → 0% → muted at 25% → unmuted, then disconnected/reconnected with 37% and mute saved. New streams initially output zero and restored 37% after unmuting. Client PIDs stayed unchanged during live adjustment, and every other device's saved volume/mute remained unchanged. Separate 23%/47%/71% values and mixed mute states were then saved, and all survived an actual Lanto exit/restart.

Sampling waited for stability and used the median of three 100% readings. Unstable Mac transition readings from the first connection were excluded. Windows obtained a stable baseline only after starting the tone following Sunshine's switch to virtual audio output; two earlier rounds were excluded. Linux's first authenticated connection timed out and recovered after Sunshine restart; subsequent volume/reconnect tests passed. The timeout root cause is unresolved, so long-term connection stability is not claimed.

All three returned to their prior 100% unmuted state, statistics off. Temporary tones, player processes, and Windows scheduled tasks were removed; media services remained running. No app or native-player implementation changed. This is real three-host audio, persistence, and isolation acceptance, using measured sound rather than slider display values.

## Shared clipboard, files, and playback across platforms

On 2026-10-17, shared clipboard and a separate file-sharing switch were added. All three Hosts were updated while retaining identities/pairings. Mac, Linux, and Windows each served as a source, sending Unicode text and files with Chinese names to every endpoint with matching SHA-256. PNG hashes also matched across four endpoints. Files larger than 4 GiB, Chinese-named files, zero-byte files, and empty directories were actually transferred to all three hosts and fully verified. See [clipboard verification](clipboard-sync.md#physical-verification-on-2026-10-17) for switching off, mid-transfer cancellation, boundaries, and recopying after the initial Windows TLS interruption.

Connection arguments now include `--audio-on-host`, preserving normal target playback while forwarding the same sound to the controller. Each host was connected and played a low-amplitude tone:

| Host | Target during streaming | Mean controller Moonlight audio-session peak |
| ------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------: |
| macOS | Default remained Mac mini speakers, 50% and unmuted | 0.00502146 |
| Linux | Physical ALC897 digital output remained 40%; player and Sunshine capture monitor used the same physical device | 0.00502088 |
| Windows | Default remained Redmi Computer Speakers; physical endpoint peak stayed nonzero | 0.13987496 |

Windows also had other actual playback, so its peak is not a single-tone amplitude and cannot be used for loudness comparison. Checks confirm streaming neither replaced nor muted target physical audio while the controller simultaneously received it. Client-only sound did not substitute for target inspection. Tones and temporary tasks were removed; system volume on all three hosts was unchanged.

A Show performance data switch was added at the top of Settings. Enabling it in the real UI launched a Mac session with `--performance-overlay`; disabling and reconnecting explicitly used `--no-performance-overlay` to avoid inheriting old Moonlight preferences. Both launches included `--audio-on-host`. Preferences survived controller exit/restart. Statistics are currently off and both sharing switches on.

All 30 core tests, type checking, production build, Host build, formatting, PowerShell installer parsing/reinstallation, and real Electron smoke testing passed. Coverage includes authenticated TLS uploads/downloads and checksums, invalid/duplicate manifest names, oversized-file metadata, changed source files, queued-task invalidation after disabling, duplicate-event suppression, and forwarding across three platforms. About 20 GiB of remote test copies, temporary clipboard components, and audio tasks were removed; production Host/desktop tasks continued. Execution policy rejected deletion of the local large-file source and small-file cache, which remain in ignored work/cache directories and are excluded from commits.

## Unified UI, top shortcuts, and branding

On 2026-10-17, layout, color, and interaction principles from shadcn/ui, Radix Themes/Select, and Headless UI informed a graphite/mist-blue theme. Sources and choices between the two local brand logos are in [UI and brand guidelines](design-system.md). Shared clipboard and performance data moved to the top of Devices. File sharing, progress, cancellation, and receiving-directory controls moved into a clipboard popover; the old bottom status bar was removed.

`npm run build`, `npm run format:check`, all 30 core tests, real Electron smoke testing, and `git diff --check` passed. New smoke checks cover top-switch persistence, file-switch dependency, preferences after restart, Escape closing the popover, native-select keyboard selection, Escape closing menus before Settings, Tab/Shift+Tab focus trapping, and restored focus on close. An independent test shortcut avoids conflict with the everyday controller.

Main, Settings, menu, and clipboard-popover screenshots were inspected at 900×620 and minimum 680×480. No horizontal overflow appeared; footer actions remained visible, native menus were not clipped by scrolling, and outside clicks/Escape closed popovers. Icons were generated as 16–256px ICO and 256px PNG. Windows API extraction of a 32px icon from the new player EXE confirmed the new graphic was embedded.

qmake incremental resource dependencies tracked generated RC files but missed ICO updates. The build now refreshes RC timestamps, and Windows resource recompilation was verified. The native client built successfully with unchanged cursor, H.264 SPS, and volume protocol identifiers; media processing was unchanged.

After user confirmation, the old Windows session disconnected and the everyday controller restarted with the new UI and `Moonlight-Lanto-native-7`. Saved devices/settings were compared field by field; only the player path changed. All three clipboard endpoints became ready again, clipboard/files remained enabled, and performance data remained off.

The Windows taskbar still showing the old logo was then fixed. Windows now has an explicit relaunch icon, uses a content-hashed ICO path, and updates existing desktop/taskbar shortcuts targeting this app. Actual window-icon and shortcut-path readback plus a taskbar screenshot after Shell refresh confirmed the new dark/mist-blue logo. Build, formatting, and real Electron smoke testing passed. Isolated tests do not modify everyday shortcuts, and no system icon cache deletion or Explorer restart was used.

## SSH deployment and standalone controller package

On 2026-10-17, SSH deployment was added in version 0.2.0. Credentials were injected locally through OpenKeylet into the product's own SSH transport and deployment manager. Existing macOS ARM64, Ubuntu x64, and Windows x64 hosts all completed system inspection, runtime and service reuse, network checks, real Host TLS pairing, and media pairing. Test-only Host identities were revoked afterward. Existing service configuration, media certificates, and administrator accounts were preserved.

Each target was also tested with a separate Moonlight portable directory and a newly generated client identity. The product's PIN workflow used the remote Sunshine administration API to accept the unique request matching the controller address. All three succeeded. Each target initially had one media client; its one new test client was revoked by UUID afterward. This verifies first-time media pairing separately from reuse of an existing pairing.

The real Electron UI completed SSH credential entry, fingerprint confirmation, inspection, and all six deployment steps, then added the device. The test used isolated configuration and operating system secure storage. A subsequent Mac HEVC stream confirmed 2560×1440 at 30 fps, WASAPI audio initialization, and a first video packet 100 ms after the video stream started. This is not the total click-to-connect latency; audio amplitude was not remeasured. The stream was disconnected and the test device removed afterward.

The universal Mac clipboard helper passed compilation, signature verification, and an actual read-only invocation. Architecture inspection confirmed both x86_64 and arm64. The check printed availability only, without clipboard contents or clipboard changes. Host packaging verifies the source and binary digests.

All 33 core tests passed. New loopback SSH server tests cover first-time confirmation, reuse of known fingerprints, rejection of changed fingerprints, failed authentication without trust persistence, UTF-8 standard input, command timeout, and cancellation. Catalog coverage includes both architectures and all three target operating system families. Electron smoke testing also verifies that cancellation before fingerprint acceptance sends no user authentication, and that deployment state contains no password. Existing device, volume, switch, pairing, and restart checks passed.

After integration of the parallel English UI changes, formatting, type checking, production build, all 33 tests, and Electron smoke passed again. The live UI deployment was repeated successfully; the resulting stream reported running, received video, and initialized audio. Screenshots at 900×620 and the minimum 680×480 showed a scrollable wizard with visible footer actions.

The Windows portable package was launched using an isolated user data directory. Checks confirmed packaged execution, automatic discovery of the bundled player, an empty initial device list, and an available SSH wizard. The package contains the player, Host archive, required JavaScript dependencies, and component catalog; the controller requires no separate Node.js or Moonlight installation.

Validation limits: existing Sunshine and Host installations were not removed to exercise installer branches. Full installation regression on clean Windows, macOS, and Linux images has not been completed. Fresh installation paths are implemented with pinned versions and SHA256 verification, while system permissions remain under OS control. Reuse tests do not establish support for every clean system, distribution, architecture, or driver. See the [SSH deployment scope](ssh-deployment.md).

## Configurable 4K desktop streaming

On 2026-10-17, 3840 × 2160 was added to the settings schema and resolution selector. New profiles use 4K, 30 FPS, and 60 Mbps; existing profiles keep their saved settings. Resolution, frame rate, and bitrate remain independently editable. Configuration tests cover both 4K persistence and preservation of an existing 1080p profile. The Electron smoke test saves a custom 75 Mbps 4K30 profile, verifies the native launch arguments, and verifies the saved values after restart. The compact settings layout and updated documentation screenshot were inspected.

The everyday controller was updated after a backup and its settings changed through the actual UI to 4K / 30 FPS / 60 Mbps. All device entries and unrelated preferences were preserved. A Windows-to-Linux connection confirmed `Video stream is 3840x2160x30`, a requested bitrate of `60000 kbps`, receipt of video, and D3D11VA hardware decoding/rendering on a 3840 × 2160 display. The short sample reported 0% network/jitter frame drops, approximately 1 ms average network latency, 1.33 ms average decoding time, and 0.21 ms average rendering time. These component timings are not end-to-end latency, and this short check is not a sustained performance benchmark. The user subsequently confirmed that the image was clear.

### Actual 4K sources on macOS and Windows

Follow-up inspection found that the Mac was rendering a 1920 × 1080 headless fallback desktop, while the Windows host's physical monitor exposed at most 2560 × 1440. Both were being enlarged into a 3840 × 2160 video. The client setting alone had not created a 4K desktop source.

An optional standalone virtual-display helper was compiled on the Apple M2 with warnings treated as errors. CoreGraphics and System Profiler confirmed a 3840 × 2160 framebuffer with 1920 × 1080 logical points. A user LaunchAgent keeps the display alive, and a readiness wrapper orders Sunshine startup after it. A cold restart of both components followed by another real connection passed. Sunshine selected the new display and created a 3840 × 2160 VideoToolbox HEVC session; the controller received 4K30 at a requested 60 Mbps through D3D11VA. The post-restart short sample reported 0% network/jitter drops, about 1 ms average network latency, 3.28 ms decoding, and 0.12 ms rendering. The existing Sunshine binary and permissions were retained. A full OS reboot was not performed for this change.

On Windows, the signed Virtual Display Driver 25.7.23 was verified and installed, with one 4K virtual monitor rendered by the RTX 3080. The archive matched the upstream SHA-256 digest. Windows required establishing the catalog's valid SignPath Foundation signer in Trusted Publishers; only that leaf certificate was added, with its thumbprint and previous trust state recorded for rollback. No root certificate or signature-enforcement setting was changed.

Sunshine was configured to activate only the virtual monitor during a session and restore the original display arrangement on disconnect. Real session logs confirmed both `Capture size: 3840x2160` and `Desktop resolution [3840x2160]`, HEVC NVENC, a 30 FPS request, and receipt of 4K30 at 60 Mbps on the controller. One short sample reported 0% network/jitter drops, approximately 2 ms average network latency, 0.83 ms decoding, and 0.12 ms rendering. A read from the interactive console confirmed that disconnect restored the original 2560 × 1440 physical display and left the virtual monitor inactive.

The first Windows connection after setup timed out during the control handshake. Subsequent connection and reconnection passed; the initial timeout was not treated as a successful sample. On macOS, the existing capture process initially retained stale display information; restarting it after the virtual display became ready resolved that condition. These are short functional checks, not a sustained stability or end-to-end latency benchmark. See [host display setup](host-display.md) for scope and rollback.

The connection was restored with the performance overlay off. The target desktop resolution was not automatically changed. Build/type checking, formatting, all 39 behavior tests, Go tunnel tests, and Electron UI smoke tests passed.

### Local/remote window switching

Ctrl plus backtick now toggles the Windows remote window while preserving the streaming process. The default-on minimization setting applies to focus loss and can be changed during a session. An active device card also exposes **Show**; its connection switch still disconnects.

All 44 behavior tests, Go tunnel tests, type checking, the production build, formatting, and Electron UI smoke tests passed. Coverage includes legacy shortcut migration, preserving custom bindings, saving the minimization preference, keeping the same session during focus switches, failed window actions leaving the stream alive, and Win32 process-handle cleanup. The Windows tests exercise the real FFI against isolated child processes and verify that a missing window cannot target another application.

Global-shortcut behavior and window restoration inside exclusive-fullscreen games remain a manual acceptance check. Automated key injection did not trigger the binding in the active fullscreen environment; this is not recorded as a successful physical shortcut test.
