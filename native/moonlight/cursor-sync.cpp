#include "cursor-sync.h"
#include "backend/nvcomputer.h"
#include "backend/nvhttp.h"
#include <QDebug>
#include <QElapsedTimer>
#include <QUrl>
#include <cmath>

LantoCursorSync::LantoCursorSync(NvComputer* computer) :
    m_Address(computer->activeAddress), m_Port(computer->activeHttpsPort),
    m_Cert(computer->serverCert), m_EventType(SDL_RegisterEvents(1))
{
    if (qEnvironmentVariableIntValue("LANTO_LOCAL_CURSOR") == 1 &&
        m_EventType != Uint32(-1) && !m_Cert.isNull()) start();
}

LantoCursorSync::~LantoCursorSync() { stop(); }

void LantoCursorSync::run()
{
    NvHTTP http(m_Address, m_Port, m_Cert, true);
    try {
        const auto info = http.openConnectionToString(http.m_BaseUrlHttps, "serverinfo", nullptr, 1000, NvHTTP::NVLL_NONE);
        NvHTTP::verifyResponseStatus(info);
        if (NvHTTP::getXmlString(info, "LantoCursorShape") != "1") return;
    } catch (const std::exception&) {
        qWarning() << "Lanto cursor shape: capability check failed";
        return;
    }
    qInfo() << "Lanto cursor shape: enabled (authenticated HTTPS)";
    QString lastId;
    int failures = 0;
    while (!isInterruptionRequested()) {
        QElapsedTimer elapsed;
        elapsed.start();
        try {
            const auto xml = http.openConnectionToString(http.m_BaseUrlHttps, "lantocursor",
                "since=" + QString::fromLatin1(QUrl::toPercentEncoding(lastId)), 500, NvHTTP::NVLL_NONE);
            NvHTTP::verifyResponseStatus(xml);
            LantoCursorFrame frame;
            if (decodeLantoCursor(xml, frame)) {
                lastId = frame.id;
                std::lock_guard<std::mutex> lock(m_Mutex);
                m_Pending = std::move(frame);
                if (!m_EventPending) {
                    SDL_Event event{};
                    event.type = m_EventType;
                    m_EventPending = SDL_PushEvent(&event) == 1;
                }
            }
            failures = 0;
        } catch (const std::exception&) {
            if (++failures == 1) qWarning() << "Lanto cursor shape: update unavailable";
            // Never fall back to unpaired HTTP. Keep video/input running on a bad response.
        }
        const qint64 interval = failures ? 500 : 33;
        while (!isInterruptionRequested() && elapsed.elapsed() < interval) msleep(5);
    }
}

void LantoCursorSync::apply(SDL_Window* window)
{
    {
        std::lock_guard<std::mutex> lock(m_Mutex);
        if (!m_Pending.image.isNull()) m_Current = std::move(m_Pending);
        m_Pending = {};
        m_EventPending = false;
    }
    if (m_Current.image.isNull()) return;
    if (SDL_GetMouseFocus() != window || !(SDL_GetWindowFlags(window) & SDL_WINDOW_INPUT_FOCUS)) {
        restore();
        return;
    }
    int width, height;
    SDL_GetWindowSize(window, &width, &height);
    // Preserve remote logical size as the streamed desktop scales to the local display.
    const double scale = qMin(width / m_Current.screenSize.width(), height / m_Current.screenSize.height());
    const QSize size(qBound(1, qRound(m_Current.logicalSize.width() * scale), 256),
                     qBound(1, qRound(m_Current.logicalSize.height() * scale), 256));
    if (m_Current.id != m_AppliedId || size != m_AppliedSize) {
        const QImage image = m_Current.image.scaled(size, Qt::IgnoreAspectRatio, Qt::SmoothTransformation);
        auto surface = SDL_CreateRGBSurfaceWithFormatFrom(const_cast<uchar*>(image.constBits()),
            image.width(), image.height(), 32, image.bytesPerLine(), SDL_PIXELFORMAT_RGBA32);
        if (!surface) return;
        auto cursor = SDL_CreateColorCursor(surface,
            qBound(0, qRound(m_Current.hotspot.x() * size.width() / m_Current.logicalSize.width()), size.width()-1),
            qBound(0, qRound(m_Current.hotspot.y() * size.height() / m_Current.logicalSize.height()), size.height()-1));
        SDL_FreeSurface(surface);
        if (!cursor) return;
        SDL_SetCursor(cursor);
        if (m_Cursor) SDL_FreeCursor(m_Cursor);
        m_Cursor = cursor;
        m_AppliedId = m_Current.id;
        m_AppliedSize = size;
        if (qEnvironmentVariableIsSet("LANTO_CURSOR_TRACE"))
            qInfo() << "Lanto cursor applied:" << m_Current.id.left(12) << size << m_Current.hotspot;
    } else SDL_SetCursor(m_Cursor);
}

void LantoCursorSync::restore() { if (m_Cursor) SDL_SetCursor(SDL_GetDefaultCursor()); }

void LantoCursorSync::stop()
{
    requestInterruption();
    wait();
    if (m_Cursor) {
        restore();
        SDL_FreeCursor(m_Cursor);
        m_Cursor = nullptr;
    }
    if (m_EventType != Uint32(-1) && SDL_WasInit(SDL_INIT_VIDEO)) SDL_FlushEvent(m_EventType);
}
