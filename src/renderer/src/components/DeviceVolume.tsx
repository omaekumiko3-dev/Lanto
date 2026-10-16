import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Device, DeviceAudio, LantoAPI } from '../../../shared/model.ts'
import { Icon } from '../Icon.tsx'
import { errorText } from '../format.ts'

export function DeviceVolume({
  device,
  api,
  disabled,
  onError
}: {
  device: Device
  api: LantoAPI
  disabled: boolean
  onError: (message: string) => void
}) {
  const [audio, setAudio] = useState<DeviceAudio>({ volume: device.volume, muted: device.muted })
  const pending = useRef<DeviceAudio | null>(null)
  const saving = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!saving.current) setAudio({ volume: device.volume, muted: device.muted })
  }, [device.volume, device.muted])

  function update(value: DeviceAudio) {
    setAudio(value)
    pending.current = value
    if (saving.current) return
    saving.current = true
    void (async () => {
      try {
        // Keep only the latest drag position while the previous update is being saved.
        while (pending.current) {
          const next = pending.current
          pending.current = null
          try {
            const state = await api.setDeviceAudio({
              id: device.id,
              volume: next.volume,
              muted: next.muted
            })
            const saved = state.config.devices.find((entry) => entry.id === device.id)
            if (!pending.current && saved && mounted.current)
              setAudio({ volume: saved.volume, muted: saved.muted })
          } catch (error) {
            pending.current = null
            if (mounted.current) onError(errorText(error))
            const state = await api.getState()
            const saved = state.config.devices.find((entry) => entry.id === device.id)
            if (saved && mounted.current && !pending.current)
              setAudio({ volume: saved.volume, muted: saved.muted })
          }
        }
      } catch (error) {
        if (mounted.current) onError(errorText(error))
      } finally {
        saving.current = false
      }
    })()
  }

  const silent = audio.muted || audio.volume === 0
  return (
    <div className={`device-volume ${silent ? 'is-muted' : ''}`}>
      <button
        className="icon-button volume-button"
        type="button"
        aria-label={`${silent ? 'Unmute' : 'Mute'} ${device.name}`}
        aria-pressed={silent}
        title={silent ? 'Restore stream audio' : 'Mute stream audio'}
        disabled={disabled}
        onClick={() =>
          update(silent ? { volume: audio.volume || 100, muted: false } : { ...audio, muted: true })
        }
      >
        <Icon name={silent ? 'volumeOff' : 'volume'} size={17} />
      </button>
      <input
        className="volume-slider"
        type="range"
        min="0"
        max="100"
        step="1"
        value={audio.volume}
        aria-label={`${device.name} Volume`}
        aria-valuetext={`${audio.volume}%${audio.muted ? ', muted' : ''}`}
        title="Adjust the stream volume for this device"
        disabled={disabled}
        style={{ '--volume': `${audio.volume}%` } as CSSProperties}
        onChange={(event) => update({ volume: Number(event.target.value), muted: false })}
      />
      <output className="volume-value" aria-hidden="true">
        {silent ? 'Mute' : `${audio.volume}%`}
      </output>
    </div>
  )
}
