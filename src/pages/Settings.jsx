import { useEffect, useRef, useState } from 'react'
import BackupSection from '../components/BackupSection.jsx'
import Button from '../components/Button.jsx'
import Field from '../components/Field.jsx'
import Input from '../components/Input.jsx'
import Modal, { ModalActions } from '../components/Modal.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import RecoveryCode from '../components/RecoveryCode.jsx'
import Select from '../components/Select.jsx'
import Toast from '../components/Toast.jsx'
import {
  dataFolder as dataFolderApi,
  print as printApi,
  recovery as recoveryApi,
  settings as api,
} from '../lib/api.js'
import './Settings.css'

// Owner only: hidden from a salesman in App.jsx and rejected for one by the main process.
// Values are read from the settings table each time they are used, so a save applies to the next invoice.
export default function Settings() {
  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [printers, setPrinters] = useState([])
  const [printerError, setPrinterError] = useState('')
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get()
      .then((data) => !cancelled && setForm(data))
      .catch((err) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [])

  // Loaded apart from the settings, so a printer-spooler problem does not block the rest of the form
  function loadPrinters() {
    setPrinterError('')
    printApi
      .listPrinters()
      .then(setPrinters)
      .catch((err) => setPrinterError(err.message))
  }
  useEffect(loadPrinters, [])

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setSaved(false)
  }

  function validate() {
    const next = {}
    if (!form.shop_name.trim()) next.shop_name = 'Shop name is required.'
    if (!/^[A-Za-z0-9]{1,8}$/.test(form.invoice_prefix.trim())) {
      next.invoice_prefix = '1 to 8 letters or digits.'
    }
    return next
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return

    setSaving(true)
    setSaveError('')
    try {
      setForm(await api.save(form))
      setSaved(true)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loadError) return <Toast tone="error">{loadError}</Toast>
  if (!form) return <p className="muted">Loading...</p>

  // A saved printer that is not connected right now is still listed, so saving does not silently drop it
  const printerMissing = form.printer_name && !printers.some((p) => p.name === form.printer_name)

  return (
    <>
      <form className="settings" onSubmit={handleSubmit} noValidate>
        <header className="page-header">
          <h1>Settings</h1>
        </header>

        {saveError && (
          <Toast tone="error" onDismiss={() => setSaveError('')}>
            {saveError}
          </Toast>
        )}
        {saved && (
          <Toast tone="success" onDismiss={() => setSaved(false)}>
            Settings saved.
          </Toast>
        )}

        <section className="settings-section">
          <h2>Shop</h2>
          <p className="settings-hint">Printed at the top of every invoice.</p>
          <div className="form-grid">
            <Field label="Shop name" error={errors.shop_name} required wide>
              <Input value={form.shop_name} onChange={set('shop_name')} />
            </Field>
            <Field label="Address" wide>
              <textarea rows={2} value={form.shop_address} onChange={set('shop_address')} />
            </Field>
            <Field label="Phone">
              <Input value={form.shop_phone} onChange={set('shop_phone')} />
            </Field>
            <Field label="Licence number">
              <Input value={form.licence_no} onChange={set('licence_no')} />
            </Field>
          </div>
        </section>

        <section className="settings-section">
          <h2>Invoice</h2>
          <div className="form-grid">
            <Field label="Invoice prefix" error={errors.invoice_prefix} required>
              <Input mono value={form.invoice_prefix} maxLength={8} onChange={set('invoice_prefix')} />
            </Field>
            {/* No tax field: billing does not apply tax yet. tax_percent stays in settings for when it does. */}
            <Field label="Footer text" wide>
              <textarea rows={2} value={form.invoice_footer} onChange={set('invoice_footer')} />
            </Field>
          </div>
          <p className="settings-hint">
            New invoices are numbered {(form.invoice_prefix.trim() || 'INV').toUpperCase()}-YYYYMMDD-0001. Numbers
            already issued do not change.
          </p>
        </section>

        <section className="settings-section">
          <h2>Printing</h2>
          <div className="form-grid">
            <Field label="Printer">
              <Select value={form.printer_name} onChange={set('printer_name')}>
                <option value="">Save as PDF (no printer)</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                    {p.isDefault ? ' (default)' : ''}
                  </option>
                ))}
                {printerMissing && <option value={form.printer_name}>{form.printer_name} (not found)</option>}
              </Select>
            </Field>
            <Field label="Invoice layout">
              <Select value={form.invoice_layout} onChange={set('invoice_layout')}>
                <option value="thermal">Thermal receipt (80 mm)</option>
                <option value="a4">A4 page</option>
              </Select>
            </Field>
          </div>
          <div className="settings-printers">
            <Button size="small" onClick={loadPrinters}>
              Refresh printers
            </Button>
            {printerError && <span className="field-error">Could not list printers: {printerError}</span>}
            {printerMissing && !printerError && (
              <span className="field-error">The saved printer is not connected. Invoices will fail until it is.</span>
            )}
          </div>
        </section>

        <div className="settings-actions">
          <Button type="submit" variant="primary" loading={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>

      {/* Outside the form: its buttons act straight away and have nothing to do with Save settings */}
      <BackupSection />

      <DataFolderSection />

      <RecoverySection />
    </>
  )
}

// The owner's recovery code, used with "Forgot password?" on the sign-in screen. Only its hash is stored,
// so a lost code cannot be shown again; this makes a new one, which replaces it. An install from before
// recovery codes has none until the owner makes one here.
// Asks for the current password, which the main process checks: a new code takes over the account, so an
// owner session left signed in at the counter must not be enough to make one.
function RecoverySection() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  // null | 'confirm' | 'working' | { code }
  const [dialog, setDialog] = useState(null)
  const [password, setPassword] = useState('')
  const [dialogError, setDialogError] = useState('')
  const passwordRef = useRef(null)

  function load() {
    recoveryApi
      .status()
      .then(setStatus)
      .catch((err) => setError(err.message))
  }
  useEffect(load, [])

  function openConfirm() {
    setPassword('')
    setDialogError('')
    setDialog('confirm')
  }

  async function generate(e) {
    e.preventDefault()
    if (!password) {
      setDialogError('Enter your current password.')
      return
    }
    setDialog('working')
    setDialogError('')
    try {
      const code = await recoveryApi.regenerate(password)
      setPassword('')
      setDialog({ code })
    } catch (err) {
      // Wrong password or locked: stay on the form with the message
      setDialogError(err.message)
      setPassword('')
      setDialog('confirm')
      // After the re-render that re-enables the field
      setTimeout(() => passwordRef.current?.focus())
    }
  }

  function close() {
    setPassword('')
    setDialog(null)
    load()
  }

  return (
    <section className="settings settings-section">
      <h2>Owner recovery code</h2>
      <p className="settings-hint">
        If you forget the owner password, &quot;Forgot password?&quot; on the sign-in screen asks for this code. It
        is the only way back into the owner account.
      </p>

      {error && <Toast tone="error">{error}</Toast>}
      {status && !status.hasCode && (
        <Toast tone="warning" inline>
          This shop has no recovery code yet. Without one, a forgotten owner password cannot be recovered. Generate
          one now and keep it somewhere safe.
        </Toast>
      )}

      <div className="data-folder-row">
        <Button variant="danger" onClick={openConfirm} disabled={!status}>
          Generate new recovery code
        </Button>
        {status?.hasCode && status.createdAt && (
          <span className="muted">Current code made {new Date(status.createdAt).toLocaleString()}</span>
        )}
      </div>

      {/* No onBackdrop or onEscape: the new code must not be dismissed by accident before it is saved */}
      {dialog &&
        (typeof dialog === 'object' ? (
          <Modal title="Your new recovery code" size="sm">
            <p className="muted">The previous code no longer works. This one is shown only now.</p>
            <RecoveryCode code={dialog.code} doneLabel="Done" onDone={close} />
          </Modal>
        ) : (
          <Modal
            title="Generate a new recovery code?"
            as="form"
            size="sm"
            tone="danger"
            onSubmit={generate}
            noValidate
          >
            <p>
              The current recovery code stops working straight away, including any printed copy. Make sure you can
              save the new one before you continue.
            </p>
            {dialogError && <Toast tone="error">{dialogError}</Toast>}
            <Field label="Current owner password">
              <PasswordInput
                ref={passwordRef}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                disabled={dialog === 'working'}
              />
            </Field>
            <ModalActions>
              <Button onClick={close} disabled={dialog === 'working'}>
                Cancel
              </Button>
              <Button type="submit" variant="danger-solid" loading={dialog === 'working'}>
                {dialog === 'working' ? 'Generating…' : 'Generate new code'}
              </Button>
            </ModalActions>
          </Modal>
        ))}
    </section>
  )
}

// Where backups, invoice PDFs and CSV reports are saved, shown in full so the owner can find it in
// Explorer without the app. The database itself is elsewhere, in the app's own folder, on purpose.
function DataFolderSection() {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    dataFolderApi
      .info()
      .then((data) => !cancelled && setInfo(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [])

  async function open() {
    setError('')
    try {
      await dataFolderApi.open()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="settings settings-section">
      <h2>Data folder</h2>
      <p className="settings-hint">Backups, saved invoices and exported reports are kept in this folder.</p>

      {info?.fallback && (
        <Toast tone="warning" inline>
          Documents\Pharmacy POS could not be used ({info.reason}), so these files are being saved in the folder
          below instead.
        </Toast>
      )}
      {error && (
        <Toast tone="error" onDismiss={() => setError('')}>
          {error}
        </Toast>
      )}

      <div className="data-folder-row">
        <Button onClick={open} disabled={!info}>
          Open data folder
        </Button>
        <span className="mono data-folder-path">{info ? info.root : '…'}</span>
      </div>
    </section>
  )
}
