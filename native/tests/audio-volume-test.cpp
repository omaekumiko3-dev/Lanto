#include "audio-volume.h"
#include <QCoreApplication>
#include <QSaveFile>
#include <QTemporaryDir>
#include <QElapsedTimer>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

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
    std::array<int16_t, 6> pcm = {-32768, -1000, 0, 1000, 16000, 32766};
    const auto original = pcm;
    LantoAudioVolume::scale(pcm.data(), int(pcm.size()), false, 100);
    require(pcm == original);
    LantoAudioVolume::scale(pcm.data(), int(pcm.size()), false, 50);
    require((pcm == std::array<int16_t, 6>{-16384, -500, 0, 500, 8000, 16383}));
    LantoAudioVolume::scale(pcm.data(), int(pcm.size()), false, 0);
    require((pcm == std::array<int16_t, 6>{}));
    std::array<float, 4> floats = {-1.0f, -0.5f, 0.25f, 1.0f};
    LantoAudioVolume::scale(floats.data(), int(floats.size()), true, 25);
    require((floats == std::array<float, 4>{-0.25f, -0.125f, 0.0625f, 0.25f}));
    LantoAudioVolume::scale(floats.data(), int(floats.size()), true, 0);
    require((floats == std::array<float, 4>{}));
    for (auto invalid : {"-1", "101", "NaN", "50junk", "", "0.5", "1000"})
        require(LantoAudioVolume::parse(invalid, 37) == 37);
    require(LantoAudioVolume::parse("0\n", 100) == 0);
    require(LantoAudioVolume::parse("100\n", 0) == 100);

    QTemporaryDir directory;
    require(directory.isValid());
    const QString path = directory.filePath("stream.volume");
    qputenv("LANTO_VOLUME_FILE", path.toUtf8());
    qputenv("LANTO_VOLUME", "0");
    write(path, "0\n");
    LantoAudioVolume control;
    require(control.percent() == 0); // Muted from the first audio frame.
    control.startControl();
    write(path, "31\n");
    QElapsedTimer timeout;
    timeout.start();
    while (control.percent() != 31 && timeout.elapsed() < 2000) QThread::msleep(10);
    require(control.percent() == 31);
    float frame = 1.0f;
    control.apply(&frame, 1, true);
    require(frame > 0.309f && frame < 0.311f);
    write(path, "invalid\n");
    QThread::msleep(120);
    require(control.percent() == 31);
    control.stopControl();
    require(!control.isRunning());
    std::puts("Audio tests passed: PCM formats, mute, full-volume identity, validation, live atomic updates and shutdown");
}
