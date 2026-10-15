# Initial Verification Record

Date: 2026-10-16. Environment: local Windows machine, Node.js 24.12.0, Electron 44.7.2. This record applies to the current Electron + TypeScript client skeleton.

| Check | Results |
| --- | --- |
| `npm run build` | Type checking and main/preload/renderer builds pass |
| `npm run format:check` | Passed |
| `npm test` | All 11 items passed |
| `npm run test:smoke` | Real Electron interface operations passed with isolated configuration |
| npm dependency audit | Reported 0 known vulnerabilities after installation; this does not mean that no unknown issues exist |
| `git diff --check` | Passed |

Core tests cover saving and reloading configuration, preserving corrupted configuration, address/parameter validation, duplicate device IDs, Moonlight parameters, TCP probing, cleanup of real local subprocesses, switching order, returning during startup, abnormal exits, and preventing a replacement session after a stop failure.

Interface checks cover isolated preload, disabled Node integration, enabled sandbox, adding, editing, and deleting devices, input error messages, saving settings, rollback for invalid shortcut keys, and configuration recovery after exit and restart. Screenshots are written to `test-results/workbench.png`, not included in Git.

No real Linux1 or Mac was connected, Moonlight/Sunshine was not installed or downloaded, and no firewall, router, or NAS was modified. There are no measured results for 2K 30fps, Chinese input, shortcut usability in games, remote key release, hardware decoding, game frame time, or multi-machine switching latency. The macOS/Linux client platforms have also not been verified on site.

The next step is to connect the real Windows → Linux1 Sunshine/Moonlight link and run acceptance tests according to[Design document](design.md#Verification Phase), then expand media telemetry and warm up sessions.
