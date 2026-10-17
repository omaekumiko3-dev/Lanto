import type { WorkbenchView } from '../hooks/useWorkbench.ts'
import { Icon } from '../Icon.tsx'
import { platformNames, phaseNames } from '../format.ts'
import { DeviceVolume } from './DeviceVolume.tsx'

export function DeviceCards({ model }: { model: WorkbenchView }) {
  const { state, active, busy, newDevice, run, api, setEditing, probes, setProbes } = model
  const waiting = state.session.phase === 'launching' || state.session.phase === 'stopping'
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
          <article className={`device-card ${inUse ? 'active-card' : ''}`} key={device.id}>
            <div className="device-heading">
              <span className={`platform-icon ${device.platform}`}>
                <Icon name={device.platform} size={26} />
              </span>
              <span className="device-identity">
                <strong>{device.name}</strong>
                <small>
                  {device.tunnel
                    ? `${device.tunnel.address} · UDP ${device.tunnel.port}`
                    : device.host || 'Address not set'}
                </small>
              </span>
              <button
                type="button"
                className="connection-switch"
                role="switch"
                aria-label={`${device.name} connection`}
                aria-checked={inUse}
                aria-busy={inUse && waiting}
                title={inUse ? 'Disconnect' : 'Connect device'}
                disabled={
                  Boolean(busy) ||
                  waiting ||
                  (!inUse &&
                    (!device.host ||
                      !state.runtime.moonlightPath ||
                      !state.runtime.shortcutRegistered))
                }
                onClick={() =>
                  void run(`connection:${device.id}`, () =>
                    inUse ? api.returnLocal() : api.connect(device.id)
                  )
                }
              >
                <span className="switch-thumb" />
              </button>
            </div>
            <div className="device-card-footer">
              <span className="platform-label">
                {platformNames[device.platform]}
                {device.tunnel ? ' · Direct tunnel' : ''}
              </span>
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
                          : 'Not checked'}
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
                  title="Rename and device settings"
                  aria-label={`Edit ${device.name}`}
                  disabled={Boolean(busy)}
                  onClick={() => setEditing(device)}
                >
                  <Icon name="edit" size={15} />
                </button>
              </div>
            </div>
            <DeviceVolume
              device={device}
              api={api}
              disabled={Boolean(busy) || waiting}
              onError={model.setNotice}
            />
            {detail && <p className="probe-detail">{detail}</p>}
          </article>
        )
      })}
      {state.config.devices.length === 0 && (
        <button className="empty-device" onClick={newDevice}>
          <Icon name="plus" size={24} />
          <span>Add your first device</span>
        </button>
      )}
    </section>
  )
}
