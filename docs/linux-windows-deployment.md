# Windows → Linux Deployment Record

Date: 2026-10-16. Deployment used KRU project `Kumiko_linux`; Windows Lanto now contains `KumikoLinux`. This acceptance covers the basic remote desktop path, excluding GUI agents, NAS working directories, and development toolchains.

## Environment and installation paths

| Item | Configuration |
| --- | --- |
| Linux | Ubuntu 26.04.1 LTS, kernel 7.0.0-38, x86_64 |
| CPU/GPU | Ryzen 5 7500F/RTX 3080, NVIDIA 595.99.02 |
| Desktop | Existing GNOME Wayland seat0 user session; original GDM automatic login preserved |
| Display | HDMI-1, 3840×2160 60Hz, 150% scale, logical desktop 2560×1440 |
| Network | Linux `192.168.100.138`, Windows `192.168.100.179`, wired direct LAN |
| Host | Node.js 24.22.0, TLS TCP 48199, mDNS UDP 5353 |
| Media | Official Sunshine `2026.914.233613` Ubuntu 26.04 amd64 package, KMS + NVENC |
| Windows | Existing Lanto Moonlight native-4, HEVC/D3D11VA, shared device and textures |

Host code was compiled from `f8122d6` and installed as an independent runtime without Electron:

```text
~/.lanto/runtime/node-v24.22.0-linux-x64/bin/node
~/.lanto/runtime/host-f8122d6/app/host/cli.js
~/.lanto/host/                         # Identity, TLS private key, controller authorization
~/.config/systemd/user/lanto-host.service
~/.config/sunshine/                   # Media configuration, certificates, separate pairing
```

Host's data directory is `0700`; identity and media-state files are `0600`. Sunshine management credentials were initialized randomly and saved only in Linux-local `~/.lanto/sunshine-admin.json`, without output or commit. Pairing tickets and media PINs were transferred through temporary files and deleted afterward. KRU handled SSH login and sudo credential injection.

Downloads came from the [official Sunshine stable release](https://github.com/LizardByte/Sunshine/releases/tag/v2026.914.233613) and [official Node.js 24.22.0](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt), with SHA-256 verified before installation:

```text
sunshine_2026.914.233613-1+ubuntu26.04_amd64.deb
b8a8ceeeb2b3f30a18a994ad268c94e0c91170f33a864c7aad31eed927ad7d47

node-v24.22.0-linux-x64.tar.xz
cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008
```

## Desktop, media, and startup

Sunshine uses the official package's `app-dev.lizardbyte.app.Sunshine.service` user service, aliased as `sunshine.service`, started by `graphical-session.target`. Host starts through the user's `default.target`. Both are enabled. Linger was not enabled, and no second desktop or virtual display session was created.

Main Sunshine configuration:

```ini
sunshine_name = KumikoLinux
capture = kms
encoder = nvenc
origin_web_ui_allowed = pc
upnp = disabled
min_log_level = 2
```

The package configured KMS binary capabilities and uinput udev rules. The current desktop user accesses graphics/input devices through ACLs. Actual keyboard/mouse verification passed without running all of Sunshine as root or granting the user blanket device read/write access. See [official installation guidance](https://docs.lizardbyte.dev/projects/sunshine/v2026.914.233613/md_docs_2getting__started.html).

At first startup the desktop was locked with the screen off, so KMS enumerated 0×0 dimensions and reported encoder/capability diagnostics. Restoring the existing desktop and restarting Sunshine made the stable release capture and encode normally; no prerelease upgrade or isolation reduction was required. To keep this remote workstation desktop available, `org.gnome.desktop.session idle-delay=0` and `sleep-inactive-ac-type='nothing'` were set. Manual locking remains available. Remote control of a locked screen, physically disconnected monitor, or disk-unlock screen was not tested.

The previous idle timeout was 300 seconds and AC idle action was `suspend`; restore those values with `gsettings` if needed. The original `('xkb', 'cn')` input source and system switching shortcuts were preserved, adding only Pinyin and `Ctrl + Space`.

Debug logging used during diagnosis was restored to info to avoid routine keyboard/mouse packet logs. Windows overlays and diagnostic logs were also turned off again. Borderless mode, 2K60, 20Mbps, and the global local-cursor preference were preserved. Linux/Windows connections use the remote cursor automatically, while Mac local cursor support remains active.

The Windows clock was initially eight hours behind NTP and Linux, making the new Host certificate not yet valid. Restoring time service and synchronization allowed pairing, with approximately 0.13 seconds of NTP offset. Certificate validity and TLS pinning were not bypassed.

## Actual acceptance checks

| Check | Result |
| --- | --- |
| Lanto pairing | Single-use ticket succeeded; token entered Windows secure storage |
| Sunshine pairing | Independent Moonlight certificate handshake succeeded using authenticated API, CSRF token, and a specific pending request |
| Display | Windows logs and overlay confirmed HEVC `2560×1440×60`; the remote test window was visible |
| Same desktop | GTK test app launched through the same user's systemd manager on existing `wayland-0`, captured by Sunshine |
| Mouse and keyboard | Windows sent clicks, drags, and scan-code keys to its owned Moonlight window; Linux GTK recorded one click, 24 drag updates, and one key event |
| Chinese input | Added the existing `ibus-libpinyin` source and `Ctrl + Space`; Windows Pinyin keystrokes produced the complete Chinese phrase meaning “Chinese input test” in Linux |
| Audio path | Sunshine initialized 48kHz stereo Opus LOWDELAY; first client audio packet arrived in approximately 300–400ms; listening quality was not assessed |
| Service restart | Existing pairing reestablished HEVC/audio after restarting Host and Sunshine |
| Full reboot | Linux boot time was `21:29:23 Asia/Shanghai`; both user services resumed after automatic login, and Windows reconnected with existing pairing and repeated Chinese-input verification |
| Reinstallation | Host identity and controller-authorization files remained byte-identical; the old unit was backed up |
| Disconnect | Moonlight exited normally; Sunshine and the remote user session remained running |

Short animated-pattern and post-reboot input tests showed approximately 60.1fps, 1ms network time, 3.2–3.3ms host processing, and 0% network/jitter frame drops. One sample showed 0.41ms decoding and 0.07ms rendering. These component statistics and short samples must not be summed into end-to-end latency or generalized to long workloads and concurrent GPU compilation/computation.

Temporary GTK test services and programs were stopped and deleted. Screenshots and diagnostic records remain in ignored local `work/linux-deploy/` and Windows `media-logs/`, outside the repository.

## Reusable installation and maintenance

Build a runtime on the development machine using an output directory that does not exist:

```bash
npm run host:build
node scripts/package-host.mjs out/host-runtime
```

Copy the entire runtime and an architecture-appropriate Node.js installation to permanent Linux paths. Run as the desktop user:

```bash
LANTO_NODE=/absolute/node/bin/node bash /absolute/host-runtime/install-linux-host.sh \
  --name Linux1 --address <actual-LAN-IP>
```

The script installs only the Host user service, backs up existing units, preserves identity, and waits for authenticated status. Sunshine must still use an official package and graphical session appropriate to the target. Do not apply this machine's NVIDIA configuration blindly to every Linux host.

Routine checks:

```bash
systemctl --user status lanto-host app-dev.lizardbyte.app.Sunshine
journalctl --user -u lanto-host -u app-dev.lizardbyte.app.Sunshine
~/.lanto/runtime/node-v24.22.0-linux-x64/bin/node \
  ~/.lanto/runtime/host-f8122d6/app/host/cli.js status
```

After an IP change, edit the device address in Lanto to retain pairing; update the Host public address before issuing tickets to new controllers. Rerun the installer after updating the runtime; old units receive timestamped backups. To roll back, restore the old unit, run `daemon-reload`, and restart the service. Keep `~/.lanto/host` and `~/.config/sunshine`; identity need not be regenerated.

NAS, GUI-agent interfaces, sustained workloads, multiple displays, and rapid multi-device switching remain to be validated. Chinese-input verification covers Pinyin composition on Linux, not forwarding Windows-local IME composition, clipboard synchronization, or compatibility with every input method.
