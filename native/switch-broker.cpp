#define WIN32_LEAN_AND_MEAN
#include "moonlight/switch-keys.h"
#include <cstdio>
#include <string>
#include <thread>
#include <sstream>
#include <iostream>
#include <cassert>

static UINT flags(int modifiers) {
    return MOD_NOREPEAT | ((modifiers & 1) ? MOD_SHIFT : 0) | ((modifiers & 2) ? MOD_CONTROL : 0) |
        ((modifiers & 4) ? MOD_ALT : 0) | ((modifiers & 8) ? MOD_WIN : 0);
}
static int testEdges() {
    LantoKeyState state{};
    state.binding = VK_OEM_3 | (4 << 8);
    assert(!state.edge(VK_LMENU, true));
    for (int i = 0; i < 12; i++) {
        assert(state.edge(VK_OEM_3, true));
        for (int repeat = 0; repeat < 8; repeat++) assert(state.edge(VK_OEM_3, true));
        assert(state.sequence == i + 1);
        // Simulate handing ownership to another player or the local broker while Alt stays down.
        state.owner = (i % 3) * 100;
        assert(state.edge(VK_OEM_3, false));
    }
    assert(!state.edge(VK_LMENU, false));
    assert(!state.edge(VK_OEM_3, true));
    assert(!state.edge(VK_OEM_3, false));
    assert(state.sequence == 12);
    state.edge(VK_LMENU, true); state.edge(VK_LSHIFT, true);
    assert(!state.edge(VK_OEM_3, true));
    state.edge(VK_OEM_3, false); state.edge(VK_LSHIFT, false);
    assert(state.edge(VK_OEM_3, true));
    state.edge(VK_LMENU, false);
    assert(state.edge(VK_OEM_3, false));
    assert(state.sequence == 13);
    const auto name = L"Local\\LantoSwitch-test-" + std::to_wstring(GetCurrentProcessId());
    LantoSwitchHook local;
    assert(local.open(name.c_str(), true, GetCurrentProcessId()));
    LantoSwitchHook remote;
    assert(remote.open(name.c_str(), false));
    local.state()->binding = VK_OEM_3 | (4 << 8);
    local.state()->edge(VK_LMENU, true);
    assert(remote.state()->edge(VK_OEM_3, true));
    assert(local.state()->sequence == 1);
    assert(local.state()->edge(VK_OEM_3, false));
    assert(remote.state()->edge(VK_OEM_3, true));
    assert(local.state()->sequence == 2);
    remote.state()->edge(VK_OEM_3, false);
    remote.state()->edge(VK_LMENU, false);
    assert(local.state()->modifiers() == 0);
    std::puts("Switch key edge tests passed");
    return 0;
}
int wmain(int argc, wchar_t** argv) {
    if (argc == 2 && std::wstring(argv[1]) == L"--test") return testEdges();
    if (argc != 5) return 2;
    const DWORD controller = wcstoul(argv[1], nullptr, 10);
    HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, controller);
    if (!parent) return 3;
    LantoSwitchHook hook;
    if (!hook.open(argv[2], true, controller)) return 4;
    int key = _wtoi(argv[3]), modifiers = _wtoi(argv[4]);
    if (key < 1 || key > 255 || modifiers < 1 || modifiers > 15) return 5;
    if (!RegisterHotKey(nullptr, 1, flags(modifiers), key)) return 6;
    hook.state()->binding = key | (modifiers << 8);
    if (!hook.activate(true)) return 7;
    MSG message;
    PeekMessageW(&message, nullptr, 0, 0, PM_NOREMOVE);
    const DWORD threadId = GetCurrentThreadId();
    std::thread([threadId]() {
        std::string line;
        while (std::getline(std::cin, line)) {
            int key = 0, modifiers = 0;
            std::istringstream command(line);
            if (command >> key >> modifiers && key > 0 && key < 256 && modifiers > 0 && modifiers < 16)
                PostThreadMessageW(threadId, WM_APP + 1, key, modifiers);
        }
        PostThreadMessageW(threadId, WM_QUIT, 0, 0);
    }).detach();
    SetTimer(nullptr, 1, 10, nullptr);
    std::puts("READY"); std::fflush(stdout);
    LONG sequence = 0;
    int registration = 1;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        if (WaitForSingleObject(parent, 0) != WAIT_TIMEOUT) break;
        if (message.message == WM_APP + 1) {
            const int nextKey = static_cast<int>(message.wParam), nextModifiers = static_cast<int>(message.lParam);
            const int nextRegistration = registration == 1 ? 2 : 1;
            if ((nextKey == key && nextModifiers == modifiers) || RegisterHotKey(nullptr, nextRegistration, flags(nextModifiers), nextKey)) {
                if (nextKey != key || nextModifiers != modifiers) {
                    UnregisterHotKey(nullptr, registration); registration = nextRegistration;
                    key = nextKey; modifiers = nextModifiers;
                    InterlockedExchange(&hook.state()->binding, key | (modifiers << 8));
                }
                std::puts("BOUND");
            } else std::puts("CONFLICT");
            std::fflush(stdout);
        }
        // A single ordered sequence prevents duplicate notifications across hook handoffs.
        while (sequence != hook.state()->sequence) { ++sequence; std::puts("SWITCH"); }
        std::fflush(stdout);
        TranslateMessage(&message); DispatchMessageW(&message);
    }
    UnregisterHotKey(nullptr, registration);
    CloseHandle(parent);
    return 0;
}
