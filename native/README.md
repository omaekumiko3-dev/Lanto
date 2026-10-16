# Native media experiment components

The console still uses Electron／TypeScript. Pixel processing, cursor drawing, capture, and encoding remain in two native processes. This directory contains fixed-version small patches and build entry points; it does not contain the complete upstream source, prebuilt programs, pairing certificates, or runtime configuration.

Current acceptance result: the H.264 SPS rewriting issue exposed in this run has been fixed, and the experiment application’s old signing authorization has been cleared and replaced with a stable Developer ID. Real video, audio, click／keyboard／drag input, and reconnection after three disconnects passed; the local cursor and native backend are enabled on this machine. This is an experimental component that has passed short-term acceptance; there is not yet a conclusion about long-term stability or end-to-end performance superiority.

## Responsibilities

| Module | Responsibilities |
| --- | --- |
| `src/main/native-profile.ts` | Maps settings to environment parameters for the current media subprocess; checks the client capability manifest before enabling the local cursor |
| `moonlight/cursor-frame.*` | Validates the cursor protocol, image dimensions, and hotspot, and decodes transparent PNG images |
| `moonlight/cursor-sync.*` | Retrieves shapes on a separate thread; the SDL thread creates, scales, and releases the local cursor |
| `sunshine/lanto_cursor.*` | Reads the system cursor and hotspot on the AppKit main thread and generates shape responses |
| Moonlight／Sunshine patches | Connects session, capability negotiation, and pairing HTTPS; ScreenCaptureKit excludes the cursor from video |
| Upstream PR #5817 | ScreenCaptureKit capture, native asynchronous VideoToolbox encoding |

Currently supports synchronization of Mac system cursor shapes and hotspots; arrow, text, link, horizontal／vertical resize, and actual window edges have been verified. Cursor movement does not need to wait for the remote image, but click results, window dragging, and text updates still travel through the video path. The Mac experiment host allows one active media client to avoid mixing the two cursor modes when sharing a capture source. Regular controllers can still connect, but the local cursor must be disabled.

## Cursor shape channel

Mac uses the public [`NSCursor.currentSystem`](https://developer.apple.com/documentation/appkit/nscursor/currentsystem) to read the current system cursor and transmit a transparent PNG, logical dimensions, and a hotspot with the top-left corner as origin. The client scales the image and hotspot based on the remote primary display’s logical dimensions and the local stream window size. The current verification environment has one primary display; multi-display setups and combinations with different scaling have not been accepted.

The host declares the capability through `LantoCursorShape=1` and the client manifest adds `cursorShapeProtocol=1`。`/lantocursor?since=<id>` It is registered only with the existing pairing HTTPS service, validates the client certificate, and requires an active session; the client pins the host certificate, does not follow redirects, and does not fall back to unauthenticated HTTP. It checks about every 33ms and returns an image only when the image or geometry information changes.

Network requests and PNG decoding run on a separate thread, while SDL events retrieve only the latest shape; mouse movement does not wait for the network. Mac combines sampling tasks on the main thread, and HTTPS waits at most 40ms to avoid blocking shutdown when the main loop exits. The protocol limits response, image, and hotspot ranges; an invalid response preserves the previous shape without interrupting video. The default cursor is restored and resources released when focus is lost or the session ends. The fixed arrow can still be used when connecting to an old host.

## Fixed sources

- Moonlight Qt `v6.2.0`：`de2467e433821664cdd2224aad8c89a625be1ad9`。
- [Sunshine PR #5817](https://github.com/LizardByte/Sunshine/pull/5817)：`andygrundman/Sunshine` ’s `c95e1bacd6a867631ace23b7642f7d59b3700e56`; not merged at the time of investigation.
- Moonlight Windows x64 dependency package `moonlight-qt-deps/v19`，SHA-256：`65ff1bd439222e1e2750054f960dcd6fac46190027da16db7403e345c295f10f`。
- Sunshine FFmpeg package `build-deps/v2026.1004.34232/Darwin-arm64-ffmpeg.tar.gz`，SHA-256：`44513e9d5492c8283dc6a723f69e92f6f1f190c272a64b91f5f3be25e3dfbff1`。

Both upstream repositories use GPL; patches are used under their respective upstream licenses. Upstream licenses and dependency notices are retained during builds.

## Windows Builds

Prepare MSVC x64, Windows SDK, and the MSVC version of the Qt SDK. Upstream recommends Qt 6.11 or later; this run first used the existing local Qt 5.15.2 to compile and perform actual TLS／D3D11 streaming verification, and this is also a variable that needs to be fixed for subsequent performance comparisons.

Check out the Moonlight commit listed above, initialize all its submodules, and extract the verified v19 x64 package to `libs/windows`, then apply, in order, `patches/moonlight-local-cursor.patch`、`patches/moonlight-h264-sps.patch` and `patches/moonlight-cursor-shape.patch`, and then run:

```powershell
pwsh -File native/build-moonlight.ps1 -Source C:/build/moonlight-qt -QtBin C:/Qt/msvc_64/bin -Output C:/build/Moonlight-Lanto
```

The output directory must be a new directory. The script copies the `native/moonlight/` source files into the upstream `app/streaming/lanto/`, compiles, deploys dependencies, and writes the `lanto-media.json` capability manifest; this file only describes features and is not a security signature. In Lanto, select the output `Moonlight.exe`for «Moonlight executable». The capability manifest is not required when the local cursor is disabled by default; the original version can still be used.

The build entry point copies the repository’s `assets/lanto-stream.svg` and `.ico` Copy the icon assets to the upstream working copy, then bundle them into the window, taskbar, and executable. These branded assets share a source with the mint green console icon and use purple to distinguish the remote screen; they do not change the app pairing identity. This machine currently uses `Moonlight-Lanto-native-4`。

## Mac build and deployment

Prepare Xcode, CMake, Ninja, Boost, pkgconf, curl, miniupnpc, Opus, OpenSSL 3, ICU, and Node. Check out the Sunshine commit listed above and initialize its submodules. Apply the following patches in order and extract the fixed FFmpeg package to a separate directory:

```bash
git apply /absolute/Lanto/native/patches/sunshine-local-cursor.patch
git apply /absolute/Lanto/native/patches/sunshine-sdk-compat.patch
git apply /absolute/Lanto/native/patches/sunshine-runtime.patch
git apply /absolute/Lanto/native/patches/sunshine-h264-sps.patch
git apply /absolute/Lanto/native/patches/sunshine-cursor-shape.patch
```

The SDK patch removes diagnostic constant mappings missing from the local SDK; the runtime patch preserves the macOS main-thread event loop in trayless mode and prevents a nullable ScreenCaptureKit error reason from triggering a diagnostic crash.

```bash
LANTO_SIGNING_IDENTITY='<Local stable code-signing identity>' bash native/build-sunshine.sh /absolute/Sunshine /absolute/ffmpeg /absolute/LantoSunshineNative.app
```

The script copies `native/sunshine/` source files into the upstream `src/platform/macos/`, without switching services or reading authentication material. The application uses a separate `dev.lanto.sunshine.native` identifier and requires a stable signing identity to be provided explicitly. This deployment used the existing local Developer ID and passed `codesign --verify --deep --strict`. Before signing, ensure the signing keychain is unlocked in the same build session; the password is injected through KRU and is not written to the script or logs. On first launch, grant screen recording, accessibility, and the audio／network permissions in use through the system interface.

Before signing,`bundle-macos-libraries.py` copies Homebrew dynamic libraries and their transitive dependencies into `Contents/Frameworks`, rewrites them to relative paths within the application, and retains dependency licenses. Versioned symlinks for libraries such as ICU resolve to the actual filenames; after copying, each non-system dependency is checked to confirm that it is inside the application, and packaging stops if a dependency is unresolved. This step is performed only on a newly created staging application, followed by signing, verification, and deployment, to avoid modifying the running application or damaging a signed package. On 2026-10-16, six runtime libraries were bundled on the Mac and startup, HEVC, audio, and local cursor were verified; daily operation no longer depends on the Homebrew installation directory, though the development dependencies above are still required for compilation.

During migration from temporary signing, TCC may retain requirements for the old binary. This run’s logs separately identified the old signatures of `PostEvent` and `AudioCapture` ; resetting only `Accessibility` or `ScreenCapture` did not clear them. Only if the same issue is confirmed through diagnosis, use the official `tccutil reset PostEvent dev.lanto.sunshine.native`／`tccutil reset AudioCapture dev.lanto.sunshine.native`, have the user allow access again in the system interface, and restart the application. Do not reset permissions on every build. See [Apple designated requirement documentation](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html)。

The H.264 fix has the host declare the capability through `LantoPreserveH264Sps=1` : native VideoToolbox can use multiple reference frames, so the client must preserve the actual SPS. Moonlight’s original compatibility rewrite reduces the reference frame limit to 1, which is incompatible with this bitstream. The patch skips rewriting only for hosts that declare the capability, with negotiation repeated on each connection; ordinary hosts retain the original logic. This negotiation is independent of the local cursor toggle.

Create a separate `0700` configuration directory for the experimental version. Pairing state and certificates can be copied locally on the Mac from the existing configuration; set the files to `0600`. Do not print them in terminal output or sync them to the repository. First check startup on another port, then disconnect the controller, quit the original service, and switch to the production port. Explicitly set `disable_vsync_macos = false`to avoid using the private Quartz debug interface enabled by default in the upstream experimental branch.

## Acceptance and rollback

Run the native cursor parsing tests in the same Qt／MSVC environment in a separate build directory using `qmake /absolute/Lanto/native/tests/cursor-frame-test.pro CONFIG+=release CONFIG-=debug`、`nmake`, then run the generated `LantoCursorTests.exe`. Tests cover transparency, dimensions, hotspots, and malformed／out-of-range responses; they do not replace verification of real desktop shapes. The six cursor sizes and hotspots read back through Windows Win32 matched Mac samples after scaling, and the user also confirmed that text, links, and window edge shapes change normally.

Check both endpoints’ logs for `Lanto local cursor`, the actual codec, received video packets, real input, and disconnect／reconnect; a live process alone does not mean the connection succeeded. Native encoding is not guaranteed to outperform the existing path; compare using the same animation, bitrate, codec, and sampling window.

This run’s audio blocking and input rejection were traced through TCC logs to old signing requirements; after authorization migration and restart, the input check changed to granted, audio initialization completed, and the client received its first audio packet in about 400ms. After each of three disconnects, the wait exceeded the old watchdog’s 10-second threshold: the service was not terminated by the watchdog, two reconnections reused the process directly, and the last followed a deliberate restart of the process managed by the login startup item. With H.264 local cursor both enabled and disabled, there were no further reference frame, slice, or decoder submission failures; after restarting, a native HEVC session was also established successfully. The statistics are short samples combining a mostly static desktop with a temporary animated window and cannot be taken as evidence of sustained 60fps or as a cross-version performance comparison.

Real input was verified in a dedicated AppKit test window: Windows injected clicks, dragging, and keyboard events with scan codes into the foreground Moonlight client, and the Mac window recorded 2 clicks, 16 drag updates, and 1 keystroke; the test saved counts only and the test window was closed afterward. Full Chinese text input and game key bindings have not been covered.

Rollback sequence: disconnect the local session, turn off the local cursor in Lanto, quit the experimental Mac application, start the original Sunshine, and reconnect. This machine has set the `dev.lanto.sunshine` login startup item to point to the native application and separate configuration; the original startup item backup is `~/.lanto/native-video/sunshine-stable-launchagent.plist`. For a permanent rollback, restore this file and reload the startup item. The original Mac application and configuration are retained. Reloading launchd, restarting the application, and automatic startup and reconnection after the entire Mac logged in automatically have been verified; see[Deployment record](../docs/mac-windows-deployment.md#unattended-startup-acceptance)。
