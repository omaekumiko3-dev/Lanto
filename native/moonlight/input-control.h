#pragma once

#include <QString>
#include <QElapsedTimer>

// Read only the controller's per-session atomic file. SDL calls stay on its event thread.
class LantoInputControl {
public:
    LantoInputControl();
    ~LantoInputControl();
    bool refresh(bool force = false);
    bool requestSwitch();
    bool matches(int key, int modifiers) const;
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
};
