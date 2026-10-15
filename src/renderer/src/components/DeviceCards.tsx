import type { WorkbenchView } from '../hooks/useWorkbench.ts'
import { Icon } from '../Icon.tsx'
import { platformNames } from '../format.ts'

export function DeviceCards({ model }: { model: WorkbenchView }) {
  const {
    state,
    selected,
    active,
    busy,
    newDevice,
    setSelectedId,
    run,
    api,
    setEditing,
    probes,
    setProbes
  } = model
  return (
    <section className="device-cards" aria-label="Device list">
      {state.config.devices.map((device, index) => {
        const host = state.trustedHosts.find((entry) => entry.id === device.hostId)
        return (
          <article
            className={`device-card ${selected?.id === device.id ? 'selected-card' : ''}`}
            key={device.id}
          >
            <div className="device-card-top">
              <span className={`platform-icon ${device.platform}`}>
                <Icon name={device.platform} size={24} />
              </span>
              <span className="device-number">{String(index + 1).padStart(2, '0')}</span>
              <button
                className="icon-button"
                aria-label={`Edit ${device.name}`}
                disabled={Boolean(busy) || (state.session.deviceId === device.id && active)}
                onClick={() => setEditing(device)}
              >
                <Icon name="edit" size={16} />
              </button>
            </div>
            <button className="device-name" onClick={() => setSelectedId(device.id)}>
              {device.name}
              <Icon name="arrow" size={16} />
            </button>
            <div className="device-address">
              {device.host || 'Address not set'} <span>{platformNames[device.platform]}</span>
            </div>
            <div className="device-card-footer">
              <span className={`probe-label ${probes[device.id]?.reachable ? 'reachable' : ''}`}>
                <span className="status-dot" />
                {host
                  ? host.status
                    ? 'Host connected'
                    : host.error
                      ? 'Host unreachable'
                      : 'Host paired'
                  : !device.host
                    ? 'Waiting for setup'
                    : probes[device.id]
                      ? probes[device.id].reachable
                        ? 'Port reachable'
                        : 'Port unreachable'
                      : 'Not checked'}
              </span>
              <button
                className="text-button"
                disabled={Boolean(busy) || !device.host}
                onClick={() =>
                  void run(`probe:${device.id}`, async () => {
                    const result = await api.probe(device.id)
                    setProbes((previous) => ({ ...previous, [device.id]: result }))
                  })
                }
              >
                {busy === `probe:${device.id}` ? 'Checking…' : host ? 'Check status' : 'Check port'}
              </button>
            </div>
            {probes[device.id] && <p className="probe-detail">{probes[device.id].message}</p>}
            {host && !probes[device.id] && (
              <p className="probe-detail">
                {host.error ||
                  (host.status
                    ? host.status.sunshineReachable
                      ? 'Sunshine port is reachable. For the first stream, pair in Moonlight.'
                      : 'Host is ready; Sunshine has not started or its port is unreachable.'
                    : 'Click Check Status to confirm whether Host and Sunshine are ready.')}
              </p>
            )}
          </article>
        )
      })}
      {state.config.devices.length === 0 && (
        <button className="empty-device button secondary" onClick={newDevice}>
          <Icon name="plus" />
          Add a Linux, Mac, or Windows device
        </button>
      )}
    </section>
  )
}
