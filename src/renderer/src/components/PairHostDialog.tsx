import type { ReactNode } from 'react'
import { useState } from 'react'
import type { DiscoveredHost } from '../../../protocol/host.ts'
import { errorText, platformNames } from '../format.ts'
import { Icon } from '../Icon.tsx'
import { Modal } from './Modal.tsx'

export function PairHostDialog({
  notice,
  busy,
  close,
  discover,
  pair
}: {
  notice?: ReactNode
  busy: boolean
  close: () => void
  discover: () => Promise<DiscoveredHost[]>
  pair: (ticket: string) => Promise<void>
}) {
  const [ticket, setTicket] = useState('')
  const [found, setFound] = useState<DiscoveredHost[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

  async function search() {
    setSearching(true)
    setError('')
    try {
      setFound(await discover())
      setSearched(true)
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setSearching(false)
    }
  }

  return (
    <Modal notice={notice} title="Connect to Lanto Host" busy={busy || searching} close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void pair(ticket)
        }}
      >
        <div className="form-body">
          <div className="discovery-heading">
            <div>
              <h3>LAN devices</h3>
              <small>After discovering a device, you still need pairing credentials from the Host.</small>
            </div>
            <button
              className="button secondary small"
              type="button"
              disabled={busy || searching}
              onClick={() => void search()}
            >
              <Icon name="signal" size={15} />
              {searching ? 'Discovering…' : 'Discover devices'}
            </button>
          </div>
          {found.length > 0 && (
            <ul className="discovered-hosts">
              {found.map((host) => (
                <li key={host.id}>
                  <Icon name={host.platform} size={21} />
                  <div>
                    <strong>{host.name}</strong>
                    <small>
                      {platformNames[host.platform]} · {host.address}:{host.port}
                    </small>
                  </div>
                  <span>Awaiting authorization</span>
                </li>
              ))}
            </ul>
          )}
          {searched && found.length === 0 && (
            <p className="settings-footnote">
              No devices found yet. You can paste pairing credentials to connect directly. Check that the Host is running and the devices are on the same LAN.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <label>
            Host Pairing Credentials
            <textarea
              autoFocus
              required
              value={ticket}
              onChange={(event) => setTicket(event.target.value)}
              placeholder="Paste one-time pairing credentials beginning with LANTO1."
              maxLength={16000}
              rows={5}
              spellCheck={false}
            />
            <small>
              On the controlled device, run npm run host -- pair
              to generate them. Credentials are valid for five minutes; copy them using a method you trust.
            </small>
          </label>
          <div className="form-note">
            <Icon name="key" size={17} />
            <span>
              After pairing, you can view Host status. The first time you open the remote display, you also need to complete Moonlight streaming pairing.
            </span>
          </div>
        </div>
        <footer className="modal-footer">
          <div className="footer-spacer" />
          <button
            className="button secondary"
            type="button"
            disabled={busy || searching}
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={busy || searching || !ticket.trim()}
          >
            {busy ? 'Pairing…' : 'Pair and Add'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
