#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Keep a 4K/60 virtual output alive in the current GNOME Wayland session.

Requires python3-gi, GStreamer and gstreamer1.0-pipewire. Sunshine must use
Portal capture and receive screen-sharing permission through GNOME's dialog.
--virtual-only keeps windows and the pointer on the streamed output.
Mutter's ScreenCast API is private; validate after desktop upgrades.
"""

import json
import os
from pathlib import Path
import signal
import sys
import time

import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gio, GLib, Gst

WIDTH, HEIGHT, RATE = 3840, 2160, 60
VIRTUAL_ONLY = "--virtual-only" in sys.argv
READY = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")) / "lanto-virtual-display.json"
SC = "org.gnome.Mutter.ScreenCast"
DC = "org.gnome.Mutter.DisplayConfig"


def proxy(name, path, interface):
    return Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, None, name, path, interface, None
    )


def call(target, method, signature=None, values=None):
    args = GLib.Variant(signature, values) if signature else None
    result = target.call_sync(method, args, Gio.DBusCallFlags.NONE, 5000, None)
    return result.unpack() if result else None


class VirtualDisplay:
    def __init__(self):
        self.loop = GLib.MainLoop()
        self.session = None
        self.pipeline = None
        self.connector = None
        self.node = None
        self.failed = False
        self.closing = False
        self.started = time.monotonic()
        self.dc = proxy(DC, "/org/gnome/Mutter/DisplayConfig", DC)
        self.before = {m[0][0] for m in call(self.dc, "GetCurrentState")[1]}

    def fail(self, message):
        print(message, file=sys.stderr, flush=True)
        self.failed = True
        self.loop.quit()
        return False

    def on_message(self, _bus, message):
        if message.type == Gst.MessageType.ERROR:
            error, detail = message.parse_error()
            self.fail(f"Virtual display pipeline: {error}: {detail}")
        elif message.type == Gst.MessageType.EOS:
            self.fail("Virtual display stream ended")

    def on_stream(self, _proxy, _sender, name, args):
        if name != "PipeWireStreamAdded" or self.node is not None:
            return
        self.node = args.unpack()[0]
        try:
            self.pipeline = Gst.parse_launch(
                f"pipewiresrc path={self.node} do-timestamp=true ! "
                f"video/x-raw,width={WIDTH},height={HEIGHT},max-framerate={RATE}/1 ! "
                "queue max-size-buffers=1 leaky=downstream ! fakesink sync=false"
            )
            bus = self.pipeline.get_bus()
            bus.add_signal_watch()
            bus.connect("message", self.on_message)
            if self.pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
                self.fail("Could not start the virtual display stream")
        except GLib.Error as error:
            self.fail(str(error))

    def check_layout(self):
        try:
            serial, monitors, logical, properties = call(self.dc, "GetCurrentState")
            if self.connector is None:
                candidates = [m for m in monitors if m[0][0] not in self.before and m[0][0].startswith("Meta-")]
                if not candidates:
                    if time.monotonic() - self.started > 30:
                        return self.fail("GNOME did not expose the virtual display within 30 seconds")
                    return True
                if len(candidates) != 1:
                    return self.fail("Another virtual display appeared; refusing to change an ambiguous output")
                self.connector = candidates[0][0][0]
            monitor = next((m for m in monitors if m[0][0] == self.connector), None)
            if monitor is None:
                return self.fail("GNOME removed the virtual display")
            modes = [m for m in monitor[1] if m[1] == WIDTH and m[2] == HEIGHT and abs(m[3] - RATE) < 1]
            if not modes:
                return self.fail("The virtual display does not expose 3840x2160 at 60 Hz")
            mode = modes[0]
            scale = min(mode[5], key=lambda value: abs(value - 1.5))
            current = next((l for l in logical if any(s[0] == self.connector for s in l[5])), None)
            other_outputs = any(s[0] != self.connector for l in logical for s in l[5])
            if current is None or not current[4] or abs(current[2] - scale) > 0.01 or (VIRTUAL_ONLY and other_outputs):
                arrangement = [(0, 0, scale, 0, True, [(self.connector, mode[0], {})])]
                x = round(WIDTH / scale)
                for old in logical:
                    if VIRTUAL_ONLY:
                        break
                    specs = [s for s in old[5] if s[0] != self.connector]
                    if not specs:
                        continue
                    outputs = []
                    width = 0
                    for spec in specs:
                        other = next(m for m in monitors if m[0][0] == spec[0])
                        selected = next(m for m in other[1] if m[6].get("is-current"))
                        outputs.append((spec[0], selected[0], {}))
                        pixels = selected[2] if old[3] in (1, 3, 5, 7) else selected[1]
                        width = max(width, round(pixels / old[2]))
                    arrangement.append((x, 0, old[2], old[3], False, outputs))
                    x += width
                call(self.dc, "ApplyMonitorsConfig", "(uua(iiduba(ssa{sv}))a{sv})", (
                    serial, 1, arrangement, {"layout-mode": GLib.Variant("u", properties.get("layout-mode", 1))}
                ))
                return True
            if not READY.exists():
                READY.write_text(json.dumps({"pid": os.getpid(), "connector": self.connector,
                    "width": WIDTH, "height": HEIGHT, "refresh": mode[3], "scale": scale,
                    "pipewireNode": self.node}) + "\n")
                READY.chmod(0o600)
                print(f"Ready: {self.connector} {WIDTH}x{HEIGHT}@{mode[3]:.2f}, scale {scale}", flush=True)
        except (GLib.Error, StopIteration, ValueError) as error:
            return self.fail(f"Display configuration failed: {error}")
        return True

    def run(self):
        READY.unlink(missing_ok=True)
        Gst.init(None)
        screen_cast = proxy(SC, "/org/gnome/Mutter/ScreenCast", SC)
        path = call(screen_cast, "CreateSession", "(a{sv})", ({},))[0]
        self.session = proxy(SC, path, SC + ".Session")
        self.session.connect("g-signal", lambda _p, _s, name, _a: self.fail("ScreenCast session closed") if name == "Closed" and not self.closing else None)
        # Hidden/metadata cursor modes inhibit the virtual view's cursor overlay,
        # also hiding it from a separate Sunshine monitor capture.
        path = call(self.session, "RecordVirtual", "(a{sv})", ({
            "is-platform": GLib.Variant("b", True), "cursor-mode": GLib.Variant("u", 1)
        },))[0]
        self.stream = proxy(SC, path, SC + ".Stream")
        self.stream.connect("g-signal", self.on_stream)
        call(self.session, "Start")
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda _sig, _frame: self.loop.quit())
        GLib.timeout_add(500, self.check_layout)
        try:
            self.loop.run()
        finally:
            self.closing = True
            READY.unlink(missing_ok=True)
            if self.pipeline:
                self.pipeline.set_state(Gst.State.NULL)
            if self.session:
                try:
                    call(self.session, "Stop")
                except GLib.Error:
                    pass
        return 1 if self.failed else 0


if __name__ == "__main__":
    if "--check-ready" in sys.argv:
        try:
            data = json.loads(READY.read_text())
            os.kill(data["pid"], 0)
            state = call(proxy(DC, "/org/gnome/Mutter/DisplayConfig", DC), "GetCurrentState")
            valid = any(m[0][0] == data["connector"] and any(
                v[1] == WIDTH and v[2] == HEIGHT and abs(v[3] - RATE) < 1 and v[6].get("is-current")
                for v in m[1]) for m in state[1])
            sys.exit(0 if valid else 1)
        except (OSError, ValueError, KeyError, GLib.Error):
            sys.exit(1)
    sys.exit(VirtualDisplay().run())
