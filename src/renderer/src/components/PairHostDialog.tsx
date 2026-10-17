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
    <Modal notice={notice} title="Connect Lanto Host" busy={busy || searching} close={close}>
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
              <small>Discovered devices still require a pairing ticket from the Host.</small>
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
              No devices found. Paste a pairing ticket to connect directly. Check that Host is
              running and both devices are on the same LAN.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <label>
            Host pairing ticket
            <textarea
              autoFocus
              required
              value={ticket}
              onChange={(event) => setTicket(event.target.value)}
              placeholder="Paste a single-use pairing ticket starting with LANTO1."
              maxLength={16000}
              rows={5}
              spellCheck={false}
            />
            <small>
              Run npm run host -- pair in a terminal on the host to generate a ticket. It is valid
              for five minutes; transfer it using a trusted method.
            </small>
          </label>
          <div className="form-note">
            <Icon name="key" size={17} />
            <span>
              Pairing lets you view Host status. Complete Moonlight streaming pairing before opening
              the remote display for the first time.
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
            {busy ? 'Pairing…' : 'Pair and add'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
