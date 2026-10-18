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
// Only the foreground player mutates the shared state. The broker handles all local windows.
class LantoSwitchHook {
public:
    LantoSwitchHook() = default;
    ~LantoSwitchHook() {
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
    bool activate(bool active) {
        if (m_Hook) {
            UnhookWindowsHookEx(m_Hook);
            m_Hook = nullptr;
            if (!m_Local && m_State) InterlockedCompareExchange(&m_State->owner, 0, GetCurrentProcessId());
        }
        if (!active) return true;
        if (!available()) return false;
        instance() = this;
        m_Hook = SetWindowsHookExW(WH_KEYBOARD_LL, callback, GetModuleHandleW(nullptr), 0);
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
            bool owns = self->m_Local ? !self->m_State->owner || foreground != static_cast<DWORD>(self->m_State->owner) : foreground == GetCurrentProcessId();
            if (owns && event->scanCode != 0x21d) {
                const bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                const LONG before = self->m_State->sequence;
                const bool consumed = self->m_State->edge(event->vkCode, down);
                // Seed SDL on handoff and keep its modifier state aligned with physical edges,
                // even when a modifier was already down before this window gained focus.
                if (self->m_ModifiersCallback) self->m_ModifiersCallback(self->m_State->modifiers());
                if (consumed) {
                    if (before != self->m_State->sequence) AllowSetForegroundWindow(self->m_State->controller);
                    return 1;
                }
            }
        }
        return CallNextHookEx(nullptr, code, message, data);
    }
    HANDLE m_Map = nullptr;
    HANDLE m_Broker = nullptr;
    HHOOK m_Hook = nullptr;
    LantoKeyState* m_State = nullptr;
    bool m_Local = false;
    void (*m_ModifiersCallback)(int) = nullptr;
};
#endif
