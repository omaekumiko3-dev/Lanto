#pragma once
#ifdef _WIN32
#include <windows.h>

// Shared only among one controller's broker and its players. No key text is stored or logged.
struct LantoKeyState {
    DWORD controller;
    DWORD broker;
    volatile LONG owner;
    volatile LONG sequence;
    volatile LONG binding;
    BYTE down[256];
    BYTE swallowed[256];

    int modifiers() const {
        return ((down[VK_LSHIFT] || down[VK_RSHIFT]) ? 1 : 0) |
               ((down[VK_LCONTROL] || down[VK_RCONTROL]) ? 2 : 0) |
               ((down[VK_LMENU] || down[VK_RMENU]) ? 4 : 0) |
               ((down[VK_LWIN] || down[VK_RWIN]) ? 8 : 0);
    }
    bool edge(DWORD key, bool pressed) {
        if (key > 255) return false;
        const bool repeat = down[key] != 0;
        down[key] = pressed;
        if (swallowed[key]) {
            if (!pressed) swallowed[key] = false;
            return true;
        }
        const LONG shortcut = InterlockedCompareExchange(&binding, 0, 0);
        if (pressed && !repeat && key == static_cast<DWORD>(shortcut & 255) && modifiers() == (shortcut >> 8)) {
            swallowed[key] = true;
            InterlockedIncrement(&sequence);
            return true;
        }
        return false;
    }
};

// Installed after SDL's keyboard grab, so it sees physical modifier edges before SDL consumes them.
// The selected locked player retains ownership across blur; otherwise the foreground
// player handles remote input and the broker handles local windows.
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
    bool open(const wchar_t* name, bool broker, DWORD controller = 0) {
        m_Local = broker;
        m_Map = broker ? CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, sizeof(LantoKeyState), name)
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
    void setModifiersCallback(void (*callback)(int)) { m_ModifiersCallback = callback; }
    bool blocksLocalInput(DWORD foreground) const {
        return m_Guard && available() && foreground != GetCurrentProcessId();
    }
    bool routeKey(DWORD key, bool down, DWORD foreground) {
        if (!available()) return false;
        const bool owns = m_Local ? !m_State->owner || foreground != static_cast<DWORD>(m_State->owner)
                                 : m_Guard || foreground == GetCurrentProcessId();
        if (!owns) return false;
        const LONG before = m_State->sequence;
        const bool consumed = m_State->edge(key, down);
        // Preserve physical modifiers across handoffs, including temporary blur.
        if (m_ModifiersCallback) m_ModifiersCallback(m_State->modifiers());
        if (before != m_State->sequence) AllowSetForegroundWindow(m_State->controller);
        return consumed || blocksLocalInput(foreground);
    }
    void guardForeground(bool enabled) {
        m_Guard = enabled && !m_Local;
        if (m_Guard) {
            DWORD foreground = 0;
            GetWindowThreadProcessId(GetForegroundWindow(), &foreground);
            if (foreground == GetCurrentProcessId()) {
                m_ForegroundLocked = LockSetForegroundWindow(LSFW_LOCK) != FALSE;
            } else if (m_ForegroundLocked) {
                // Let the controller restore this window if an OS activation
                // bypassed the lock. Input remains guarded until focus returns.
                LockSetForegroundWindow(LSFW_UNLOCK);
                m_ForegroundLocked = false;
            }
        } else if (m_ForegroundLocked) {
            LockSetForegroundWindow(LSFW_UNLOCK);
            m_ForegroundLocked = false;
        }
    }
    bool activate(bool active) {
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
        if (m_Hook && m_ModifiersCallback) m_ModifiersCallback(m_State->modifiers());
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
            if (event->scanCode != 0x21d) {
                const bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                // While focus is being restored, never type into the local popup.
                if (self->routeKey(event->vkCode, down, foreground)) return 1;
            }
            // SDL's synthetic AltGr Ctrl edge must also stay out of a local popup.
            if (self->blocksLocalInput(foreground)) return 1;
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
    bool m_Local = false;
    bool m_Guard = false;
    bool m_ForegroundLocked = false;
    void (*m_ModifiersCallback)(int) = nullptr;
};
#endif
