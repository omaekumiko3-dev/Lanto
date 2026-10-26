#pragma once

#include <QString>
#include <QElapsedTimer>
#include <cstdint>
#include "switch-keys.h"

// Read only the controller's per-session atomic file. SDL calls stay on its event thread.
class LantoInputControl {
public:
    LantoInputControl();
    ~LantoInputControl();
    bool refresh(bool force = false);
    bool requestSwitch();
    bool matches(int key, int modifiers) const;
    void setSwitchCapture(bool active);
    bool keyboardFocus() const;
    std::uint64_t physicalKeyHold(std::uint32_t key) const;
    bool physicalKeyReleased(std::uint64_t hold) const;
    bool managed() const { return !m_Path.isEmpty(); }
    bool locked() const { return m_Locked; }
    bool remote() const { return m_Remote; }

private:
    QString m_Path;
    QElapsedTimer m_Timer;
    void* m_Controller = nullptr;
    unsigned long m_ControllerPid = 0;
    int m_Key = 0;
    int m_Modifiers = 0;
    bool m_Locked = true;
    bool m_Remote = false;
    bool m_HasCaptured = false;
    long m_Emergency = 0;
#ifdef Q_OS_WIN
    LantoSwitchHook m_SwitchHook;
    bool m_SharedSwitch = false;
    bool m_SwitchFailed = false;
#endif
};
