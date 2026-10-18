#include "input-control.h"
#include <QCoreApplication>
#include <QSaveFile>
#include <QTemporaryDir>
#include <QProcess>
#include <cstdio>
#include <cstdlib>
#include <atomic>
#include <thread>
#include <QThread>
#ifdef Q_OS_WIN
#include <windows.h>
#endif

static void requireAt(bool value, int line) {
    if (!value) { std::fprintf(stderr, "Input requirement failed at line %d\n", line); std::abort(); }
}
#define require(value) requireAt(value, __LINE__)
static void write(const QString& path, const QByteArray& value)
{
    for (int attempt = 0; ; ++attempt) {
        QSaveFile file(path);
        require(file.open(QIODevice::WriteOnly));
        require(file.write(value) == value.size());
        if (file.commit()) return;
        // Match the controller's bounded retry for temporary Windows sharing conflicts.
        if (attempt >= 5) std::fprintf(stderr, "Control write failed: %s\n", file.errorString().toUtf8().constData());
        require(attempt < 5);
        QThread::msleep(10 << attempt);
    }
}

int main(int argc, char** argv)
{
    QCoreApplication app(argc, argv);
    if (app.arguments().contains("--idle")) return app.exec();
#ifdef Q_OS_WIN
    if (app.arguments().contains("--hidden-window")) {
        WNDCLASSW type = {};
        type.lpfnWndProc = DefWindowProcW;
        type.hInstance = GetModuleHandleW(nullptr);
        type.lpszClassName = L"SDL_app";
        require(RegisterClassW(&type) != 0);
        require(CreateWindowW(L"SDL_app", L"Lanto hidden-window test", WS_OVERLAPPEDWINDOW,
                              0, 0, 640, 480, nullptr, nullptr, type.hInstance, nullptr) != nullptr);
        std::puts("READY");
        std::fflush(stdout);
        return app.exec();
    }
#endif
    QTemporaryDir directory;
    require(directory.isValid());
    const auto path = directory.filePath("stream.input");
    qputenv("LANTO_INPUT_FILE", path.toUtf8());
    qputenv("LANTO_CONTROLLER_PID", QByteArray::number(app.applicationPid()));
    write(path, "{\"key\":192,\"modifiers\":2,\"locked\":true,\"remote\":true}");
    LantoInputControl control;
    require(control.managed() && control.locked() && control.remote());
    require(control.matches(192, 2));
    require(!control.matches(192, 3)); // Ctrl+Shift is a different combination.
    require(!control.matches(81, 7));  // Moonlight's original quit shortcut passes through.
    require(control.requestSwitch()); // Exercises only the stdout protocol; no input injection.
    // Exercise actual Windows replacement sharing while the live control reader polls.
    std::atomic<bool> writing{true};
    std::thread writer([&]() {
        for (int count = 0; count < 500; ++count) {
#ifdef Q_OS_WIN
            const auto temporary = path + ".tmp";
            HANDLE file = CreateFileW(reinterpret_cast<const wchar_t*>(temporary.utf16()), GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
            require(file != INVALID_HANDLE_VALUE);
            const char value[] = "{\"key\":192,\"modifiers\":2,\"locked\":true,\"remote\":true}";
            DWORD written = 0;
            require(WriteFile(file, value, sizeof(value) - 1, &written, nullptr) && written == sizeof(value) - 1);
            require(CloseHandle(file));
            // Match Node's write/close/rename sequence.
            bool renamed = false;
            DWORD renameError = 0;
            for (int attempt = 0; attempt < 6 && !renamed; ++attempt) {
                renamed = MoveFileExW(reinterpret_cast<const wchar_t*>(temporary.utf16()),
                    reinterpret_cast<const wchar_t*>(path.utf16()), MOVEFILE_REPLACE_EXISTING) != FALSE;
                if (!renamed) renameError = GetLastError();
                if (!renamed) QThread::msleep(10 << attempt);
            }
            if (!renamed) std::fprintf(stderr, "Rename failed with Windows error %lu at write %d\n", renameError, count);
            require(renamed);
#else
            write(path, "{\"key\":192,\"modifiers\":2,\"locked\":true,\"remote\":true}");
#endif
        }
        writing = false;
    });
    while (writing) {
        control.refresh(true);
        require(control.remote());
        QThread::msleep(1); // Still 50 times faster than the player event loop.
    }
    writer.join();
    write(path, "{\"key\":121,\"modifiers\":6,\"locked\":true,\"remote\":false}");
    require(control.refresh(true));
    require(!control.remote() && !control.matches(121, 6));
    write(path, "{\"key\":121,\"modifiers\":6,\"locked\":true,\"remote\":true}");
    require(control.refresh(true) && control.matches(121, 6));
    write(path, "{\"key\":121,\"modifiers\":6,\"locked\":false,\"remote\":true}");
    require(control.refresh(true) && !control.locked() && !control.matches(121, 6));
    for (const auto invalid : {"broken", "{}", "{\"key\":192,\"modifiers\":99,\"locked\":true,\"remote\":true}"}) {
        write(path, invalid);
        control.refresh(true);
        require(!control.remote());
    }
    QProcess controller;
    controller.start(app.applicationFilePath(), {"--idle"});
    require(controller.waitForStarted());
    qputenv("LANTO_CONTROLLER_PID", QByteArray::number(controller.processId()));
    write(path, "{\"key\":192,\"modifiers\":2,\"locked\":true,\"remote\":true}");
    LantoInputControl owned;
    require(owned.remote());
    controller.kill();
    require(controller.waitForFinished());
    owned.refresh(true);
    require(!owned.remote() && !owned.requestSwitch());
#ifdef Q_OS_WIN
    // Simulate broker lifetime separately from the controller without installing a hook.
    controller.start(app.applicationFilePath(), {"--idle"});
    require(controller.waitForStarted());
    const auto name = QString("Local\\LantoInputTest-%1").arg(app.applicationPid());
    LantoSwitchHook shared;
    require(shared.open(reinterpret_cast<const wchar_t*>(name.utf16()), true, app.applicationPid()));
    shared.state()->broker = controller.processId();
    qputenv("LANTO_CONTROLLER_PID", QByteArray::number(app.applicationPid()));
    qputenv("LANTO_SWITCH_MAP", name.toUtf8());
    LantoInputControl brokerOwned;
    require(brokerOwned.remote());
    require(!brokerOwned.matches(192, 2)); // Shared hook owns matching; no duplicate stdout path.
    controller.kill(); require(controller.waitForFinished());
    brokerOwned.refresh(true);
    require(!brokerOwned.remote());
    qunsetenv("LANTO_SWITCH_MAP");
#endif
    require(QFile::remove(path));
    control.refresh(true);
    require(!control.remote());
    std::puts("Input tests passed: exact shortcut, live configuration, local mode, invalid data, owned controller exit, stdout switch notification");
}
