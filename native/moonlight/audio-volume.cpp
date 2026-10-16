#include "audio-volume.h"
#include <QDir>
#include <QFile>
#include <QDebug>
#include <cstdint>
#include <cstring>

LantoAudioVolume::LantoAudioVolume()
    : m_Path(qEnvironmentVariable("LANTO_VOLUME_FILE")),
      m_Percent(parse(qgetenv("LANTO_VOLUME"), 100))
{
}

LantoAudioVolume::~LantoAudioVolume() { stopControl(); }

int LantoAudioVolume::parse(const QByteArray& value, int fallback)
{
    const QByteArray text = value.trimmed();
    if (text.isEmpty() || text.size() > 3) return fallback;
    for (char c : text) if (c < '0' || c > '9') return fallback;
    bool ok = false;
    const int result = text.toInt(&ok);
    return ok && result <= 100 ? result : fallback;
}

void LantoAudioVolume::startControl()
{
    if (m_Path.isEmpty() || !QDir::isAbsolutePath(m_Path) || isRunning()) return;
    readControl();
    qInfo("Lanto audio volume: %d%%", percent());
    start();
}

void LantoAudioVolume::stopControl()
{
    requestInterruption();
    wait();
}

void LantoAudioVolume::readControl()
{
    QFile file(m_Path);
    if (!file.open(QIODevice::ReadOnly) || file.size() > 16) return;
    const int previous = percent();
    const int next = parse(file.read(16), previous);
    if (next != previous) {
        m_Percent.store(next, std::memory_order_relaxed);
        qInfo("Lanto audio volume: %d%%", next);
    }
}

void LantoAudioVolume::run()
{
    while (!isInterruptionRequested()) {
        readControl();
        msleep(50);
    }
}

void LantoAudioVolume::apply(void* samples, int count, bool floatingPoint) const
{
    scale(samples, count, floatingPoint, percent());
}

void LantoAudioVolume::scale(void* samples, int count, bool floatingPoint, int percent)
{
    if (count <= 0 || percent >= 100) return;
    if (percent <= 0) {
        std::memset(samples, 0, size_t(count) * (floatingPoint ? sizeof(float) : sizeof(int16_t)));
        return;
    }
    const float gain = float(percent) / 100.0f;
    if (floatingPoint) {
        auto* values = static_cast<float*>(samples);
        for (int i = 0; i < count; ++i) values[i] *= gain;
    }
    else {
        auto* values = static_cast<int16_t*>(samples);
        for (int i = 0; i < count; ++i) values[i] = int16_t(values[i] * gain);
    }
}
