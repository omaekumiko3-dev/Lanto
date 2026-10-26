#pragma once
#include <array>
#include <cstdint>

// Process-local observations from the Windows hook, independent of SDL's queue.
// A hold is armed only after an observed native down. Unknown state never releases
// a key, and replacing the hook invalidates observations from the previous hook.
class LantoPhysicalKeys {
public:
    void reset() {
        m_State.fill(0);
        if (++m_Epoch == 0) ++m_Epoch;
    }

    void observe(unsigned scan, bool extended, bool down) {
        if (scan == 0 || scan > 255) return;
        m_State[scan | (extended ? 256 : 0)] = down ? 1 : 2;
    }

    std::uint64_t hold(std::uint32_t key) const {
        const auto scan = scanCode(key);
        return scan && m_State[scan] == 1 ? (std::uint64_t(m_Epoch) << 32) | scan : 0;
    }

    bool released(std::uint64_t hold) const {
        const auto scan = static_cast<unsigned>(hold & 0xffffffff);
        return (hold >> 32) == m_Epoch && scan > 0 && scan < m_State.size() && m_State[scan] == 2;
    }

    // Stream keys use physical QWERTY VK codes, not the user's active layout.
    // Match hardware scan codes so AZERTY/Dvorak and NumLock cannot alias holds.
    // Unmapped/international non-normalized keys retain ordinary release handling.
    static unsigned scanCode(std::uint32_t key) {
        if (key >> 24) return 0;
        const auto vk = key & 255;
        const bool extended = ((key >> 16) & 255) != 0;
        constexpr unsigned letters[] = {
            0x1e, 0x30, 0x2e, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17,
            0x24, 0x25, 0x26, 0x32, 0x31, 0x18, 0x19, 0x10, 0x13,
            0x1f, 0x14, 0x16, 0x2f, 0x11, 0x2d, 0x15, 0x2c
        };
        constexpr unsigned numbers[] = {0x0b, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a};
        constexpr unsigned keypad[] = {0x52, 0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49};
        if (vk >= 0x41 && vk <= 0x5a) return letters[vk - 0x41];
        if (vk >= 0x30 && vk <= 0x39) return numbers[vk - 0x30];
        if (vk >= 0x60 && vk <= 0x69) return keypad[vk - 0x60];
        if (vk >= 0x70 && vk <= 0x79) return 0x3b + vk - 0x70;
        switch (vk) {
        case 0x08: return 0x0e; // Backspace
        case 0x09: return 0x0f; // Tab
        case 0x0d: return extended ? 0x11c : 0x1c;
        case 0x14: return 0x3a; // Caps Lock
        case 0x1b: return 0x01; // Escape
        case 0x20: return 0x39; // Space
        case 0x21: return 0x149; // Page Up
        case 0x22: return 0x151; // Page Down
        case 0x23: return 0x14f; // End
        case 0x24: return 0x147; // Home
        case 0x25: return 0x14b; // Left
        case 0x26: return 0x148; // Up
        case 0x27: return 0x14d; // Right
        case 0x28: return 0x150; // Down
        case 0x2c: return 0x137; // Print Screen
        case 0x2d: return 0x152; // Insert
        case 0x2e: return 0x153; // Delete
        case 0x5b: return 0x15b; // Left Windows
        case 0x5c: return 0x15c; // Right Windows
        case 0x5d: return 0x15d; // Application
        case 0x6a: return 0x37; // Keypad multiply
        case 0x6b: return 0x4e; // Keypad add
        case 0x6d: return 0x4a; // Keypad subtract
        case 0x6e: return 0x53; // Keypad decimal
        case 0x6f: return 0x135; // Keypad divide
        case 0x7a: return 0x57; // F11
        case 0x7b: return 0x58; // F12
        case 0x91: return 0x46; // Scroll Lock
        case 0xa0: return 0x2a; // Left Shift
        case 0xa1: return 0x36; // Right Shift
        case 0xa2: return 0x1d; // Left Ctrl
        case 0xa3: return 0x11d; // Right Ctrl
        case 0xa4: return 0x38; // Left Alt
        case 0xa5: return 0x138; // Right Alt
        case 0xba: return 0x27; // Semicolon
        case 0xbb: return 0x0d; // Equals
        case 0xbc: return 0x33; // Comma
        case 0xbd: return 0x0c; // Minus
        case 0xbe: return 0x34; // Period
        case 0xbf: return 0x35; // Slash
        case 0xc0: return 0x29; // Grave
        case 0xdb: return 0x1a; // Left bracket
        case 0xdc: return 0x2b; // Backslash
        case 0xdd: return 0x1b; // Right bracket
        case 0xde: return 0x28; // Apostrophe
        case 0xe2: return 0x56; // Non-US backslash
        default: return 0;
        }
    }

private:
    std::array<unsigned char, 512> m_State{};
    std::uint32_t m_Epoch = 1;
};
