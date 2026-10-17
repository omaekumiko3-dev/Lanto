# Third-party notices

Lanto is distributed with independently licensed software. The root MIT license applies to original Lanto code, not to every component in a release archive. Preserve upstream copyright notices and license texts when redistributing the application.

## Controller and Host

| Component | License / source |
| --- | --- |
| Electron | MIT; [source](https://github.com/electron/electron). Electron's LICENSE and LICENSES.chromium.html are retained at the package root. Chromium, Node.js, and other embedded components have their own notices there. |
| React and React DOM | MIT; [source](https://github.com/facebook/react). Included in the renderer bundle. |
| bonjour-service, selfsigned, ssh2, zod and transitive runtime dependencies | See each installed package's license and the generated licenses/npm/inventory.json in the release. Full license texts are included under licenses/npm/. |
| Direct tunnel helper | WireGuard Go, gVisor, Go runtime, and Go modules; see [native/tunnel/THIRD_PARTY_NOTICES.md](native/tunnel/THIRD_PARTY_NOTICES.md). License copies and sources accompany the packaged helpers. |

## Native desktop player

The separate Moonlight executable and Lanto's native integrations are GPL-3.0. The player retains its own LICENSE. Full native source materials are downloadable beside the corresponding release binary, including pinned revisions, patches, source dependencies, and build scripts.

| Component | License / source |
| --- | --- |
| Moonlight Qt and common C code | GPL-3.0; [Moonlight Qt](https://github.com/moonlight-stream/moonlight-qt), [common C](https://github.com/moonlight-stream/moonlight-common-c) |
| Qt 5.15.2 | LGPL-3.0/GPL-3.0 and module-specific third-party notices; [Qt source](https://download.qt.io/archive/qt/5.15/5.15.2/single/). The Qt Virtual Keyboard module uses GPL terms. DLLs remain dynamically replaceable. |
| FFmpeg | LGPL-2.1-or-later for this upstream dependency build; [source](https://github.com/FFmpeg/FFmpeg). Its pinned configuration does not enable GPL codecs. |
| libplacebo | LGPL-2.1-or-later; [source](https://code.videolan.org/videolan/libplacebo) |
| SDL, sdl2-compat, SDL_ttf | zlib; [SDL](https://github.com/libsdl-org/SDL), with bundled FreeType and HarfBuzz notices retained |
| OpenSSL | Apache-2.0; [source](https://github.com/openssl/openssl) |
| Opus and dav1d | BSD licenses; [Opus](https://github.com/xiph/opus), [dav1d](https://code.videolan.org/videolan/dav1d) |
| shaderc and SPIR-V tools | Apache-2.0 and dependency notices; source revisions follow the Vulkan SDK 1.4.363.0 manifest |
| qmdnsengine, ENet, nanors, Discord RPC, Detours, controller mappings | Their respective MIT/BSD/permissive notices are retained in the native license collection |
| ICU, libpng, zlib, Zstandard, JPEG, ANGLE, Mesa | Their respective Unicode/MIT, PNG/zlib, BSD, IJG and other included notices; these support the Qt runtime |
| Microsoft Visual C++ runtime and Direct3D compiler | Microsoft redistributable terms, not MIT or GPL. These are unmodified runtime binaries. See [Microsoft redistribution guidance](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170). |

The release's resources/media/licenses/ directory contains native dependency license copies and a source inventory. Qt's full source archive and the packaging recipe are provided on the release page. Users may replace the LGPL DLLs with compatible modified versions and reverse engineer the combined application to debug those modifications under the applicable license terms.

## Provisioned separately

The SSH setup wizard downloads official Sunshine and Node.js packages when needed. They are not embedded in the controller archive. Sunshine is GPL-3.0; Node.js uses MIT and third-party notices. Their original installers and upstream licensing apply. The custom experimental macOS Sunshine app is source-only in this release.

WireGuard, Windows, macOS, Linux, and other project/product names belong to their respective owners. This project is independently developed and does not imply affiliation or endorsement.
