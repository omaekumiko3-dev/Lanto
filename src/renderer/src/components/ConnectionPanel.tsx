import type { WorkbenchView } from '../hooks/useWorkbench.ts'
import { Icon } from '../Icon.tsx'
import { platformNames, phaseNames, shortcutLabel } from '../format.ts'

export function ConnectionPanel({ model }: { model: WorkbenchView }) {
  const {
    state,
    selected,
    settings,
    phase,
    active,
    selectedActive,
    busy,
    setSettingsOpen,
    newDevice,
    run,
    api,
    setEditing
  } = model
  return (
    <section className="connection-grid">
      <div className="desktop-stage">
        <div className="stage-top">
          <div className="stage-target">
            <Icon name={selected?.platform || 'monitor'} size={17} />
            <span>{selected?.name || 'Waiting to add a device'}</span>
            {selected && <small>{platformNames[selected.platform]}</small>}
          </div>
          <span className={`status-badge ${phase === 'running' ? 'connected' : ''}`}>
            <span className="status-dot" />
            {selected?.host ? phaseNames[phase] : 'Waiting for setup'}
          </span>
        </div>
        <div className="stage-center">
          <div className={`desktop-art ${phase === 'running' ? 'is-running' : ''}`}>
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-screen">
              <Icon name={selected?.platform || 'monitor'} size={45} />
              <span className="screen-line" />
              <span className="screen-line short" />
            </div>
            <span className="art-node node-one" />
            <span className="art-node node-two" />
            <span className="art-node node-three" />
          </div>
          <h2>
            {phase === 'running'
              ? 'Continue in Moonlight'
              : selected
                ? `Connect your ${selected.name}`
                : 'Add your first device'}
          </h2>
          <p>
            {phase === 'running'
              ? 'The desktop has been handed off to a separate client. Use the return shortcut any time to come back to this machine.'
              : 'The remote desktop opens in a separate window, while the development environment and tasks stay on the remote machine.'}
          </p>
          <div className="stage-actions">
            {selected ? (
              <>
                <button
                  className="button primary"
                  disabled={
                    Boolean(busy) ||
                    !selected.host ||
                    !state.runtime.moonlightPath ||
                    !state.runtime.shortcutRegistered ||
                    phase === 'running' ||
                    phase === 'launching' ||
                    phase === 'stopping'
                  }
                  onClick={() => void run('connect', () => api.connect(selected.id))}
                >
                  <Icon name="arrow" size={18} />
                  {busy === 'connect'
                    ? 'Starting…'
                    : selectedActive && active
                      ? 'Client started'
                      : active
                        ? 'Switch to this device'
                        : 'Open Remote Desktop'}
                </button>
                <button
                  className="button quiet"
                  disabled={Boolean(busy) || (selectedActive && active)}
                  onClick={() => setEditing(selected)}
                >
                  <Icon name="edit" size={16} />
                  Edit device
                </button>
              </>
            ) : (
              <button className="button primary" onClick={newDevice}>
                <Icon name="plus" size={18} />
                Add Device
              </button>
            )}
          </div>
          {selectedActive && state.session.error && (
            <p className="stage-error">{state.session.error}</p>
          )}
        </div>
        <div className="stream-profile">
          <span>
            <Icon name="monitor" size={16} />
            <strong>{settings.resolution === '2560x1440' ? '2K' : '1080p'}</strong> / {settings.fps}{' '}
            FPS
          </span>
          <span>
            <Icon name="signal" size={15} />
            {settings.bitrateMbps} Mbps
          </span>
          <button className="text-button" onClick={() => setSettingsOpen(true)}>
            Adjust screen <Icon name="settings" size={14} />
          </button>
        </div>
      </div>
      <aside className="preparation-card">
        <div className="card-eyebrow">READY TO CONNECT</div>
        <h2>Connection setup</h2>
        <p className="preparation-intro">First connection? Complete these three steps.</p>
        <div className="checklist-item">
          <span className={`step-icon ${state.runtime.moonlightPath ? 'done' : ''}`}>
            {state.runtime.moonlightPath ? <Icon name="check" size={14} /> : '1'}
          </span>
          <div>
            <strong>Install Moonlight on this machine</strong>
            <small>{state.runtime.moonlightPath ? 'Client found' : 'Client not found'}</small>
            <button className="text-button" onClick={() => setSettingsOpen(true)}>
              {state.runtime.moonlightPath ? 'View client settings' : 'Choose install location'}{' '}
              <Icon name="arrow" size={13} />
            </button>
          </div>
        </div>
        <div className="checklist-item">
          <span className={`step-icon ${selected?.host ? 'done' : ''}`}>
            {selected?.host ? <Icon name="check" size={14} /> : '2'}
          </span>
          <div>
            <strong>Enter the target device address</strong>
            <small>{selected?.host || 'Use an IP address or LAN hostname'}</small>
            <button
              className="text-button"
              onClick={() => (selected ? setEditing(selected) : newDevice())}
            >
              Edit device <Icon name="arrow" size={13} />
            </button>
          </div>
        </div>
        <div className="checklist-item">
          <span className="step-icon">3</span>
          <div>
            <strong>Pair in Moonlight</strong>
            <small>Sunshine must be started on the target device first</small>
            <button
              className="text-button"
              disabled={Boolean(busy) || !state.runtime.moonlightPath || active}
              onClick={() => void run('pair', () => api.openMoonlight())}
            >
              Open Pairing Window <Icon name="external" size={12} />
            </button>
          </div>
        </div>
        <div className="return-card">
          <div>
            <Icon name="key" size={16} />
            <strong>Return to This Machine</strong>
          </div>
          <kbd>{shortcutLabel(settings.returnShortcut)}</kbd>
          <small>The initial release will close the local streaming window and return to Lanto.</small>
          <button
            className="button secondary small"
            disabled={Boolean(busy) || (!active && state.session.phase !== 'failed')}
            onClick={() => void run('return', () => api.returnLocal())}
          >
            <Icon name="back" size={15} />
            {busy === 'return' ? 'Returning…' : 'Return to This Machine'}
          </button>
        </div>
      </aside>
    </section>
  )
}
