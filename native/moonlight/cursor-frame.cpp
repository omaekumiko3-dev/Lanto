#include "cursor-frame.h"
#include <QBuffer>
#include <QImageReader>
#include <QMap>
#include <QXmlStreamReader>
#include <cmath>

bool decodeLantoCursor(const QString& xml, LantoCursorFrame& frame)
{
    if (xml.size() > 140000) return false;
    QXmlStreamReader reader(xml);
    QMap<QString, QString> fields;
    if (!reader.readNextStartElement() || reader.name().toString() != "root" ||
        reader.attributes().value("status_code") != "200") return false;
    while (reader.readNextStartElement()) {
        const auto key = reader.name().toString();
        if (fields.contains(key)) return false;
        fields[key] = reader.readElementText(QXmlStreamReader::ErrorOnUnexpectedElement);
    }
    while (!reader.atEnd()) reader.readNext();
    if (reader.hasError() || fields.value("cursorProtocol") != "1" ||
        fields.value("changed") != "1") return false;
    const auto id = fields.value("id");
    if (id.isEmpty() || id.size() > 256) return false;
    auto number = [&fields](const char* name) {
        bool ok;
        const double value = fields.value(name).toDouble(&ok);
        return ok && std::isfinite(value) ? value : -1.0;
    };
    const QSizeF size(number("width"), number("height"));
    const QSizeF screen(number("screenWidth"), number("screenHeight"));
    const QPointF hotspot(number("hotX"), number("hotY"));
    if (size.width() < 1 || size.height() < 1 || size.width() > 128 || size.height() > 128 ||
        screen.width() < 1 || screen.height() < 1 || screen.width() > 32768 || screen.height() > 32768 ||
        hotspot.x() < 0 || hotspot.y() < 0 || hotspot.x() >= size.width() || hotspot.y() >= size.height()) return false;
    const auto hex = fields.value("png").toLatin1();
    if (hex.isEmpty() || hex.size() > 131072 || hex.size() % 2) return false;
    for (const char ch : hex) {
        if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return false;
    }
    QByteArray png = QByteArray::fromHex(hex);
    QBuffer buffer(&png);
    buffer.open(QIODevice::ReadOnly);
    QImageReader imageReader(&buffer, "PNG");
    const auto pixels = imageReader.size();
    if (pixels.width() < 1 || pixels.height() < 1 || pixels.width() > 256 || pixels.height() > 256) return false;
    QImage image = imageReader.read();
    if (image.isNull()) return false;
    frame = { id, image.convertToFormat(QImage::Format_RGBA8888), size, screen, hotspot };
    return true;
}
