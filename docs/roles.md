# Controller and Host Responsibilities

Date: 2026-10-16. Host/controller communication follows these module boundaries. Host does not create Electron windows.

## Responsibilities

| Layer | Owns | Boundary |
| --- | --- | --- |
| Controller renderer | Devices, pairing, connection preparation, and status presentation | No file, credential, or socket access |
| Controller main | IPC, configuration, shortcuts, Host client, and media-process orchestration | Does not capture remote desktops or execute arbitrary remote commands |
| Host | Host identity, single-use pairing, trusted controllers, status API, and LAN announcements | No Electron/React; does not replace the Linux graphical session |
| Shared protocol | Versions, message validation, pairing tickets, and request paths | No Electron or UI dependency |
| Media adapter | Sunshine/Moonlight video, audio, keyboard, and mouse transport | Lanto management pairing is not streaming pairing |

Host and controller both use TypeScript. Their network modules depend only on Node.js; Electron is confined to the controller entry point and system adapters. Existing manual device configuration remains compatible.

## Code organization

```text
src/common/        Shared infrastructure such as atomic JSON saves and serial queues
src/protocol/      Network message and pairing-ticket versions and validation
src/host/          Headless Node.js Host
  cli.ts           Local management commands and process signals
  config.ts        Host identity, certificates, and local management credentials
  pairing.ts       Single-use pairing and trusted controllers
  server.ts        HTTPS routes, authentication, and request boundaries
  service.ts       Host lifecycle and module assembly
src/controller/    Host network client and trusted-device storage
src/main/          Electron lifecycle, IPC, system adapters, controller orchestration
src/preload/       Fixed API callable by the renderer
src/renderer/src/
  components/      Device, connection, and dialog presentation components
  hooks/           Workspace state and asynchronous actions
```

Entry files assemble modules; business rules live in the corresponding modules. Shared utilities address existing duplication without introducing speculative frameworks. UI components do not own certificates, tokens, or network authentication logic.

## Pairing and communication

First initialization creates a persistent Host UUID and self-signed TLS certificate. `_lanto._tcp` announces the host name, platform, protocol version, and port on the LAN. Discovery locates devices without trusting them automatically. Tickets can be pasted directly when multicast is unavailable.

A Host terminal command generates a single-use ticket valid for five minutes, containing the address, certificate, and high-entropy secret. The controller first verifies HTTPS using that certificate, then submits its pairing request. Tickets expire after use; generating another revokes the previous one.

After pairing, Host stores only the controller token digest. Electron `safeStorage` encrypts the controller's saved token; no secret is returned to the renderer. Subsequent status requests require authentication. Management operations such as generating tickets, listing controllers, and revoking authorization are restricted to loopback connections holding the local management credential.

This initial personal-LAN protocol provides neither public relays nor arbitrary remote command execution. Identity changes require pairing again; unauthenticated discovery cannot replace a trusted certificate.

## Delivery and verification for this phase

Implemented features include Host initialization, foreground operation, local pairing commands, controller listing/revocation, mDNS announcements, authenticated status, and controller discovery/pairing/status presentation. Host status distinguishes background-service reachability from Sunshine port reachability without inferring a video first frame. Linux background operation provides systemd user-service generation; this phase completed only local text validation.

This phase does not modify existing Sunshine accounts or automatically take over their certificates. Initial media pairing still follows Moonlight/Sunshine after Lanto pairing. A later media adapter may unify guidance without bypassing upstream authorization.

Tests use loopback and separate temporary directories for real TLS, certificate mismatch, expired/replayed tickets, token revocation, state recovery, and controller UI flows. They do not alter the local firewall, install persistent system services, or establish completed Linux/Mac desktop streaming.
