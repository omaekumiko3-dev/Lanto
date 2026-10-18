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
    const auto map = qEnvironmentVariable("LANTO_SWITCH_MAP");
    m_SharedSwitch = !map.isEmpty();
    if (m_SharedSwitch) m_SwitchFailed = !m_SwitchHook.open(reinterpret_cast<const wchar_t*>(map.utf16()), false);
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
    if (m_Controller && WaitForSingleObject(m_Controller, 0) == WAIT_TIMEOUT &&
            (!m_SharedSwitch || (!m_SwitchFailed && m_SwitchHook.available()))) {
        // The controller atomically replaces this file. QFile on Windows can
        // deny replacement while open, making a switch fail with EPERM.
        QByteArray contents;
        HANDLE file = CreateFileW(reinterpret_cast<const wchar_t*>(m_Path.utf16()), GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file != INVALID_HANDLE_VALUE) {
            char buffer[1025]; DWORD size = 0;
            if (ReadFile(file, buffer, sizeof(buffer), &size, nullptr) && size <= 1024)
                contents = QByteArray(buffer, static_cast<int>(size));
            CloseHandle(file);
        }
        const auto doc = QJsonDocument::fromJson(contents);
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
    if (!locked || !remote) m_HasCaptured = false;
#ifdef Q_OS_WIN
    // Only the selected, live managed player may hold foreground protection.
    m_SwitchHook.guardForeground(m_HasCaptured && managed() && locked && remote && m_SharedSwitch);
#endif
    return changed;
}

bool LantoInputControl::matches(int key, int modifiers) const
{
#ifdef Q_OS_WIN
    if (m_SharedSwitch) return false; // The shared physical-key hook owns the reserved combination.
#endif
    return managed() && locked() && remote() && key == m_Key && (modifiers & 15) == m_Modifiers;
}

void LantoInputControl::setSwitchCapture(bool active, void (*modifiersChanged)(int))
{
#ifdef Q_OS_WIN
    // Do not intercept local input while a new stream is still opening.
    if (active) m_HasCaptured = true;
    const bool guard = m_HasCaptured && managed() && locked() && remote() && m_SharedSwitch;
    m_SwitchHook.guardForeground(guard);
    m_SwitchHook.setModifiersCallback(modifiersChanged);
    // SDL releases capture on blur. Keep our reserved key and input barrier alive
    // until an explicit selection change, even while another app has focus.
    if (m_SharedSwitch && !m_SwitchHook.activate(active || guard)) m_SwitchFailed = true;
#else
    Q_UNUSED(active);
    Q_UNUSED(modifiersChanged);
#endif
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
