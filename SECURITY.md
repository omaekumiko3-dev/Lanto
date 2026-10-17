# Security policy

## Supported release

Security fixes target the latest published release. Lanto is an early-stage project; it has not undergone an independent security audit.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/omaekumiko3-dev/Lanto/security/advisories/new) for exploitable authentication, clipboard, transfer, deployment, or native parsing issues. Include affected versions, reproduction steps, impact, and a minimal proof of concept. Do not put credentials or private desktop data in a public issue.

If private reporting is unavailable, open an issue asking for a private contact channel without publishing exploit details or sensitive data. There is no guaranteed response time or bug bounty.

## Trust model

- Verify the SSH host fingerprint during provisioning. Credentials are used for that deployment session and are not saved in Lanto settings or activity logs.
- Host pairing pins its TLS identity and stores controller authorization using operating-system secure storage. Sunshine media pairing is separate.
- Shared clipboard and file sharing are opt-in. They share with paired online Hosts, even while no desktop stream is open.
- Treat every paired computer as trusted. A compromised local account or host is outside the protection offered by paired transport.
- Ordinary LAN media transport follows the configured Moonlight/Sunshine behavior. Do not assume the entire LAN stream is end-to-end encrypted merely because Host control uses HTTPS. Use the direct encrypted tunnel or a trusted network where appropriate.
- The direct tunnel requires reachable SSH for setup and a reachable UDP endpoint afterward. It is not a relay or an access-control replacement.

See [architecture](docs/architecture.md), [SSH deployment](docs/ssh-deployment.md), and [direct tunnel](docs/direct-tunnel.md) for implementation details. Protect runtime identity files and backups; they are not project source and must not be committed.
