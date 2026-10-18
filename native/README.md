# Native Media Experimental Components

The console remains Electron/TypeScript. Pixels, cursor drawing, capture, and encoding stay in two native processes. This directory contains small patches for pinned versions and build entry points, not complete upstream sources, prebuilt programs, pairing certificates, or runtime configuration.

Current acceptance: the H.264 SPS rewrite issue exposed during testing is fixed. Old signature-related permissions for the experimental app were cleared, and it now uses a stable Developer ID. Real video, audio, clicks, keyboard input, dragging, and reconnecting after three disconnects passed. Local cursor and the native backend are enabled on this setup. These experimental components have passed short acceptance tests; long-term stability and superior end-to-end performance are not established.

## Responsibilities

| Module                       | Responsibility                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/native-profile.ts` | Map settings to environment parameters for the current media child process; check the client capability manifest before enabling local cursor |
| `moonlight/cursor-frame.*`   | Validate cursor protocol, image dimensions, and hotspot; decode transparent PNG                                                               |
| `moonlight/cursor-sync.*`    | Fetch shapes on a separate thread; create, scale, and release local cursors on the SDL thread                                                 |
| `moonlight/audio-volume.*`   | Read session volume on a separate thread and apply PCM gain to all channels after decoding                                                    |
| `sunshine/lanto_cursor.*`    | Read system cursor and hotspot on the AppKit main thread and generate shape responses                                                         |
| Moonlight/Sunshine patches   | Integrate sessions, capability negotiation, and paired HTTPS; exclude the cursor from ScreenCaptureKit video                                  |
| Upstream PR #5817            | ScreenCaptureKit capture and native asynchronous VideoToolbox encoding                                                                        |

Mac system cursor shapes and hotspots are synchronized. Arrow, text, link, horizontal/vertical resize, and actual window-edge cursors have been verified. Cursor movement does not wait for remote video, but click results, window dragging, and text updates still use the video pipeline. The experimental Mac host permits one active media client to avoid mixing cursor modes on a shared capture source. Ordinary controllers can still connect with local cursor disabled.

## Cursor-shape channel

The Mac uses public [`NSCursor.currentSystem`](https://developer.apple.com/documentation/appkit/nscursor/currentsystem) to read the current system cursor, transmitting transparent PNG, logical dimensions, and a top-left-origin hotspot. The client scales the image and hotspot using the remote primary display's logical size and local streaming-window dimensions. Current validation covers one primary display; multiple displays and differing scale combinations remain unverified.

The host advertises `LantoCursorShape=1`, and the client manifest includes `cursorShapeProtocol=1`. `/lantocursor?since=<id>` is registered only on the existing paired HTTPS service, validates the client certificate, and requires an active session. The client pins the host certificate, follows no redirects, and never falls back to unauthenticated HTTP. It checks about every 33ms and receives an image only when image or geometry changes.

Network requests and PNG decoding run on a separate thread; SDL events take only the newest shape, and mouse movement never waits for the network. The Mac coalesces main-thread sampling jobs, with HTTPS waiting at most 40ms to avoid blocking shutdown after the main loop exits. The protocol bounds response size, image dimensions, and hotspot coordinates. Invalid responses retain the previous shape without interrupting video. Losing focus or ending the session restores the default cursor and releases resources. Older hosts can still use the fixed arrow.

## Pinned sources

- Moonlight Qt `v6.2.0`: `de2467e433821664cdd2224aad8c89a625be1ad9`.
- [Sunshine PR #5817](https://github.com/LizardByte/Sunshine/pull/5817): `c95e1bacd6a867631ace23b7642f7d59b3700e56` in `andygrundman/Sunshine`; unmerged at investigation time.
- Moonlight Windows x64 dependency bundle `moonlight-qt-deps/v19`, SHA-256: `65ff1bd439222e1e2750054f960dcd6fac46190027da16db7403e345c295f10f`.
- Sunshine FFmpeg bundle `build-deps/v2026.1004.34232/Darwin-arm64-ffmpeg.tar.gz`, SHA-256: `44513e9d5492c8283dc6a723f69e92f6f1f190c272a64b91f5f3be25e3dfbff1`.

Both upstream repositories use GPL licenses. Patches follow their respective upstream licenses. Retain upstream licenses and dependency notices in builds.

The first public release ships the Windows Moonlight player. Its release page also provides matching Moonlight/dependency sources, the Qt source archive and packaging recipe, and license texts. The experimental macOS Sunshine app is source-only. See [licensing scope](../LICENSES.md).

## Windows build

Prepare MSVC x64, Windows SDK, and an MSVC Qt SDK. Upstream recommends Qt 6.11 or newer. This build initially used the already installed Qt 5.15.2 for compilation and real TLS/D3D11 streaming validation; keep that variable fixed in later performance comparisons.

Check out the pinned Moonlight commit, initialize all submodules, extract the verified v19 x64 package into `libs/windows`, and apply `patches/moonlight-local-cursor.patch`, `patches/moonlight-h264-sps.patch`, `patches/moonlight-cursor-shape.patch`, `patches/moonlight-audio-volume.patch`, `patches/moonlight-auto-pair.patch`, `patches/moonlight-locked-input.patch`, and `patches/moonlight-shared-switch.patch` in order. Then run:

```powershell
pwsh -File native/build-moonlight.ps1 -Source C:/build/moonlight-qt -QtBin C:/Qt/msvc_64/bin -Output C:/build/Moonlight-Lanto
```

The output directory must be new. The script copies `native/moonlight/` sources into upstream `app/streaming/lanto/`, builds, deploys dependencies, and writes the `lanto-media.json` capability manifest. That file describes features and is not a security signature. Select the output `Moonlight.exe` in Lanto's Moonlight executable setting. The current Windows default requires `lockedInputProtocol=1` and `sharedSwitchProtocol=1`. To use an unmodified player, disable both local cursor and **Switch only with shortcut**.

`complete-windows-runtime.ps1` inspects EXE/DLL imports with the installed MSVC tools and copies missing non-system runtime libraries from the selected Qt SDK and MSVC redistributable directory. Packaging must retain their licenses. The unused PDF image plugin is excluded because it can come from a separately versioned QtWebEngine package. Validate a prepared player with a minimal PATH so a developer environment cannot hide missing DLLs.

The build copies repository `assets/lanto-stream.svg` and `.ico` into the upstream working copy's icon resources for the window, taskbar, and executable. The asset shares the controller's geometry and uses a mist-blue background to distinguish remote video; it does not change application pairing identity. The Windows build with foreground protection is `Moonlight-Lanto-native-12`. Incremental builds also refresh Windows RC resources to avoid stale EXE icons.

## Automatic media pairing over SSH

`automatedPairProtocol=1` advertises one-time automatic pairing. Lanto sets `LANTO_AUTOMATED_PAIR=1` only for its own `pair` child process. Already paired clients exit successfully; new pairing success/failure emits fixed result markers and exits with 0/2. This mode does not wait for the original QML result dialog to close and does not print the PIN. Ordinary pairing without that variable retains its existing interface.

The build also deploys Qt `qoffscreen.dll`. Automatic pairing uses the offscreen platform and software Quick rendering; normal remote desktops retain ordinary windows and hardware video. Validation covered existing pairing reuse for three hosts and pairing a new portable client identity; temporary client authorization was then revoked. A real Mac HEVC stream received its first video packet after deployment.

The universal Mac clipboard helper is compiled from existing Swift source and merged for x86_64/arm64 by `scripts/build-mac-clipboard.mjs`. Generated source and binary hashes are verified during Host packaging. Installation in the private user cache preserves execution permissions and does not touch Screen Recording or Accessibility authorization databases.

## Switching input ownership

The Windows player advertises lockedInputProtocol=1. The controller supplies LANTO_INPUT_FILE and LANTO_CONTROLLER_PID only to its owned stream. A small atomic JSON file carries the virtual key, modifier mask, lock option, and selected system. SDL reads it on its event thread at most every 50 ms. Remote mode clips the mouse to the video and captures system keys; local mode releases capture and hides the window. Lock mode bypasses Moonlight's built-in combinations, reserving only the configured Lanto shortcut.

`sharedSwitchProtocol=1` adds `LANTO_SWITCH_MAP`: one randomly named shared-memory state between the native Windows keyboard helper and its players. The foreground player installs its switch hook after SDL's hook, so Alt/Ctrl edges remain visible before SDL consumes them. Local windows use the helper's hook. Each fresh reserved-key press increments one shared sequence, while its repeat and release are consumed across process handoffs. The helper sends ordered notifications over its owned stdout pipe. No time debounce discards rapid taps, and a held modifier remains available for the next tap. Hiding a player releases its captured keys and buttons. Original controller and helper process handles guard their lifetimes; failure disables input and hides streams. The original per-player stdout switch remains a compatibility path when shared switching is absent. Secure Windows desktop shortcuts remain OS-owned.

Build `native/tests/input-control-test.pro` with the same Qt/MSVC toolchain to check exact modifier matching, binding changes, local mode, invalid files, controller exit, and the legacy stdout notification without physical input injection. `node scripts/build-switch.mjs` builds the standalone helper and tests held modifiers, per-press edges, autorepeat, release after handoff, exact modifiers, and shared-memory continuity. It also builds an invisible media fixture for the two-process Electron smoke test; the fixture is excluded from release packages. Mouse confinement and physical desktop shortcut behavior still require interactive acceptance testing.

`foregroundGuardProtocol=1` keeps locked selection independent of foreground-window changes. The controller maintains topmost placement and restores the selected stream when an ordinary local popup steals focus; blur never selects the local system. The player keeps its switch hook alive across SDL focus loss without using the global `LockSetForegroundWindow` lock. Keyboard and mouse events are consumed while another process temporarily has focus, so they do not land in that local window; they are not replayed. An explicit switch grants controller activation before publishing the request. If direct activation fails, the controller temporarily attaches both the previous foreground queue and the target queue, activates the target, and detaches in reverse order; returning to the local controller uses the same path. Explicit local selection, unlocked mode, controller/broker loss, and process teardown release input protection. Windows secure desktop and privileged system overlays remain OS-owned. Regression coverage includes denied focus restoration, external activation while local, explicit return, and disabling the lock; real game and screenshot overlays require interactive acceptance.

For an opt-in Windows acceptance run, start the controller with `--remote-debugging-port=0`, connect two real streams, wait for their video, and run `node scripts/verify-live-switching.mjs --data-dir <controller-profile> --report <result.json>`. This advances 30 application switch requests through the broker, checks native visibility/focus, input ownership, selection, and unchanged process IDs, and reports activation latency. It does not inject physical keyboard/mouse events or establish video-frame latency. Avoid interacting with the controller while the test is cycling.

## Per-device stream volume

The native client manifest advertises `audioVolumeProtocol=1`. For each stream, the controller creates a separate randomly named local control file and passes it to its child process through `LANTO_VOLUME_FILE`. `LANTO_VOLUME` also supplies initial gain so muted devices stay muted from the first frame. The file contains only an integer from 0–100, is written using atomic replacement, and is removed after process exit. Volume and mute preferences remain separate device settings.

After audio initialization, the client starts a separate thread that reads the file every 50ms. The audio thread reads only an atomic integer and performs no disk access. Decoded Float32 or Int16 Opus PCM is scaled by percentage. Mute outputs zero samples while decoding continues; 100% preserves samples. This works with every host platform without modifying remote system volume. Lanto disables mute-on-focus-loss in startup arguments so users can return to the device card to adjust volume. Local cursor, encoder, and frame-queue behavior retain their configured settings.

The native test entry point is `native/tests/audio-volume-test.pro`, covering both PCM formats, mute, full amplitude, invalid input, live file changes, and thread exit. Hardware validation used a short Linux test tone and Windows audio-session peak readback; see [acceptance records](../docs/verification.md#device-volume-control).

## Mac build and deployment

Prepare Xcode, CMake, Ninja, Boost, pkgconf, curl, miniupnpc, Opus, OpenSSL 3, ICU, and Node. Check out the pinned Sunshine commit and initialize submodules. Apply these patches in order and extract the pinned FFmpeg package into a separate directory:

```bash
git apply /absolute/Lanto/native/patches/sunshine-local-cursor.patch
git apply /absolute/Lanto/native/patches/sunshine-sdk-compat.patch
git apply /absolute/Lanto/native/patches/sunshine-runtime.patch
git apply /absolute/Lanto/native/patches/sunshine-h264-sps.patch
git apply /absolute/Lanto/native/patches/sunshine-cursor-shape.patch
```

The SDK patch removes mappings for diagnostic constants missing from the local SDK. The runtime patch preserves the macOS main-thread event loop without a tray and prevents nullable ScreenCaptureKit failure reasons from crashing diagnostics.

```bash
LANTO_SIGNING_IDENTITY='<stable-local-code-signing-identity>' bash native/build-sunshine.sh /absolute/Sunshine /absolute/ffmpeg /absolute/LantoSunshineNative.app
```

The script copies `native/sunshine/` sources into upstream `src/platform/macos/`; it neither switches services nor reads authentication materials. The app uses the distinct identifier `dev.lanto.sunshine.native` and requires an explicitly supplied stable signing identity. This deployment used an existing local Developer ID and passed `codesign --verify --deep --strict`. Unlock the signing keychain in the same build session before signing. the local credential manager supplies the password without writing it to scripts or logs. First launch requires the user to grant Screen Recording, Accessibility, and any audio/network permissions used through the system interface.

Before signing, `bundle-macos-libraries.py` copies Homebrew dynamic libraries and transitive dependencies into `Contents/Frameworks`, rewrites them to app-relative paths, and retains dependency licenses. Versioned symbolic links such as ICU libraries resolve to real filenames. After copying, every non-system dependency must actually reside inside the app; unresolved dependencies stop packaging. Perform this only on a new staging app, then sign, verify, and deploy, avoiding changes to a running or already signed bundle. On 2026-10-16, six runtime libraries were bundled on the Mac and startup, HEVC, audio, and local cursor were verified. Everyday operation no longer depends on Homebrew installation paths; compilation still requires the development dependencies above.

When migrating from temporary signatures, TCC can retain requirements for the old binary. Logs in this case identified old signatures for `PostEvent` and `AudioCapture`; resetting only `Accessibility` or `ScreenCapture` did not remove them. Only after diagnosing the same problem, use official `tccutil reset PostEvent dev.lanto.sunshine.native` / `tccutil reset AudioCapture dev.lanto.sunshine.native`, have the user grant permission again in the system interface, and restart the app. Do not reset permissions on every build. See [Apple designated requirements](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html) for the role of stable signatures.

The H.264 fix is negotiated through host capability `LantoPreserveH264Sps=1`. Native VideoToolbox can use multiple reference frames, so the client must preserve the actual SPS. Moonlight's original compatibility rewrite reduces the reference-frame limit to one, conflicting with this bitstream. The patch skips rewriting only for hosts advertising that capability and renegotiates on every connection; ordinary hosts retain the original behavior. Negotiation is independent of local cursor mode.

Create a separate `0700` configuration directory for the experiment. Pairing state and certificates can be copied locally on the Mac from existing configuration with file mode `0600`; do not print them in the terminal or synchronize them to the repository. Test startup on another port first, then disconnect the controller, exit the old service, and switch to the normal port. Explicitly set `disable_vsync_macos = false` to avoid the private Quartz debugging API enabled by default in the upstream experimental branch.

## Acceptance and rollback

Build cursor parsing tests in a separate directory with the same Qt/MSVC environment using `qmake /absolute/Lanto/native/tests/cursor-frame-test.pro CONFIG+=release CONFIG-=debug`, then `nmake`, and run `LantoCursorTests.exe`. Tests cover transparency, dimensions, hotspots, and malformed/out-of-bounds responses; they do not replace real desktop shape validation. Windows Win32 readback of six cursor dimensions and hotspots matched scaled Mac samples, and the user confirmed correct shapes over text, links, and window edges.

Check both sides' logs for `Lanto local cursor`, the actual codec, received video packets, real input, and disconnect/reconnect behavior. A live process alone does not establish a working connection. Native encoding is not guaranteed to beat the existing path; compare the same animation, bitrate, codec, and sampling window.

TCC logs traced audio blocking and input rejection to old signature requirements. After permission migration and restart, input was granted, audio initialized, and the client received its first audio packet in about 400ms. Each of three disconnects was followed by a wait longer than the old watchdog's ten-second threshold. The watchdog did not terminate the service: two reconnects reused the process, and the last followed an intentional restart into a login-item-managed process. H.264 sessions with local cursor on and off no longer produced reference-frame, slice, or decoder-submission errors. A native HEVC session also connected after restart. Statistics mix static desktop and temporary animation windows over short samples, so they do not demonstrate sustained 60fps or cross-version performance comparisons.

Real input was validated in a dedicated AppKit window. Windows injected clicks, dragging, and scan-code keyboard events into foreground Moonlight; the Mac recorded two clicks, 16 drag events, and one key event. Only counts were stored, and the test window exited afterward. Complete Chinese input and game key mappings were not covered.

Rollback order: disconnect the local session, disable local cursor in Lanto, exit the experimental Mac app, start original Sunshine, and reconnect. The local `dev.lanto.sunshine` login item now points to the native app and its separate configuration. Its original backup is `~/.lanto/native-video/sunshine-stable-launchagent.plist`; restore and reload it for long-term rollback. The original Mac app and configuration are retained. launchd reload, application restart, and automatic startup/reconnection after a full Mac restart with automatic login have been verified; see [deployment records](../docs/mac-windows-deployment.md#unattended-startup-acceptance).
