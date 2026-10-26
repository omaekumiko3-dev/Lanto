#!/usr/bin/env python3
"""Real GIO regression on a private D-Bus; no access to desktop permissions.

Run with LD_PRELOAD=<test build> and pass that library's absolute path.
The mock portal deliberately emits Response BEFORE returning the request path.
"""
import ctypes
import os
import subprocess
import sys

SERVICE = r'''
import gi, sys
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib
connection = Gio.DBusConnection.new_for_address_sync(sys.argv[1],
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
    None, None)
connection.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
    'org.freedesktop.DBus', 'RequestName',
    GLib.Variant('(su)', ('org.freedesktop.portal.Desktop', 0)), None,
    Gio.DBusCallFlags.NONE, 2000, None)
info = Gio.DBusNodeInfo.new_for_xml("""<node><interface name="org.freedesktop.portal.RemoteDesktop">
 <method name="Start"><arg type="o" direction="in"/><arg type="s" direction="in"/>
 <arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
</interface></node>""")
def call(conn, sender, path, interface, method, parameters, invocation):
    token = parameters.unpack()[2]['handle_token']
    request = '/org/freedesktop/portal/desktop/request/' + sender[1:].replace('.', '_') + '/' + token
    conn.emit_signal(sender, request, 'org.freedesktop.portal.Request', 'Response',
        GLib.Variant('(ua{sv})', (0, {})))
    conn.flush_sync(None)
    invocation.return_value(GLib.Variant('(o)', (request,)))
connection.register_object('/org/freedesktop/portal/desktop', info.interfaces[0], call, None, None)
print('READY', flush=True)
GLib.MainLoop().run()
'''


def main():
    daemon = subprocess.Popen(
        ['dbus-daemon', '--session', '--nofork', '--print-address=1'],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    service = None
    try:
        address = daemon.stdout.readline().strip()
        if not address.startswith('unix:'):
            raise RuntimeError('Private D-Bus did not start')
        service = subprocess.Popen([sys.executable, '-c', SERVICE, address],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if service.stdout.readline().strip() != 'READY':
            raise RuntimeError('Mock portal did not start: ' + service.stderr.read())
        # Make the existing GIO library visible to the preload adapter's RTLD_NEXT.
        ctypes.CDLL('libgio-2.0.so.0', mode=ctypes.RTLD_GLOBAL)
        library = ctypes.CDLL(os.path.abspath(sys.argv[1]))
        test = library.lanto_portal_test
        test.argtypes = [ctypes.c_char_p, ctypes.c_int]
        test.restype = ctypes.c_int
        baseline = test(address.encode(), 0)
        if baseline != 1:
            raise RuntimeError(f'Expected a lost response without adapter, got {baseline}')
        results = [test(address.encode(), 1) for _ in range(30)]
        if any(results):
            raise RuntimeError(f'Replay failures: {results}')
        print('PASS: real private D-Bus reproduces the late-subscribe timeout; 30/30 adapted calls recover', flush=True)
    finally:
        for process in (service, daemon):
            if process:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()


if __name__ == '__main__':
    main()
