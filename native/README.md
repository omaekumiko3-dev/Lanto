# Native media experiment components

The console still uses Electron／TypeScript. Pixel processing, cursor drawing, capture, and encoding remain in two native processes. This directory contains fixed-version small patches and build entry points; it does not contain the complete upstream source, prebuilt programs, pairing certificates, or runtime configuration.

Current acceptance conclusion: component builds and a real 2K60 video connection passed, but the Mac experimental branch still shows audio thread blocking and bitstream decoding errors, and the input permission probe did not pass. The experimental host has been exited and the stable version restored; the local cursor is disabled in the everyday configuration. The following content is for reproduction and future fixes; this combination cannot yet be used as the stable default.

## Responsibilities

| Module | Responsibilities |
| --- | --- |
| `src/main/native-profile.ts` | Maps settings to environment parameters for the current media subprocess; checks the client capability manifest before enabling the local cursor |
| Moonlight patch | Native SDL cursor; verify host capability; pass cursor mode in paired launch/resume requests |
| Sunshine cursor patch | Pass the mode to ScreenCaptureKit with the session to exclude the cursor from video; the next normal connection restores the remote cursor |
| Upstream PR #5817 | ScreenCaptureKit capture, native asynchronous VideoToolbox encoding |

The current local cursor is a fixed arrow, with no remote shape/hotspot synchronization yet. Cursor movement does not need to wait for the remote screen, but click results, window dragging, and text updates still go through the video link. The Mac test host allows one active media client to avoid mixing the two cursor modes when sharing a capture source. A normal controller can still connect, but the local cursor must be turned off.

## Fixed sources

- Moonlight Qt `v6.2.0`：`de2467e433821664cdd2224aad8c89a625be1ad9`。
- [Sunshine PR #5817](https://github.com/LizardByte/Sunshine/pull/5817)：`andygrundman/Sunshine` ’s `c95e1bacd6a867631ace23b7642f7d59b3700e56`; not merged at the time of investigation.
- Moonlight Windows x64 dependency package `moonlight-qt-deps/v19`，SHA-256：`65ff1bd439222e1e2750054f960dcd6fac46190027da16db7403e345c295f10f`。
- Sunshine FFmpeg package `build-deps/v2026.1004.34232/Darwin-arm64-ffmpeg.tar.gz`，SHA-256：`44513e9d5492c8283dc6a723f69e92f6f1f190c272a64b91f5f3be25e3dfbff1`。

Both upstream repositories use GPL; patches are used under their respective upstream licenses. Upstream licenses and dependency notices are retained during builds.

## Windows Builds

Prepare MSVC x64, Windows SDK, and the MSVC version of the Qt SDK. Upstream recommends Qt 6.11 or later; this run first used the existing local Qt 5.15.2 to compile and perform actual TLS／D3D11 streaming verification, and this is also a variable that needs to be fixed for subsequent performance comparisons.

Check out the Moonlight commit listed above, initialize all its submodules, and extract the verified v19 x64 package to `libs/windows`, the application `patches/moonlight-local-cursor.patch`, and then run:

```powershell
pwsh -File native/build-moonlight.ps1 -Source C:/build/moonlight-qt -QtBin C:/Qt/msvc_64/bin -Output C:/build/Moonlight-Lanto
```

The output directory must be new. The script compiles, deploys dependencies, and writes `lanto-media.json` capability manifest; this file only describes features and is not a security signature. In Lanto, select the output `Moonlight.exe`for «Moonlight executable». The capability manifest is not required when the local cursor is disabled by default; the original version can still be used.

## Mac build and deployment

Prepare Xcode, CMake, Ninja, Boost, pkgconf, curl, miniupnpc, Opus, OpenSSL 3, ICU, and Node. Check out the Sunshine commit listed above and initialize its submodules. Apply the following patches in order and extract the fixed FFmpeg package to a separate directory:

```bash
git apply /absolute/Lanto/native/patches/sunshine-local-cursor.patch
git apply /absolute/Lanto/native/patches/sunshine-sdk-compat.patch
git apply /absolute/Lanto/native/patches/sunshine-runtime.patch
```

The SDK patch removes diagnostic constant mappings missing from the local SDK; the runtime patch preserves the macOS main-thread event loop in trayless mode and prevents a nullable ScreenCaptureKit error reason from triggering a diagnostic crash.

```bash
bash native/build-sunshine.sh /absolute/Sunshine /absolute/ffmpeg /absolute/LantoSunshineNative.app
```

The script does not switch services or read authentication materials; the app uses a separate `dev.lanto.sunshine.native` identifier, and temporary local signing. On first launch, grant the Screen Recording, Accessibility, and audio/network permissions used through the system interface; an executable signed with a different temporary signature may need authorization again.

Create a separate `0700` configuration directory for the experimental version. Pairing state and certificates can be copied locally on the Mac from the existing configuration; set the files to `0600`. Do not print them in terminal output or sync them to the repository. First check startup on another port, then disconnect the controller, quit the original service, and switch to the production port. Explicitly set `disable_vsync_macos = false`to avoid using the private Quartz debug interface enabled by default in the upstream experimental branch.

## Acceptance and rollback

Check both endpoints’ logs for `Lanto local cursor`, the actual codec, received video packets, real input, and disconnect／reconnect; a live process alone does not mean the connection succeeded. Native encoding is not guaranteed to outperform the existing path; compare using the same animation, bitrate, codec, and sampling window.

The local no-tray event loop patch did not eliminate audio blocking and cannot be recorded as fixed. Screen Recording authorization worked after the user allowed it again; after Accessibility was added again, the experimental branch’s Post Event permission interface still returned a denial. It remains unclear whether this is due to the signing record or an upstream permission probe issue. Next, resolve these two issues on a side port before resuming real input and continuous reconnection acceptance, to avoid repeatedly interrupting everyday sessions.

Rollback order: disconnect the local session, disable the local cursor in Lanto, exit the experimental Mac app, start the original Sunshine, and reconnect. The original Mac app, configuration, and login startup item are all kept separately.
