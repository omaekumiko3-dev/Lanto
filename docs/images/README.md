# Documentation images

The product illustrations use the built-in ImageGen tool with screenshots captured from the real Lanto Electron application. The screenshots use an isolated configuration and example device names. IPv4 addresses are from 192.0.2.0/24 and IPv6 addresses from 2001:db8::/32, reserved for documentation.

## Files

- `hero.png`: project hero and actual device dashboard.
- `setup.png`: SSH setup illustration.
- `clipboard.png`: clipboard and file-sharing illustration.
- `tunnel.png`: optional direct-tunnel illustration.
- `screenshots/`: original, unedited application captures.
- `prompts.json`: generation mode, input references, and complete prompts.

Illustrations are explanatory artwork. The original screenshots show the actual interface and state; generated compositions are not evidence of live device connectivity or benchmark results.

## Recreate screenshots

Build the application, then run `node scripts/capture-docs.mjs`. Optionally set `LANTO_DOCS_MOONLIGHT` to a compatible local player executable. The script uses a separate data directory under ignored `work/`, an independent shortcut, and example addresses. It does not connect to those addresses or reuse a personal device list.
