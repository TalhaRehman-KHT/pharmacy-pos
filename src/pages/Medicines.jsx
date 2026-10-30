import { Fragment, useEffect, useState } from 'react'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Field from '../components/Field.jsx'
import Input from '../components/Input.jsx'
import MedicineForm from '../components/MedicineForm.jsx'
import Modal, { ModalActions } from '../components/Modal.jsx'
import Select from '../components/Select.jsx'
import Table from '../components/Table.jsx'
import Toast from '../components/Toast.jsx'
import { ChevronRightIcon } from '../components/icons.jsx'
import { batches as batchApi, medicines as api } from '../lib/api.js'
import { expiryStatus, formatPKR } from '../lib/format.js'
import { useRowFlash } from '../lib/useRowFlash.js'
import './Medicines.css'

// Why the count changed. batches.adjustQuantity records every manual change under the single ledger reason
// 'adjustment', so the chosen reason is kept at the start of the ledger note, e.g. "Damaged: carton crushed".
const ADJUST_REASONS = ['Damaged', 'Expired, disposed of', 'Returned to supplier', 'Stock count correction', 'Other']

export default function Medicines({ currentUser }) {
  const isOwner = currentUser?.role === 'owner'
  const [rows, setRows] = useState([])
  // medicine_id -> total quantity across all batches
  const [stock, setStock] = useState({})
  const [expanded, setExpanded] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // null = closed, {} = adding, a row = editing
  const [editing, setEditing] = useState(null)
  // The row waiting for its deactivation to be confirmed, or null
  const [deactivating, setDeactivating] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [rowFlash, flashRow] = useRowFlash()

  useEffect(() => {
    let cancelled = false
    // Debounce so typing doesn't fire a query per keystroke
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const [data, summary] = await Promise.all([
          api.list({ search, activeOnly: !showInactive }),
          batchApi.stockSummary(),
        ])
        if (!cancelled) {
          setRows(data)
          setStock(Object.fromEntries(summary.map((s) => [s.medicine_id, s.total_quantity])))
          setError('')
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, showInactive, reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  function toggleExpanded(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDeactivate(row) {
    setDeactivating(null)
    try {
      await api.deactivate(row.id)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="medicines">
      <header className="page-header">
        <h1>Medicines</h1>
        <Button variant="primary" onClick={() => setEditing({})}>
          Add medicine
        </Button>
      </header>

      <div className="toolbar">
        <Input
          type="search"
          className="search"
          placeholder="Search by name, generic, company or barcode"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>

      {error && (
        <Toast tone="error" onDismiss={() => setError('')}>
          {error}
        </Toast>
      )}

      {!loading && rows.length === 0 ? (
        <EmptyState>
          {search ? 'No medicines match your search.' : 'No medicines yet. Add one to get started.'}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className="toggle" aria-label="Expand" />
              <th>Name</th>
              <th>Generic name</th>
              <th>Company</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Barcode</th>
              <th className="num">Stock</th>
              <th className="num">Reorder level</th>
              <th className="actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expanded.has(row.id)
              const total = stock[row.id] ?? 0
              const rowClass = [!row.is_active && 'inactive', rowFlash(row.id)].filter(Boolean).join(' ')
              return (
                <Fragment key={row.id}>
                  <tr className={rowClass || undefined}>
                    <td className="toggle">
                      <button
                        type="button"
                        className={`toggle-btn${isOpen ? ' open' : ''}`}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? 'Hide batches' : 'Show batches'}
                        onClick={() => toggleExpanded(row.id)}
                      >
                        <ChevronRightIcon size={16} />
                      </button>
                    </td>
                    <td className="medicine-name">
                      {row.name}
                      {!row.is_active && <Badge>Inactive</Badge>}
                    </td>
                    <td>{row.generic_name}</td>
                    <td>{row.company}</td>
                    <td>{row.category}</td>
                    <td>{row.unit}</td>
                    <td className="mono">{row.barcode}</td>
                    <td className={`num${row.is_active && total <= row.reorder_level ? ' low-stock' : ''}`}>
                      {total}
                    </td>
                    <td className="num">{row.reorder_level}</td>
                    <td className="actions">
                      <Button size="small" onClick={() => setEditing(row)}>
                        Edit
                      </Button>
                      {row.is_active ? (
                        <Button variant="danger" size="small" onClick={() => setDeactivating(row)}>
                          Deactivate
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="batch-row">
                      <td colSpan={10}>
                        <BatchList medicine={row} isOwner={isOwner} onAdjusted={reload} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </Table>
      )}

      {editing && (
        <MedicineForm
          medicine={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            flashRow(saved.id)
            reload()
          }}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title={`Deactivate ${deactivating.name}?`}
          confirmLabel="Deactivate"
          onConfirm={() => handleDeactivate(deactivating)}
          onCancel={() => setDeactivating(null)}
        >
          <p>It will be hidden from the active list.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

function BatchList({ medicine, isOwner, onAdjusted }) {
  const medicineId = medicine.id
  const [batches, setBatches] = useState(null)
  const [error, setError] = useState('')
  const [adjusting, setAdjusting] = useState(null)
  const [rowFlash, flashRow] = useRowFlash()

  useEffect(() => {
    let cancelled = false
    batchApi
      .listByMedicine(medicineId)
      .then((data) => !cancelled && setBatches(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [medicineId])

  if (error) return <Toast tone="error">{error}</Toast>
  if (!batches) return <EmptyState compact>Loading batches...</EmptyState>
  if (batches.length === 0) return <EmptyState compact>No batches. Add stock from Stock Entry.</EmptyState>

  return (
    <>
      <Table bare compact>
        <thead>
          <tr>
            <th>Batch</th>
            <th className="num">Quantity</th>
            <th>Expiry</th>
            <th className="num">Sale price</th>
            {isOwner && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr
              key={b.id}
              className={[b.quantity === 0 && 'depleted', rowFlash(b.id)].filter(Boolean).join(' ') || undefined}
            >
              <td className="mono">{b.batch_no || '—'}</td>
              <td className="num">{b.quantity}</td>
              <td className={`expiry-${expiryStatus(b.expiry_date) ?? 'ok'}`}>{b.expiry_date || '—'}</td>
              <td className="num">{formatPKR(b.sale_price)}</td>
              {isOwner && (
                <td>
                  <Button size="small" onClick={() => setAdjusting(b)}>
                    Adjust
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>

      {adjusting && (
        <AdjustStockDialog
          medicineName={medicine.name}
          batch={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={(updated) => {
            setBatches((list) => list.map((b) => (b.id === updated.id ? updated : b)))
            setAdjusting(null)
            flashRow(updated.id)
            onAdjusted()
          }}
        />
      )}
    </>
  )
}

// Owner only. Calls batches.adjustQuantity, which updates the batch and writes the stock_entries
// ledger row together, under the owner's id taken from the main-process session.
function AdjustStockDialog({ medicineName, batch, onClose, onSaved }) {
  const [direction, setDirection] = useState('remove')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const amount = /^\d+$/.test(qty.trim()) ? Number(qty.trim()) : null
  const delta = amount === null ? null : direction === 'remove' ? -amount : amount
  const after = delta === null ? null : batch.quantity + delta

  function validate() {
    const next = {}
    if (!amount) next.qty = 'Enter a whole number above 0.'
    else if (after < 0) next.qty = `The batch only has ${batch.quantity}.`
    if (!reason) next.reason = 'Choose a reason.'
    if (!note.trim()) next.note = 'Describe what happened.'
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
      onSaved(await batchApi.adjustQuantity(batch.id, delta, 'adjustment', `${reason}: ${note.trim()}`))
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
    }
  }

  return (
    <Modal title="Adjust stock" as="form" onSubmit={handleSubmit} noValidate onBackdrop={onClose} onEscape={onClose}>
      <p className="adjust-subject">
        {medicineName} · batch <span className="mono">{batch.batch_no || '—'}</span> · {batch.quantity} in stock
      </p>

      {saveError && <Toast tone="error">{saveError}</Toast>}

      <div className="form-grid">
        <Field label="Change">
          <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="remove">Remove from stock</option>
            <option value="add">Add to stock</option>
          </Select>
        </Field>
        <Field label="Quantity" error={errors.qty} required>
          <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        <Field label="Reason" error={errors.reason} required wide>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose…</option>
            {ADJUST_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" error={errors.note} required wide>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </Field>
      </div>

      {after !== null && after >= 0 && (
        <p className="adjust-result">
          {batch.quantity} → <strong>{after}</strong>
        </p>
      )}

      <ModalActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? 'Saving…' : 'Save adjustment'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
