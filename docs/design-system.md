# UI and Brand Guidelines

Updated 2026-10-17. Lanto uses a graphite background, mist-blue accents, and warm-white text. Device cards, settings, Host pairing, dropdowns, and the clipboard popover share colors, radii, spacing, and interaction states.

## Research and decisions

Component projects on GitHub and official interaction documentation were reviewed before implementation within the existing Electron/React structure:

| Source | Adopted principle | Application in Lanto |
| --- | --- | --- |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | Light surfaces, clear action hierarchy, composable components | Primary, secondary, and icon button hierarchy; compact toolbar; separate WorkspaceControls component |
| [Radix Themes](https://github.com/radix-ui/themes) and [color guidance](https://www.radix-ui.com/themes/docs/theme/color) | Distinct neutral/accent roles and semantic color reuse | Central CSS variables for backgrounds, panels, inputs, hover, borders, text, and accents |
| [Radix Select](https://www.radix-ui.com/primitives/docs/components/select) | Clear selection, keyboard navigation, and focus feedback | Consistent selected backgrounds, checkmarks, hover, and focus for every dropdown |
| [Headless UI](https://github.com/tailwindlabs/headlessui) and [Listbox](https://headlessui.com/react/listbox) | Visual style with complete interaction semantics | Native select retained for arrow keys, Enter, Esc, and keyboard focus |

Electron 44.7.2 uses Chromium 152, which supports [customizable native select](https://developer.chrome.com/blog/a-customizable-select). `appearance: base-select` and `::picker(select)` therefore style menus consistently. Browser-managed popups are not clipped by the scrolling settings panel. None of the above component packages were installed, and their logos or component source were not copied. Revalidate selector support and keyboard behavior when upgrading or replacing Electron.

## Colors and dimensions

| Role | Value |
| --- | --- |
| Page background | `#14171c` |
| Cards/popovers | `#1c2027` |
| Raised surfaces/dropdowns | `#242932` |
| Primary text | `#f0f1f4` |
| Secondary text | `#99a4b5` |
| Primary accent | `#a6c4f5` |
| Accent background | `#253349` |
| Online status | `#9dcbbd` |

Standard controls use 9px radii, cards/popovers 14px, and Settings dialogs 18px. Status colors indicate online, warning, and error states instead of unrelated backgrounds for the three operating systems. Icons share one stroke width. Control transitions last approximately 140ms and respect reduced-motion preferences.

## Layout and interactions

The device toolbar orders **Shared clipboard**, **Performance data**, **Connect Host**, and **Add device**. The first two toggle and save directly. Performance data applies on the next connection; its tooltip preserves the shortcut for the current session.

The arrow beside clipboard sharing opens a native browser Popover containing file sharing, online counts, progress, cancellation, and the receiving directory. Clicking outside or pressing Esc closes it. File sharing is disabled while clipboard sharing is off. The device page no longer has a bottom clipboard status bar.

At the minimum 680×480 window size, Settings retains a fixed footer and scrollable central form. The top toolbar wraps in narrow windows. Tab/Shift+Tab cycle within the dialog, and closing it restores focus to its trigger. With a dropdown open, the first Esc closes the menu; the second closes Settings.

## Logo

The existing OpenKeylet and Bricktone marks in local repositories were references. OpenKeylet uses a dark geometric frame and short orange bar to define negative space; Bricktone uses light/cyan planes and a dark rounded base. Both use a small number of shapes for recognition.

Lanto combines a warm-white L with opposing mist-blue corners, leaving a continuous channel between them to suggest connected workspaces. Straight cut corners and broad planes remain recognizable in title-bar and taskbar sizes. The controller uses a dark base; the display client uses a mist-blue base with the same foreground structure to distinguish their purposes.

`assets/lanto.svg` and `assets/lanto-stream.svg` are the vector sources. `npm run icons` generates 256px PNGs and ICOs at 16, 24, 32, 48, 64, 128, and 256px. Shape changes must update both variants; the title bar uses SVG directly. Native player builds update both internal Qt icons and Windows EXE resources, and incremental builds must recompile icon resources too.

At controller startup on Windows, the ICO is written to a content-hashed user cache path. The window receives explicit AppUserModelID, relaunch-command, and icon-resource properties. Existing Lanto desktop/taskbar shortcuts pointing to the same program and arguments are updated. Icon paths resolve physically to support launcher mappings of AppData. Logo updates therefore avoid reusing the old Shell icon-cache key without deleting the system icon cache or restarting Explorer. Isolated smoke runs do not modify everyday shortcuts.

## Verification

Real Electron smoke tests cover both top switches, the file-switch dependency, Popover Esc dismissal, preference persistence and restart recovery, native-menu keyboard selection, layered menu/dialog Esc behavior, Tab focus trapping, and focus restoration. Main-page, Settings, and expanded-menu screenshots are checked at 900×620 and 680×480 for horizontal overflow and visible footer actions. See [verification.md](verification.md).
