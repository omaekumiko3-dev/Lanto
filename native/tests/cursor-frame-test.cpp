#include "cursor-frame.h"
#include <QBuffer>
#include <QCoreApplication>
#include <iostream>
#include <stdexcept>

static void require(bool passed, const char* message) {
    if (!passed) throw std::runtime_error(message);
}

static QString packet(const QImage& image) {
    QByteArray png;
    QBuffer buffer(&png);
    buffer.open(QIODevice::WriteOnly);
    require(image.save(&buffer, "PNG"), "PNG fixture encoding failed");
    return "<root status_code=\"200\"><cursorProtocol>1</cursorProtocol><changed>1</changed>"
           "<id>test-shape</id><width>24</width><height>28</height><hotX>3.5</hotX><hotY>4</hotY>"
           "<screenWidth>2560</screenWidth><screenHeight>1440</screenHeight><png>" +
           QString::fromLatin1(png.toHex()) + "</png></root>";
}

int main(int argc, char** argv) {
    QCoreApplication app(argc, argv);
    try {
        QImage image(48, 56, QImage::Format_RGBA8888);
        image.fill(QColor(20, 90, 120, 127));
        const auto xml = packet(image);
        LantoCursorFrame frame;
        require(decodeLantoCursor(xml, frame), "valid cursor rejected");
        require(frame.image.size() == image.size() && frame.image.pixelColor(0,0).alpha() == 127,
                "cursor dimensions or alpha lost");
        require(frame.hotspot == QPointF(3.5, 4) && frame.logicalSize == QSizeF(24, 28),
                "fractional hotspot or logical size lost");
        const auto reject = [&](QString value) {
            require(!decodeLantoCursor(value, frame), "unsafe/invalid cursor accepted");
            require(frame.id == "test-shape", "rejected packet replaced valid frame");
        };
        reject(QString(xml).replace("<changed>1", "<changed>0"));
        reject(QString(xml).replace("<cursorProtocol>1", "<cursorProtocol>2"));
        reject(QString(xml).replace("status_code=\"200\"", "status_code=\"401\""));
        reject(QString(xml).replace("<hotX>3.5", "<hotX>24"));
        reject(QString(xml).replace("<hotY>4", "<hotY>-1"));
        reject(QString(xml).replace("<width>24", "<width>nan"));
        reject(QString(xml).replace("<screenWidth>2560", "<screenWidth>0"));
        reject(QString(xml).replace("<png>", "<png>gg"));
        reject(QString(xml).replace("<id>test-shape</id>", "<id>one</id><id>two</id>"));
        reject(xml.left(xml.size()-8));
        reject(xml + "<root/>");
        reject(QString(140001, 'x'));
        QImage huge(300, 10, QImage::Format_RGBA8888);
        huge.fill(Qt::transparent);
        reject(packet(huge));
        std::cout << "Cursor frame tests passed: alpha, dimensions, hotspot, protocol, bounds and malformed input\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
