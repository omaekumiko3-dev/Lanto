# Local Verification Record

Date: 2026-10-16. Environment: local Windows machine, Node.js 24.12.0, Electron 44.7.2. The record covers the Electron control side and the standalone Node.js Host.

| Check | Results |
| --- | --- |
| `npm run build` | Type checking and main/preload/renderer builds pass |
| `npm run host:build` | The standalone Node.js Host build passes, and the built CLI runs |
| `npm run format:check` | Passed |
| `npm test` | All 17 items passed |
| `npm run test:smoke` | Real Electron operations and loopback Host pairing passed under isolated configuration |
| npm dependency audit | Reported 0 known vulnerabilities after installation; this does not mean that no unknown issues exist |
| `git diff --check` | Passed |

Core tests cover saving and reloading configuration, preserving corrupted configuration, address/parameter validation, duplicate device IDs, Moonlight parameters, TCP probing, cleanup of real local subprocesses, switching order, returning during startup, abnormal exits, and preventing a replacement session after a stop failure.

Host tests cover real HTTPS, rejection of invalid certificates, rejection of unauthenticated requests, rejection of expired/replaced/replayed one-time credentials, token digest storage, authorization recovery and revocation, the local CLI management interface, discovery record validation, and systemd service file escaping. Check that the Host/protocol/common source code does not introduce Electron, React, or main modules.

The interface checks covered isolated preload, disabled Node integration, enabled sandbox, adding/editing/removing devices, input error prompts, saving settings, rollback of invalid shortcuts, and restoring configuration after quitting and restarting. Added loopback Host pairing, encryption and decryption using operating-system secure storage, ensuring the renderer does not receive tokens, restoring Host state after restart, and revoking authorization when a device is removed. Screenshots were written to `test-results/workbench.png` and `test-results/host-paired.png`, not included in Git.

Real component deployment from Windows → Mac has also been completed: the Node.js Host on Mac M2 runs via launchd, and the Windows control client completed real HTTPS pairing and status retrieval; independent Moonlight/Sunshine media pairing returned success. Screen recording permission was missing at first; after restarting the Mac, capture initialization passed; Lanto successfully initiated a Desktop session, and Sunshine recorded `CLIENT CONNECTED` and start HEVC VideoToolbox hardware encoding. The Windows first frame, actual input, and frame rate are still to be confirmed. See [Mac Deployment Record](mac-windows-deployment.md)。

No connection was made to a real Linux1, and no firewall, router, or NAS was modified. Cross-device mDNS discovery and actual Linux systemd installation have not been verified on site. There are no measured results for 2K 30fps, Chinese input, shortcut usability in games, remote key release, hardware decoding, game frame time, or multi-machine switching latency.

The next step is to connect the real Windows → Linux1 Sunshine/Moonlight link and run acceptance tests according to[Design document](design.md#Verification Phase), then expand media telemetry and warm up sessions.
