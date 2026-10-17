# SSH deployment

On the Windows controller, **Add device** opens the SSH setup wizard. Enter the target address, port, username, and password, private key, or local SSH Agent. Verify the SHA256 host fingerprint on the first connection, review the detected system and reuse plan, and select **Deploy**. When setup finishes, select **Connect device**. Existing Host credentials and manual device entry remain available.

## Requirements and scope

- The target must have SSH and SFTP enabled, with SSH reachable from the controller during setup. Local/direct mode also requires reachable streaming ports. Encrypted direct tunnel mode carries those ports over a device-to-device UDP connection; see [direct tunnel setup](direct-tunnel.md).
- Windows requires an administrator SSH account and a signed-in desktop user. On macOS and Linux, connect as the desktop user; system package installation uses sudo when required. Desktop services do not run as root.
- Windows and macOS select official x64 or ARM64 packages automatically. Fresh Linux installation supports Ubuntu 22.04, 24.04, and 26.04 on amd64 and arm64. Other Linux distributions can reuse installed Sunshine. Desktop clipboard support requires Python 3, GTK 3, a systemd user session, and a working X11 or Xwayland clipboard bridge.
- The controller needs internet access to download missing Node.js or Sunshine packages. Linux may also need access to package repositories. Existing components are reused without a forced upgrade.
- macOS screen recording, accessibility, and application permission prompts require approval on the target desktop. The wizard pauses until the user grants access and selects **Continue verification**. Linux Wayland screen sharing portals, headless display outputs, and drivers also depend on the target system.
- Automatic pairing and connection use the default Sunshine ports and Desktop application. Custom Sunshine ports, servers without a signed-in desktop, public internet forwarding, and unattended login configuration are outside this version's automatic setup scope.

## Deployment and reuse

1. SSH verifies the host identity and detects the operating system, architecture, Node.js, Host, and Sunshine. A changed fingerprint requires confirmation. Refusal or failed authentication does not add a trust record.
2. Missing packages are downloaded to a local cache and checked against pinned SHA256 digests before SFTP uploads them to a private, unique staging directory. The target verifies the packages again. Node.js uses an isolated runtime directory.
3. Existing Sunshine settings, administrator accounts, and media pairings are preserved. Existing Host identity, certificates, grants, and service arguments are preserved. Supported stopped services are started where possible. Only missing components are installed.
4. A new Host uses a Windows LOCAL SERVICE scheduled task and interactive clipboard task, a Linux systemd user service, or a macOS LaunchAgent. Windows ACLs restrict access to service identity files. The release includes a universal Mac clipboard binary, installed in a cache keyed by its source digest, so the target does not need to compile it.
5. Existing network settings are reused when Host and Sunshine are reachable. Additional Windows rules are limited to the local subnet. On Linux with UFW enabled, required ports are opened only to the current SSH controller address. The firewall and SSH configuration are otherwise preserved.
6. SSH generates a one-time Host ticket on the target. The controller consumes it automatically and pins the TLS certificate. It connects to the current SSH address even when reused configuration advertises an old IP. The bundled player generates a four-digit PIN; the target accepts only a unique pending request whose source matches the current SSH controller.
7. An already paired player is reused. New Sunshine installations receive a random administrator password stored in private target configuration. If an existing Sunshine administrator account is unavailable to the deployment agent, enter its current username and password under **Advanced authentication**. Existing credentials and pairings are preserved.

Passwords and private-key passphrases are used only for the current session. They are not written to Lanto configuration, logs, or deployment scripts. SSH trust records contain only addresses and fingerprints in `ssh-known-hosts.json`. Host authorization remains encrypted by the operating system's secure storage. Deployment state sent to the renderer excludes credentials, raw SSH output, and pairing tickets.

Cancellation stops subsequent steps and closes SSH. An operating system installer that has already started may finish; cancellation does not roll back package transactions. Installed components and original configuration are preserved and detected on reconnection. Successful deployment removes its remote staging directory. Failure or disconnection may leave `~/.lanto/deploy/run-<UUID>` for later cleanup. Confirmation and attention states expire after 15 minutes. Partial completion is never reported as full success.

## Packaging

Build the controller and Host with Node.js and Go 1.26.4 or newer (for the bundled direct tunnel):

```powershell
npm ci
npm run build
```

Automatic pairing requires a native player with `automatedPairProtocol=1`. Apply `native/patches/moonlight-auto-pair.patch` together with the existing patches to the pinned Moonlight source, then run `native/build-moonlight.ps1`. The mode is enabled only through a child-process environment variable. Interactive pairing retains its existing behavior. Automated mode reports success or failure and exits, including when reusing an existing pairing. The build includes the Qt offscreen plugin.

On a Mac with Xcode command line tools, run `node scripts/build-mac-clipboard.mjs out/native-clipboard`. Copy its `manifest.json` and `clipboard-<source-digest>` binary to the controller repository's `out/native-clipboard/` directory and rebuild. Packaging verifies the source digest and binary SHA256 to reject stale helpers. Without this prebuilt binary, source Host packages retain the target-side `xcrun swiftc` compilation path.

```powershell
node scripts/package-controller.mjs C:\path\to\native-player
```

Output is `out/release/Lanto-0.3.0-win-x64/` and a matching ZIP. It contains Electron, runtime dependencies, the player, Host archive, pinned component catalog, native patches, and build instructions. Launch `Lanto.exe`; no separate Node.js or Moonlight installation is required on the controller. User configuration is stored outside the release folder. The packaging script requires a new output directory and refuses to overwrite an existing one.

Components are pinned to Node.js 24.22.0 and Sunshine v2026.914.233613. Digests come from the [official Node.js checksums](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt) and [official Sunshine release](https://github.com/LizardByte/Sunshine/releases/tag/v2026.914.233613). Installation follows the [Sunshine documentation](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2getting__started.html). Version changes require updates to `scripts/deploy/catalog.json` and renewed verification.
