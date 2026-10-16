# Video Pipeline Performance Investigation

Date: 2026-10-16. Target: Mac mini M2 → Windows RTX 3080, Sunshine 2026.914.233613, Moonlight 6.2.0.

## Responsibilities and goals

Lanto’s Electron/TypeScript layer handles devices, authorization, settings, and media process lifecycle. Decoding, rendering, and input are handled by a separate native Moonlight process; pixels do not pass through the renderer, preload, IPC, or JavaScript arrays. The investigation aims to reduce the time from actual input to visible change while preserving native Alt + Tab and borderless fullscreen.

The experiment separates responsibilities: a test animation on the Mac provides repeatable motion; a Windows comparison program only launches the media client with fixed parameters and reads statistics after exit; raw logs and desktop-related content remain in an ignored directory, while the repository stores only a result summary with device addresses removed. After the experiment, restore the normal connection managed by Lanto without changing the Sunshine account, certificate, or user-saved display settings.

## Known data

The same overlay screenshot provided by the user: HEVC, 2560×1440, 59.79fps; network latency 1ms, variance 0ms, network dropped frames and jitter dropped frames both 0%; average decode 0.29ms, average frame queue 0.01ms, average render 0.17ms.

The sum of the three client timing values is about 0.47ms and is only for comparing orders of magnitude; it is not end-to-end latency and does not rule out spikes hidden by the averages. The screenshot does not report host processing time. Host capture/encoding, remote application response, input transport, and physical display scanout still require independent measurement.[Moonlight statistics definitions](https://github.com/moonlight-stream/moonlight-docs/wiki/Frequently-Asked-Questions)。

## Native implementation and rewrite boundaries

Moonlight’s media implementation already uses C/C++, FFmpeg, D3D11VA; current logs show RTX 3080,`bind` texture access, and a monitored fence. The source supports directly binding the decode output texture, a GPU fence between decode and render devices, and FLIP_DISCARD with non-synchronized Present. Buffer count cannot be treated directly as an equal-length queueing delay, and the maximum frame latency must not be forced to one frame without testing.[Fixed-version D3D11 source](https://github.com/moonlight-stream/moonlight-qt/blob/v6.2.0/app/streaming/video/ffmpeg-renderers/d3d11va.cpp)、[Microsoft Flip Model guide](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/for-best-performance--use-dxgi-flip-model)。

Rust can call the same native Windows APIs through windows-rs; changing the language does not change the GPU video engine or screen scan cycle. A custom C++ media process is suitable for reusing the existing native implementation; Rust is better suited to new modules that need its memory safety and cross-platform control capabilities. Both require measurements to demonstrate a benefit.[windows-rs](https://github.com/microsoft/windows-rs)、[NVIDIA video hardware and SDK](https://developer.nvidia.com/video-codec-sdk)。

## Host options

The installed Sunshine Mac backend still uses AVCaptureScreenInput. The existing VideoToolbox path already includes settings related to real-time and low latency, so it cannot be described as lacking hardware acceleration or as having no low-latency processing at all.

Upstream [PR #5817](https://github.com/LizardByte/Sunshine/pull/5817) Introduces ScreenCaptureKit and native VideoToolbox encoding at the same time; open and unmerged at the time of investigation, with head at `c95e1bacd6a867631ace23b7642f7d59b3700e56`. There is also one that changes only the capture direction, [PR #5511](https://github.com/LizardByte/Sunshine/pull/5511), also unmerged. Latency figures discussed in upstream issues are reports from other machines and cannot be applied to this machine.[macOS latency discussion](https://github.com/LizardByte/Sunshine/issues/5441)。

If making changes later, first test fixed commits of these native backends, then decide whether to maintain them independently. ScreenCaptureKit capture intervals, surface pool depth, and asynchronous callbacks need separate design; surface pool capacity does not equal fixed latency. Do not copy queueDepth=1 without validation. Apple’s VideoToolbox low-latency H.264 mode also cannot automatically be generalized to HEVC.[Apple ScreenCaptureKit](https://developer.apple.com/videos/play/wwdc2022/10155/)、[Apple low-latency encoding](https://developer.apple.com/videos/play/wwdc2021/10158/)。

## Comparison method

Use the same Mac test animation, wired connection, 2K60, 20Mbps, with V-sync and frame pacing waits disabled. Compare default HEVC/D3D11, the shared-device experimental path with direct texture binding, H.264/D3D11, then repeat the baseline. Statistics come from full-session averages after Moonlight exits and serve only as a short screening test; they do not represent P95/P99 or hardware measurement from input to photon.

Also verified and attempted the official PresentMon 2.6.0, SHA-256 `b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af`. Starting an ETW trace in the current Windows session returns Access denied, so the Independent Flip/DWM path or DisplayLatency cannot be confirmed; user groups were not changed and no elevation was used.[PresentMon console documentation](https://github.com/GameTechDev/PresentMon/blob/v2.6.0/README-ConsoleApplication.md)。

## Real-machine comparison results

Each client process ran for 28 seconds, including initialization, so the actual image measurement window was shorter; logs are full-session averages. The Mac Swift/AppKit small window only generated motion and did not capture or encode. The first shared-device sample in round two had an animation restart race; it is retained and labeled, and cannot be treated as a fully controlled steady-state result.

| Round / path | Decode ms | Frame queue ms | Render ms | Render FPS | Network dropped frames % | Jitter dropped frames % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / HEVC default | 0.62 | 0.01 | 0.21 | 59.64 | 0 | 0.38 |
| 1 / HEVC shared device + direct binding | 0.44 | 0.01 | 0.07 | 59.91 | 0 | 0 |
| 1 / H.264 default | 0.64 | 0.01 | 0.20 | 58.92 | 1.57 | 0.24 |
| 1 / HEVC default repeat | 0.80 | 0.01 | 0.20 | 59.41 | 0 | 0.47 |
| 2 / HEVC shared device + direct binding (animation restart) | 1.04 | 0.01 | 0.08 | 61.55 | 0 | 0 |
| 2 / HEVC default | 0.47 | 0.01 | 0.19 | 60.00 | 0 | 0.16 |
| 2 / HEVC shared device + direct binding repeat | 0.53 | 0.01 | 0.07 | 60.13 | 0 | 0 |
| 2 / HEVC default repeat | 0.75 | 0.01 | 0.20 | 59.84 | 0 | 0.39 |

Statistics fields retain Moonlight’s names. “Network dropped frames” and “jitter dropped frames” are client classifications and cannot establish a physical link fault. The short sample’s 61.55fps also cannot be interpreted as sustained output above 60Hz.

Shared-device render time was lower in all three samples, by about 0.11～0.14ms; decode varied noticeably, and no stable improvement or overall best result was established. H.264 did not outperform HEVC in this round, and the host also showed an IDR warning, so it is not the current default. The experiment supports adding an optional pipeline, but not claiming a significant end-to-end speedup. The screenshot and animation workload differ, so their averages cannot be directly compared before and after.

The fixed commit and results with device addresses removed are in[research snapshot](../research/performance-2026-10-16.json). The user screenshot and raw media logs were not committed.

## Optional optimization implemented

Settings now include “Windows graphics pipeline”; the new configuration still defaults to automatic. The experimental option “shared device and texture” passes `D3D11VA_FORCE_SEPARATE_DEVICES=0` and `D3D11VA_FORCE_BIND=1`to the Windows media subprocess and calls the verified native Moonlight implementation. It does not modify system environment variables; pixels remain in the native process and GPU.

The settings model saves the enum and remains compatible with old configurations; the media adapter maps it to fixed parameters, and the process wrapper handles passing and cleanup. Results may differ across drivers, VRR, and high GPU load. If artifacts or regressions occur, switch back to “Automatic”; the change takes effect on the next connection.

The shared-device experimental option is saved and enabled on this machine’s Windows system, retaining 2K60, 20Mbps, response priority, and statistics. Actual logs confirm shared device, bind, D3D11VA, and HEVC; the user confirmed, “Normal, controls feel more responsive.” This feedback supports keeping the local choice, but does not generalize to all GPUs or establish an overall latency figure. All 18 core tests and a real Electron smoke test passed; a new process boundary check confirmed that rendering environment parameters do not contaminate the parent process or subsequent ordinary subprocesses.

## Retest tool

First close any existing Lanto instance, then run the development tool. It reads the saved device and credentials without outputting credentials; the device name must be unique, or a UUID can be passed. Media processes run in sequence, then the normal connection with the original settings is restored.

```powershell
node scripts/performance/compare.mjs --device KumikoMac --seconds 28
node scripts/performance/compare.mjs --device KumikoMac --seconds 28 --repeat-shared
```

Raw data is written to the ignored `test-results/performance/`。`scripts/performance/pattern.swift` directory. On Mac, compile it as an AppKit test window that exits on its own after starting for 240 seconds; this time it was compiled with KRU as `~/.lanto/perf/LantoPattern.app`. Confirm that the animation is running before starting, and keep it running throughout the entire sampling period. Use consistent window motion, resolution, bitrate, network, overlay, and concurrent load to avoid mixing startup effects into this run.

## Technology direction

| Approach | Assessment and execution conditions |
| --- | --- |
| C++ Moonlight + D3D11VA + direct decode texture | Currently validated Windows media core; continue measuring synchronization, tail latency, and actual presentation mode |
| Shared-device experimental path | Lower render average and provides a rollback option; decode and overall latency did not consistently win |
| Vulkan/libplacebo, D3D12, or dedicated NVDEC implementation | No real-machine comparison was completed this round, so these cannot be ranked as faster; they may use the same video hardware and add resource interoperability costs |
| Rust console rewrite | The console does not process pixels, so there is no basis for a performance gain; Rust can be used for new native control/measurement modules |
| C++/Objective-C++ Mac backend improvements | Worth measuring further. First recheck the fixed commit and dependency boundaries of PR #5817, build alongside, compare, then consider replacement |
| Video embedded in Electron | A sharedTexture interface exists; Chromium composition and synchronization still need measurement. This round retains the separate native window |

The last four items are source investigation and engineering judgment, not a measured performance ranking.[NVDEC guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvdec-video-decoder-api-prog-guide/index.html)、[Electron sharedTexture](https://www.electronjs.org/docs/latest/api/shared-texture)。

## Next-stage acceptance

Add timestamps for capture complete, encoding start/end, frame received, decode complete, and Present; record P50/P95/P99, stutter, and GPU contention. Monotonic clocks on different machines cannot be directly subtracted; first calibrate cross-machine frame age and record the error. Input-to-photon requires high-speed photography or corresponding measurement hardware.

The Mac backend comparison should use fixed commits and verify permissions, frame timestamps, stream recovery, audio/video, input, and reconnection. Five surfaces in the pool do not equal a fixed buffer of five frames. The current physical display source and client report are both 60Hz; requesting 120fps alone does not prove that 120 new desktop frames were produced.

If maintaining a native media process independently, prioritize reusing C++/moonlight-common-c and the existing hardware path, with IPC carrying commands and statistics only. The presentation queue can discard decoded frames that have expired, but must not arbitrarily discard compressed frames with reference dependencies; texture lifetimes must be governed by fences and decode references. Expand the rewrite scope only after repeatable tail latency and input-to-image improvements demonstrate its value.
