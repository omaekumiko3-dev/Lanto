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

The companion Moonlight C++ client was compiled and deployed on Windows and completed a real streaming session. Sunshine PR #5817, with fixed source code and three patches, was compiled on Mac M2; the repository build script also independently completed the build and temporary-signature check. The patches applied successfully to clean source code in the order documented. The Mac backend uses ScreenCaptureKit and native VideoToolbox, while the client retains D3D11VA shared-device/direct-texture binding.

The device-independent subset of the upstream native tests ran 647 tests: 638 passed and 9 were skipped. Full hardware tests are affected by the SSH environment, permissions, and device context, and had 5 fixture setup/cleanup errors, so they cannot be recorded as a full-suite pass; CTest registered no tests, and the actual invocation was `tests/test_sunshine`No native code coverage was reported.

The first experimental stream received 2K60 video packets and negotiated a local cursor, but the audio thread blocked on disconnect, causing the watchdog to terminate the service. The main-thread event loop without a menu bar was then retained, and the ScreenCaptureKit nullable error diagnostic was fixed; the old screen recording signature record passed the official `tccutil` Only after resetting the experimental app did the user reauthorize it. This experience shows that successful process startup or encoder probing cannot replace reconnection validation. For the final real-device status, see[Deployment record](mac-windows-deployment.md)。

Retries with the patches still showed Core Audio blocking, decoding errors, and denial from the input permission probe, so stability acceptance did not pass. Stable Sunshine has now been restored and the local cursor disabled; HEVC video and the first audio packet were confirmed to be back. The experimental version was not set as the default login service.
