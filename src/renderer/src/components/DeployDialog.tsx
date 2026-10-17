import { useState } from 'react'
import type { FormEvent } from 'react'
import type { DeploymentView, SshConnectionInput } from '../../../protocol/deployment.ts'
import type { LantoAPI } from '../../../shared/model.ts'
import { Modal } from './Modal.tsx'
import { Icon } from '../Icon.tsx'

const empty: SshConnectionInput = {
  name: '',
  network: 'direct',
  tunnelAddress: '',
  tunnelPort: 48200,
  host: '',
  port: 22,
  username: '',
  auth: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  administratorPassword: '',
  sunshineUsername: '',
  sunshinePassword: ''
}
export function DeployDialog({
  view,
  api,
  close,
  manual,
  connect
}: {
  view: DeploymentView
  api: LantoAPI
  close: () => void
  manual: () => void
  connect: (id: string) => void
}) {
  const [draft, setDraft] = useState<SshConnectionInput>({
    ...empty,
    network: view.network || 'direct',
    name: view.name || '',
    host: view.host || ''
  })
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [editing, setEditing] = useState(['idle', 'failed', 'cancelled'].includes(view.phase))
  const active = ['connecting', 'host-key', 'inspecting', 'deploying'].includes(view.phase)
  const field = (key: keyof SshConnectionInput, value: string | number) =>
    setDraft((previous) => ({ ...previous, [key]: value }))
  async function action(task: () => Promise<void>) {
    setError('')
    setStarting(true)
    try {
      await task()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operation failed')
    } finally {
      setStarting(false)
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void action(async () => {
      await api.inspectDeployment(draft)
      setDraft((previous) => ({
        ...previous,
        password: '',
        passphrase: '',
        administratorPassword: '',
        sunshineUsername: '',
        sunshinePassword: ''
      }))
      setEditing(false)
    })
  }
  const labels = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }
  return (
    <Modal
      title="Add device via SSH"
      close={close}
      busy={active || starting}
      notice={error ? <div role="alert">{error}</div> : undefined}
    >
      {editing ? (
        <form onSubmit={submit}>
          <div className="form-body deploy-form">
            <p className="form-intro">
              Connect once to configure the remote desktop automatically. SSH must be enabled and
              the target desktop signed in.
            </p>
            <label>
              Connection mode
              <select
                aria-label="Connection mode"
                value={draft.network || 'direct'}
                onChange={(event) => field('network', event.target.value)}
              >
                <option value="direct">Local network / direct connection</option>
                <option value="tunnel">Encrypted direct tunnel · no account</option>
              </select>
              {draft.network === 'tunnel' && (
                <small>
                  Connect these two devices without an account or relay. Set up over reachable SSH
                  first; future connections use the tunnel.
                </small>
              )}
            </label>
            <div className="form-columns">
              <label>
                Device name
                <input
                  autoFocus
                  required
                  maxLength={50}
                  value={draft.name}
                  onChange={(event) => field('name', event.target.value)}
                  placeholder="e.g. Office Mac"
                />
              </label>
              <label>
                SSH username
                <input
                  required
                  maxLength={128}
                  autoComplete="username"
                  spellCheck={false}
                  value={draft.username}
                  onChange={(event) => field('username', event.target.value)}
                  placeholder="User signed in to the target device"
                />
              </label>
            </div>
            <div className="form-columns deploy-address">
              <label>
                IP address or hostname
                <input
                  required
                  maxLength={253}
                  spellCheck={false}
                  value={draft.host}
                  onChange={(event) => field('host', event.target.value)}
                  placeholder="192.168.1.20"
                />
              </label>
              <label>
                Port
                <input
                  required
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port}
                  onChange={(event) => field('port', Number(event.target.value))}
                />
              </label>
            </div>
            {draft.network === 'tunnel' && (
              <div className="form-columns deploy-address">
                <label>
                  Tunnel endpoint
                  <input
                    aria-label="Tunnel endpoint"
                    aria-describedby="tunnel-endpoint-help"
                    maxLength={253}
                    spellCheck={false}
                    value={draft.tunnelAddress || ''}
                    onChange={(event) => field('tunnelAddress', event.target.value)}
                    placeholder="Leave blank to use the SSH address"
                  />
                  <small id="tunnel-endpoint-help">
                    Use the target’s public IPv6, public IP, or hostname when connecting across
                    networks. Without a reachable endpoint, this mode cannot connect.
                  </small>
                </label>
                <label>
                  Tunnel UDP port
                  <input
                    aria-label="Tunnel UDP port"
                    aria-describedby="tunnel-port-help"
                    required
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.tunnelPort || 48200}
                    onChange={(event) => field('tunnelPort', Number(event.target.value))}
                  />
                  <small id="tunnel-port-help">
                    Forward this external UDP port to port 48200 on the target if using a router.
                  </small>
                </label>
              </div>
            )}
            <label>
              Authentication method
              <select
                aria-label="Authentication method"
                value={draft.auth}
                onChange={(event) => field('auth', event.target.value)}
              >
                <option value="password">Password</option>
                <option value="key">SSH private key</option>
                <option value="agent">Local SSH Agent</option>
              </select>
            </label>
            {draft.auth === 'password' && (
              <label>
                SSH password
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  maxLength={4096}
                  value={draft.password}
                  onChange={(event) => field('password', event.target.value)}
                />
              </label>
            )}
            {draft.auth === 'key' && (
              <>
                <label>
                  Private key file
                  <div className="input-action">
                    <input
                      readOnly
                      required
                      value={draft.privateKeyPath}
                      placeholder="Select a local private key file"
                    />
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        void action(async () => {
                          const path = await api.chooseSshKey()
                          if (path) field('privateKeyPath', path)
                        })
                      }
                    >
                      Select
                    </button>
                  </div>
                </label>
                <label>
                  Private key passphrase
                  <input
                    type="password"
                    autoComplete="off"
                    value={draft.passphrase}
                    onChange={(event) => field('passphrase', event.target.value)}
                    placeholder="Leave blank for an unencrypted private key"
                  />
                </label>
              </>
            )}
            <details className="deploy-advanced">
              <summary>Advanced authentication</summary>
              <label>
                sudo password
                <input
                  type="password"
                  autoComplete="off"
                  value={draft.administratorPassword}
                  onChange={(event) => field('administratorPassword', event.target.value)}
                  placeholder="Leave blank if it matches the SSH password"
                />
                <small>
                  Used when installing Linux system components. On Windows, use an administrator SSH
                  account.
                </small>
              </label>
              <label>
                Existing Sunshine administrator username
                <input
                  value={draft.sunshineUsername}
                  onChange={(event) => field('sunshineUsername', event.target.value)}
                  autoComplete="off"
                  placeholder="Usually blank; fill in if existing Sunshine requires authentication"
                />
              </label>
              <label>
                Existing Sunshine administrator password
                <input
                  type="password"
                  value={draft.sunshinePassword}
                  onChange={(event) => field('sunshinePassword', event.target.value)}
                  autoComplete="off"
                />
                <small>
                  Used only for initial display pairing; existing usernames and passwords are
                  unchanged.
                </small>
              </label>
            </details>
            <div className="form-note">
              <Icon name="link" size={16} />
              <span>
                Existing configuration is preserved. SSH passwords, key passphrases, and sudo
                passwords are used only for this operation.
              </span>
            </div>
          </div>
          <footer className="modal-footer">
            <button type="button" className="text-button" onClick={manual}>
              Add manually
            </button>
            <div className="footer-actions">
              <button type="button" className="button secondary" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={starting}>
                {starting ? 'Connecting…' : 'Connect and inspect'}
              </button>
            </div>
          </footer>
        </form>
      ) : (
        <>
          <div className="form-body deploy-status" aria-live="polite">
            <div className="deploy-target">
              <strong>{view.name}</strong>
              <span>
                {view.host}
                {view.system
                  ? ` · ${labels[view.system.platform]} ${view.system.architecture}`
                  : ''}
              </span>
            </div>
            {view.tunnelEndpoint && (
              <p className="form-intro">
                Direct tunnel endpoint: <strong>{view.tunnelEndpoint}</strong>
              </p>
            )}
            {view.phase === 'host-key' ? (
              <div className="host-key-review">
                <p>{view.message}</p>
                {view.previousFingerprint && (
                  <label>
                    Previous fingerprint<code>{view.previousFingerprint}</code>
                  </label>
                )}
                <label>
                  SSH host fingerprint<code>{view.fingerprint}</code>
                </label>
                <small>
                  Verify the SHA256 fingerprint against the SSH host public key on the target
                  device.
                </small>
              </div>
            ) : (
              <p
                className={
                  view.phase === 'failed' || view.phase === 'attention'
                    ? 'deploy-warning'
                    : 'form-intro'
                }
              >
                {view.message || 'Connecting to SSH…'}
              </p>
            )}
            {view.steps.length > 0 && (
              <ol className="deploy-steps">
                {view.steps.map((step, index) => (
                  <li key={step.id} data-phase={step.phase}>
                    <span className="deploy-step-marker">
                      {step.phase === 'complete' ? '✓' : step.phase === 'failed' ? '!' : index + 1}
                    </span>
                    <div>
                      <strong>{step.title}</strong>
                      {step.detail && <small>{step.detail}</small>}
                    </div>
                    <span className="deploy-step-state">
                      {
                        {
                          pending: 'Waiting',
                          running: 'In progress',
                          complete: 'Complete',
                          attention: 'Needs attention',
                          failed: 'Incomplete',
                          skipped: 'Reused'
                        }[step.phase]
                      }
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {view.progress && (
              <div className="deploy-progress">
                <span>{view.progress.label}</span>
                <progress
                  max={view.progress.total || undefined}
                  value={view.progress.total ? view.progress.bytes : undefined}
                />
                <small>
                  {(view.progress.bytes / 1048576).toFixed(1)} MB
                  {view.progress.total > 0
                    ? ` / ${(view.progress.total / 1048576).toFixed(1)} MB`
                    : ''}
                </small>
              </div>
            )}
          </div>
          <footer className="modal-footer">
            {active ? (
              <button
                className="button secondary"
                disabled={starting}
                onClick={() => void action(() => api.cancelDeployment())}
              >
                Cancel deployment
              </button>
            ) : (
              <button className="button secondary" onClick={close}>
                Close
              </button>
            )}
            <div className="footer-actions">
              {view.phase === 'host-key' && (
                <button
                  className="button primary"
                  disabled={starting}
                  onClick={() => void action(() => api.confirmSshHost(true))}
                >
                  Trust this device and continue
                </button>
              )}
              {view.phase === 'ready' && (
                <button
                  className="button primary"
                  disabled={
                    starting || (view.system?.platform === 'windows' && !view.system.administrator)
                  }
                  onClick={() => void action(() => api.startDeployment())}
                >
                  Deploy
                </button>
              )}
              {view.phase === 'attention' && (
                <button
                  className="button primary"
                  disabled={starting}
                  onClick={() => void action(() => api.startDeployment())}
                >
                  Continue verification
                </button>
              )}
              {view.phase === 'attention' && view.network === 'tunnel' && (
                <button
                  className="button secondary"
                  disabled={starting}
                  onClick={() =>
                    void action(async () => {
                      await api.cancelDeployment()
                      setEditing(true)
                    })
                  }
                >
                  Edit connection
                </button>
              )}
              {['failed', 'cancelled', 'complete'].includes(view.phase) && (
                <button className="button secondary" onClick={() => setEditing(true)}>
                  Reconnect
                </button>
              )}
              {view.phase === 'complete' && view.deviceId && (
                <button className="button primary" onClick={() => connect(view.deviceId!)}>
                  Connect device
                </button>
              )}
            </div>
          </footer>
        </>
      )}
    </Modal>
  )
}
