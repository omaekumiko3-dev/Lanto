# Windows control machine → Windows host deployment record

2026-10-17 through the KRU project `Kumiko_win` Deployment. The device has been added to Lanto, named `KumikoWindows`, the address is `192.168.100.120`. This work completed Host and media pairing, displayed a real HEVC desktop, transferred audio, and configured startup. The user is playing a full screen game on this machine and chose to complete background checks first, so clicking, dragging, Chinese input, and dynamic scenes at sustained 60fps have not been accepted.

## Host and pinned versions

| Projects | Actual configuration |
| --- | --- |
| system | Windows 11 Pro，build 26300，x64 |
| Graphics card | NVIDIA RTX 3080, driver 591.86 |
| Currently displayed | 2560×1440, 60Hz, existing console session |
| Sunshine | Official stable release `2026.914.233613`，AMD64 MSI |
| Host | Lanto `8b04e91` Build artifacts, Node.js `24.22.0` |
| Controller | Lanto native Moonlight v5, D3D11VA, shared devices and textures |

Download sources: [Official Sunshine release](https://github.com/LizardByte/Sunshine/releases/tag/v2026.914.233613) and [Official Node.js checksum list](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt). Both downloaded files passed SHA-256 verification, and the Sunshine MSI and the extracted `node.exe` Authenticode status of is `Valid`。

```text
Sunshine-Windows-AMD64-installer.msi
1d7fed8beecd5889dc7ff14cf9f42d6d38f37c3066c13c6c2a5f4e91847e0ccf

node-v24.22.0-win-x64.zip
f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3
```

## Installation and operation

Sunshine was installed silently using the official MSI,`/qn /norestart`, and the installer returned code 0. The configuration is located at `C:\Program Files\Sunshine\config`, uses NVENC encoding; the administration web page allows local access only, UPnP is disabled, and the log level is info. The administration password was generated randomly on the target machine and was not returned in plaintext; only SYSTEM and Administrators can access the configuration directory.

`SunshineService` is an official service, running as LocalSystem with startup type Automatic. Recovery is configured to restart after 5 seconds, 15 seconds, and 60 seconds. Existing system accounts, language, time zone, and power plan were retained; automatic sleep on AC power was already disabled.

Fixed operating location for Lanto Host:

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

Generate a new runtime directory on the development machine:

```powershell
npm run host:build
node scripts/package-host.mjs out/host-runtime
```

Copy the entire runtime directory to a fixed subdirectory under `Program Files` on the controlled machine, then place the files from the official Node.js Windows ZIP in that directory’s `node` subdirectory. Run the following in an administrator PowerShell session:

```powershell
& 'C:\Program Files\Lanto Host\host-8b04e91\install-windows-host.ps1' `
  -Name KumikoWindows -Address 192.168.100.120
```

The installer requires Node.js 24.12 or later, and the runtime directory must be under `Program Files` ; the data directory must be under `ProgramData\Lanto` . Reparse points are rejected. The installer sets the runtime directory so only SYSTEM and Administrators can write to it, while LOCAL SERVICE has read and execute access; only these three principals can access Host data, and LOCAL SERVICE can modify it. Existing identities, certificates, and controller authorizations are not overwritten.

Scheduled task `Lanto Host` uses `LOCAL SERVICE`／`ServiceAccount`, triggered at system startup, independent of an interactive user login and without storing a user password. The task has no runtime limit; on failure it retries every minute, up to 999 times. During upgrades, the existing task XML is backed up, and a same-name task not managed by this installer is not overwritten. Account selection is based on [Microsoft Scheduled Tasks documentation](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal?view=windowsserver2025-ps) and [LocalService account reference](https://learn.microsoft.com/en-us/windows/win32/services/localservice-account)。

Existing network categories were not changed in the firewall: Lanto TCP 48199, UDP 5353, and the official Sunshine program rules are allowed only for `LocalSubnet`, across all network profiles; no public-facing port mapping was added.

To check or generate new pairing credentials, run this in an administrator PowerShell session on the target machine:

```powershell
$runtime = 'C:\Program Files\Lanto Host\host-8b04e91'
$data = 'C:\ProgramData\Lanto\Host'
& "$runtime\node\node.exe" "$runtime\app\host\cli.js" status --data-dir $data
& "$runtime\node\node.exe" "$runtime\app\host\cli.js" pair --data-dir $data
Get-ScheduledTask -TaskName 'Lanto Host'
Get-ScheduledTaskInfo -TaskName 'Lanto Host'
Get-Service SunshineService
```

## Actual verification and limitations

- Lanto completed certificate-pinned HTTPS pairing using a one-time credential, and the controller stored the authorization in the system secure storage; Sunshine completed separate media pairing. The temporary credential and PIN files were deleted.
- The native client actually received and displayed a 2560×1440 HEVC desktop, with a 60fps configuration request; the first video packet arrived in about 300ms, and D3D11VA decoding succeeded. The local cursor protocol was disabled for Windows, so the remote cursor was used.
- One statistics sample from the static test window showed about 21.54fps, 1ms network latency, 3.2ms host processing, 0.67ms decoding, 0.10ms rendering, and 0% network frame loss. The frame rate of a static desktop does not prove sustained 60fps or represent end to end input latency.
- Play a low-amplitude test tone in an existing remote console session; locally, test only the WASAPI audio session of that Moonlight process, with an average peak of `0.00300045`, confirming that real sound arrived. The idle silent desktop previously had no audio packets; the first packet appeared after the test sound began, so this idle period cannot be treated as audio startup latency.
- After running the Host installer repeatedly,`host.json` and `controllers.json` The SHA-256 remained completely unchanged, and the service was restored to operation; confirmed the task-start trigger, failure retries, run account, and ACLs for each secret file.
- After the Sunshine service restarts, the control end successfully reads through the existing media pairing `Desktop` and `Steam Big Picture` application list, without requiring pairing again. The streaming window was not opened again in this round, so the user’s local game could remain in the foreground.
- The temporary interactive test window, audio task, and test audio were all cleaned up; performance statistics were turned off again on the controller, and each of the three devices retained its own volume setting.

The whole machine was not restarted, and the login screen, BitLocker startup unlock, Chinese input, game Raw Input, controllers, and long term stability were not verified. Sunshine’s basic desktop keyboard and mouse use the existing injection path; no virtual HID driver requiring a paid license was installed. Any future addition of this capability should follow [Sunshine Windows input documentation](https://github.com/LizardByte/Sunshine/blob/v2026.914.233613/docs/getting_started.md#windows-1) .
