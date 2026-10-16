import { randomUUID } from 'node:crypto'
import type { Device } from '../src/shared/model.ts'

export function deviceFixture(overrides: Partial<Device> = {}): Device {
  return {
    id: randomUUID(),
    name: 'Test Linux',
    host: 'linux1.local',
    platform: 'linux',
    appName: 'Desktop',
    volume: 100,
    muted: false,
    ...overrides
  }
}
