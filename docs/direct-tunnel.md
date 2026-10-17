# Encrypted direct connections

Lanto 0.3 adds a connection mode that links the controller and target directly, using embedded WireGuard components. There is no account to create, no third-party login, and no coordination or relay server. Video, audio, input, Host requests, and enabled clipboard/file synchronization travel through the encrypted tunnel.

## Set up a device

1. Open **Add device** and select **Encrypted direct tunnel · no account**.
2. Enter the target's reachable SSH address and desktop-user credentials. Initial provisioning can take place on the same local network. Confirm the SSH fingerprint.
3. Set **Tunnel endpoint** to an address that this controller can reach. Leave it blank to use the SSH address during local setup. You can edit the tunnel endpoint later in the device settings.
4. For a remote network, use a reachable public IPv6 address or a public IP/hostname with a router mapping. The target listens on **UDP 48200**. **Tunnel UDP port** is the external port; map it to UDP 48200 on the target. For example, external UDP 55000 can map to target UDP 48200.
5. Select **Deploy**. Lanto installs its bundled tunnel helper, exchanges public keys over verified SSH, checks the encrypted handshake, pairs the pinned Host identity, and completes Sunshine media pairing.
6. Select **Connect device**. Later sessions reuse the saved keys and need no SSH password. Keep the target signed in to its desktop and its services running.

The wizard pauses when a direct handshake cannot be established. Fix the endpoint/firewall/router mapping and select **Continue verification**, or use **Edit connection** to change setup values. A failed or incomplete handshake is never reported as a completed deployment. macOS may require its usual local-network or firewall approval; allow the relevant system prompt on that device, then continue.

## Reachability limits

At least one usable endpoint must be reachable from the other device. Lanto does not discover public addresses through a third-party service, create router mappings, or fall back to a relay. Two devices behind restrictive NAT, carrier-grade NAT without usable IPv6, blocked UDP, expired IPv6 addresses, sleeping devices, and disabled services can therefore prevent a connection. A dynamic hostname can be supplied when the target's reachable address changes.

No public Sunshine or Host port forwarding is needed for tunnel mode. Only UDP 48200 on the target carries the encrypted tunnel. The helper forwards the default Lanto/Sunshine ports internally. Custom Host ports other than 48199 and custom Sunshine ports are outside this version's tunnel setup scope. A local program occupying the loopback proxy's streaming ports can prevent startup; Lanto reports a port conflict instead of silently choosing another destination.

The Windows controller remains the supported desktop client. Targets support Windows, macOS, and Linux on x64/ARM64. Fresh Sunshine/runtime installation retains the SSH deployment support boundaries described in [SSH deployment](ssh-deployment.md).

## Identity, storage, and services

- Each controller/target pairing has a controller WireGuard key. The target retains its own identity and a bounded list of enrolled public keys. Re-enrollment by the same controller replaces that controller's entry; other entries remain intact.
- Controller private keys are encrypted through the operating system's secure storage in `direct-tunnels.json`. Renderer state and `config.json` contain only the endpoint and managed local address. Credentials are not exported through the UI.
- Target keys are stored under `~/.lanto/direct-tunnel` on macOS/Linux, with private directory/file permissions, or under `C:\ProgramData\Lanto\DirectTunnel` with restricted Windows ACLs.
- The target uses the **Lanto Direct Tunnel** LOCAL SERVICE startup task on Windows, `dev.lanto.direct-tunnel` LaunchAgent on macOS, or `lanto-direct-tunnel.service` user service on Linux. The helper uses its own network stack and does not install a VPN adapter or change system routes/DNS.
- The Windows firewall rule is limited to this helper and UDP 48200. Active UFW receives a UDP 48200 rule; macOS receives an application firewall entry. Existing streaming configuration and other firewall rules are preserved.
- Removing a controller device revokes its Host authorization, stops its local helper, and deletes its locally saved tunnel key. The target may retain the now-unused public-key entry; a later SSH setup from the same controller replaces it. Existing Sunshine clients remain governed by Sunshine's own pairing list.

SSH remains the trust bootstrap. The tunnel does not turn possession of an address into authorization: the peer must have the corresponding private key. Host TLS identity/token checks and Sunshine's pairing checks remain in place inside the tunnel. Sunshine's administrative web port is not forwarded.

## Verification

Automated tests cover encrypted TCP and UDP transport, peer-key rejection, IPv6 endpoints, configuration validation, secret-vault persistence, corrupt-state preservation, and enrollment/re-enrollment. Desktop smoke tests cover the mode selector, SSH trust boundary, and existing controller behavior.

The native IPv6 transport test passed on Linux. This Windows test environment blocks ordinary IPv6 UDP loopback, so that case was explicitly skipped there after a plain UDP reachability probe; IPv4 transport passed on both systems.

Live Windows-to-Linux, Windows-to-Windows, and Windows-to-macOS deployments completed all steps and delivered video and audio over the tunnel. Independent fresh native client identities completed PIN pairing through the tunnel; only those test clients were then revoked. A saved controller profile survived an application restart. A deliberately unreachable endpoint was rejected; restoring the original endpoint restored connectivity.

These live tests used LAN-reachable outer endpoints. They verify the actual encrypted data path, not reachability across two different public networks. Real public IPv6 or router-forwarded connections remain dependent on the user's network and have not been represented as a completed WAN test.

## Source and packaging

The helper source, pinned Go dependencies, build script, integrity manifest, and license notices are included with Lanto. See [the helper README](../native/tunnel/README.md). End users do not need Go, a WireGuard client, Tailscale, or any third-party account. Developers need Go 1.26.4 or newer to build the six helper variants alongside the existing Node.js toolchain.
