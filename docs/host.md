# Lanto Host Guide

Host is a background Node.js program without a main window, responsible for host identity, controller authorization, and status. It does not depend on Electron, capture video, or replace the target graphical desktop. Sunshine/Moonlight still transport video and keyboard/mouse; agents and users should share the same Linux graphical session.

## First startup

Requires Node.js 24.12 or a newer 24.x release. In the project directory, run `npm ci --omit=dev` to install runtime dependencies without the Electron development runtime, then:

```bash
npm run host -- init --name Linux1 --address 192.168.1.20
npm run host -- start
```

Replace the example IP with the target's address. `init` creates local identity, a TLS certificate, and a management credential without overwriting existing configuration. The default `~/.lanto/host` directory contains private keys and authorization state; keep it in the local user's home, outside Git and shared source directories.

The default bind address is `0.0.0.0:48199`. `--listen` accepts `0.0.0.0`, `127.0.0.1`, `::`, or `::1`; `--port` changes the management port. `--address` is the connection address embedded in tickets. With multiple network interfaces, explicitly choose a LAN address reachable from the controller.

After a device's IP changes, edit **IP address or hostname** on its controller card. This can be saved offline; the next probe or connection uses the new address without interrupting the current stream. Device name, management port, UUID, trusted certificate, and pairing token remain intact, and identity is still verified. Editing the address cannot change the operating system or Host identity. To issue a new controller a ticket containing the updated address, also update `address` in the target's `host.json` and restart Host; do not delete its UUID or certificate.

The CLI does not configure firewalls automatically. The Windows installer below creates Host rules limited to the local subnet. Discovery uses `_lanto._tcp` mDNS on UDP 5353; controller management uses TCP 48199; Sunshine manages media ports. Loopback-only binding disables LAN announcements, as does `start --no-discovery`.

## Pairing and revocation

Keep Host running and execute in another terminal on the same target:

```bash
npm run host -- pair
```

Transfer the complete `LANTO1.` ticket through a trusted channel and paste it into **Connect Host**. It contains the address, public certificate, and single-use secret and expires in five minutes. Discovery lists contain no secrets and cannot establish trust. The controller verifies the ticket's certificate before submitting pairing over HTTPS.

Later operations use an independent high-entropy token. Host stores its digest; the controller encrypts the token with Electron system secure storage. The UI receives only host information and status. A Linux controller without a usable keychain refuses credential storage instead of falling back to plaintext.

```bash
npm run host -- status
npm run host -- controllers
npm run host -- revoke <controller-UUID>
```

These CLI commands read the local management credential and contact the running Host through authenticated loopback. Ordinary controller tokens cannot access management endpoints. Removing a paired device first revokes the controller's authorization on Host. If Host is offline, the device remains and an error is shown; authorization can instead be managed using the target CLI.

## Background operation on Linux

Development `start` runs in the foreground and stops when its terminal closes. Generate a systemd user service without starting Electron for Host:

```bash
mkdir -p ~/.config/systemd/user
npm run --silent host -- service-file > ~/.config/systemd/user/lanto-host.service
systemctl --user daemon-reload
systemctl --user enable --now lanto-host.service
```

Stop any manual Host first to avoid binding the port twice. The generated unit uses absolute paths to the current Node executable and project entry; regenerate it after moving the project or replacing Node. Pass the same `--data-dir` to `service-file` for a custom data directory. Inspect status and logs with:

```bash
systemctl --user status lanto-host.service
journalctl --user -u lanto-host.service
```

This user service starts with the user session. Host responsiveness does not prove that the desktop or Sunshine is ready, nor establish control of login screens or startup unlock. Sunshine must still attach to the correct graphical session according to platform guidance. Actual Ubuntu 26.04 installation on 2026-10-16 passed service restart, full reboot, and Windows reconnection after automatic login; see [Linux deployment](linux-windows-deployment.md) and [systemd service syntax](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml).

To avoid copying the entire repository, run on the development machine with an output directory that does not yet exist:

```bash
npm run host:build
node scripts/package-host.mjs out/host-runtime
```

Copy the entire directory to a permanent Linux runtime path. Packaging copies only compiled output and lockfile production dependencies, excluding Electron, development tools, Host identities, and controller credentials. Dependency licenses are retained. Dependencies with native install scripts or platform restrictions reject cross-platform packaging and require separate review. Run the installer as the desktop user, without sudo:

```bash
LANTO_NODE=/absolute/path/to/node bash /absolute/path/to/host-runtime/install-linux-host.sh \
  --name Linux1 --address 192.168.1.20
```

`LANTO_NODE` defaults to Node on PATH; `LANTO_HOST_DATA_DIR` defaults to `~/.lanto/host`. The installer validates the unit, backs up any existing unit, restarts the service, and checks authenticated local status. Reinstallation preserves UUIDs, certificates, and controller authorization. `init` does not overwrite an existing name or address. Do not move the runtime directory after installation.

## Background operation on Windows

The same runtime includes `install-windows-host.ps1`. Place it in a permanent `Program Files` subdirectory and put the official Windows Node.js distribution in its `node` subdirectory so `node\node.exe` exists. Run in administrator PowerShell:

```powershell
& 'C:\Program Files\Lanto Host\host-runtime\install-windows-host.ps1' `
  -Name Windows1 -Address 192.168.1.30
```

The installer creates the `Lanto Host` startup scheduled task as `LOCAL SERVICE`, independent of user login, with one-minute retries after abnormal exits. Data defaults to `C:\ProgramData\Lanto\Host`; `-DataDirectory` may select another subdirectory inside `ProgramData\Lanto`. The installer sets runtime/data ACLs, backs up existing task XML, preserves UUID/certificate/pairing authorization, and adds local-subnet-only HTTPS and mDNS firewall rules. Later administration requires an elevated terminal and the same explicit `--data-dir`.

See [Windows deployment](windows-windows-deployment.md) for physical deployment and acceptance scope. Sunshine remains a separate installation whose official Windows service attaches to the console desktop. Host startup does not establish login-screen or disk-unlock support.

macOS can run the same CLI. An automatic launchd installer was not yet provided at this documented stage. A manually installed user launchd service and Windows controller pairing are recorded in [Mac deployment](mac-windows-deployment.md). Screen recording and keyboard/mouse permissions are requested by the media engine; a headless Host does not bypass system authorization.

## Media boundaries

Lanto Host pairing authorizes management APIs; Moonlight pairing authorizes Sunshine streaming, using separate credentials. In the manual installation path documented here, Sunshine is installed separately and initial streaming pairing is completed in Moonlight. Lanto does not overwrite existing Sunshine accounts or certificates.

`sunshineReachable` only probes TCP 47989 locally on Host. It does not establish protocol identity, completed pairing, video reception, or hardware encoding. Host exposes no network API for arbitrary commands, remote input injection, or automatic Sunshine startup; such capabilities require separate design and verification.

The source runtime entry is `node src/host/cli.ts`. With development dependencies installed, run `npm run host:build`, then `node out/host/host/cli.js start`; this build does not introduce Electron. Runtime packaging, Linux user-service installation, and Windows startup-task installation are provided. Unified media dependency installation, Mac GUI-agent takeover, and rapid multi-device switching were later-stage work at the time of this guide.
