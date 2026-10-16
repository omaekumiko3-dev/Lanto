#pragma once
#include <QImage>
#include <QPointF>
#include <QSizeF>
#include <QString>

struct LantoCursorFrame {
    QString id;
    QImage image;
    QSizeF logicalSize, screenSize;
    QPointF hotspot;
};

// Returns false for unchanged, malformed, oversized, or unsupported frames.
bool decodeLantoCursor(const QString& xml, LantoCursorFrame& frame);
