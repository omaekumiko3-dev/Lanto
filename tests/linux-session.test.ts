import test from 'node:test'
import assert from 'node:assert/strict'
import { linuxClipboardEnvironment } from '../src/clipboard/linux-session.ts'

test('a Host started before login acquires the current desktop without importing unrelated variables', async () => {
  const inherited = { PATH: '/usr/bin', LANG: 'en_US.UTF-8', XDG_RUNTIME_DIR: '/run/user/1000' }
  const current = await linuxClipboardEnvironment(inherited, async () => ({
    DISPLAY: ':0',
    XAUTHORITY: '/run/user/1000/.mutter-Xwaylandauth.first',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    PATH: '/unexpected/bin',
    SSH_AUTH_SOCK: '/private/agent',
    LD_PRELOAD: '/unexpected/library.so'
  }))
  assert.equal(current.DISPLAY, ':0')
  assert.equal(current.XAUTHORITY, '/run/user/1000/.mutter-Xwaylandauth.first')
  assert.equal(current.PATH, '/usr/bin')
  assert.equal(current.SSH_AUTH_SOCK, undefined)
  assert.equal(current.LD_PRELOAD, undefined)
  assert.equal('DISPLAY' in inherited, false)

  const relogin = await linuxClipboardEnvironment(current, async () => ({
    DISPLAY: ':1',
    XAUTHORITY: '/run/user/1000/.mutter-Xwaylandauth.second'
  }))
  assert.equal(relogin.DISPLAY, ':1')
  assert.equal(relogin.XAUTHORITY, '/run/user/1000/.mutter-Xwaylandauth.second')
  assert.equal(current.DISPLAY, ':0')
})

test('manual desktop launches survive an unavailable or invalid user-session environment', async () => {
  const inherited = { DISPLAY: ':9', XAUTHORITY: '/home/desktop/.Xauthority' }
  for (const value of [null, [], { DISPLAY: 0, XAUTHORITY: 'invalid\0path' }]) {
    assert.deepEqual(await linuxClipboardEnvironment(inherited, async () => value), inherited)
  }
  assert.deepEqual(
    await linuxClipboardEnvironment(inherited, async () => {
      throw new Error('No user manager')
    }),
    inherited
  )
})
