# Windows Controller → Windows Host Deployment Record

> Historical hardware verification. Addresses and device labels are anonymized examples; this is not a universal setup guarantee.

Deployed on 2026-10-17 on a Windows test host. Lanto contains device `WindowsDesktop` at `192.0.2.30`. Completed checks include dual Host/media pairing, 2K60 HEVC desktop, actual audio, clicks/drags, English/Chinese input, reconnection, and startup configuration. Full reboot and long-term stability were not tested.

## Host and pinned versions

| Item            | Actual configuration                                           |
| --------------- | -------------------------------------------------------------- |
| System          | Windows 11 Pro, build 26300, x64                               |
| GPU             | NVIDIA RTX 3080, driver 591.86                                 |
| Current display | 2560×1440 at 60Hz, existing console session                    |
| Sunshine        | Official stable `2026.914.233613`, AMD64 MSI                   |
| Host            | Compiled Lanto `8b04e91`, Node.js `24.22.0`                    |
| Controller      | Lanto native Moonlight v5, D3D11VA, shared device and textures |

Downloads came from the [official Sunshine release](https://github.com/LizardByte/Sunshine/releases/tag/v2026.914.233613) and [official Node.js checksum list](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt). Both downloads passed SHA-256 verification. Authenticode status was `Valid` for the Sunshine MSI and extracted `node.exe`.

```text
Sunshine-Windows-AMD64-installer.msi
1d7fed8beecd5889dc7ff14cf9f42d6d38f37c3066c13c6c2a5f4e91847e0ccf

node-v24.22.0-win-x64.zip
f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3
```

## Installation and operation

Sunshine's official MSI was installed silently with `/qn /norestart`, returning code 0. Configuration is in `C:\Program Files\Sunshine\config`, with NVENC encoding, management web access limited to the local machine, UPnP disabled, and info logging. A random management password was generated locally on the target without returning plaintext. Only SYSTEM and Administrators can access its configuration directory.

The official `SunshineService` runs as LocalSystem with Automatic startup. Recovery restarts occur after 5, 15, and 60 seconds. Existing accounts, language, timezone, and power plan were preserved; AC automatic sleep was already disabled.

Permanent Host runtime locations:

```text
C:\Program Files\Lanto Host\host-8b04e91\
  app\host\cli.js
  node_modules\
  node\node.exe
  install-windows-host.ps1

C:\ProgramData\Lanto\Host\
  host.json
  controllers.json
```

Generate a fresh runtime on the development machine:

```powershell
npm run host:build
node scripts/package-host.mjs out/host-runtime
```

Copy the whole runtime into a permanent target `Program Files` subdirectory, then put the official Windows Node.js ZIP contents in its `node` subdirectory. Run in administrator PowerShell:

```powershell
& 'C:\Program Files\Lanto Host\host-8b04e91\install-windows-host.ps1' `
  -Name WindowsDesktop -Address 192.0.2.30
```

The installer requires Node.js 24.12 or later, a runtime inside `Program Files`, and data inside `ProgramData\Lanto`; it rejects reparse points. Runtime writes are restricted to SYSTEM/Administrators; LOCAL SERVICE gets read/execute access. Host data is limited to these three principals, with modify access for LOCAL SERVICE. Existing identity, certificates, and controller authorization are preserved.

The `Lanto Host` task uses `LOCAL SERVICE`/`ServiceAccount`, triggers at system startup without interactive login, and stores no user password. It has no execution time limit and retries failures every minute up to 999 times. Upgrades back up existing task XML and refuse to replace an identically named task not managed by this installer. Account selection follows [Microsoft scheduled-task guidance](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal?view=windowsserver2025-ps) and [LocalService documentation](https://learn.microsoft.com/en-us/windows/win32/services/localservice-account).

Existing network categories were unchanged. Lanto TCP 48199/UDP 5353 and official Sunshine program rules allow only `LocalSubnet` across network profiles. No public port mapping was added.

To inspect status or issue a new ticket, run administrator PowerShell on the target:

```powershell
$runtime = 'C:\Program Files\Lanto Host\host-8b04e91'
$data = 'C:\ProgramData\Lanto\Host'
& "$runtime\node\node.exe" "$runtime\app\host\cli.js" status --data-dir $data
& "$runtime\node\node.exe" "$runtime\app\host\cli.js" pair --data-dir $data
Get-ScheduledTask -TaskName 'Lanto Host'
Get-ScheduledTaskInfo -TaskName 'Lanto Host'
Get-Service SunshineService
```

## Actual verification and boundaries

- A single-use ticket completed certificate-pinned HTTPS pairing, with controller authorization in secure system storage. Sunshine completed independent media pairing. Temporary ticket and PIN files were deleted.
- The native client received and displayed a 2560×1440 HEVC desktop at a requested 60fps. The first video packet arrived in approximately 300ms; D3D11VA decoding succeeded. The local-cursor protocol was disabled for Windows, using the remote cursor.
- An animated temporary window in the same console session produced short samples of 59.66/60.17fps and 59.89fps after reconnection. Network time was approximately 1ms, host processing 3.2ms, decoding 0.39–0.44ms, rendering 0.09–0.10ms, and network drops 0%. These short client statistics do not establish long-term stability or end-to-end input latency.
- Real foreground Moonlight keyboard/mouse events produced one remote click, 128 drag updates, and exact text `lanto123`. Remote Chinese IME composition from Pinyin then submitted the six-character Chinese phrase meaning “Chinese input test,” with exact character matching. The test text was not injected into the field through SSH.
- A low-amplitude test tone played in the existing remote console session. Only that Moonlight process's WASAPI audio session was measured locally, with average peak `0.00300045`, confirming actual audio arrival. The previously silent desktop produced no audio packets; the first arrived after the tone began, so the preceding idle period is not audio startup latency.
- Rerunning the Host installer preserved the exact SHA-256 of `host.json` and `controllers.json` and restored service availability. Startup trigger, failure retries, account, and secret-file ACLs were confirmed.
- After restarting Sunshine, existing media pairing successfully retrieved `Desktop` and `Steam Big Picture` and established another HEVC session. Another deliberate disconnect/reconnect preserved the desktop, test window, and entered Chinese text. First video remained approximately 300ms, and the new client's average audio-session peak was `0.00300156`, confirming audio recovery.
- Temporary interactive windows, audio tasks, and tones were removed. Controller performance statistics were disabled again, and all three devices retained their own volume settings.

This run did not test full reboot, login screens, BitLocker startup unlock, game Raw Input, controllers, or long-term stability. Basic Sunshine keyboard/mouse used its existing injection path without adding a virtual HID driver requiring a paid license. Future additions should be validated separately using [Sunshine Windows input guidance](https://github.com/LizardByte/Sunshine/blob/v2026.914.233613/docs/getting_started.md#windows-1).

## Intermittent Wi-Fi connection failures

On 2026-10-18, repeated connection failures coincided with Windows WLAN AutoConfig event 8003 (the driver disconnected the network) and event 4003 (limited-connectivity recovery). Sunshine logged initial UDP ping timeouts, and SSH was briefly unavailable too. Existing Host authorization and Sunshine pairing still worked after the link recovered.

This host uses a MediaTek MT7612 USB Wi-Fi adapter. Its driver advanced property `*SelectiveSuspend` was enabled with a five-second idle timeout even though the separate power-management view reported selective suspend disabled. The adapter properties were backed up, the driver property was set to `0` with `Set-NetAdapterAdvancedProperty -NoRestart`, and that adapter was restarted once through a temporary task that removed itself. The new setting persisted after the adapter restart. A driver-only Windows Update search found no update for this adapter; unrelated offered updates were not installed.

Eight subsequent real disconnect/reconnect cycles received 2560 × 1440 video at 60 FPS with D3D11VA and the requested 120 Mbps setting. No new WLAN driver-disconnect event appeared during that run. This is a finite reconnect test, not proof that selective suspend caused every past outage or a full-motion wireless throughput benchmark.

Lanto now retries transient Host transport failures, coalesces simultaneous checks, and periodically refreshes saved devices. Recovery clears stale network errors without re-pairing. Authorization and certificate failures are classified separately and do not receive transport retries. Host reachability and Sunshine availability are also reported separately. These controller changes improve detection and recovery of device status; they do not replace or reset a wireless driver, or automatically restart an interrupted video stream.
