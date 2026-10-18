#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fstream>
#include <string>
#include <sstream>

static std::string json(const char* text) {
    std::string value = "\"";
    for (const unsigned char character : std::string(text)) {
        if (character == '\\' || character == '"') value += '\\';
        if (character >= 32) value += character;
    }
    return value + '"';
}
int main(int argc, char** argv) {
    WNDCLASSW type{};
    type.lpfnWndProc = DefWindowProcW;
    type.hInstance = GetModuleHandleW(nullptr);
    type.lpszClassName = L"SDL_app";
    if (!RegisterClassW(&type)) return 1;
    const auto window = CreateWindowW(type.lpszClassName, L"Lanto isolated media test", WS_OVERLAPPEDWINDOW,
        0, 0, 640, 480, nullptr, nullptr, type.hInstance, nullptr);
    if (!window) return 2;
    // The test window is never shown, activated, or given keyboard/mouse input.
    char gain[64]{};
    GetEnvironmentVariableA("LANTO_VOLUME", gain, sizeof(gain));
    std::ofstream records("media-starts.jsonl", std::ios::app);
    records << "{\"pid\":" << GetCurrentProcessId() << ",\"initialVolume\":" << json(gain) << ",\"args\":[";
    for (int index = 2; index < argc; index++) records << (index > 2 ? "," : "") << json(argv[index]);
    records << "]}\n"; records.close();
    wchar_t volumeFile[32768]{};
    GetEnvironmentVariableW(L"LANTO_VOLUME_FILE", volumeFile, 32768);
    SetTimer(window, 1, 30, nullptr);
    MSG message;
    while (IsWindow(window) && GetMessageW(&message, nullptr, 0, 0) > 0) {
        if (message.message == WM_TIMER) {
            std::ifstream input(volumeFile);
            if (input) {
                std::ostringstream value; value << input.rdbuf();
                std::ofstream("volume-" + std::to_string(GetCurrentProcessId()) + ".json") << value.str();
            }
        }
        TranslateMessage(&message); DispatchMessageW(&message);
    }
    return 0;
}
