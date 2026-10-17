# Local Verification Record

Date: 2026-10-16. Environment: local Windows machine, Node.js 24.12.0, Electron 44.7.2. The record covers the Electron control side and the standalone Node.js Host.

| Check | Results |
| --- | --- |
| `npm run build` | Type checking and main/preload/renderer builds pass |
| `npm run host:build` | The standalone Node.js Host build passes, and the built CLI runs |
| `npm run format:check` | Passed |
| `npm test` | All 20 items passed |
| `npm run test:smoke` | Real Electron operations and loopback Host pairing passed under isolated configuration |
| npm dependency audit | Reported 0 known vulnerabilities after installation; this does not mean that no unknown issues exist |
| `git diff --check` | Passed |

Core tests cover saving and reloading configuration, preserving corrupted configuration, address/parameter validation, duplicate device IDs, Moonlight parameters, TCP probing, cleanup of real local subprocesses, switching order, returning during startup, abnormal exits, and preventing a replacement session after a stop failure.

Host tests cover real HTTPS, rejection of invalid certificates, rejection of unauthenticated requests, rejection of expired/replaced/replayed one-time credentials, token digest storage, authorization recovery and revocation, the local CLI management interface, discovery record validation, and systemd service file escaping. Check that the Host/protocol/common source code does not introduce Electron, React, or main modules.

The interface checks covered isolated preload, disabled Node integration, enabled sandbox, adding/editing/removing devices, input error prompts, saving settings, rollback of invalid shortcuts, and restoring configuration after quitting and restarting. Added loopback Host pairing, encryption and decryption using operating-system secure storage, ensuring the renderer does not receive tokens, restoring Host state after restart, and revoking authorization when a device is removed. Screenshots were written to `test-results/workbench.png` and `test-results/host-paired.png`, not included in Git.

Real component deployment from Windows → Mac has also been completed: the Node.js Host on Mac M2 runs via launchd, and the Windows control client completed real HTTPS pairing and status retrieval; independent Moonlight/Sunshine media pairing returned success. Screen recording permission was missing at first; after restarting the Mac, capture initialization passed; Lanto successfully initiated a Desktop session, and Sunshine recorded `CLIENT CONNECTED` and start HEVC VideoToolbox hardware encoding. The Windows first frame, actual input, and frame rate are still to be confirmed. See [Mac Deployment Record](mac-windows-deployment.md)。

Later, Windows → Mac was changed to 2K 60fps, prioritize responsiveness, and enable statistics. Client logs confirm `2560x1440x60`、RTX 3080 D3D11VA hardware decoding/rendering, with V-sync and frame pacing disabled; the server confirmed that the hardware encoding session was established. The user reported that the mouse, input, and dragging experience had “improved noticeably.” The new settings were saved through the actual interface and the connection was re-established; it was verified that the diagnostic file could still be written by the child process after the parent process closed the file handle. No end-to-end latency figures before and after optimization were recorded.

At this early stage, it was not yet connected to the real Linux1; see the Linux records at the end of this document for the later on-site acceptance. No firewall, router, or NAS settings were changed. There are still no complete hands-on test results for cross-device mDNS discovery, shortcut availability in games, key release after an unexpected remote disconnection, sustained frame rate, game frame time, or multi-machine switching latency.

In addition, eight sets of real-media comparisons have been completed: shared-device and direct-decoded texture binding had lower average values in this rendering round; decoding has not yet consistently won. See[Performance Investigation](performance-investigation.md)Windows then enabled the experimental items on the local machine; the logs confirmed shared／bind／D3D11VA, and the user confirmed that the picture and input worked normally and felt more responsive. A new real subprocess check covers that the environment parameters apply only to the specified subprocess, without contaminating the parent process or subsequent ordinary subprocesses. PresentMon ETW capture was not completed due to insufficient current permissions; no physical-display or end-to-end latency was reported.

The real Sunshine／Moonlight base link from Windows to Linux1 was completed later; continue according to[Design document](design.md#Verification Phase)Verify the agent, NAS, media telemetry, and warmed-up session.

## Local Cursor and Mac Native Backend

New checks cover the client capability manifest, rejecting the local cursor when protocol versions mismatch or are corrupted, continued operation of older clients in normal mode, and platform boundaries for Windows graphics environment parameters. A real Electron smoke check verifies saving the local cursor setting; the test uses a dedicated shortcut so it can coexist with the daily control client while running. Type checking, build, and formatting checks passed.

The companion Moonlight C++ client has been compiled and deployed on Windows, and completed a real streaming session. The Sunshine PR #5817 pinned source and patch have been compiled on Mac M2; the initial build used a temporary signature, while the current v2 uses a stable Developer ID and passed strict signature verification. The patch applied in the documented order to clean source passed. The Mac backend uses ScreenCaptureKit and native VideoToolbox, while the client retains D3D11VA shared device/direct texture binding.

The device-independent subset of the upstream native tests ran 647 tests: 638 passed and 9 were skipped. Full hardware tests are affected by the SSH environment, permissions, and device context, and had 5 fixture setup/cleanup errors, so they cannot be recorded as a full-suite pass; CTest registered no tests, and the actual invocation was `tests/test_sunshine`No native code coverage was reported.

The first experimental stream received 2K60 video packets and negotiated a local cursor, but the audio thread blocked on disconnect, causing the watchdog to terminate the service. The main-thread event loop without a menu bar was then retained, and the ScreenCaptureKit nullable error diagnostic was fixed; the old screen recording signature record passed the official `tccutil` Only after resetting the experimental app did the user reauthorize it. This experience shows that successful process startup or encoder probing cannot replace reconnection validation. For the final real-device status, see[Deployment record](mac-windows-deployment.md)。

Subsequently identified and fixed two root causes: the client incorrectly reduced the H.264 SPS reference frame limit based on host capability; during stable-signature migration, clean up `PostEvent`／`AudioCapture` the old requirements, and, after user authorization and a restart, restore input and system audio. The tray event loop patch itself did not resolve the permission block and must not be conflated with the same fix.

v2 real-device regression: the stable Sunshine standard mode is `preserve SPS=false`; for the two modes of the native H.264 local cursor, on and off, both are `preserve SPS=true`, received the first video and audio packets, and did not show the original reference-frame/slice/decoder-submission errors. After each of the three ended native sessions, we waited 12 seconds and the Mac service remained alive; two reconnected directly, and the third reconnected after an active launchd restart. Authorization was retained, and native HEVC audio and video were received. The current session keeps the local cursor enabled.

A real end-to-end input probe was run through a dedicated window: mouse clicks and drags, along with keyboard events carrying scan codes, were injected into the foreground Windows Moonlight session. The Mac AppKit window recorded 2 clicks, 16 drags, and 1 keystroke. The probe did not save text content and was exited afterward. This check confirms that events were delivered; it does not mean that Chinese input, all keyboard shortcuts, or long-term interaction have been fully verified.

Build script validation includes PowerShell parsing, Bash syntax, rejection of temporary signing, incremental patch application, and `git diff --check`. This native fix did not modify the controller TypeScript, and uses the existing test results in the table above; validation of the subsequent UI update is in the next section. This round did not measure native coverage, sustained 60fps, long-term stability, or end-to-end latency; log averages for mixed static desktops and animations are not used for performance rankings.

## Compact Window and Icon Updates

Change the control device to a 900×620 window without a system title bar, with a minimum size of 680×480. Add an icon, window buttons, and a bottom session bar; remove the decorative preview, duplicate navigation, preparation checklist, and persistent activity log. Move the graphics pipeline, media paths, and statistics into advanced settings. Window actions continue to run through IPC after validating the source; arbitrary window or Electron APIs are not exposed.

All 19 tests passed in this rerun, and type checking, the production build, and a real Electron smoke test passed. The smoke test added checks for sizing without the system title bar, the drag and button areas, rejection by the window-action allowlist, settings scrolling and bottom-button accessibility at the minimum size, and whether the close button actually exits the app; existing coverage for pairing, add/edit/delete, and error validation remains. Found and fixed an issue where an error message obscured a dialog button. The actual visible window was also checked for minimizing, maximizing, and restoring.

The console window icon, desktop shortcut, and window/executable icons for the native v3 media client have been replaced. Checked by retrieving the icons of the two running windows through Win32; PNG, SVG, and multi-size ICO resources are in the repository, and the screenshots are in the ignored `test-results/`. v3 uses the same media patch; reconnecting the real Mac retained the local cursor and HEVC/D3D11VA, and the first audio and video packets were received. The Mac application binary was not modified, and system authorization was not requested again.


## Device Connection Toggle and Online Editing

The upper-right corner of the device card is now a keyboard-operable connection toggle; the bottom session bar and separate Back button have been removed. Devices that are connecting can be renamed and their settings saved; the name appears immediately, while media parameters take effect on the next connection. The current device cannot be removed until disconnected. Paired devices now support editing their address; the system type is still managed by the pairing identity, and re-pairing preserves the user’s name.

All 19 tests, type checking, production build, formatting checks, and Electron smoke tests passed. The new smoke test uses an isolated configuration and a real local subprocess, covering connection/disconnection and device switching via the toggle, Space key operation, renaming while connected and saving parameters without changing the PID, refusing to remove the current device, reading new parameters on the next launch, and automatically turning off the toggle and allowing reconnection after an abnormal client exit. This subprocess test does not constitute network streaming acceptance.

The local program was restarted, and a real connection was established using the new switch on the KumikoMac card. Logs confirm 2560×1440, 60fps, HEVC, D3D11VA, the local cursor enabled, and receipt of the first video and audio packets. Manual inspection of a screenshot from the control end confirmed that it showed only the real Mac card, the sliding switch in the upper-right corner, and the available edit entry point.

## Mac Cursor Shape and Hotspot Synchronization

Moonlight v4 and the Mac Objective-C++ cursor module have both completed native compilation. Qt parsing tests passed, covering PNG transparency, logical dimensions, fractional hotspots, protocol versions, status codes, duplicate fields, malformed XML/hexadecimal, and size and response limits. The Mac uses the same Developer ID and specified signing requirements as the previous version; strict signature verification passed, and system authorization was not reset.

The real AppKit test window provides arrow, I-beam, hand, and horizontal/vertical resize regions, and also checks the actual right edge of the window. On Windows, Win32 reads the cursor pixels, size, and hotspot of the running media window: the pixel summaries for all six shapes are distinct, and the sizes and hotspots match the Mac samples scaled by 1.5 and rounded. For example, the text cursor is 35×33, and its hotspot (18,17), horizontally scaled to 45×36, hotspot (23,18). The user then confirmed that the window edges, text area, and links ”all change normally.” The test window has been closed.

Unpaired HTTPS cursor requests were rejected by TLS; the same path over HTTP returned XML `status_code=404`, cursor contents were not exposed. The final build changed AppKit sampling to a merged task with bounded waiting to avoid blocking HTTPS as the main thread exits; after restarting, the real HEVC session was restored, the local cursor was enabled, and system audio and Opus initialized normally. Performance statistics remain disabled. This round did not establish conclusions about end-to-end latency, long-running operation, or multi-display compatibility; the automatic focus-switch check was aborted because the user changed focus and was not counted as a pass.

This round again passed 19 control-side tests, type checking, production build, formatting checks, and a real Electron smoke test. Patches for both platforms applied in document order to clean source at the fixed version passed. PowerShell/Bash build script syntax and diff whitespace checks passed.

## Full Mac Restart and Automatic Login

On 2026-10-16, two full-system restarts were completed. The first confirmed that the existing LaunchAgent starts automatically after the user logs in. Then, with the user’s explicit authorization, FileVault was turned off, and the system tools were used in a GUI session to configure automatic login. The second restart’s boot time was 12:09:14 (Asia/Shanghai); no further user login or manual application launch was requested, and the target user’s desktop, Host, native Sunshine, and KRU all recovered automatically. Windows reconnected using the existing pairing, and the host logs confirmed HEVC 2560×1440, local cursor, and system audio initialization. Media components were not recompiled or modified this time, and screen recording/accessibility permissions were not requested again.

Startup items and disk were inspected read-only at the same time; no files were deleted and no other apps were disabled. System swap space released about 10.7 GB after restart. The final observed built-in APFS capacity was about 245.1 GB, with 93.6 GB used and 151.5 GB remaining; these values change during operation. Storage details are saved in the local ignored directory `work/maintenance/mac-2026-10-16.html`, do not submit a personal project list.

## Change the IP of a paired device

Remove the read-only restriction on the paired device address input field, and save the management and streaming addresses in sync, while retaining the device identity and operating system restrictions. All 20 tests, type checking, production build, and Electron smoke test passed. Added real TLS tests covering address migration, continued token availability after restart, and rejection of a different certificate at the new address.

Isolated Electron tests cover the editable address, field-by-field preservation of the certificate and encrypted token after saving, fallback when writing the configuration fails, repair at startup when the two configurations are inconsistent, and an unchanged current session PID with the next streaming session using the new address. The tests used a loopback address and isolated configuration; they did not change the user’s Mac network configuration or the actual saved address. The screenshot of the editing interface is local `test-results/edit-host-address.png`。

## Linux Physical Machine Deployment and Restart

Installed the official stable Sunshine and standalone Node.js Host on Ubuntu 26.04.1／RTX 3080; both user services were actually enabled. Completed two pairings from Windows. HEVC 2K60, the first audio packet, clicking, dragging, and keyboard input all passed; within the same GNOME Wayland session, the GTK text field received “Chinese input test” via remote Pinyin input. After one full-system reboot, automatic login, Host, Sunshine, and existing pairings all recovered; audio and video were received again, and Chinese input was verified. See [Linux Deployment Record](linux-windows-deployment.md)。

The controller limits the local cursor protocol by device platform; Linux／Windows automatically use the remote cursor, while the Mac preference is preserved. All 20 tests, type checking, production build, format checking, and isolated Electron smoke test passed; native environment tests confirmed that Linux／Windows do not reject ordinary clients because of the Mac local cursor preference. The runtime directory packaging script and Linux user service installer added for this deployment were used in this deployment; the runtime package contains no Electron, full repository, or identity data.

## Device Volume Control

On 2026-10-17, independent 0–100% volume and mute controls were added to device cards; existing devices default to 100% volume and unmuted. Muting preserves the original volume. Settings made before connecting take effect on the first audio frame, and changes made during a connection update the native PCM gain through a control file unique to each session. Audio continues playing when returning to the device list.

23 tests, type checking, production build, and Electron smoke test passed. Coverage includes migration from old configuration, rejection of out-of-range values, isolation across devices, continuous sliding and keyboard adjustment, mute recovery, initial mute on connection, retaining settings after renaming / reconnecting / restarting the app, and falling back to the current gain when saving to disk fails. Interface screenshots at 680×480 and 900×620 were manually inspected. Qt native tests verify Int16 and Float32 PCM, unchanged output at 100%, silence for zero samples, invalid control data, real-time atomic replacement, and thread exit.

The local machine was updated to native client v5, retaining the existing streaming pairing. A real Linux session used HEVC 2560×1440, 60fps, and the existing D3D11VA pipeline; the first audio packet arrived after about 400ms. Low-amplitude test audio was played in a Linux desktop session through PipeWire, and the peak of that Moonlight process’s audio session was read on Windows. The measurement was:

| Card settings | Windows audio session average peak |
| --- | ---: |
| 100% | 0.0250318 |
| 50% | 0.0125154 |
| 25% | 0.0062579 |
| Mute | 0 |
| Unmute and restore to 25% | 0.0062580 |

This result verifies that the actual output gain changes with the card; it does not mean perceived loudness is linear. The test tone has stopped; everyday volume and diagnostic settings have been restored, and the remote system volume and service were not changed.

## Windows controlled-device deployment

On 2026-10-17, the official stable Sunshine MSI, a standalone Node.js Host, and a LOCAL SERVICE startup task were installed on Windows 11 Pro / RTX 3080, and pairing was completed for both Host and Sunshine. The Windows control endpoint displayed a real 2560×1440 HEVC desktop, the first video packet arrived in about 300ms, and D3D11VA decoding succeeded; a short animated-scene sample measured 59.66/60.17fps, network latency was about 1ms, and network frame loss was 0%. Low-level test audio played in the existing remote console session; only this Moonlight process’s WASAPI audio session was read locally, with an average peak `0.00300045`, confirming actual audio output.

After rerunning the Windows installer, the identity and authorization file hashes remain unchanged, and the Host is usable again; check the startup trigger, LOCAL SERVICE account, failure retries, absence of a runtime limit, and private file ACLs. After restarting the Sunshine service, the existing media pairing can still be read through the authenticated applications list endpoint for Desktop/Steam Big Picture. The firewall entries for both Host and Sunshine are restricted to the local subnet; the machine was not rebooted.

Foreground input testing passed: clicks, drags, and scancode keyboard events were sent from Moonlight, and the window in the same remote console session recorded 1 click and 128 drag updates; English `lanto123` Character-for-character match; remote Pinyin input produced “Chinese input test,” matching character for character across 6 characters. After actively disconnecting and reconnecting, the original window and text were retained; the animation sample was 59.89fps; the new client audio session had an average peak `0.00300156`. The temporary test window and audio task have been deleted, and performance statistics have been turned off again. Whole-machine reboot, game Raw Input, controller, and long-term stability have not been accepted; see [Windows Deployment Record](windows-windows-deployment.md)。

The 23 core tests in this run, Host TypeScript build, formatting checks, PowerShell parsing, and diff whitespace checks passed. No changes were made to the controller UI or native player code, and no unit tests duplicating existing implementation logic were added; first-time installation, repeated execution, real service recovery, and permission checks for the Windows installer were all completed on the target machine.

## Actual Volume Regression on Three Hosts

On 2026-10-17, at the user’s request, connected to KumikoMac, KumikoLinux, and KumikoWindows one by one. Played a low-level test tone in each host’s existing desktop session, operated the slider and mute button on the device card, and read the corresponding Moonlight process’s WASAPI audio session peak on the controller. Using each machine’s stable 100% output as the baseline, the results are as follows; the percentages indicate the PCM peak ratio, not perceived loudness.

| Host | Measured output with 50% configured | Measured output at the 25% setting | zero volume/muted | Unmuting returns to 25% | 37% restored after reconnection |
| --- | ---: | ---: | --- | ---: | ---: |
| macOS | 50.00% | 25.01% | are all 0 | 24.98% | 36.97% |
| Linux | 50.00% | 25.00% | are all 0 | 25.00% | 37.01% |
| Windows | 50.00% | 25.00% | are all 0 | 25.00% | 36.99% |

All three devices completed 100% → 50% → 25% → 0% → 25% muted → unmuted, then disconnected and reconnected with the setting at 37% and muted. The initial output on the new stream remained at 0, and after unmuting it returned to 37%. The client PID remained unchanged during real-time adjustment, and the volume and mute values saved on the other devices each remained unchanged. Then different values of 23% / 47% / 71% and mixed mute states were saved for the three devices, Lanto was actually exited and restarted, and all three device configurations were retained.

For sampling, first wait for the sound to stabilize, then use the median of three 100% readings as the baseline. Readings during the Mac’s initial connection transition were unstable and were not counted as passing results. On Windows, the test tone was started after Sunshine switched to virtual audio output, which produced a stable baseline; the two readings from test sources started before the switch were likewise not counted. The first Linux authentication connection timed out; restarting Sunshine restored it, and subsequent volume and reconnection checks passed. The cause of that connection timeout has not yet been identified, so this does not support a claim that long-term connection stability has been verified.

Before the final recovery test on all three machines, volume was at 100%／unmuted, and performance statistics collection was turned off again; temporary test audio, playback processes, and Windows scheduled tasks were cleaned up, while all media services remain running. This round did not modify the application or native player implementation; this was an acceptance test of sound, state persistence, and device isolation on three real hosts, and does not use the slider’s displayed value as a substitute for actual audio measurement.

## Shared clipboard, files, and playback behavior across all three platforms

2026-10-17: Added separate shared clipboard and file switches. All three Hosts have been updated and use their existing identities/pairings. Using Mac, Linux, and Windows as the respective sources, Unicode text and Chinese filenames were sent to all endpoints; the content SHA-256 matched. PNG images were also compared by digest across all four endpoints. Files larger than 4 GiB, Chinese-named files, zero-byte files, and empty directories were actually sent to all three hosts, and all checks passed. For the actual behavior when switches are turned off and when canceled midway, implementation boundaries, and the results of copying again after the first Windows TLS interruption, see[Shared clipboard verification](clipboard-sync.md#2026-10-17-hardware-verification)。

Add connection parameters `--audio-on-host`, preserving normal audio playback on the target machine while also sending the same sound to the control device. Connected to three hosts individually and played a low-volume test sound:

| Host | target device during streaming | Average peak of the control-side Moonlight audio session |
| --- | --- | ---: |
| macOS | The default remains the Mac mini speakers, volume at 50%, unmuted | 0.00502146 |
| Linux | Keep the default physical ALC897 digital output at 40%; the player output and Sunshine capture use the monitor of the same physical device | 0.00502088 |
| Windows | The default output is Redmi Computer Speakers, and the physical endpoint peak remains nonzero | 0.13987496 |

At the time, other content was actually playing on Windows, so the peak was not the amplitude of a single test tone and cannot be compared in loudness with the other two machines. These checks confirmed that the target device’s physical audio path was not replaced or muted by streaming, and that the control end also received sound; sound from the client side alone was not used as a substitute for checking the target end. The test tone and temporary task were cleaned up, and the system volume on all three machines was left unchanged.

Add a “Show Performance Data” toggle at the top of the Settings page. After actually turning it on in the interface and starting a Mac session, the client process uses `--performance-overlay`; after closing, reconnect to explicitly use `--no-performance-overlay`, to avoid inheriting Moonlight’s old preferences. Both times also carried `--audio-on-host`。Saved preferences persist after the control end exits and restarts; current performance statistics are off, and both sharing switches are on.

All 30 core tests, type checking, production build, Host build, formatting checks, PowerShell installer parsing and actual repeated installation, and real Electron smoke tests passed. Tests covered authentication, TLS uploads and downloads and verification, manifest traversal and duplicate names, oversized file metadata, source file changes, queued task invalidation after close, duplicate event suppression, and forwarding on all three platforms. The remote test copy of about 20 GiB, temporary clipboard component, and audio task have been cleaned up; the formal Host and desktop tasks continue running. Deletion of the local large-file test source and small-file cache was denied by execution policy; they remain in ignored work/cache directories and are not included in the commit.

## Unified Interface, Top Quick Toggles, and Brand Update

2026-10-17 Referencing the layout, color, and interaction principles of shadcn/ui, Radix Themes/Select, and Headless UI, completed the graphite gray/mist blue theme. See for the research sources and the tradeoffs between the two local brand logos[Interface and Brand Guidelines](design-system.md). Shared clipboard and performance data have been moved to the top of the device page; file sharing, progress, cancellation, and the receiving directory are now inside the clipboard pop-up, and the original bottom status bar has been removed.

`npm run build`、`npm run format:check`, 30 core tests, a real Electron smoke test, and `git diff --check` Passed. The smoke test added saving the top-level toggle, file-toggle dependencies, restoring preferences after restart, closing the Popover with Esc, keyboard selection in the native dropdown, Esc closing the menu before closing settings, Tab/Shift+Tab focus cycling, and returning focus after closing. The test configuration uses a separate hotkey to avoid contention with the control endpoint running daily.

Manually inspected screenshots of the main interface, settings, menus, and clipboard popover at 900×620 and the minimum size of 680×480. No horizontal overflow appeared; the buttons at the bottom of Settings remained visible, the native menu was not clipped by the scroll area, and the Popover closed when clicking outside it or pressing Esc. Icons were generated as 16–256px ICO and 256px PNG files, and the 32px icon was actually extracted from the new player EXE through the Windows API to confirm that the new graphic was embedded.

Found that qmake’s incremental resource dependencies included only the generated RC file and did not track ICO updates; updated the build script to refresh the RC timestamp and verified that Windows resources were recompiled. The new native client build passed; the cursor, H.264 SPS, and volume protocol identifiers remain unchanged; the media processing implementation was not modified in this round.

After the user confirms, disconnect the original Windows session and restart the everyday control client, using the new interface and `Moonlight-Lanto-native-7`After saving, the devices and settings were compared item by item; only the player path changed. All three clipboard endpoints returned to ready, shared clipboard/files remained enabled, and performance data remained disabled.
