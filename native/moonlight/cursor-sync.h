#pragma once
#include "cursor-frame.h"
#include "backend/nvaddress.h"
#include "SDL_compat.h"
#include <QSslCertificate>
#include <QThread>
#include <mutex>

class NvComputer;

// Network work runs on its own Qt thread. All SDL cursor work stays on the SDL thread.
class LantoCursorSync final : public QThread {
public:
    explicit LantoCursorSync(NvComputer* computer);
    ~LantoCursorSync() override;
    Uint32 eventType() const { return m_EventType; }
    void apply(SDL_Window* window);
    void restore();
    void stop();
protected:
    void run() override;
private:
    NvAddress m_Address;
    uint16_t m_Port;
    QSslCertificate m_Cert;
    const Uint32 m_EventType;
    std::mutex m_Mutex;
    LantoCursorFrame m_Pending, m_Current;
    bool m_EventPending = false;
    SDL_Cursor* m_Cursor = nullptr;
    QString m_AppliedId;
    QSize m_AppliedSize;
};
