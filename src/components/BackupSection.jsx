import { useEffect, useRef, useState } from 'react'
import { backup as api, drive as driveApi } from '../lib/api.js'
import Badge from './Badge.jsx'
import Button from './Button.jsx'
import EmptyState from './EmptyState.jsx'
import Field from './Field.jsx'
import Input from './Input.jsx'
import Modal, { ModalActions } from './Modal.jsx'
import Table from './Table.jsx'
import Toast from './Toast.jsx'

// Must match RESTORE_CONFIRMATION in electron/main.js, which checks it again
const CONFIRM_WORD = 'RESTORE'

// Part of the owner-only Settings page. Backups live in the app's data folder; one is also taken on every
// shutdown. A restore replaces all data and restarts the app, so it needs the confirmation word typed.
export default function BackupSection() {
  const [status, setStatus] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // { label, detail, run(confirmation) } while the confirmation dialog is open
  const [pending, setPending] = useState(null)

  function load() {
    setLoadError('')
    api
      .status()
      .then(setStatus)
      .catch((err) => setLoadError(err.message))
  }
  useEffect(load, [])

  async function backupNow() {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const name = await api.create()
      setMessage(`Backup saved: ${name}`)
      load()
    } catch (err) {
      setError(`Backup failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  function confirmListed(b) {
    setMessage('')
    setError('')
    setPending({
      label: b.name,
      detail: `${b.kind === 'pre-restore' ? 'Safety copy' : 'Backup'} from ${formatDateTime(b.created_at)}`,
      run: (confirmation) => api.restore(b.name, confirmation),
    })
  }

  async function chooseFile() {
    setMessage('')
    setError('')
    setBusy(true)
    try {
      const file = await api.chooseFile()
      if (!file) return
      setPending({
        label: file.name,
        detail: `${file.path} (${formatSize(file.size)}, modified ${formatDateTime(file.modified)})`,
        run: (confirmation) => api.restoreChosen(confirmation),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings settings-section backup-section">
      <h2>Backup</h2>
      <p className="settings-hint">
        A backup is taken automatically every 6 hours and every time the app closes. The 10 most recent are kept, plus the last backup of each day for 30 days. The 3 most recent copies saved before a restore are always kept.
      </p>

      {error && (
        <Toast tone="error" onDismiss={() => setError('')}>
          {error}
        </Toast>
      )}
      {message && (
        <Toast tone="success" onDismiss={() => setMessage('')}>
          {message}
        </Toast>
      )}

      <div className="backup-toolbar">
        <span>
          Last backup:{' '}
          <strong>{status ? (status.lastBackupAt ? formatDateTime(status.lastBackupAt) : 'never') : '…'}</strong>
        </span>
        <span className="backup-toolbar-actions">
          <Button variant="danger" onClick={chooseFile} disabled={busy}>
            Restore from file…
          </Button>
          <Button variant="primary" onClick={backupNow} loading={busy}>
            {busy ? 'Working…' : 'Back up now'}
          </Button>
        </span>
      </div>

      {loadError && <Toast tone="error">Could not list backups: {loadError}</Toast>}
      {status && status.backups.length === 0 && <EmptyState>No backups yet.</EmptyState>}
      {status && status.backups.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Date</th>
              <th>File</th>
              <th className="num">Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {status.backups.map((b) => (
              <tr key={b.name}>
                <td>
                  {formatDateTime(b.created_at)}
                  {b.kind === 'pre-restore' && <Badge>before restore</Badge>}
                </td>
                <td className="mono">{b.name}</td>
                <td className="num">{formatSize(b.size)}</td>
                <td className="actions">
                  <Button variant="danger" size="small" onClick={() => confirmListed(b)} disabled={busy}>
                    Restore
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <DriveSection onRestore={setPending} />

      {pending && <RestoreConfirm pending={pending} onCancel={() => setPending(null)} />}
    </section>
  )
}

// Copies to and from a PharmacyPOS folder in the owner's Google Drive. Nothing here touches the network
// until the owner clicks: the app is offline-first, and the remote list is only fetched on request.
// Restoring downloads the file, then the main process runs the same restore as a local backup.
function DriveSection({ onRestore }) {
  const [status, setStatus] = useState(null)
  const [loadError, setLoadError] = useState('')
  // Which action is running: 'connect' | 'disconnect' | 'upload' | 'list' | null
  const [working, setWorking] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // null until the owner asks for the list
  const [remote, setRemote] = useState(null)

  function loadStatus() {
    setLoadError('')
    driveApi
      .status()
      .then(setStatus)
      .catch((err) => setLoadError(err.message))
  }
  useEffect(loadStatus, [])

  async function run(action, fn) {
    setWorking(action)
    setMessage('')
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.message)
      // Expired access clears the stored credential in the main process; re-read so the buttons match
      loadStatus()
    } finally {
      setWorking(null)
    }
  }

  // Clicking again while sign-in waits (say, after closing the browser tab) restarts it, and the main
  // process rejects the earlier attempt; only the latest one may update the screen
  const connectAttempt = useRef(0)
  async function connect() {
    const attempt = ++connectAttempt.current
    const current = () => attempt === connectAttempt.current
    setWorking('connect')
    setMessage('')
    setError('')
    try {
      const account = await driveApi.connect()
      if (!current()) return
      setStatus((s) => ({ ...s, account }))
      setMessage(`Connected as ${account}.`)
    } catch (err) {
      if (current()) setError(err.message)
    } finally {
      if (current()) setWorking(null)
    }
  }

  const disconnect = () =>
    run('disconnect', async () => {
      const { revoked } = await driveApi.disconnect()
      setStatus((s) => ({ ...s, account: null }))
      setRemote(null)
      setMessage(
        revoked
          ? 'Google Drive is disconnected.'
          : 'Disconnected on this computer. Google could not be reached to cancel access, so remove ' +
              'Pharmacy POS at myaccount.google.com/permissions when you are online.',
      )
    })

  const upload = () =>
    run('upload', async () => {
      const file = await driveApi.uploadLatest()
      setMessage(
        file.alreadyUploaded ? `${file.name} is already in Google Drive.` : `Uploaded ${file.name} to Google Drive.`,
      )
      if (remote) setRemote(await driveApi.list())
    })

  const loadRemote = () => run('list', async () => setRemote(await driveApi.list()))

  function confirmRemote(file) {
    setMessage('')
    setError('')
    onRestore({
      label: file.name,
      detail: `Google Drive backup uploaded ${formatDateTime(file.created_at)}. It is downloaded first, so this needs an internet connection.`,
      run: (confirmation) => driveApi.restore(file.id, confirmation),
    })
  }

  const busy = working !== null

  return (
    <div className="drive-subsection">
      <h3>Google Drive</h3>

      {loadError && <Toast tone="error">{loadError}</Toast>}
      {!status && !loadError && <p className="muted">Loading…</p>}

      {status && !status.configured && (
        <p className="settings-hint">Google Drive backup is not set up in this copy of the app.</p>
      )}

      {status?.configured && (
        <>
          <p className="settings-hint">
            Copies backups to a PharmacyPOS folder in your Google Drive. Needs an internet connection, and only
            uploads when you click Upload. Local backups work the same with or without it.
          </p>

          {error && (
            <Toast tone="error" onDismiss={() => setError('')}>
              {error}
            </Toast>
          )}
          {message && (
            <Toast tone="success" onDismiss={() => setMessage('')}>
              {message}
            </Toast>
          )}

          {!status.account ? (
            <div className="backup-toolbar">
              <span className="muted">
                {working === 'connect' ? 'Finish signing in in your web browser…' : 'Not connected.'}
              </span>
              <Button variant="primary" onClick={connect}>
                {working === 'connect' ? 'Open sign-in again' : 'Connect Google Drive'}
              </Button>
            </div>
          ) : (
            <>
              <div className="backup-toolbar">
                <span>
                  Connected as <strong>{status.account}</strong>
                </span>
                <span className="backup-toolbar-actions">
                  <Button onClick={disconnect} disabled={busy} loading={working === 'disconnect'}>
                    {working === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                  <Button onClick={loadRemote} disabled={busy} loading={working === 'list'}>
                    {working === 'list' ? 'Loading…' : remote ? 'Refresh list' : 'Show Drive backups'}
                  </Button>
                  <Button variant="primary" onClick={upload} disabled={busy} loading={working === 'upload'}>
                    {working === 'upload' ? 'Uploading…' : 'Upload latest backup'}
                  </Button>
                </span>
              </div>

              {remote && remote.length === 0 && <EmptyState>No backups in Google Drive yet.</EmptyState>}
              {remote && remote.length > 0 && (
                <Table>
                  <thead>
                    <tr>
                      <th>Uploaded</th>
                      <th>File</th>
                      <th className="num">Size</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {remote.map((f) => (
                      <tr key={f.id}>
                        <td>{formatDateTime(f.created_at)}</td>
                        <td className="mono">{f.name}</td>
                        <td className="num">{formatSize(f.size)}</td>
                        <td className="actions">
                          <Button variant="danger" size="small" onClick={() => confirmRemote(f)} disabled={busy}>
                            Restore
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function RestoreConfirm({ pending, onCancel }) {
  const [typed, setTyped] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (typed !== CONFIRM_WORD) return
    setRestoring(true)
    setError('')
    try {
      // Only settles on failure; a successful restore restarts the app
      await pending.run(typed)
    } catch (err) {
      setError(err.message)
      setRestoring(false)
    }
  }

  // No onEscape, and the backdrop is ignored while restoring: a restore under way cannot be cancelled
  return (
    <Modal
      title="Restore this backup?"
      as="form"
      role="alertdialog"
      size="sm"
      tone="danger"
      onSubmit={handleSubmit}
      noValidate
      onBackdrop={restoring ? undefined : onCancel}
    >
      <p>
        <strong className="mono">{pending.label}</strong>
        <br />
        <span className="muted">{pending.detail}</span>
      </p>
      <p>
        All current data is replaced with the backup, and anything recorded since it was taken is lost. A safety
        copy of the current data is saved first. The app restarts when the restore finishes.
      </p>
      {error && <Toast tone="error">{error}</Toast>}
      <Field label={`Type ${CONFIRM_WORD} to confirm`}>
        <Input mono value={typed} autoFocus disabled={restoring} onChange={(e) => setTyped(e.target.value)} />
      </Field>
      <ModalActions>
        <Button onClick={onCancel} disabled={restoring}>
          Cancel
        </Button>
        <Button type="submit" variant="danger-solid" disabled={typed !== CONFIRM_WORD} loading={restoring}>
          {restoring ? 'Restoring…' : 'Restore and restart'}
        </Button>
      </ModalActions>
    </Modal>
  )
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
