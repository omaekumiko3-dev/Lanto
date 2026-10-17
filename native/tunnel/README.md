# Direct application tunnel

Lanto embeds the upstream WireGuard protocol and its userspace network stack. The helper connects a controller directly to a target device over UDP. It has no account service, registration, rendezvous server, STUN server, relay, or telemetry endpoint. The endpoint supplied by the user is the only tunnel destination; hostnames use the operating system's ordinary DNS resolution.

The helper creates no system network interface and changes no routes or DNS settings. A controller binds per-device loopback TCP/UDP proxies; the target forwards authenticated tunnel traffic to its own loopback services. The fixed port allowlist covers Host and Sunshine, excluding Sunshine's administrative web port. The target listens on UDP 48200. It is an application tunnel, not a general network proxy.

The internal `10.203.0.0/16` addresses exist only in the userspace stack. Every peer is limited to one `/32`. Controller proxies bind only IPv4 loopback addresses. The underlying UDP connection supports reachable IPv4 and IPv6 endpoints.

## Build and verify

Use Go 1.26.4 or newer and the checked-in `go.mod` and `go.sum`:

```sh
npm run build
npm run test:tunnel
```

`scripts/build-tunnel.mjs` cross-compiles Windows, macOS, and Linux binaries for x64 and ARM64, without CGO. It records the source digest and each binary's SHA256 in `out/tunnel/manifest.json`. Builds with unchanged source and matching binaries reuse those outputs. The controller verifies a binary before starting or uploading it; the SSH deployment agent verifies it again. On macOS the verified copy receives an ad-hoc signature before its LaunchAgent starts.

`npm test` includes the Go tests. They establish real encrypted TCP and UDP communication, refuse an untrusted peer key, validate IPv6 transport, and reject configurations that could expose an arbitrary proxy.

## Runtime contract

The controller sends one bounded JSON configuration over the helper's standard input and keeps that pipe open. Closing the pipe ends the helper. The target runs `lanto-tunnel --config <private configuration file>` through an operating-system background service. Configuration keys never appear in command-line arguments or stdout.

Stdout emits bounded JSON readiness and handshake notifications. A readiness notification only means local listeners exist. Lanto also requires an authenticated WireGuard handshake, pinned Host TLS pairing/status, and native media pairing before declaring deployment complete.

The helper supports at most 64 peer keys, 64 concurrent accepted TCP connections per forwarded port, and 128 UDP source mappings per port. Idle UDP mappings expire. Existing enrolled controllers can have their keys replaced through authenticated SSH without changing the target's key or other controllers' keys.

See [third-party notices](THIRD_PARTY_NOTICES.md) and [the product guide](../../docs/direct-tunnel.md).
