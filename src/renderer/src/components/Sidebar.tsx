import type { WorkbenchView } from '../hooks/useWorkbench.ts'
import { Icon } from '../Icon.tsx'

export function Sidebar({ model }: { model: WorkbenchView }) {
  const { state, selected, active, setSettingsOpen, newDevice, setSelectedId } = model
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">L</div>
        <div>
          Lanto<span>LOCAL. CONNECTED.</span>
        </div>
      </div>
      <div className="nav-label">Workspace</div>
      <nav aria-label="Main navigation">
        <button className="nav-button active" onClick={() => setSettingsOpen(false)}>
          <Icon name="grid" />
          Workbench
          <span className="nav-dot" />
        </button>
        <button className="nav-button" onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" />
          Settings
        </button>
      </nav>
      <div className="device-nav-title">
        <span className="nav-label">My Devices</span>
        <button className="icon-button" title="Add Device" onClick={newDevice}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      <div className="device-nav">
        {state.config.devices.map((device) => (
          <button
            key={device.id}
            className={`device-nav-item ${selected?.id === device.id ? 'selected' : ''}`}
            onClick={() => setSelectedId(device.id)}
          >
            <span className={`device-nav-icon ${device.platform}`}>
              <Icon name={device.platform} size={18} />
            </span>
            <span>
              <strong>{device.name}</strong>
              <small>{device.host || 'Waiting for setup'}</small>
            </span>
            {state.session.deviceId === device.id && active && <span className="status-dot cyan" />}
          </button>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div className="local-machine">
          <Icon name="windows" size={20} />
          <div>
            <strong>Local machine</strong>
            <small>
              {state.runtime.platform === 'win32' ? 'Windows · Actions' : 'Current Device · Actions'}
            </small>
          </div>
          <span className="status-dot cyan" />
        </div>
        <div className="version">
          Personal Local Network Workspace <span>v{state.runtime.version}</span>
        </div>
      </div>
    </aside>
  )
}
