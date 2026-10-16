import logo from '../../../../assets/lanto.svg'
import { Icon } from '../Icon.tsx'
import type { WindowAction } from '../../../shared/model.ts'

export function Titlebar({
  settings,
  error
}: {
  settings: () => void
  error: (text: string) => void
}) {
  function control(action: WindowAction) {
    void window.lanto.controlWindow(action).catch(() => error('Window operation failed. Try again.'))
  }
  return (
    <header className="titlebar">
      <div className="brand">
        <img src={logo} alt="" />
        <span>Lanto</span>
      </div>
      <div className="titlebar-actions">
        <button
          className="icon-button settings-button"
          aria-label="Settings"
          title="Settings"
          onClick={settings}
        >
          <Icon name="settings" size={18} />
        </button>
        <span className="titlebar-divider" />
        <button
          className="window-button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => control('minimize')}
        >
          <Icon name="minimize" size={15} />
        </button>
        <button
          className="window-button"
          aria-label="Maximize or restore"
          title="Maximize or restore"
          onClick={() => control('maximize')}
        >
          <Icon name="maximize" size={14} />
        </button>
        <button
          className="window-button window-close"
          aria-label="Close Window"
          title="Close Window"
          onClick={() => control('close')}
        >
          <Icon name="close" size={17} />
        </button>
      </div>
    </header>
  )
}
