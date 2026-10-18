import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SessionManager, type MediaExit, type MediaHandle } from '../src/main/session-manager.ts'
import { defaultConfig } from '../src/shared/model.ts'
import { deviceFixture } from './fixtures.ts'

const settings = defaultConfig().settings
const first = deviceFixture()
const second = deviceFixture({ name: 'Test Mac', host: 'mac.local', platform: 'macos' })
const third = deviceFixture({ name: 'Third', host: 'third.local' })

function fixture() {
  const owners = new Set<number>()
  const handles: ReturnType<typeof handle>[] = []
  const events: string[] = []
  let failStart = false
  function handle(pid: number) {
    let resolve!: (exit: MediaExit) => void
    const value = {
      pid,
      stops: 0,
      failStop: false,
      failHide: false,
      failShow: false,
      failConfigure: false,
      audio: [] as number[],
      closed: new Promise<MediaExit>((done) => {
        resolve = done
      }),
      exit(code: number) {
        owners.delete(pid)
        resolve({ code, signal: null })
      },
      async stop() {
        value.stops++
        if (value.failStop) throw new Error('stop failed')
        value.exit(0)
      },
      async setAudio(audio: { volume: number }) {
        value.audio.push(audio.volume)
      },
      window: {
        async toggle(): Promise<'local' | 'remote'> {
          throw new Error('Use explicit owner selection')
        },
        async show() {
          events.push(`show:${pid}`)
          if (value.failShow) throw new Error('show failed')
          assert.ok(
            owners.size === 0 || owners.has(pid),
            'previous input owner must release before show'
          )
          owners.add(pid)
        },
        async hide() {
          events.push(`hide:${pid}`)
          if (value.failHide) throw new Error('hide failed')
          owners.delete(pid)
        },
        async configure(input: { lockInput: boolean }) {
          if (value.failConfigure) throw new Error('configure failed')
          events.push(`configure:${pid}:${input.lockInput}`)
        },
        close() {}
      }
    }
    return value
  }
  const manager = new SessionManager(
    {
      async start() {
        if (failStart) throw new Error('missing executable')
        assert.equal(owners.size, 0, 'release the current owner before launching')
        const value = handle(100 + handles.length)
        handles.push(value)
        owners.add(value.pid)
        return value
      }
    },
    () => {},
    () => {}
  )
  return {
    manager,
    handles,
    owners,
    events,
    failStart: (value: boolean) => {
      failStart = value
    }
  }
}

test('two streams stay connected; a third is rejected and the cycle retains one input owner', async () => {
  const { manager, handles, owners } = fixture()
  await manager.connect(first, settings)
  await manager.connect(first, settings)
  await manager.connect(second, settings)
  assert.equal(handles.length, 2)
  assert.deepEqual(
    handles.map((value) => value.stops),
    [0, 0]
  )
  assert.equal(manager.controlDeviceId, second.id)
  await assert.rejects(manager.connect(third, settings), /Two devices/)
  assert.equal(manager.controlDeviceId, second.id)
  assert.equal(await manager.toggleWindow(), 'local')
  assert.equal(owners.size, 0)
  const expected = [first.id, second.id, null, first.id, second.id, null]
  for (const id of expected) {
    await manager.toggleWindow()
    assert.equal(manager.controlDeviceId, id)
  }
  assert.equal(manager.sessions.length, 2)
  await manager.disconnect()
  assert.deepEqual(
    handles.map((value) => value.stops),
    [1, 1]
  )
})

test('rapid switch requests queue every distinct tap without a time debounce', async () => {
  const { manager, handles } = fixture()
  await manager.connect(first, settings)
  await manager.connect(second, settings)
  await manager.hideWindow()
  const results = await Promise.all(Array.from({ length: 10 }, () => manager.toggleWindow()))
  assert.deepEqual(results, [
    'remote',
    'remote',
    'local',
    'remote',
    'remote',
    'local',
    'remote',
    'remote',
    'local',
    'remote'
  ])
  assert.equal(manager.controlDeviceId, first.id)
  assert.deepEqual(
    handles.map((value) => value.stops),
    [0, 0]
  )
  await manager.disconnect()
})

test('disconnect and volume only target the selected device; another stream survives its exit', async () => {
  const { manager, handles } = fixture()
  await manager.connect(first, settings)
  await manager.connect(second, settings)
  await manager.setAudio(first.id, { volume: 25, muted: false })
  await manager.setAudio(second.id, { volume: 80, muted: true })
  assert.deepEqual(
    handles.map((value) => value.audio),
    [[25], [80]]
  )
  await manager.disconnect(first.id)
  assert.equal(manager.controlDeviceId, second.id)
  assert.equal(manager.sessions.length, 1)
  assert.equal(handles[1]!.stops, 0)
  await manager.connect(first, settings)
  handles[0]!.exit(9)
  await Promise.resolve()
  assert.equal(manager.sessions.length, 2)
  handles[1]!.exit(7)
  await Promise.resolve()
  assert.equal(manager.sessions.length, 1)
  assert.equal(manager.controlDeviceId, first.id)
  assert.equal(manager.state.phase, 'failed')
  await manager.disconnect()
})

test('startup failure leaves the existing stream alive and the queue usable', async () => {
  const { manager, handles, failStart } = fixture()
  await manager.connect(first, settings)
  failStart(true)
  await assert.rejects(manager.connect(second, settings), /missing executable/)
  assert.equal(manager.sessions.length, 1)
  assert.equal(manager.controlDeviceId, null)
  assert.equal(handles[0]!.stops, 0)
  failStart(false)
  await manager.connect(second, settings)
  await manager.disconnect()
})

test('failure to hide prevents a new owner; failure to show keeps both streams alive', async () => {
  const { manager, handles } = fixture()
  await manager.connect(first, settings)
  handles[0]!.failHide = true
  await assert.rejects(manager.connect(second, settings), /hide failed/)
  assert.equal(handles.length, 1)
  handles[0]!.failHide = false
  await manager.connect(second, settings)
  await manager.hideWindow()
  handles[0]!.failShow = true
  await assert.rejects(manager.toggleWindow(), /show failed/)
  assert.equal(manager.controlDeviceId, null)
  assert.equal(manager.sessions.length, 2)
  await manager.disconnect()
})

test('disconnect all attempts both clients and retains ownership of a process that fails to stop', async () => {
  const { manager, handles } = fixture()
  await manager.connect(first, settings)
  await manager.connect(second, settings)
  handles[0]!.failStop = true
  await assert.rejects(manager.disconnect(), /stop failed/)
  assert.equal(handles[1]!.stops, 1)
  assert.equal(manager.sessions.length, 1)
  assert.equal(manager.sessions[0]!.pid, handles[0]!.pid)
  handles[0]!.failStop = false
  await manager.disconnect()
  assert.equal(manager.state.phase, 'idle')
})

test('disconnect requested during startup waits for and closes the newly owned process', async () => {
  const { handles, manager: source } = fixture()
  await source.connect(first, settings)
  const pending = handles[0]!
  let finish!: (handle: MediaHandle) => void
  const manager = new SessionManager(
    {
      start: () =>
        new Promise((resolve) => {
          finish = resolve
        })
    },
    () => {},
    () => {}
  )
  const connecting = manager.connect(first, settings)
  await new Promise<void>((resolve) => setImmediate(resolve))
  const closing = manager.disconnect()
  finish(pending)
  await Promise.all([connecting, closing])
  assert.equal(pending.stops, 1)
  assert.equal(manager.state.phase, 'idle')
})

test('live input settings apply to both connected clients', async () => {
  const { manager, events } = fixture()
  await manager.connect(first, settings)
  await manager.connect(second, settings)
  await manager.configureWindow({ ...settings, lockInput: false })
  assert.ok(events.includes('configure:100:false') && events.includes('configure:101:false'))
  await manager.disconnect()
})

test('a failed input-settings update rolls back the other connected client', async () => {
  const { manager, handles, events } = fixture()
  await manager.connect(first, settings)
  await manager.connect(second, settings)
  handles[1]!.failConfigure = true
  await assert.rejects(
    manager.configureWindow({ ...settings, lockInput: false }),
    /configure failed/
  )
  assert.deepEqual(
    events.filter((entry) => entry.startsWith('configure')),
    ['configure:100:false', 'configure:100:true']
  )
  await manager.disconnect()
})
