# Licensing

## Lanto's original work

The root [MIT License](LICENSE) applies to Lanto's original controller, Host, direct tunnel helper, deployment scripts, artwork, and documentation, except for the native integrations listed below and material carrying its own notice. Existing third-party copyright and license notices remain in force.

MIT was selected because it is a short, widely used permissive license that permits commercial use, modification, and redistribution with attribution and the license notice. Apache-2.0 was also considered; its explicit patent terms are useful, but MIT keeps this project's original-code licensing simple. Neither choice can relicense somebody else's dependencies.

## Native integration scope

The following material is distributed under GPL-3.0, following the respective upstream projects. See [native/COPYING](native/COPYING) and the upstream file notices for any later-version permissions:

- `native/patches/moonlight-*.patch` and `native/moonlight/`, integrated into Moonlight Qt.
- `native/patches/sunshine-*.patch` and `native/sunshine/`, integrated into Sunshine.
- Native test programs in `native/tests/` that compile those integration sources.

The original build and packaging scripts remain MIT. `native/tunnel/` is original MIT code linking the dependencies documented in its [third-party notices](native/tunnel/THIRD_PARTY_NOTICES.md).

The packaged controller launches the native player as a separate executable. The combined download contains multiple separately licensed components; it must not be described as wholly MIT licensed. Keep the native player's GPL notice and the dependency notices with redistributed packages. When distributing modified native binaries, provide their complete corresponding source and build materials under the applicable licenses.

## Release materials

Every public native binary release must have matching source materials beside its binary download. Those materials include the pinned Moonlight tree and recursive submodules, Lanto patches and integration sources, dependency sources and their build scripts, and the Qt source and packaging recipe used for the supplied DLLs. SHA-256 checksums identify the downloadable artifacts. Source archives are distinct from GitHub's automatic Lanto source archive, which does not contain upstream dependency sources.

Sunshine and Node.js target installers are fetched from their upstream releases during provisioning; their binaries are not embedded in the controller download. The experimental custom Sunshine app is not distributed in this release. Its patch and build instructions are available for users who build it themselves.

## References and documentation examples

- [MIT license explained by Choose a License](https://choosealicense.com/licenses/mit/).
- [Apache-2.0 license](https://choosealicense.com/licenses/apache-2.0/).
- [Moonlight Qt](https://github.com/moonlight-stream/moonlight-qt): native-client build instructions, GPL license, and release packaging.
- [Sunshine](https://github.com/LizardByte/Sunshine): host installation, permissions, and upstream licensing.
- [LocalSend](https://github.com/localsend/localsend): clear download, platform support, screenshots, and contributor guidance under Apache-2.0.

These projects informed the organization of Lanto's public documentation. Their branding and product claims are not reused as Lanto claims.
