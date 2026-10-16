# Video Pipeline Performance Investigation

Date: 2026-10-16. Setup: Mac mini M2 → Windows RTX 3080, Sunshine 2026.914.233613, Moonlight 6.2.0.

## Responsibilities and goals

Lanto's Electron/TypeScript layer manages devices, authorization, settings, and media-process lifecycles. A separate native Moonlight process handles decoding, rendering, and input. Pixels never pass through the renderer, preload, IPC, or JavaScript arrays. The investigation aims to reduce actual input-to-display response while retaining native Alt + Tab and borderless fullscreen.

The experiments have separate responsibilities: a Mac animation supplies repeatable moving content; the Windows comparison runner starts media clients with fixed parameters and reads statistics after exit. Raw logs and desktop-related content stay in ignored directories; the repository stores only result summaries with device addresses removed. Normal Lanto-managed connections are restored afterward, without changing Sunshine accounts, certificates, or saved display parameters.

## Known measurements

One user-provided overlay screenshot reports HEVC, 2560×1440, 59.79fps; network latency 1ms with 0ms variance; 0% network and jitter frame loss; average decoding 0.29ms, frame queue 0.01ms, and rendering 0.17ms.

The three client timings total about 0.47ms, useful only for comparing scale. They are not end-to-end latency and cannot exclude spikes hidden by averages. The screenshot does not report host processing time. Host capture/encoding, remote application response, input transport, and physical display scanout still require separate measurement. [Moonlight statistic definitions](https://github.com/moonlight-stream/moonlight-docs/wiki/Frequently-Asked-Questions).

## Native implementation and rewrite boundaries

Moonlight already uses C/C++, FFmpeg, and D3D11VA for media. Current logs show RTX 3080, `bind` texture access, and a monitored fence. Its source supports directly binding decoder output textures, GPU fences between decoding and rendering devices, FLIP_DISCARD, and unsynchronized Present. Buffer count is not automatically an equivalent number of queued frames; do not force maximum frame latency to one without testing. [Pinned D3D11 source](https://github.com/moonlight-stream/moonlight-qt/blob/v6.2.0/app/streaming/video/ffmpeg-renderers/d3d11va.cpp), [Microsoft Flip Model guide](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/for-best-performance--use-dxgi-flip-model).

Rust can call the same Windows native APIs through windows-rs. Changing languages does not change the GPU video engine or display scan period. A custom C++ media process suits reuse of the existing native implementation; Rust suits new modules that need its memory safety and cross-platform control capabilities. Both must demonstrate benefits through measurement. [windows-rs](https://github.com/microsoft/windows-rs), [NVIDIA video hardware and SDK](https://developer.nvidia.com/video-codec-sdk).

## Host candidates

The installed Sunshine Mac backend still uses AVCaptureScreenInput. Its VideoToolbox path already includes real-time and low-latency settings; it must not be described as lacking hardware acceleration or all latency handling.

Upstream [PR #5817](https://github.com/LizardByte/Sunshine/pull/5817) introduces both ScreenCaptureKit and native VideoToolbox encoding. At investigation time it was open and unmerged, at head `c95e1bacd6a867631ace23b7642f7d59b3700e56`. Capture-only [PR #5511](https://github.com/LizardByte/Sunshine/pull/5511) was also unmerged. Latency numbers in upstream discussions describe other machines and cannot be applied to this setup. [macOS latency discussion](https://github.com/LizardByte/Sunshine/issues/5441).

Before maintaining a custom implementation, test fixed commits of these native backends. ScreenCaptureKit capture intervals, surface-pool depth, and asynchronous callbacks need separate design. Pool capacity is not fixed latency; do not copy an unverified queueDepth=1 setting. Apple's low-latency H.264 mode must not automatically be generalized to HEVC. [Apple ScreenCaptureKit](https://developer.apple.com/videos/play/wwdc2022/10155/), [Apple low-latency encoding](https://developer.apple.com/videos/play/wwdc2021/10158/).

## Comparison method

Use the same Mac animation, wired link, 2K60, and 20Mbps, with V-sync and frame pacing disabled. Compare default HEVC/D3D11, the experimental shared-device path with direct texture binding, H.264/D3D11, and a repeated baseline. Moonlight's post-exit whole-session averages provide a short screening comparison, not P95/P99 values or input-to-photon hardware measurements.

Official PresentMon 2.6.0 was also verified and attempted, with SHA-256 `b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af`. Starting ETW tracing in the current Windows session returned Access denied, so Independent Flip/DWM paths and DisplayLatency could not be confirmed. No user groups or privileges were changed. [PresentMon console documentation](https://github.com/GameTechDev/PresentMon/blob/v2.6.0/README-ConsoleApplication.md).

## Hardware comparison results

Each client process ran for 28 seconds including initialization, so its actual video measurement interval was shorter. Logs contain whole-session averages. The small Swift/AppKit window on the Mac only produces animation; it does not capture or encode. An animation-restart race affected the first shared-device sample in round two. That sample is retained and marked, and is not a fully controlled steady-state result.

| Round / path | Decode ms | Frame queue ms | Render ms | Render FPS | Network frame loss % | Jitter frame loss % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / HEVC default | 0.62 | 0.01 | 0.21 | 59.64 | 0 | 0.38 |
| 1 / HEVC shared device + direct binding | 0.44 | 0.01 | 0.07 | 59.91 | 0 | 0 |
| 1 / H.264 default | 0.64 | 0.01 | 0.20 | 58.92 | 1.57 | 0.24 |
| 1 / HEVC default repeat | 0.80 | 0.01 | 0.20 | 59.41 | 0 | 0.47 |
| 2 / HEVC shared device + direct binding (animation restart) | 1.04 | 0.01 | 0.08 | 61.55 | 0 | 0 |
| 2 / HEVC default | 0.47 | 0.01 | 0.19 | 60.00 | 0 | 0.16 |
| 2 / HEVC shared device + direct binding repeat | 0.53 | 0.01 | 0.07 | 60.13 | 0 | 0 |
| 2 / HEVC default repeat | 0.75 | 0.01 | 0.20 | 59.84 | 0 | 0.39 |

Field names follow Moonlight. Network and jitter frame loss are client classifications, not evidence of a physical-link fault. A short 61.55fps sample does not establish sustained output above 60Hz.

Shared-device rendering time was lower in all three samples, by about 0.11–0.14ms. Decoding varied substantially, with no demonstrated stable improvement or overall optimum. H.264 did not beat HEVC in this round and produced host IDR warnings, so it is not the current default. The experiment supports an optional pipeline, not a claim of substantial end-to-end acceleration. Screenshot and animation workloads differ, so their averages are not a direct before/after comparison.

See the [research snapshot](../research/performance-2026-10-16.json) for pinned commits and results with device addresses removed. The user screenshot and raw media logs are not committed.

## Implemented optional optimization

Settings now include Windows graphics pipeline, with new configurations still defaulting to Automatic. The experimental Shared device and textures option passes only `D3D11VA_FORCE_SEPARATE_DEVICES=0` and `D3D11VA_FORCE_BIND=1` to the Windows media child process, invoking the verified native Moonlight implementation. System environment variables are unchanged, and pixels remain in the native process and GPU.

The settings model stores an enum with backward compatibility; the media adapter maps it to fixed parameters, and the process wrapper passes and cleans them up. Results can differ with drivers, VRR, or high GPU load. If corruption or regressions appear, switch back to Automatic for the next connection.

The local Windows configuration has the shared-device experiment enabled, retaining 2K60, 20Mbps, response priority, and statistics. Actual logs confirm shared device, bind, D3D11VA, and HEVC. The user reported normal operation with more responsive control. This supports retaining the local choice, not a conclusion for all GPUs or a total-latency figure. Eighteen core tests and a real Electron smoke test passed. A new process-boundary check confirms rendering environment variables do not contaminate the parent process or later ordinary children.

## Retesting tools

Close any existing Lanto instance before running the developer tool. It reads saved devices and credentials without printing credentials. Device names must be unique; UUIDs are also accepted. Media processes run sequentially, and the normal connection with original settings is restored afterward.

```powershell
node scripts/performance/compare.mjs --device KumikoMac --seconds 28
node scripts/performance/compare.mjs --device KumikoMac --seconds 28 --repeat-shared
```

Raw data is written to ignored `test-results/performance/`. `scripts/performance/pattern.swift` compiles on the Mac as an AppKit test window and exits after 240 seconds. This run built it through KRU at `~/.lanto/perf/LantoPattern.app`. Confirm the animation is running before sampling and covers the entire interval. Standardize window motion, resolution, bitrate, network, overlay, and concurrent load to avoid the startup confound seen here.

## Technical route selection

| Route | Assessment and conditions |
| --- | --- |
| C++ Moonlight + D3D11VA + direct decoding textures | Current verified Windows media core; continue measuring synchronization, latency tails, and actual presentation mode |
| Experimental shared-device path | Lower average rendering time with a rollback option; no stable win in decoding or total latency |
| Vulkan/libplacebo, D3D12, or dedicated NVDEC implementation | No completed hardware comparison in this round; cannot rank as faster and may reuse the same video hardware with extra resource-interoperability cost |
| Rust console rewrite | The console handles no pixels, so there is no demonstrated performance benefit; Rust can serve new native control/measurement modules |
| C++/Objective-C++ Mac backend improvements | Worth further measurement; first review PR #5817's fixed commit and dependency boundaries, build alongside the current version, and compare before replacing it |
| Video embedded in Electron | A sharedTexture API exists, but Chromium compositing and synchronization still need measurement; retain a separate native window in this round |

The last four rows reflect source research and engineering judgment, not measured performance rankings. [NVDEC guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvdec-video-decoder-api-prog-guide/index.html), [Electron sharedTexture](https://www.electronjs.org/docs/latest/api/shared-texture).

## Next acceptance stage

Add timestamps for capture completion, encoding start/end, full-frame receipt, decoding completion, and Present. Record P50/P95/P99, stalls, and GPU contention. Monotonic clocks on different machines cannot be directly subtracted. Calibrate cross-machine frame age and record error; input-to-photon measurement requires high-speed recording or suitable measurement hardware.

Pin Mac backend commits and validate permissions, frame timestamps, bitstream recovery, audio/video, input, and reconnection. Five pooled surfaces do not imply five frames of fixed buffering. The current physical display source and client both report 60Hz; requesting 120fps alone does not prove 120 new desktop frames are produced.

If maintaining a native media process, prefer C++/moonlight-common-c reuse and existing hardware paths, with IPC carrying only commands and statistics. Presentation queues may discard stale decoded images, but compressed frames with reference dependencies cannot be discarded arbitrarily. Texture lifetimes must respect fences and decoder references. Expand rewrite scope only after repeatable improvements in latency tails and input-to-display response demonstrate value.

## Local cursor and native encoding implementation

The native route is now deployable. Pinned source, patches, and entry points are documented in [native/README.md](../native/README.md). Electron only saves the mode and passes environment parameters to the client it creates. Moonlight uses a native SDL cursor and negotiates the mode with the paired Sunshine session. Mac ScreenCaptureKit excludes the cursor from video per session. Disabling the experiment restores the remote cursor on the next ordinary connection.

Local movement no longer waits for a video round trip. This version uses a fixed arrow and does not synchronize remote cursor shape, hotspot, drag/drop hints, or software cursors. Interface changes after clicks still pass through capture, encoding, network, and display. Immediate local pointer movement therefore does not mean all end-to-end latency has disappeared.

The experimental Mac app coexists with the stable version, uses native asynchronous VideoToolbox, and prohibits software encoding. It uses no private Quartz V-sync debugging API. The custom Windows client uses the already installed Qt 5.15.2, a different toolchain from the original. The two paths have not yet been compared with the same animation, encoding format, and equally long sampling windows. Implementation and permission/reconnection tests do not prove native encoding is faster.

The subsequent v2 stability fix preserves the native H.264 bitstream SPS, preventing the client from incorrectly reducing its reference-frame limit to one. The Mac app uses a stable Developer ID, and migrated input/audio permissions were handled according to system logs. A real input probe and reconnecting after three disconnects passed; local cursor is currently enabled. See [verification records](verification.md#local-cursor-and-native-mac-backend) for details and test boundaries. Static desktops may reduce frame delivery; requesting 60fps does not mean every sampling window consistently contains 60 distinct frames.
