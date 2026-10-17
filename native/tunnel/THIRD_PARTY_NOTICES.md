# Third-party notices

The direct tunnel helper links the packages pinned in `go.mod` and `go.sum`. Copies of their license texts are included in `licenses/` and in the packaged helper source folder.

| Component | Source | License copy |
| --- | --- | --- |
| WireGuard Go | https://git.zx2c4.com/wireguard-go/ | `licenses/wireguard-go.txt` (MIT) |
| gVisor userspace networking | https://github.com/google/gvisor | `licenses/gvisor.txt` (Apache 2.0 and included notices) |
| Google B-tree | https://github.com/google/btree | `licenses/google-btree.txt` (Apache 2.0) |
| Go runtime | https://go.dev/ | `licenses/go-runtime.txt` (BSD 3-Clause) |
| Go supplementary crypto, net, sys, time modules | https://go.googlesource.com/ | `licenses/go-x-*.txt` (BSD 3-Clause) |
| Wintun Go dependency | https://git.zx2c4.com/wintun-go/ | `licenses/wintun-go.txt` (MIT) |

The application uses `CreateNetTUN`, a userspace implementation. It does not install or use the Wintun driver. Wintun's Go module remains an upstream module dependency. WireGuard is a registered trademark of Jason A. Donenfeld; this project is independently developed.
