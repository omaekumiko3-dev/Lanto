import type { WorkbenchView } from '../hooks/useWorkbench.ts'
import { Icon } from '../Icon.tsx'
import { platformNames, phaseNames } from '../format.ts'

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
      {state.config.devices.map((device) => {
        const host = state.trustedHosts.find((entry) => entry.id === device.hostId)
        const inUse = active && state.session.deviceId === device.id
        const reachable = host
          ? !host.error && host.status?.sunshineReachable
          : probes[device.id]?.reachable
        const detail =
          host?.error || (probes[device.id]?.reachable === false ? probes[device.id]?.message : '')
        return (
          <article
            className={`device-card ${selected?.id === device.id ? 'selected-card' : ''}`}
            key={device.id}
          >
            <button
              className="device-select"
              aria-label={device.name}
              aria-pressed={selected?.id === device.id}
              onClick={() => setSelectedId(device.id)}
            >
              <span className={`platform-icon ${device.platform}`}>
                <Icon name={device.platform} size={26} />
              </span>
              <span className="device-identity">
                <strong>{device.name}</strong>
                <small>{device.host || 'Address not set'}</small>
              </span>
              <span className="selection-mark">
                <Icon name="check" size={13} />
              </span>
            </button>
            <div className="device-card-footer">
              <span className="platform-label">{platformNames[device.platform]}</span>
              <span className={`probe-label ${inUse || reachable ? 'reachable' : ''}`}>
                <span className="status-dot" />
                {inUse
                  ? phaseNames[state.session.phase]
                  : !device.host
                    ? 'Not configured'
                    : reachable
                      ? 'Ready'
                      : detail
                        ? 'Unreachable'
                        : host
                          ? 'Paired'
                          : 'Pending check'}
              </span>
              <div className="device-tools">
                <button
                  className="icon-button"
                  title="Check connection"
                  aria-label={`Check ${device.name}`}
                  disabled={Boolean(busy) || !device.host}
                  onClick={() =>
                    void run(`probe:${device.id}`, async () => {
                      const result = await api.probe(device.id)
                      setProbes((previous) => ({ ...previous, [device.id]: result }))
                    })
                  }
                >
                  <Icon name="refresh" size={15} />
                </button>
                <button
                  className="icon-button"
                  title="Edit device"
                  aria-label={`Edit ${device.name}`}
                  disabled={Boolean(busy) || inUse}
                  onClick={() => setEditing(device)}
                >
                  <Icon name="edit" size={15} />
                </button>
              </div>
            </div>
            {detail && <p className="probe-detail">{detail}</p>}
          </article>
        )
      })}
      {state.config.devices.length === 0 && (
        <button className="empty-device" onClick={newDevice}>
          <Icon name="plus" size={24} />
          <span>Add First Device</span>
        </button>
      )}
    </section>
  )
}
