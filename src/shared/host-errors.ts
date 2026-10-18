import type { HostErrorKind } from '../protocol/host.ts'

export const hostErrorMessages: Record<HostErrorKind, string> = {
  network: 'Host is unreachable; checking again automatically. Check its network and Host service.',
  authorization: 'Host authorization was rejected; pair this device again.',
  identity: 'Host identity or certificate changed; verify the device before pairing again.',
  service: 'Host returned an invalid response; check the Host service.'
}
