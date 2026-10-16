# Local Verification Record

Date: 2026-10-16. Environment: local Windows machine, Node.js 24.12.0, Electron 44.7.2. The record covers the Electron control side and the standalone Node.js Host.

| Check | Results |
| --- | --- |
| `npm run build` | Type checking and main/preload/renderer builds pass |
| `npm run host:build` | The standalone Node.js Host build passes, and the built CLI runs |
| `npm run format:check` | Passed |
| `npm test` | All 19 items passed |
| `npm run test:smoke` | Real Electron operations and loopback Host pairing passed under isolated configuration |
| npm dependency audit | Reported 0 known vulnerabilities after installation; this does not mean that no unknown issues exist |
| `git diff --check` | Passed |

Core tests cover saving and reloading configuration, preserving corrupted configuration, address/parameter validation, duplicate device IDs, Moonlight parameters, TCP probing, cleanup of real local subprocesses, switching order, returning during startup, abnormal exits, and preventing a replacement session after a stop failure.

Host tests cover real HTTPS, rejection of invalid certificates, rejection of unauthenticated requests, rejection of expired/replaced/replayed one-time credentials, token digest storage, authorization recovery and revocation, the local CLI management interface, discovery record validation, and systemd service file escaping. Check that the Host/protocol/common source code does not introduce Electron, React, or main modules.

The interface checks covered isolated preload, disabled Node integration, enabled sandbox, adding/editing/removing devices, input error prompts, saving settings, rollback of invalid shortcuts, and restoring configuration after quitting and restarting. Added loopback Host pairing, encryption and decryption using operating-system secure storage, ensuring the renderer does not receive tokens, restoring Host state after restart, and revoking authorization when a device is removed. Screenshots were written to `test-results/workbench.png` and `test-results/host-paired.png`, not included in Git.

Real component deployment from Windows → Mac has also been completed: the Node.js Host on Mac M2 runs via launchd, and the Windows control client completed real HTTPS pairing and status retrieval; independent Moonlight/Sunshine media pairing returned success. Screen recording permission was missing at first; after restarting the Mac, capture initialization passed; Lanto successfully initiated a Desktop session, and Sunshine recorded `CLIENT CONNECTED` and start HEVC VideoToolbox hardware encoding. The Windows first frame, actual input, and frame rate are still to be confirmed. See [Mac Deployment Record](mac-windows-deployment.md)。

Later, Windows → Mac was changed to 2K 60fps, prioritize responsiveness, and enable statistics. Client logs confirm `2560x1440x60`、RTX 3080 D3D11VA hardware decoding/rendering, with V-sync and frame pacing disabled; the server confirmed that the hardware encoding session was established. The user reported that the mouse, input, and dragging experience had “improved noticeably.” The new settings were saved through the actual interface and the connection was re-established; it was verified that the diagnostic file could still be written by the child process after the parent process closed the file handle. No end-to-end latency figures before and after optimization were recorded.

No connection was made to a real Linux1 machine, and no firewall, router, or NAS was modified. Cross device mDNS discovery and actual Linux systemd installation have not been accepted on site. There are no complete real world results for Chinese input compatibility, shortcut use in games, remote key release, stable frame rate, game frame time, or multi machine switching latency.

In addition, eight sets of real-media comparisons have been completed: shared-device and direct-decoded texture binding had lower average values in this rendering round; decoding has not yet consistently won. See[Performance Investigation](performance-investigation.md)Windows then enabled the experimental items on the local machine; the logs confirmed shared／bind／D3D11VA, and the user confirmed that the picture and input worked normally and felt more responsive. A new real subprocess check covers that the environment parameters apply only to the specified subprocess, without contaminating the parent process or subsequent ordinary subprocesses. PresentMon ETW capture was not completed due to insufficient current permissions; no physical-display or end-to-end latency was reported.

The next step is to connect the real Windows → Linux1 Sunshine/Moonlight link and run acceptance tests according to[Design document](design.md#Verification Phase), then expand media telemetry and warm up sessions.

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
