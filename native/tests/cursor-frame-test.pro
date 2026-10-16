QT += core gui
CONFIG += console c++17
CONFIG -= app_bundle debug_and_release
TEMPLATE = app
TARGET = LantoCursorTests
INCLUDEPATH += ../moonlight
SOURCES += cursor-frame-test.cpp ../moonlight/cursor-frame.cpp
HEADERS += ../moonlight/cursor-frame.h
