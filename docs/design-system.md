# Interface and Brand Guidelines

Updated 2026-10-17. Lanto uses a graphite gray background, mist blue accent color, and warm white text. Device cards, Settings, Host pairing, dropdown menus, and the clipboard popover use the same set of colors, corner radii, spacing, and interaction states.

## Research and Tradeoffs

First reviewed component projects on GitHub and official interaction documentation, then implemented the design to fit the existing Electron/React structure:

| Source | Design principles adopted | Implementation in Lanto |
| --- | --- | --- |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | Lightweight surfaces, clear action hierarchy, composable components | Primary buttons, secondary buttons, icon buttons, and compact toolbars are differentiated by priority; a standalone WorkspaceControls component |
| [Radix Themes](https://github.com/radix-ui/themes) and[color guidelines](https://www.radix-ui.com/themes/docs/theme/color) | Neutral scale and accent colors have distinct roles; colors are reused by semantic meaning | Backgrounds, panels, inputs, hover states, borders, text, and accent colors are defined centrally as CSS variables |
| [Radix Select](https://www.radix-ui.com/primitives/docs/components/select) | Clear selected states, keyboard navigation, and focus feedback | All dropdown items use consistent selected backgrounds, checkmarks, hover states, and focus states |
| [Headless UI](https://github.com/tailwindlabs/headlessui) and[Listbox](https://headlessui.com/react/listbox) | Consider visual styling together with complete interaction semantics | Keep the native select, supporting arrow keys, Enter, Esc, and keyboard focus |

The current Electron 44.7.2 uses Chromium 152, which supports[customizable native select](https://developer.chrome.com/blog/a-customizable-select). Therefore, `appearance: base-select` and `::picker(select)` is used for a consistent popup menu; the popup layer is managed by the browser and is not clipped by the Settings panel’s scroll area. The packages mentioned above were not added, and their logos or component source code were not copied. Revalidate selector support and keyboard behavior when upgrading or replacing Electron.

## Colors and Sizes

| Use | Color value |
| --- | --- |
| Page background | `#14171c` |
| Card/popover | `#1c2027` |
| Raised surface/dropdown menu | `#242932` |
| Primary text | `#f0f1f4` |
| Secondary text | `#99a4b5` |
| Primary accent color | `#a6c4f5` |
| Accent background | `#253349` |
| Online status | `#9dcbbd` |

Standard controls have a 9px corner radius, cards and popovers 14px, and the Settings dialog 18px. Status colors are used for online, warning, and error states; the three operating systems are no longer assigned unrelated background colors. Icons use a consistent stroke width; control animations are about 140ms and respect the system’s reduced motion preference.

## Layout and Interaction

At the top of the Devices page, items are arranged as “Shared Clipboard,” “Performance Data,” “Connect Host,” and “Add Device.” The first two toggle directly and save their settings; Performance Data takes effect on the next connection, and its prompt retains the current session’s shortcut instructions.

The arrow to the right of Clipboard opens a native browser Popover containing file sharing, online count, progress, cancel, and receive directory. Click outside or press Esc to close it. When Shared Clipboard is off, the Shared Files toggle is disabled. The clipboard status bar is no longer shown at the bottom of the Devices page.

The Settings dialog retains a fixed action area at the bottom in a minimum 680×480 window, with a scrollable form in the middle; the top toolbar wraps in a narrow window. Tab/Shift+Tab cycles through the dialog, and focus returns to the entry point after it closes. When a dropdown menu is open, the first Esc closes only the menu; the second closes Settings.

## Logo

Reference existing marks in the OpenKeylet and Bricktone repositories on the same machine: OpenKeylet uses a dark geometric frame and a short orange bar to create clear negative space; Bricktone uses light/cyan blocks and a dark rounded base. Both establish recognition with a small number of shapes.

Lanto’s new graphic consists of a warm white L shape and opposing mist blue angles, with a continuous channel left between them to express a connection between two workspaces. It keeps straight clipped corners and large color blocks so it remains recognizable at small title bar and taskbar sizes. The controller uses a dark base; the display client uses a mist blue base with the same foreground structure to distinguish the window’s purpose.

`assets/lanto.svg` and `assets/lanto-stream.svg` is the vector source file.`npm run icons` Generate a 256px PNG and an ICO containing 16, 24, 32, 48, 64, 128, and 256px sizes. Update both variants when changing the shape; the title bar references the SVG directly. Native player builds update both the Qt internal icon and the Windows EXE resource, and incremental builds must also recompile the icon resource.

## Verification

A real Electron smoke test covers the two top toggles, the file toggle dependency, closing the Popover with Esc, saving and restoring preferences after restart, keyboard selection in the native menu, separate Esc behavior for menus and dialogs, Tab focus cycling, and focus returning after close. Screenshots of the main interface, Settings, and expanded menu at 900×620 and 680×480 are checked to confirm there is no horizontal overflow and the bottom action buttons remain visible. See the validation record at [verification.md](verification.md)。
