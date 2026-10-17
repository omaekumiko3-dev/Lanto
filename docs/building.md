# Building and releasing

## Toolchains

- Node.js 24.12 or newer, npm, and Git.
- Go matching `native/tunnel/go.mod` (the release uses Go 1.26.4).
- A graphical environment for Electron smoke tests.
- Windows PowerShell for Windows executable branding and packaging.
- MSVC x64, Windows SDK, and Qt for a native Moonlight build.
- macOS with Xcode Command Line Tools for the optional universal clipboard helper or experimental Sunshine app.

## Controller and Host

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

`build` produces Electron main/preload/renderer output, compiles the Host, cross-compiles tunnel helpers, and packages SSH deployment resources. Go dependencies and npm dependencies are pinned by their lockfiles.

`npm run host -- --help` shows the Host CLI. See [Host setup](host.md) for its init, pairing, serving, and installation commands. A standalone Host runtime can be assembled into a new directory with:

```bash
npm run host:build
node scripts/package-host.mjs out/my-host-runtime
```

The Host runtime uses Node.js and production dependencies, without Electron.

## Native player

Follow [native/README.md](../native/README.md). The release uses Moonlight Qt commit `de2467e433821664cdd2224aad8c89a625be1ad9` (v6.2.0), Windows dependency bundle v19, and Qt 5.15.2. Initialize recursive submodules. Apply the five Moonlight patches listed there, in order; do not apply patches from other versions or experimental local work.

```powershell
pwsh -File native/build-moonlight.ps1 -Source C:/build/moonlight-qt -QtBin C:/Qt/msvc_64/bin -Output C:/build/Lanto-player
```

Use a new output directory. The build copies integration sources and artwork, deploys Qt plugins, and emits a capability manifest. Automatic SSH media pairing requires `automatedPairProtocol=1`. An ordinary Moonlight client can still be selected manually, but it does not provide every Lanto extension.

The release source materials include the exact upstream sources, dependency build scripts, patches, and Qt recipe. They support rebuilding and modification; bit-for-bit reproducibility across compilers and SDKs is not claimed.

## macOS clipboard helper

On macOS:

```bash
node scripts/build-mac-clipboard.mjs out/native-clipboard
```

Copy the resulting `manifest.json` and `clipboard-<source-digest>` into the Windows checkout's `out/native-clipboard/` directory before `npm run build`. Packaging verifies the source digest and binary SHA-256. Without this optional prebuilt helper, the target compiles its Swift source on first use.

The experimental custom Sunshine macOS app is a separate source build and is not included in the Windows release. Its signing and permission setup are documented under `native/`.

## Windows package

After building and preparing a native player:

```powershell
node scripts/package-controller.mjs C:/build/Lanto-player
```

The script creates a new `out/release/Lanto-<version>-win-x64/` directory and ZIP. It refuses to overwrite an existing directory. Preserve all files in the package when redistributing it, including Electron notices, native notices, and Lanto's license.

## Checks before release

1. Update the version and lockfile, changelog, links, and release notes.
2. Run type checking, the behavior tests, Go tests, formatting checks, and Electron smoke tests.
3. Launch the packaged application with isolated data and verify the bundled native-player capability manifest and Host/tunnel assets.
4. Capture screenshots using `node scripts/capture-docs.mjs`; the script uses separate test data and documentation-range addresses.
5. Audit tracked files, Git history, and packaged output for credentials, private runtime state, and unintended files.
6. Include third-party license texts and matching native source materials. A link to an upstream repository alone is not the source artifact for a modified binary.
7. Generate SHA-256 checksums after artifacts are final. Upload the binary, matching sources, and checksums to the same release.
8. Verify public download links and artifact hashes after publishing.

Hardware validation is separate from automated tests. Describe the host platforms, codecs, network conditions, and limits actually checked. Do not extrapolate LAN checks to arbitrary internet/NAT environments.
