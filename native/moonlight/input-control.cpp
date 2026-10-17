#include "input-control.h"
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#ifdef Q_OS_WIN
#include <windows.h>
#endif

LantoInputControl::LantoInputControl()
{
#ifdef Q_OS_WIN
    m_Path = qEnvironmentVariable("LANTO_INPUT_FILE");
    bool ok = false;
    m_ControllerPid = qEnvironmentVariable("LANTO_CONTROLLER_PID").toULong(&ok);
    if (managed() && ok && m_ControllerPid)
        m_Controller = OpenProcess(SYNCHRONIZE, FALSE, m_ControllerPid);
#endif
    refresh(true);
}

LantoInputControl::~LantoInputControl()
{
#ifdef Q_OS_WIN
    if (m_Controller) CloseHandle(m_Controller);
#endif
}

bool LantoInputControl::refresh(bool force)
{
    if (!managed() || (!force && m_Timer.isValid() && m_Timer.elapsed() < 50)) return false;
    m_Timer.restart();
    bool locked = true;
    bool remote = false;
    int key = 0;
    int modifiers = 0;
#ifdef Q_OS_WIN
    QFile file(m_Path);
    if (m_Controller && WaitForSingleObject(m_Controller, 0) == WAIT_TIMEOUT &&
            file.open(QIODevice::ReadOnly) && file.size() <= 1024) {
        const auto doc = QJsonDocument::fromJson(file.readAll());
        const auto value = doc.object();
        key = value.value("key").toInt();
        modifiers = value.value("modifiers").toInt();
        if (key > 0 && key < 256 && modifiers > 0 && modifiers < 16 &&
                value.value("locked").isBool() && value.value("remote").isBool()) {
            locked = value.value("locked").toBool();
            remote = value.value("remote").toBool();
        }
    }
#endif
    bool changed = m_Locked != locked || m_Remote != remote || m_Key != key || m_Modifiers != modifiers;
    m_Locked = locked;
    m_Remote = remote;
    m_Key = key;
    m_Modifiers = modifiers;
    return changed;
}

bool LantoInputControl::matches(int key, int modifiers) const
{
    return managed() && locked() && remote() && key == m_Key && (modifiers & 15) == m_Modifiers;
}

bool LantoInputControl::requestSwitch()
{
#ifdef Q_OS_WIN
    if (!m_Controller || WaitForSingleObject(m_Controller, 0) != WAIT_TIMEOUT) return false;
    // The foreground process grants its controller permission to activate the local window.
    AllowSetForegroundWindow(m_ControllerPid);
    static const char message[] = "LANTO_SWITCH\n";
    DWORD written = 0;
    return WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), message, sizeof(message) - 1, &written, nullptr)
            && written == sizeof(message) - 1;
#else
    return false;
#endif
}
