#pragma once
#ifdef _WIN32
#include <windows.h>
#include <initializer_list>
#include "physical-keys.h"

// Shared only among one controller's broker and its players. No key text is stored or logged.
struct LantoKeyState {
    DWORD controller;
    DWORD broker;
    volatile LONG owner;
    volatile LONG sequence;
    volatile LONG binding;
    BYTE down[256];
    BYTE swallowed[256];
    volatile LONG emergency;
    DWORD escapeTimes[3];
    unsigned escapeCount;
    volatile LONG resumed;

    int modifierKeys() const {
        return (down[VK_LSHIFT] ? 1 : 0) | (down[VK_RSHIFT] ? 2 : 0) |
               (down[VK_LCONTROL] ? 4 : 0) | (down[VK_RCONTROL] ? 8 : 0) |
               (down[VK_LMENU] ? 16 : 0) | (down[VK_RMENU] ? 32 : 0) |
               (down[VK_LWIN] ? 64 : 0) | (down[VK_RWIN] ? 128 : 0);
    }
    int modifiers() const {
        return ((down[VK_LSHIFT] || down[VK_RSHIFT]) ? 1 : 0) |
               ((down[VK_LCONTROL] || down[VK_RCONTROL]) ? 2 : 0) |
               ((down[VK_LMENU] || down[VK_RMENU]) ? 4 : 0) |
               ((down[VK_LWIN] || down[VK_RWIN]) ? 8 : 0);
    }
    bool edge(DWORD key, bool pressed, void (*beforeSwitch)(void*) = nullptr, void* context = nullptr,
              DWORD now = GetTickCount()) {
        if (key > 255) return false;
        const bool repeat = down[key] != 0;
        down[key] = pressed;
        if (swallowed[key]) {
            if (!pressed) swallowed[key] = false;
            return true;
        }
        if (pressed && !repeat) {
            if (key == VK_ESCAPE && owner != 0) {
                unsigned kept = 0;
                for (unsigned i = 0; i < escapeCount; ++i)
                    if (now - escapeTimes[i] <= 1000) escapeTimes[kept++] = escapeTimes[i];
                escapeTimes[kept++] = now;
                escapeCount = kept;
                if (kept == 3) {
                    escapeCount = 0;
                    swallowed[key] = true;
                    if (beforeSwitch) beforeSwitch(context);
                    InterlockedIncrement(&emergency);
                    return true;
                }
            } else escapeCount = 0;
        }
        const LONG shortcut = InterlockedCompareExchange(&binding, 0, 0);
        if (pressed && !repeat && key == static_cast<DWORD>(shortcut & 255) && modifiers() == (shortcut >> 8)) {
            swallowed[key] = true;
            // Grant activation before the broker can observe the request.
            if (beforeSwitch) beforeSwitch(context);
            InterlockedIncrement(&sequence);
            return true;
        }
        return false;
    }
};

// Installed after SDL's keyboard grab, so it sees physical modifier edges before SDL consumes them.
// The selected locked player retains ownership across blur. The independent broker
// also observes the chord, so switching never depends on a player's SDL event thread.
class LantoSwitchHook {
public:
    LantoSwitchHook() = default;
    ~LantoSwitchHook() {
        guardForeground(false);
        activate(false);
        if (m_State) UnmapViewOfFile(m_State);
        if (m_Map) CloseHandle(m_Map);
        if (m_Broker) CloseHandle(m_Broker);
    }
    bool open(const wchar_t* name, bool broker, DWORD controller = 0, SECURITY_ATTRIBUTES* security = nullptr) {
        m_Local = broker;
        m_Map = broker ? CreateFileMappingW(INVALID_HANDLE_VALUE, security, PAGE_READWRITE, 0, sizeof(LantoKeyState), name)
                       : OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, name);
        if (!m_Map) return false;
        if (broker && GetLastError() == ERROR_ALREADY_EXISTS) return false;
        m_State = static_cast<LantoKeyState*>(MapViewOfFile(m_Map, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(LantoKeyState)));
        if (!m_State) return false;
        if (broker) {
            ZeroMemory(m_State, sizeof(*m_State));
            m_State->controller = controller;
            m_State->broker = GetCurrentProcessId();
            for (int key = 0; key < 256; key++) m_State->down[key] = (GetAsyncKeyState(key) & 0x8000) != 0;
        } else m_Broker = OpenProcess(SYNCHRONIZE, FALSE, m_State->broker);
        return broker || m_Broker;
    }
    bool available() const { return m_State && (m_Local || (m_Broker && WaitForSingleObject(m_Broker, 0) == WAIT_TIMEOUT)); }
    LantoKeyState* state() { return m_State; }
    std::uint64_t physicalHold(std::uint32_t key) const {
        return m_Hook && available() ? m_Physical.hold(key) : 0;
    }
    bool physicalReleased(std::uint64_t hold) const {
        return m_Hook && available() && m_Physical.released(hold);
    }
    LONG emergency() const { return m_State ? m_State->emergency : 0; }
    void acknowledgeEmergency(LONG value) { m_EmergencyAck = value; }
    bool blocksLocalInput(DWORD foreground) const {
        return m_Guard && available() && emergency() == m_EmergencyAck && foreground != GetCurrentProcessId();
    }
    bool blocksLocalKey(DWORD key, bool down, DWORD foreground) const {
        // SDL forwards keyups for modifiers that Windows saw before its grab.
        // Swallowing one during focus handoff leaves that modifier held locally.
        // Releases cannot type into the local window; keep blocking all presses.
        const bool modifier = key == VK_SHIFT || key == VK_CONTROL || key == VK_MENU ||
            (key >= VK_LSHIFT && key <= VK_RMENU) || key == VK_LWIN || key == VK_RWIN;
        return blocksLocalInput(foreground) && (down || !modifier);
    }
    bool routeKey(DWORD key, bool down, DWORD foreground) {
        if (!available()) return false;
        const bool owns = m_Local || m_Guard || foreground == GetCurrentProcessId();
        if (!owns) return false;
        const bool consumed = m_State->edge(key, down, [](void* context) {
            auto self = static_cast<LantoSwitchHook*>(context);
            AllowSetForegroundWindow(self->m_State->controller);
        }, this);
        // SDL processes these edges in its own event queue. Changing its modifier
        // state here runs ahead of queued events and can leave a modifier stuck.
        return consumed || blocksLocalKey(key, down, foreground);
    }
    bool registeredShortcut(DWORD key, int modifiers, bool (*pressed)(DWORD)) {
        if (!m_Local || !available() || key < 1 || key > 255 ||
            m_State->binding != static_cast<LONG>(key | (modifiers << 8))) return false;
        // WM_HOTKEY with MOD_NOREPEAT represents a fresh OS-recognized press.
        // A silently removed hook may have missed releases, so its cached down/
        // swallowed bytes cannot veto this recovery path. Reconcile only shared
        // physical state; never seed SDL's independent keyboard state.
        for (DWORD modifier : {VK_LSHIFT, VK_RSHIFT, VK_LCONTROL, VK_RCONTROL,
                               VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN})
            m_State->down[modifier] = pressed(modifier);
        m_State->down[key] = m_State->swallowed[key] = pressed(key);
        AllowSetForegroundWindow(m_State->controller);
        InterlockedIncrement(&m_State->sequence);
        return true;
    }
    void guardForeground(bool enabled) {
        // Keep input guarded across blur without locking out the controller's
        // explicit activation of another player. The controller restores focus.
        m_Guard = enabled && !m_Local;
    }
    bool activate(bool active) {
        m_Physical.reset();
        if (m_MouseHook) { UnhookWindowsHookEx(m_MouseHook); m_MouseHook = nullptr; }
        if (m_Hook) {
            UnhookWindowsHookEx(m_Hook);
            m_Hook = nullptr;
            if (!m_Local && m_State) InterlockedCompareExchange(&m_State->owner, 0, GetCurrentProcessId());
        }
        if (!active) return true;
        if (!available()) return false;
        instance() = this;
        m_Hook = SetWindowsHookExW(WH_KEYBOARD_LL, callback, GetModuleHandleW(nullptr), 0);
        if (m_Hook && m_Guard)
            m_MouseHook = SetWindowsHookExW(WH_MOUSE_LL, mouseCallback, GetModuleHandleW(nullptr), 0);
        if (m_Guard && !m_MouseHook) {
            if (m_Hook) UnhookWindowsHookEx(m_Hook);
            m_Hook = nullptr;
        }
        if (m_Hook && !m_Local) InterlockedExchange(&m_State->owner, GetCurrentProcessId());
        return m_Hook != nullptr;
    }
private:
    static LantoSwitchHook*& instance() { static LantoSwitchHook* hook = nullptr; return hook; }
    static LRESULT CALLBACK callback(int code, WPARAM message, LPARAM data) {
        auto self = instance();
        if (code == HC_ACTION && self && self->available()) {
            auto event = reinterpret_cast<const KBDLLHOOKSTRUCT*>(data);
            DWORD foreground = 0;
            GetWindowThreadProcessId(GetForegroundWindow(), &foreground);
            const bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            if (event->scanCode != 0x21d) {
                self->m_Physical.observe(event->scanCode, (event->flags & LLKHF_EXTENDED) != 0, down);
                // While focus is being restored, never type into the local popup.
                if (self->routeKey(event->vkCode, down, foreground)) return 1;
            } else if (self->blocksLocalKey(event->vkCode, down, foreground)) return 1;
            // The synthetic AltGr Ctrl follows the same release rule, without
            // changing physical modifier state or re-blocking a forwarded keyup.
        }
        return CallNextHookEx(nullptr, code, message, data);
    }
    static LRESULT CALLBACK mouseCallback(int code, WPARAM message, LPARAM data) {
        auto self = instance();
        if (code == HC_ACTION && self) {
            DWORD foreground = 0;
            GetWindowThreadProcessId(GetForegroundWindow(), &foreground);
            if (self->blocksLocalInput(foreground)) return 1;
        }
        return CallNextHookEx(nullptr, code, message, data);
    }
    HANDLE m_Map = nullptr;
    HANDLE m_Broker = nullptr;
    HHOOK m_Hook = nullptr;
    HHOOK m_MouseHook = nullptr;
    LantoKeyState* m_State = nullptr;
    LantoPhysicalKeys m_Physical;
    bool m_Local = false;
    bool m_Guard = false;
    LONG m_EmergencyAck = 0;
};
#endif
