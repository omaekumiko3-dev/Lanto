#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "moonlight/switch-keys.h"
#include <cstdio>
#include <string>
#include <thread>
#include <sstream>
#include <iostream>
#include <cassert>
#include <mutex>
#include <condition_variable>
#include <deque>
#include <atomic>
#include <algorithm>
#include "system-switch.h"

// A frozen controller or a full stdout pipe cannot stall keyboard hooks or Esc.
class Output {
    std::mutex mutex;
    std::condition_variable changed;
    std::deque<std::string> queue;
public:
    Output() {
        std::thread([this]() {
            for (;;) {
                std::string line;
                { std::unique_lock<std::mutex> lock(mutex);
                  changed.wait(lock, [this]() { return !queue.empty(); });
                  line = std::move(queue.front()); queue.pop_front(); }
                if (std::puts(line.c_str()) < 0 || std::fflush(stdout)) ExitProcess(0);
            }
        }).detach();
    }
    void send(std::string line) {
        std::lock_guard<std::mutex> lock(mutex);
        if (line.rfind("EMERGENCY ", 0) == 0)
            queue.erase(std::remove_if(queue.begin(), queue.end(), [](const std::string& item) {
                return item.rfind("SWITCH ", 0) == 0;
            }), queue.end());
        if (line.rfind("SWITCH ", 0) == 0 && !queue.empty() && queue.back().rfind("SWITCH ", 0) == 0)
            queue.back() = std::move(line);
        else if (queue.size() < 256) queue.push_back(std::move(line));
        else ExitProcess(11); // Fail open instead of growing an unbounded privileged queue.
        changed.notify_one();
    }
};
static bool ownedPlayer(DWORD pid, DWORD controller) {
    if (SystemSwitch::parentOf(pid) != controller) return false;
    SystemSwitch::Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
    wchar_t path[32768]; DWORD size = 32768;
    if (!process.value || !QueryFullProcessImageNameW(process, 0, path, &size)) return false;
    const wchar_t* name = wcsrchr(path, L'\\');
    return name && _wcsicmp(name + 1, L"Moonlight.exe") == 0;
}
static std::atomic<bool> activating{false};
static void focusOwned(HWND window, DWORD pid, DWORD controller, LantoKeyState* state) {
    DWORD actual = 0; GetWindowThreadProcessId(window, &actual);
    if (!window || actual != pid) return;
    if (activating.exchange(true)) return;
    const LONG emergency = state->emergency;
    std::thread([window, pid, controller, state, emergency]() {
        if (pid != controller && !ownedPlayer(pid, controller)) { activating = false; return; }
        DWORD foregroundPid = 0;
        const DWORD foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), &foregroundPid);
        const DWORD targetThread = GetWindowThreadProcessId(window, nullptr);
        const DWORD thread = GetCurrentThreadId();
        const bool attached = foregroundThread && foregroundThread != thread && AttachThreadInput(thread, foregroundThread, TRUE);
        const bool attachedTarget = targetThread && targetThread != thread && targetThread != foregroundThread && AttachThreadInput(thread, targetThread, TRUE);
        SetForegroundWindow(window);
        if (attachedTarget) AttachThreadInput(thread, targetThread, FALSE);
        if (attached) AttachThreadInput(thread, foregroundThread, FALSE);
        if (state->emergency != emergency && pid != controller) ShowWindowAsync(window, SW_HIDE);
        activating = false;
    }).detach();
}
struct EmergencyWindows {
    DWORD controller;
    bool terminate;
    std::vector<DWORD> players;
    EmergencyWindows(DWORD parent, bool kill) : controller(parent), terminate(kill) {
        SystemSwitch::Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
        PROCESSENTRY32W entry{sizeof(entry)};
        if (Process32FirstW(snapshot, &entry)) do {
            if (entry.th32ParentProcessID == parent && _wcsicmp(entry.szExeFile, L"Moonlight.exe") == 0)
                players.push_back(entry.th32ProcessID);
        } while (Process32NextW(snapshot, &entry));
    }
};
static BOOL CALLBACK releaseWindow(HWND window, LPARAM data) {
    auto context = reinterpret_cast<EmergencyWindows*>(data);
    DWORD pid = 0; GetWindowThreadProcessId(window, &pid);
    if (std::find(context->players.begin(), context->players.end(), pid) != context->players.end()) {
        if (context->terminate && IsWindowVisible(window)) {
            SystemSwitch::Handle process(OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
            if (process.value && ownedPlayer(pid, context->controller)) TerminateProcess(process, 12);
        } else {
            ShowWindowAsync(window, SW_HIDE);
            SetWindowPos(window, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_ASYNCWINDOWPOS | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
    return TRUE;
}

static UINT flags(int modifiers) {
    return MOD_NOREPEAT | ((modifiers & 1) ? MOD_SHIFT : 0) | ((modifiers & 2) ? MOD_CONTROL : 0) |
        ((modifiers & 4) ? MOD_ALT : 0) | ((modifiers & 8) ? MOD_WIN : 0);
}
static bool registeredSwitch(LantoSwitchHook& hook, const MSG& message,
                             int registration, int key, int modifiers,
                             bool (*pressed)(DWORD)) {
    if (message.message != WM_HOTKEY || message.wParam != static_cast<WPARAM>(registration) ||
        HIWORD(message.lParam) != key ||
        LOWORD(message.lParam) != (flags(modifiers) & ~MOD_NOREPEAT)) return false;
    return hook.registeredShortcut(key, modifiers, pressed);
}
static int testEdges() {
    const auto tap = [](LantoKeyState& value, DWORD now) {
        const bool consumed = value.edge(VK_ESCAPE, true, nullptr, nullptr, now);
        value.edge(VK_ESCAPE, false, nullptr, nullptr, now + 1);
        return consumed;
    };
    LantoKeyState emergency{}; emergency.owner = 1;
    assert(!tap(emergency, 0)); assert(!tap(emergency, 700));
    assert(!tap(emergency, 1100)); assert(tap(emergency, 1300));
    assert(emergency.emergency == 1 && emergency.sequence == 0);
    emergency = {}; emergency.owner = 1;
    assert(!emergency.edge(VK_ESCAPE, true, nullptr, nullptr, 100));
    for (DWORD time = 200; time < 900; time += 100) assert(!emergency.edge(VK_ESCAPE, true, nullptr, nullptr, time));
    assert(emergency.emergency == 0);
    emergency.edge(VK_ESCAPE, false); assert(!tap(emergency, 600)); assert(tap(emergency, 1100));
    emergency = {}; emergency.owner = 1;
    assert(!tap(emergency, 0)); assert(!tap(emergency, 500)); assert(!tap(emergency, 1001));
    emergency.edge('A', true); emergency.edge('A', false);
    assert(!tap(emergency, 1100)); assert(!tap(emergency, 1200)); assert(tap(emergency, 1300));
    emergency = {}; // Local game's ordinary Esc presses never arm the emergency.
    tap(emergency, 0); tap(emergency, 100); tap(emergency, 200); assert(!emergency.emergency);
    emergency.owner = 1;
    tap(emergency, 0xfffffff0); tap(emergency, 0x10); assert(tap(emergency, 0x20));
    assert(SystemSwitch::validMap(L"Local\\LantoSwitch-12345678-abcd-1234-abcd-123456789abc"));
    assert(!SystemSwitch::validMap(L"Local\\LantoSwitch-anything --command"));
    std::puts("Triple Esc: rolling 1000ms, distinct presses, boundary, wraparound, local-only exclusion passed");
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
    // Simulate a popup taking focus mid-chord without sending physical input.
    const DWORD popup = GetCurrentProcessId() + 1;
    remote.guardForeground(true);
    assert(!remote.routeKey('A', true, GetCurrentProcessId())); // SDL owns foreground input.
    assert(remote.routeKey('A', false, popup));
    assert(remote.blocksLocalInput(popup)); // Mouse events use the same ownership barrier.
    assert(!remote.blocksLocalInput(GetCurrentProcessId()));
    assert(remote.routeKey(VK_SNAPSHOT, true, popup));
    assert(remote.routeKey(VK_SNAPSHOT, false, popup));
    assert(remote.routeKey(VK_LMENU, true, popup));
    assert(remote.routeKey(VK_OEM_3, true, popup));
    assert(local.state()->sequence == 3);
    remote.guardForeground(true);
    assert(remote.blocksLocalInput(popup)); // Input stays blocked until selection is applied.
    remote.guardForeground(false);
    assert(!remote.blocksLocalInput(popup));
    assert(!remote.routeKey('A', true, popup));
    assert(local.routeKey(VK_OEM_3, false, popup));
    assert(local.routeKey(VK_OEM_3, true, popup));
    assert(local.state()->sequence == 4); // Alt is still held after returning local.
    local.routeKey(VK_OEM_3, false, popup);
    local.routeKey(VK_LMENU, false, popup);
    // A modifier pressed locally before grabbing a stream must be released to
    // Windows even if focus returns before the player's guard is disabled.
    // SDL remembers these pre-grab downs and forwards their matching keyups.
    const DWORD modifiers[] = {VK_LSHIFT, VK_RSHIFT, VK_LCONTROL, VK_RCONTROL,
                               VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN};
    for (int cycle = 0; cycle < 100; cycle++) {
        for (DWORD modifier : modifiers) {
            remote.guardForeground(false);
            assert(!local.routeKey(modifier, true, popup));
            remote.guardForeground(true);
            assert(!remote.routeKey(modifier, false, popup));
            assert(local.state()->modifiers() == 0);
            // Releasing a modifier must not remove the input protection.
            assert(remote.routeKey('A', true, popup));
            assert(remote.routeKey('A', false, popup));
            assert(remote.routeKey(modifier, true, popup));
            assert(!remote.routeKey(modifier, false, popup));
            assert(remote.blocksLocalInput(popup));
        }
    }
    for (DWORD modifier : {VK_SHIFT, VK_CONTROL, VK_MENU}) {
        assert(remote.blocksLocalKey(modifier, true, popup));
        assert(!remote.blocksLocalKey(modifier, false, popup));
    }
    remote.guardForeground(false);
    // Physical modifiers survive capture changes only in the shared hook state.
    // Never seed SDL flags without corresponding SDL keyboard-state presses:
    // SDL can ignore the eventual keyup and leave Ctrl/Alt logically held.
    const int sides[] = {1, 2, 4, 8, 16, 32, 64, 128};
    for (int cycle = 0; cycle < 100; ++cycle) {
        for (int index = 0; index < 8; ++index) {
            const DWORD modifier = modifiers[index];
            assert(!remote.routeKey(modifier, true, GetCurrentProcessId()));
            assert(remote.state()->modifierKeys() == sides[index]);
            assert(remote.activate(true));
            assert(remote.state()->modifierKeys() == sides[index]);
            assert(!remote.routeKey(modifier, false, GetCurrentProcessId()));
            assert(remote.state()->modifierKeys() == 0);
            assert(remote.activate(false));
        }
    }
    // Both sides may be held together; releasing one must preserve the other.
    remote.state()->edge(VK_LCONTROL, true);
    remote.state()->edge(VK_RCONTROL, true);
    remote.state()->edge(VK_LMENU, true);
    remote.state()->edge(VK_RMENU, true);
    assert(remote.state()->modifierKeys() == (4 | 8 | 16 | 32));
    remote.state()->edge(VK_RCONTROL, false);
    remote.state()->edge(VK_RMENU, false);
    assert(remote.state()->modifierKeys() == (4 | 16));
    remote.state()->edge(VK_LCONTROL, false);
    remote.state()->edge(VK_LMENU, false);
    assert(remote.state()->modifierKeys() == 0 && remote.state()->modifiers() == 0);
    state = {};
    state.binding = VK_OEM_3 | (4 << 8);
    state.edge(VK_LMENU, true);
    bool granted = false;
    struct Handoff { LantoKeyState* state; bool* granted; } handoff{&state, &granted};
    assert(state.edge(VK_OEM_3, true, [](void* context) {
        auto handoff = static_cast<Handoff*>(context);
        assert(handoff->state->sequence == 0); // Activation is granted before publication.
        *handoff->granted = true;
    }, &handoff));
    assert(granted && state.sequence == 1);
    // The independent broker must still recognize the reserved chord when the
    // selected player's hook stops receiving events. Both hook orders must
    // publish exactly once, including held-Alt taps and autorepeat.
    local.state()->binding = VK_OEM_3 | (4 << 8);
    local.state()->owner = GetCurrentProcessId();
    for (int order = 0; order < 2; ++order) {
        auto first = order ? &remote : &local;
        auto second = order ? &local : &remote;
        first->routeKey(VK_LMENU, true, GetCurrentProcessId());
        second->routeKey(VK_LMENU, true, GetCurrentProcessId());
        for (int tap = 0; tap < 100; ++tap) {
            const LONG before = local.state()->sequence;
            if (!first->routeKey(VK_OEM_3, true, GetCurrentProcessId()))
                second->routeKey(VK_OEM_3, true, GetCurrentProcessId());
            for (int repeat = 0; repeat < 5; ++repeat) {
                if (!first->routeKey(VK_OEM_3, true, GetCurrentProcessId()))
                    second->routeKey(VK_OEM_3, true, GetCurrentProcessId());
            }
            assert(local.state()->sequence == before + 1);
            if (!first->routeKey(VK_OEM_3, false, GetCurrentProcessId()))
                second->routeKey(VK_OEM_3, false, GetCurrentProcessId());
        }
        first->routeKey(VK_LMENU, false, GetCurrentProcessId());
        second->routeKey(VK_LMENU, false, GetCurrentProcessId());
    }
    // Only broker edges remain; no player callback is invoked in this cycle.
    const LONG beforeBroker = local.state()->sequence;
    local.routeKey(VK_LMENU, true, GetCurrentProcessId());
    assert(local.routeKey(VK_OEM_3, true, GetCurrentProcessId()));
    assert(local.state()->sequence == beforeBroker + 1);
    local.routeKey(VK_OEM_3, false, GetCurrentProcessId());
    local.routeKey(VK_LMENU, false, GetCurrentProcessId());
    // A real WM_HOTKEY cannot be rejected because a lost hook left stale keys.
    const auto released = [](DWORD) { return false; };
    MSG hotkey{};
    hotkey.message = WM_HOTKEY; hotkey.wParam = 1;
    hotkey.lParam = MAKELPARAM(MOD_ALT, VK_OEM_3);
    local.state()->down[VK_LCONTROL] = true;
    local.state()->down[VK_OEM_3] = local.state()->swallowed[VK_OEM_3] = true;
    const LONG beforeHotkey = local.state()->sequence;
    assert(registeredSwitch(local, hotkey, 1, VK_OEM_3, 4, released));
    assert(local.state()->sequence == beforeHotkey + 1);
    assert(local.state()->modifiers() == 0 && !local.state()->swallowed[VK_OEM_3]);
    hotkey.wParam = 2;
    assert(!registeredSwitch(local, hotkey, 1, VK_OEM_3, 4, released));
    hotkey.wParam = 1; hotkey.lParam = MAKELPARAM(MOD_ALT | MOD_SHIFT, VK_OEM_3);
    assert(!registeredSwitch(local, hotkey, 1, VK_OEM_3, 4, released));
    hotkey.lParam = MAKELPARAM(MOD_ALT, 'A');
    assert(!registeredSwitch(local, hotkey, 1, VK_OEM_3, 4, released));
    hotkey.lParam = MAKELPARAM(MOD_ALT, VK_OEM_3);
    local.state()->binding = 'A' | (2 << 8);
    assert(!registeredSwitch(local, hotkey, 1, VK_OEM_3, 4, released));
    assert(!remote.registeredShortcut('A', 2, released));
    assert(local.state()->sequence == beforeHotkey + 1);
    std::puts("Switch key edge tests passed (800 side-preserving modifier capture/release cycles)");
    std::puts("Independent broker, both hook orders, and stale-state WM_HOTKEY recovery passed");
    return 0;
}
int wmain(int argc, wchar_t** argv) {
    if (argc == 2 && std::wstring(argv[1]) == L"--system-service") return SystemSwitch::service();
    if (argc == 2 && std::wstring(argv[1]) == L"--test") return testEdges();
    bool systemWorker = argc == 7 && std::wstring(argv[1]) == L"--system-worker";
    SystemSwitch::Handle channel;
    if (systemWorker) {
        if (!SystemSwitch::isSystem()) return 20;
        channel.value = CreateFileW(argv[6], GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
        ULONG server = 0;
        if (channel.value == INVALID_HANDLE_VALUE || !GetNamedPipeServerProcessId(channel, &server) || server != SystemSwitch::parentOf(GetCurrentProcessId())) return 21;
        FILE* ignored = nullptr;
        freopen_s(&ignored, "NUL", "r", stdin); freopen_s(&ignored, "NUL", "w", stdout);
        if (!SystemSwitch::attachStdio(channel)) return 22;
        --argc; ++argv; --argc;
    } else if (argc == 5) {
        const int result = SystemSwitch::proxy(argc, argv);
        if (result >= 0) return result;
    }
    if (argc != 5) return 2;
    const DWORD controller = wcstoul(argv[1], nullptr, 10);
    HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, controller);
    if (!parent) return 3;
    LantoSwitchHook hook;
    SystemSwitch::Handle controllerQuery(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, controller));
    SystemSwitch::Security security(SystemSwitch::userSid(controllerQuery));
    if (systemWorker && !security.descriptor) return 23;
    if (!hook.open(argv[2], true, controller, systemWorker ? &security.attributes : nullptr)) return 4;
    int key = _wtoi(argv[3]), modifiers = _wtoi(argv[4]);
    if (key < 1 || key > 255 || modifiers < 1 || modifiers > 15) return 5;
    if (!RegisterHotKey(nullptr, 1, flags(modifiers), key)) return 6;
    hook.state()->binding = key | (modifiers << 8);
    if (!hook.activate(true)) return 7;
    MSG message;
    PeekMessageW(&message, nullptr, 0, 0, PM_NOREMOVE);
    const DWORD threadId = GetCurrentThreadId();
    std::thread([threadId, inputPipe = systemWorker ? channel.value : nullptr]() {
        const auto dispatch = [threadId](const std::string& line) {
            int key = 0, modifiers = 0;
            std::istringstream command(line);
            if (line.rfind("FOCUS ", 0) == 0) {
                std::string name; DWORD pid = 0; uintptr_t window = 0;
                if (command >> name >> pid >> window) PostThreadMessageW(threadId, WM_APP + 2, pid, static_cast<LPARAM>(window));
                return;
            }
            if (command >> key >> modifiers && key > 0 && key < 256 && modifiers > 0 && modifiers < 16)
                PostThreadMessageW(threadId, WM_APP + 1, key, modifiers);
        };
        if (inputPipe) {
            std::string buffer;
            for (;;) {
                DWORD available = 0, read = 0; char bytes[256];
                if (!PeekNamedPipe(inputPipe, nullptr, 0, nullptr, &available, nullptr)) break;
                if (!available) { Sleep(2); continue; }
                if (!ReadFile(inputPipe, bytes, std::min(available, static_cast<DWORD>(sizeof(bytes))), &read, nullptr) || !read) break;
                buffer.append(bytes, read);
                size_t newline;
                while ((newline = buffer.find('\n')) != std::string::npos) {
                    dispatch(buffer.substr(0, newline)); buffer.erase(0, newline + 1);
                }
                if (buffer.size() > 256) break;
            }
        } else {
            std::string line;
            while (std::getline(std::cin, line)) dispatch(line);
        }
        PostThreadMessageW(threadId, WM_QUIT, 0, 0);
    }).detach();
    SetTimer(nullptr, 1, 10, nullptr);
    // Process-owned objects outlive detached workers until ExitProcess below.
    auto output = new Output;
    if (systemWorker) {
        DWORD session = 0; ProcessIdToSessionId(GetCurrentProcessId(), &session);
        output->send("SYSTEM_READY " + std::to_string(GetCurrentProcessId()) + " " + std::to_string(session));
    }
    output->send("READY");
    LONG sequence = 0;
    LONG emergency = 0;
    DWORD emergencyAt = 0;
    bool emergencyPending = false;
    int registration = 1;
    DWORD lastHookRenewal = GetTickCount();
    LONG lastOwner = hook.state()->owner;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        if (WaitForSingleObject(parent, 0) != WAIT_TIMEOUT) break;
        if (message.message == WM_APP + 2)
            focusOwned(reinterpret_cast<HWND>(message.lParam), static_cast<DWORD>(message.wParam), controller, hook.state());
        if (message.message == WM_APP + 1) {
            const int nextKey = static_cast<int>(message.wParam), nextModifiers = static_cast<int>(message.lParam);
            const int nextRegistration = registration == 1 ? 2 : 1;
            if ((nextKey == key && nextModifiers == modifiers) || RegisterHotKey(nullptr, nextRegistration, flags(nextModifiers), nextKey)) {
                if (nextKey != key || nextModifiers != modifiers) {
                    UnregisterHotKey(nullptr, registration); registration = nextRegistration;
                    key = nextKey; modifiers = nextModifiers;
                    InterlockedExchange(&hook.state()->binding, key | (modifiers << 8));
                }
                output->send("BOUND");
            } else output->send("CONFLICT");
        }
        registeredSwitch(hook, message, registration, key, modifiers,
                         [](DWORD key) { return (GetAsyncKeyState(key) & 0x8000) != 0; });
        const DWORD now = GetTickCount();
        if (emergency != hook.state()->emergency) {
            emergency = hook.state()->emergency;
            sequence = hook.state()->sequence;
            emergencyAt = now; emergencyPending = true;
            InterlockedExchange(&hook.state()->owner, 0);
            ClipCursor(nullptr);
            output->send("EMERGENCY " + std::to_string(emergency) + " " + std::to_string(sequence));
            EmergencyWindows context{controller, false}; EnumWindows(releaseWindow, reinterpret_cast<LPARAM>(&context));
        }
        if (emergencyPending && now - emergencyAt >= 350) {
            if (hook.state()->resumed != emergency) {
                EmergencyWindows context{controller, true}; EnumWindows(releaseWindow, reinterpret_cast<LPARAM>(&context));
                ClipCursor(nullptr);
            }
            emergencyPending = false;
        }
        const LONG owner = hook.state()->owner;
        // SDL installs its modifier hook when capture changes. Put the broker
        // above that hook and recover Windows' silent low-level-hook removal.
        // Shared key edges survive renewal; no key events are synthesized.
        if (owner != lastOwner || now - lastHookRenewal >= 1000) {
            hook.activate(true);
            lastOwner = owner;
            lastHookRenewal = now;
        }
        // A single ordered sequence prevents duplicate notifications across hook handoffs.
        if (sequence != hook.state()->sequence) {
            sequence = hook.state()->sequence;
            output->send("SWITCH " + std::to_string(sequence));
        }
        TranslateMessage(&message); DispatchMessageW(&message);
    }
    UnregisterHotKey(nullptr, registration);
    CloseHandle(parent);
    ExitProcess(0);
}
