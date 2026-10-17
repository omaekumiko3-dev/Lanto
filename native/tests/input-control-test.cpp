#include "input-control.h"
#include <QCoreApplication>
#include <QSaveFile>
#include <QTemporaryDir>
#include <QProcess>
#include <cstdio>
#include <cstdlib>
#ifdef Q_OS_WIN
#include <windows.h>
#endif

static void require(bool value) { if (!value) std::abort(); }
static void write(const QString& path, const QByteArray& value)
{
    QSaveFile file(path);
    require(file.open(QIODevice::WriteOnly));
    require(file.write(value) == value.size());
    require(file.commit());
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
    require(QFile::remove(path));
    control.refresh(true);
    require(!control.remote());
    std::puts("Input tests passed: exact shortcut, live configuration, local mode, invalid data, owned controller exit, stdout switch notification");
}
