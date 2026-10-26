#pragma once
#include <sddl.h>
#include <tlhelp32.h>
#include <io.h>
#include <fcntl.h>
#include <vector>

// Only this fixed, protected executable can be started by the service. No shell,
// user-supplied executable path, environment, or privileged command is accepted.
namespace SystemSwitch {
constexpr wchar_t serviceName[] = L"LantoSwitchSystem";
constexpr wchar_t pipeName[] = L"\\\\.\\pipe\\LantoSwitchSystem-v1";
inline HANDLE stopping = nullptr;
inline HANDLE workerJob = nullptr;
inline SERVICE_STATUS_HANDLE statusHandle = nullptr;
inline SERVICE_STATUS status{};
inline HANDLE serviceThread = nullptr;
inline void error(HANDLE pipe, const char* stage, DWORD code = GetLastError()) {
    const auto text = std::string("ERROR ") + stage + " " + std::to_string(code) + "\n";
    DWORD written = 0; WriteFile(pipe, text.data(), static_cast<DWORD>(text.size()), &written, nullptr);
}

struct Handle {
    HANDLE value;
    explicit Handle(HANDLE h = nullptr) : value(h) {}
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    operator HANDLE() const { return value; }
    Handle(const Handle&) = delete;
};
inline DWORD parentOf(DWORD pid) {
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
    PROCESSENTRY32W entry{sizeof(entry)};
    if (Process32FirstW(snapshot, &entry)) do {
        if (entry.th32ProcessID == pid) return entry.th32ParentProcessID;
    } while (Process32NextW(snapshot, &entry));
    return 0;
}
inline std::wstring userSid(HANDLE process) {
    HANDLE raw = nullptr;
    if (!OpenProcessToken(process, TOKEN_QUERY, &raw)) return {};
    Handle token(raw);
    DWORD size = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &size);
    std::vector<BYTE> bytes(size);
    if (!size || !GetTokenInformation(token, TokenUser, bytes.data(), size, &size)) return {};
    LPWSTR sid = nullptr;
    if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid, &sid)) return {};
    std::wstring result(sid); LocalFree(sid); return result;
}
inline bool isSystem(HANDLE process = GetCurrentProcess()) {
    return userSid(process) == L"S-1-5-18";
}
inline bool validMap(const std::wstring& name) {
    const std::wstring prefix = L"Local\\LantoSwitch-";
    if (name.size() != prefix.size() + 36 || name.compare(0, prefix.size(), prefix) != 0) return false;
    for (size_t i = 0; i < 36; ++i) {
        const wchar_t c = name[prefix.size() + i];
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != L'-') return false; }
        else if (!((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f'))) return false;
    }
    return true;
}
struct Security {
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    SECURITY_ATTRIBUTES attributes{sizeof(attributes), nullptr, FALSE};
    explicit Security(const std::wstring& sid = L"BA") {
        const auto text = L"D:P(A;;GA;;;SY)(A;;GA;;;" + sid + L")S:(ML;;NW;;;HI)";
        if (ConvertStringSecurityDescriptorToSecurityDescriptorW(text.c_str(), SDDL_REVISION_1, &descriptor, nullptr))
            attributes.lpSecurityDescriptor = descriptor;
    }
    ~Security() { if (descriptor) LocalFree(descriptor); }
};
inline void enablePrivilege(const wchar_t* name) {
    HANDLE raw = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &raw)) return;
    Handle token(raw);
    TOKEN_PRIVILEGES privilege{}; privilege.PrivilegeCount = 1;
    if (LookupPrivilegeValueW(nullptr, name, &privilege.Privileges[0].Luid)) {
        privilege.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
        AdjustTokenPrivileges(token, FALSE, &privilege, 0, nullptr, nullptr);
    }
}
inline bool readLine(HANDLE pipe, std::string& line, DWORD timeout) {
    const DWORD start = GetTickCount(); line.clear();
    while (GetTickCount() - start < timeout && (!stopping || WaitForSingleObject(stopping, 0) == WAIT_TIMEOUT)) {
        DWORD size = 0;
        if (!PeekNamedPipe(pipe, nullptr, 0, nullptr, &size, nullptr)) return false;
        if (!size) { Sleep(5); continue; }
        char c; DWORD read = 0;
        if (!ReadFile(pipe, &c, 1, &read, nullptr) || !read) return false;
        if (c == '\n') return true;
        if (line.size() >= 256 || c < 32 || c > 126) return false;
        line += c;
    }
    return false;
}
inline bool connect(HANDLE pipe, DWORD timeout) {
    const DWORD start = GetTickCount();
    while (GetTickCount() - start < timeout && WaitForSingleObject(stopping, 0) == WAIT_TIMEOUT) {
        const BOOL connected = ConnectNamedPipe(pipe, nullptr);
        const DWORD error = connected ? ERROR_SUCCESS : GetLastError();
        ULONG client = 0;
        if ((connected || error == ERROR_PIPE_CONNECTED) && GetNamedPipeClientProcessId(pipe, &client) && client) {
            DWORD mode = PIPE_READMODE_BYTE | PIPE_WAIT;
            return SetNamedPipeHandleState(pipe, &mode, nullptr, nullptr) != FALSE;
        }
        Sleep(10);
    }
    return false;
}
inline void serve(HANDLE client) {
    ULONG proxy = 0;
    if (!GetNamedPipeClientProcessId(client, &proxy)) return;
    Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, proxy));
    HANDLE raw = nullptr;
    if (!process.value || !OpenProcessToken(process, TOKEN_QUERY, &raw)) return;
    Handle clientToken(raw);
    TOKEN_ELEVATION elevation{}; DWORD size = 0, session = 0;
    if (!GetTokenInformation(clientToken, TokenElevation, &elevation, sizeof(elevation), &size) || !elevation.TokenIsElevated ||
        !GetTokenInformation(clientToken, TokenSessionId, &session, sizeof(session), &size) || !session) return;
    std::string request;
    if (!readLine(client, request, 3000)) return;
    DWORD controller = 0; int key = 0, modifiers = 0; std::string map, extra;
    std::istringstream input(request);
    if (!(input >> controller >> map >> key >> modifiers) || (input >> extra) || parentOf(proxy) != controller ||
        key < 1 || key > 255 || modifiers < 1 || modifiers > 15) return;
    const std::wstring wideMap(map.begin(), map.end());
    if (!validMap(wideMap)) return;
    Handle parent(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, controller));
    DWORD controllerSession = 0;
    if (!parent.value || !ProcessIdToSessionId(controller, &controllerSession) || controllerSession != session ||
        userSid(parent) != userSid(process)) return;

    // Session 0 cannot receive desktop input. Duplicate SYSTEM into the authenticated
    // controller's interactive session; never inherit handles across sessions.
    Security security;
    const auto privatePipe = std::wstring(pipeName) + L"-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(proxy);
    Handle channel(CreateNamedPipeW(privatePipe.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 65536, 65536, 0, &security.attributes));
    if (channel.value == INVALID_HANDLE_VALUE) return;
    HANDLE ownRaw = nullptr, duplicateRaw = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY, &ownRaw)) return;
    Handle ownToken(ownRaw);
    if (!DuplicateTokenEx(ownToken, TOKEN_ALL_ACCESS, nullptr, SecurityImpersonation, TokenPrimary, &duplicateRaw)) return;
    Handle duplicate(duplicateRaw);
    if (!SetTokenInformation(duplicate, TokenSessionId, &session, sizeof(session))) { error(client, "session"); return; }
    wchar_t executable[32768];
    if (!GetModuleFileNameW(nullptr, executable, 32768)) return;
    std::wstring command = L"\"" + std::wstring(executable) + L"\" --system-worker " + std::to_wstring(controller) +
        L" " + wideMap + L" " + std::to_wstring(key) + L" " + std::to_wstring(modifiers) + L" " + privatePipe;
    STARTUPINFOW startup{sizeof(startup)}; startup.lpDesktop = const_cast<wchar_t*>(L"winsta0\\default");
    PROCESS_INFORMATION child{};
    if (!CreateProcessAsUserW(duplicate, executable, command.data(), nullptr, nullptr, FALSE,
        CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, nullptr, &startup, &child)) { error(client, "launch"); return; }
    Handle worker(child.hProcess), thread(child.hThread);
    Handle job(CreateJobObjectW(nullptr, nullptr));
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!job.value || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) ||
        !AssignProcessToJobObject(job, worker)) { TerminateProcess(worker, 10); return; }
    workerJob = job.value;
    ResumeThread(thread);
    if (connect(channel, 4000)) {
        ULONG workerPid = 0;
        if (GetNamedPipeClientProcessId(channel, &workerPid) && workerPid == child.dwProcessId) {
            char bytes[4096];
            while (WaitForSingleObject(stopping, 0) == WAIT_TIMEOUT && WaitForSingleObject(parent, 0) == WAIT_TIMEOUT &&
                   WaitForSingleObject(worker, 0) == WAIT_TIMEOUT && WaitForSingleObject(process, 0) == WAIT_TIMEOUT) {
                bool okay = true;
                for (int direction = 0; direction < 2; ++direction) {
                    HANDLE source = direction ? static_cast<HANDLE>(channel) : client;
                    HANDLE target = direction ? client : static_cast<HANDLE>(channel);
                    DWORD available = 0, read = 0, written = 0;
                    if (!PeekNamedPipe(source, nullptr, 0, nullptr, &available, nullptr)) { okay = false; break; }
                    if (available && (!ReadFile(source, bytes, std::min(available, static_cast<DWORD>(sizeof(bytes))), &read, nullptr) ||
                        !WriteFile(target, bytes, read, &written, nullptr) || written != read)) { okay = false; break; }
                }
                if (!okay) break;
                Sleep(2);
            }
        }
    } else { DWORD code = 0; GetExitCodeProcess(worker, &code); error(client, "worker", code); }
    workerJob = nullptr;
    TerminateJobObject(job, 0);
}
inline DWORD WINAPI control(DWORD code, DWORD, void*, void*) {
    if (code == SERVICE_CONTROL_STOP || code == SERVICE_CONTROL_SHUTDOWN) {
        status.dwCurrentState = SERVICE_STOP_PENDING; status.dwCheckPoint = 1; status.dwWaitHint = 5000;
        SetServiceStatus(statusHandle, &status); SetEvent(stopping);
        if (serviceThread) CancelSynchronousIo(serviceThread);
    }
    return NO_ERROR;
}
inline void WINAPI main(DWORD, wchar_t**) {
    statusHandle = RegisterServiceCtrlHandlerExW(serviceName, control, nullptr);
    if (!statusHandle) return;
    stopping = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(), &serviceThread, 0, FALSE, DUPLICATE_SAME_ACCESS);
    status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    status.dwCurrentState = SERVICE_RUNNING;
    status.dwControlsAccepted = SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN;
    enablePrivilege(L"SeTcbPrivilege"); enablePrivilege(L"SeAssignPrimaryTokenPrivilege"); enablePrivilege(L"SeIncreaseQuotaPrivilege");
    SetServiceStatus(statusHandle, &status);
    Security security;
    while (WaitForSingleObject(stopping, 0) == WAIT_TIMEOUT) {
        Handle pipe(CreateNamedPipeW(pipeName, PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 65536, 65536, 0, &security.attributes));
        if (pipe.value == INVALID_HANDLE_VALUE) { status.dwWin32ExitCode = GetLastError(); break; }
        if (connect(pipe, 1000)) serve(pipe);
    }
    status.dwCurrentState = SERVICE_STOPPED; status.dwControlsAccepted = 0;
    SetServiceStatus(statusHandle, &status);
    CloseHandle(stopping); stopping = nullptr;
    if (serviceThread) CloseHandle(serviceThread);
}
inline int service() {
    SERVICE_TABLE_ENTRYW entries[] = {{const_cast<wchar_t*>(serviceName), main}, {nullptr, nullptr}};
    return StartServiceCtrlDispatcherW(entries) ? 0 : static_cast<int>(GetLastError());
}
inline bool attachStdio(HANDLE pipe) {
    HANDLE read = nullptr, write = nullptr;
    if (!DuplicateHandle(GetCurrentProcess(), pipe, GetCurrentProcess(), &read, 0, FALSE, DUPLICATE_SAME_ACCESS) ||
        !DuplicateHandle(GetCurrentProcess(), pipe, GetCurrentProcess(), &write, 0, FALSE, DUPLICATE_SAME_ACCESS)) return false;
    const int input = _open_osfhandle(reinterpret_cast<intptr_t>(read), _O_RDONLY | _O_BINARY);
    const int output = _open_osfhandle(reinterpret_cast<intptr_t>(write), _O_WRONLY | _O_BINARY);
    if (input < 0 || output < 0) return false;
    const bool okay = _dup2(input, 0) == 0 && _dup2(output, 1) == 0;
    _close(input); _close(output); return okay;
}
// -1 means no service installed (portable administrator mode). Installed service
// failures are explicit; never silently downgrade a requested SYSTEM connection.
inline int proxy(int argc, wchar_t** argv) {
    if (GetEnvironmentVariableW(L"LANTO_SWITCH_DIRECT", nullptr, 0)) return -1;
    SC_HANDLE manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
    if (!manager) return 30;
    SC_HANDLE service = OpenServiceW(manager, serviceName, SERVICE_QUERY_STATUS | SERVICE_START);
    const DWORD error = GetLastError();
    if (!service) { CloseServiceHandle(manager); return error == ERROR_SERVICE_DOES_NOT_EXIST ? -1 : 31; }
    SERVICE_STATUS_PROCESS info{}; DWORD size = 0;
    QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO, reinterpret_cast<BYTE*>(&info), sizeof(info), &size);
    if (info.dwCurrentState == SERVICE_STOPPED) StartServiceW(service, 0, nullptr);
    HANDLE raw = INVALID_HANDLE_VALUE;
    for (int tries = 0; tries < 400; ++tries) {
        raw = CreateFileW(pipeName, GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
        if (raw != INVALID_HANDLE_VALUE) break;
        Sleep(10);
    }
    Handle pipe(raw);
    bool trusted = false;
    if (pipe.value != INVALID_HANDLE_VALUE) {
        ULONG server = 0;
        QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO, reinterpret_cast<BYTE*>(&info), sizeof(info), &size);
        if (GetNamedPipeServerProcessId(pipe, &server) && server && server == info.dwProcessId) {
            Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, server));
            trusted = process.value && isSystem(process);
        }
    }
    CloseServiceHandle(service); CloseServiceHandle(manager);
    if (!trusted) return 32;
    std::wstring wide;
    for (int i = 1; i < argc; ++i) { if (i > 1) wide += L" "; wide += argv[i]; }
    std::string request(wide.begin(), wide.end()); request += '\n'; DWORD written = 0;
    if (!WriteFile(pipe, request.data(), static_cast<DWORD>(request.size()), &written, nullptr) || written != request.size()) return 33;
    const HANDLE channel = pipe.value;
    std::thread([channel]() {
        std::string line;
        while (std::getline(std::cin, line)) {
            line += '\n'; DWORD written = 0;
            if (!WriteFile(channel, line.data(), static_cast<DWORD>(line.size()), &written, nullptr)) break;
        }
        // EOF must close the service connection even when its output reader waits.
        ExitProcess(0);
    }).detach();
    char bytes[4096]; DWORD read = 0;
    for (;;) {
        DWORD available = 0;
        // Synchronous pipe handles serialize reads and writes. Never block in an
        // empty read while the stdin thread needs to send a binding/focus command.
        if (!PeekNamedPipe(pipe, nullptr, 0, nullptr, &available, nullptr)) break;
        if (!available) { Sleep(2); continue; }
        if (!ReadFile(pipe, bytes, std::min(available, static_cast<DWORD>(sizeof(bytes))), &read, nullptr) || !read) break;
        if (std::fwrite(bytes, 1, read, stdout) != read || std::fflush(stdout)) break;
    }
    return 0;
}
}
