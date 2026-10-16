# Lanto Host User Guide

Host is a background Node.js program without a main window. It handles host identity, controller authorization, and status. It does not depend on Electron, capture the screen, or replace the controlled device’s graphical desktop. Video and keyboard and mouse input still go through Sunshine/Moonlight; the agent and user should use the same Linux graphical session.

## First Launch

Requires Node.js 24.12 or a later 24.x version. Go to the project directory and run `npm ci --omit=dev`, which installs runtime dependencies only and does not install the Electron development runtime. Run:

```bash
npm run host -- init --name Linux1 --address 192.168.1.20
npm run host -- start
```

Replace the example IP with the address of the controlled device.`init` Creates the local identity, TLS certificate, and management credentials; existing configuration is not overwritten by the initialization command. The default directory `~/.lanto/host` contains private keys and authorization state and should remain in the local user directory, not in Git or a shared source directory.

Binds to `0.0.0.0:48199`，`--listen` is supported `0.0.0.0`、`127.0.0.1`、`::`、`::1`；`--port` The management port can be changed.`--address` is the connection address in the pairing credentials. If there are multiple network adapters, explicitly select the internal network address reachable from the controller.

If the same device gets a new IP address, edit “IP or hostname” using the edit button on the device card in the controller. It can be saved offline; the new address will be used on the next check or connection, without interrupting the current stream. The device name, management port, UUID, trusted certificate, and pairing token are retained, and device identity is still verified. The operating system and Host identity cannot be changed by editing the address. To generate pairing credentials for a new controller that include the latest address, then update the controlled device’s `host.json` ’s `address` and restart Host; do not delete the UUID or certificate.

The Host does not configure the firewall automatically. Device discovery uses `_lanto._tcp` mDNS announcements, UDP 5353; controller management communication uses TCP 48199, and Sunshine manages the media ports. When bound to a loopback address, it does not announce on the local network;`start --no-discovery` can also disable announcements.

## Pairing and Revocation

Keep Host running, and execute the following in another terminal on the same controlled device:

```bash
npm run host -- pair
```

Send the complete `LANTO1.` credentials to the controller using a method you trust, and paste them into “Connect Host.” The credentials contain the host access address, public certificate, and one-time secret, and are valid for five minutes. The discovery list does not contain the secret and cannot establish trust. The controller first verifies the certificate in the credentials, then submits the pairing request over HTTPS.

Subsequent operations use a separate high-entropy token. Host stores only the token digest; the controller stores the encrypted token using Electron system secure storage, and the interface receives only host information and status. If the Linux controller lacks an available keychain, it refuses to save credentials rather than falling back to plaintext.

```bash
npm run host -- status
npm run host -- controllers
npm run host -- revoke <Controller UUID>
```

These CLI commands read the local management credentials and operate the running Host through an authenticated loopback interface. Ordinary controller tokens cannot access the management interface. When the controller removes a paired device, it first revokes its own authorization on Host; if Host is offline, the device is retained and a failure is shown. Authorization can be managed through the CLI on the controlled device.

## Running in the Linux Background

During development, `start` runs as a foreground process; closing the terminal stops it. Linux can generate a systemd user service, without starting Electron for Lanto Host:

```bash
mkdir -p ~/.config/systemd/user
npm run --silent host -- service-file > ~/.config/systemd/user/lanto-host.service
systemctl --user daemon-reload
systemctl --user enable --now lanto-host.service
```

First stop the manually run Host to avoid binding the port twice. The generated file uses absolute paths to the current Node executable and project entry point; regenerate it after moving the project or changing the Node installation. For a custom data directory, also pass `service-file` in the `--data-dir`command. View status and logs:

```bash
systemctl --user status lanto-host.service
journalctl --user -u lanto-host.service
```

This is a user service started by the user’s session. A responsive Host does not prove that the desktop session or Sunshine is ready, so it cannot be claimed to control the login screen or unlock at startup. Sunshine still needs to be connected to the correct graphics session according to its platform instructions. The systemd file was checked as text on this machine; actual installation and session lifecycle have not been accepted on a real Linux machine.[systemd service syntax](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml)。

Windows and macOS can run the Host using the same CLI; a system service/launchd automatic installer is not yet available. A launchd user service was installed manually on Mac, and pairing with the Windows control app was completed. Details are in [Windows → Mac Deployment Record](mac-windows-deployment.md)macOS screen recording and keyboard and mouse permissions are requested by the actual media engine; Host having no window does not mean system permissions can be bypassed.

## Media Path Boundaries

Lanto Host manages authorization for its management interface; Moonlight manages authorization for Sunshine streaming, and the two use different credentials. Sunshine still needs to be installed separately, and initial streaming pairing must be completed in Moonlight; Lanto does not replace existing Sunshine accounts or certificates.

in the status `sunshineReachable` only checks local TCP 47989 on Host. It does not prove the peer’s protocol identity, completed pairing, receipt of video, or availability of hardware encoding. Host does not provide network interfaces for arbitrary command execution, remote input injection, or automatic Sunshine startup; those capabilities need to be designed and verified separately.

At runtime, use the source entry point `node src/host/cli.ts`With the full development dependencies installed, you can also run `npm run host:build`and then run `node out/host/host/cli.js start`; this build does not include Electron. Packaged installers, automatic media dependency installation, Mac GUI agent takeover, and multi machine hot switching are later stage work.
