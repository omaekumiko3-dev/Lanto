import type { WorkbenchView } from '../hooks/useWorkbench.ts'
import { Icon } from '../Icon.tsx'
import { shortcutLabel } from '../format.ts'

export function SessionBar({ model }: { model: WorkbenchView }) {
  const { state, selected, settings, phase, active, selectedActive, busy, run, api } = model
  const running = state.config.devices.find((device) => device.id === state.session.deviceId)
  const waiting = state.session.phase === 'launching' || state.session.phase === 'stopping'
  return (
    <footer className="session-bar">
      <div className="session-summary">
        <span className={`status-dot ${active ? 'cyan' : ''}`} />
        <div>
          <strong>{active ? running?.name || 'Connecting' : selected?.name || 'No device selected'}</strong>
          <small>
            {active
              ? 'Alt + Tab to switch windows'
              : `${settings.resolution === '2560x1440' ? '2K' : '1080p'} · ${settings.fps} FPS`}
          </small>
        </div>
      </div>
      <div className="session-actions">
        {(active || state.session.phase === 'failed') && (
          <button
            className="button secondary"
            title={`Disconnect and return to this machine · ${shortcutLabel(settings.returnShortcut)}`}
            disabled={Boolean(busy) || waiting}
            onClick={() => void run('return', () => api.returnLocal())}
          >
            <Icon name="back" size={16} />
            Return to This Machine
          </button>
        )}
        {(!selectedActive || !active) && (
          <button
            className="button primary"
            disabled={
              Boolean(busy) ||
              waiting ||
              !selected?.host ||
              !state.runtime.moonlightPath ||
              !state.runtime.shortcutRegistered
            }
            onClick={() => selected && void run('connect', () => api.connect(selected.id))}
          >
            {phase === 'launching' || busy === 'connect'
              ? 'Connecting…'
              : active
                ? 'Switch to this device'
                : 'Open Remote Desktop'}
            <Icon name="arrow" size={17} />
          </button>
        )}
      </div>
    </footer>
  )
}
