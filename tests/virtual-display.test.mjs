import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test(
  'virtual display preserves its output through transient compositor timeouts but bounds persistent failure',
  { skip: process.platform !== 'linux' },
  async () => {
    const source = await readFile(
      new URL('../scripts/display/linux-virtual-display.py', import.meta.url),
      'utf8'
    )
    const result = spawnSync(
      'python3',
      [
        '-c',
        `
import ast, sys, types
tree = ast.parse(sys.stdin.read())
definition = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'VirtualDisplay')
class BusError(Exception): pass
clock = [0]
calls = []
failure = [True]
spec = ('Meta-0', 'MetaVendor', 'Virtual', '1')
mode = ('4k', 3840, 2160, 60, 1.5, [1, 1.5], {})
healthy = (1, [(spec, [mode], {})], [(0, 0, 1.5, 0, True, [spec], {})], {})
def call(*args):
 calls.append(clock[0])
 if failure[0]: raise BusError('Timeout was reached')
 return healthy
namespace = dict(sys=sys, time=types.SimpleNamespace(monotonic=lambda: clock[0]),
 GLib=types.SimpleNamespace(Error=BusError, Variant=lambda signature, value: value), call=call, WIDTH=3840, HEIGHT=2160, RATE=60,
 VIRTUAL_ONLY=True, READY=types.SimpleNamespace(exists=lambda: True))
exec(compile(ast.Module(body=[definition], type_ignores=[]), '<display>', 'exec'), namespace)
def display():
 obj = namespace['VirtualDisplay'].__new__(namespace['VirtualDisplay'])
 obj.next_layout_check = 0; obj.layout_failure_since = None; obj.connector = 'Meta-0'
 obj.dc = None; obj.failed = False; obj.started = 0; obj.quit = False
 obj.loop = types.SimpleNamespace(quit=lambda: setattr(obj, 'quit', True))
 return obj
obj = display()
assert obj.check_layout() and not obj.failed
clock[0] = 1
assert obj.check_layout() and calls == [0], calls
clock[0] = 5; failure[0] = False
assert obj.check_layout() and obj.layout_failure_since is None and not obj.quit
clock[0] = 10; failure[0] = True
assert obj.check_layout() and obj.layout_failure_since == 10
clock[0] = 39
assert obj.check_layout() and not obj.failed
clock[0] = 44
assert not obj.check_layout() and obj.failed and obj.quit
clock[0] = 0
obj = display()
def apply_timeout(target, method, *args):
 if method == 'ApplyMonitorsConfig': raise BusError('Apply timed out')
 return (1, healthy[1], [(0, 0, 1, 0, True, [spec], {})], {})
namespace['call'] = apply_timeout
assert obj.check_layout() and not obj.failed
clock[0] = 31
assert not obj.check_layout() and obj.failed, 'Successful reads must not reset a failing apply deadline'
print('transient timeout, polling backoff, recovery reset and persistent deadline passed')
`
      ],
      { input: source, encoding: 'utf8', timeout: 10000 }
    )
    assert.equal(result.status, 0, result.stderr)
  }
)

test(
  'virtual display cleanup deadline terminates a blocked native call without a Python callback',
  { skip: process.platform !== 'linux' },
  async () => {
    const source = await readFile(
      new URL('../scripts/display/linux-virtual-display.py', import.meta.url),
      'utf8'
    )
    const result = spawnSync(
      'python3',
      [
        '-c',
        `
import ast, ctypes, signal, sys
tree = ast.parse(sys.stdin.read())
definition = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'arm_cleanup_timeout')
namespace = {'signal': signal}
exec(compile(ast.Module(body=[definition], type_ignores=[]), '<cleanup>', 'exec'), namespace)
namespace['arm_cleanup_timeout']()
ctypes.CDLL(None).sleep(60)
raise SystemExit('Blocked cleanup returned without its deadline')
`
      ],
      { input: source, encoding: 'utf8', timeout: 10000 }
    )
    assert.equal(result.error, undefined)
    assert.equal(result.signal, 'SIGALRM')
  }
)

// Exercise the graph check on its Linux host without requiring a graphical
// session or importing GStreamer. Fixtures include the observed stalled graph.
test(
  'virtual display readiness rejects a surviving monitor with a stalled or unrelated stream',
  { skip: process.platform !== 'linux' },
  async () => {
    const source = await readFile(
      new URL('../scripts/display/linux-virtual-display.py', import.meta.url),
      'utf8'
    )
    const result = spawnSync(
      'python3',
      [
        '-c',
        `
import ast, copy, json, sys
tree = ast.parse(sys.stdin.read())
check = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'stream_linked')
namespace = {}
exec(compile(ast.Module(body=[check], type_ignores=[]), '<readiness>', 'exec'), namespace)
linked = namespace['stream_linked']
graph = [
 {'id': 63, 'type': 'PipeWire:Interface:Node', 'info': {'state': 'running', 'props': {'media.class': 'Stream/Output/Video'}}},
 {'id': 65, 'type': 'PipeWire:Interface:Client', 'info': {'props': {'application.process.id': 1234}}},
 {'id': 66, 'type': 'PipeWire:Interface:Node', 'info': {'state': 'running', 'props': {'client.id': 65, 'media.class': 'Stream/Input/Video'}}},
 {'id': 68, 'type': 'PipeWire:Interface:Link', 'info': {'state': 'active', 'output-node-id': 63, 'input-node-id': 66}}
]
assert linked(graph, 63, 1234)
for state in ('init', 'negotiating', 'paused', 'error'):
 broken = copy.deepcopy(graph); broken[-1]['info']['state'] = state
 assert not linked(broken, 63, 1234), state
broken = copy.deepcopy(graph); broken[0]['info']['state'] = 'idle'
assert not linked(broken, 63, 1234)
assert not linked(graph, 63, 9999)
assert not linked(graph, 9999, 1234)
print('active, stalled, and owner-reuse graph checks passed')
`
      ],
      { input: source, encoding: 'utf8', timeout: 10000 }
    )
    assert.equal(result.status, 0, result.stderr)
  }
)
