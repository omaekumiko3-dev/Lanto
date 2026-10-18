import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

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
