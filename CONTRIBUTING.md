# Contributing to Lanto

Thanks for helping make remote work across computers more dependable.

## Before making a change

Search existing issues and describe larger changes before implementing them. Include the user problem, expected behavior, and the platforms affected. Small fixes and documentation corrections can go directly to a pull request.

For bug reports, include the Lanto version, controller OS, Host OS, GPU/codec when relevant, LAN or tunnel mode, and exact reproduction steps. Explain what happened and what you expected. Remove addresses, account names, tokens, pairing tickets, clipboard contents, and personal desktop material from logs and screenshots.

## Development

Follow [Building](docs/building.md). Use a separate development configuration and test data rather than changing your everyday paired hosts. The renderer is sandboxed: operating-system access belongs in the main process or Host, with validated IPC and protocol inputs.

```bash
npm ci
npm run typecheck
npm test
npm run format:check
npm run test:smoke
```

The smoke test launches Electron and uses isolated data. A graphical environment is required. It does not prove that real capture, audio, input, permissions, or hardware codecs work; describe any hardware checks separately.

Keep patches focused. Add tests when they protect meaningful behavior, especially protocol parsing, authentication, filesystem handling, transfer integrity, and lifecycle cleanup. Explain behavior changes, validation, and remaining limitations in the pull request.

## Native changes

Keep upstream revisions pinned, put integrations under `native/`, and preserve upstream licenses. Document how to apply and reverse patches. Native contributions must include build and validation notes. Do not claim lower latency from configuration alone: compare the same workload, codec, resolution, and sampling duration.

## Licensing

By submitting a contribution, you agree to license it under the license that applies to the files you change: MIT for original Lanto code and documentation, and the upstream GPL terms for the native integrations. See [LICENSES.md](LICENSES.md). Do not add code or assets whose redistribution rights are unclear.

## Working together

Be respectful, specific, and constructive. Discuss code and behavior rather than people. Security issues belong in the private reporting process described in [SECURITY.md](SECURITY.md).
