#pragma once
#include <QThread>
#include <QString>
#include <atomic>

// Each owned stream gets its own control file. Disk I/O never runs on the audio thread.
class LantoAudioVolume final : public QThread {
public:
    LantoAudioVolume();
    ~LantoAudioVolume() override;
    void startControl();
    void stopControl();
    void apply(void* samples, int count, bool floatingPoint) const;
    int percent() const { return m_Percent.load(std::memory_order_relaxed); }
    static int parse(const QByteArray& value, int fallback);
    static void scale(void* samples, int count, bool floatingPoint, int percent);
protected:
    void run() override;
private:
    void readControl();
    const QString m_Path;
    std::atomic<int> m_Percent;
};
