import { useEffect, useRef, useState } from 'react'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Field from '../components/Field.jsx'
import Input from '../components/Input.jsx'
import MedicineForm from '../components/MedicineForm.jsx'
import MedicineSearch from '../components/MedicineSearch.jsx'
import Table from '../components/Table.jsx'
import Toast from '../components/Toast.jsx'
import { batches as batchApi } from '../lib/api.js'
import { daysUntil, expiryStatus, formatLocalDate, formatPKR } from '../lib/format.js'
import { useRowFlash } from '../lib/useRowFlash.js'
import './StockEntry.css'

const EMPTY_BATCH = {
  batch_no: '',
  quantity: '',
  purchase_price: '',
  sale_price: '',
  expiry_date: '',
}

const MONEY = /^\d+(\.\d{1,2})?$/

export default function StockEntry() {
  const [medicine, setMedicine] = useState(null)
  // Non-null while the add-medicine modal is open; holds the prefill (the unmatched search term)
  const [creating, setCreating] = useState(null)
  const [form, setForm] = useState(EMPTY_BATCH)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [batches, setBatches] = useState([])
  const [batchesKey, setBatchesKey] = useState(0)
  const batchNoRef = useRef(null)
  const [rowFlash, flashRow] = useRowFlash()

  const medicineId = medicine?.id

  useEffect(() => {
    if (!medicineId) {
      setBatches([])
      return
    }
    let cancelled = false
    batchApi
      .listByMedicine(medicineId)
      .then((data) => !cancelled && setBatches(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [medicineId, batchesKey])

  // Move straight to the batch fields once a medicine is picked
  useEffect(() => {
    if (medicineId) batchNoRef.current?.focus()
  }, [medicineId])

  function pickMedicine(m) {
    setMedicine(m)
    setSaved(null)
    setErrors(({ medicine: _, ...rest }) => rest)
  }

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setSaved(null)
  }

  const warnings = buildWarnings(form)

  function validate() {
    const next = {}
    if (!medicine) next.medicine = 'Select a medicine.'
    if (!/^\d+$/.test(form.quantity.trim()) || Number(form.quantity) <= 0) {
      next.quantity = 'Enter a whole number above 0.'
    }
    if (!MONEY.test(form.sale_price.trim())) next.sale_price = 'Enter an amount like 120 or 120.50.'
    if (form.purchase_price.trim() && !MONEY.test(form.purchase_price.trim())) {
      next.purchase_price = 'Enter an amount like 95 or 95.50.'
    }
    return next
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return

    setSaving(true)
    setError('')
    try {
      const batch = await batchApi.create({
        medicine_id: medicine.id,
        batch_no: form.batch_no,
        quantity: Number(form.quantity.trim()),
        purchase_price: form.purchase_price.trim() ? Number(form.purchase_price.trim()) : 0,
        sale_price: Number(form.sale_price.trim()),
        expiry_date: form.expiry_date || null,
      })
      setSaved({ name: medicine.name, ...batch })
      flashRow(batch.id)
      setForm(EMPTY_BATCH)
      setErrors({})
      setBatchesKey((k) => k + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stock-entry">
      <header className="page-header">
        <h1>Stock Entry</h1>
      </header>

      {error && (
        <Toast tone="error" onDismiss={() => setError('')}>
          {error}
        </Toast>
      )}
      {saved && (
        <Toast tone="success">
          Added {saved.quantity} × {saved.name}
          {saved.batch_no ? ` (batch ${saved.batch_no})` : ''}.
        </Toast>
      )}

      <Card as="form" onSubmit={handleSubmit} noValidate>
        <Field label="Medicine" error={errors.medicine} required as="div">
          {medicine ? (
            <div className="selected-medicine">
              <div>
                <strong>{medicine.name}</strong>
                <span className="muted">
                  {[medicine.generic_name, medicine.company, medicine.unit].filter(Boolean).join(' · ')}
                </span>
              </div>
              <Button
                size="small"
                onClick={() => {
                  setMedicine(null)
                  setSaved(null)
                }}
              >
                Change
              </Button>
            </div>
          ) : (
            <MedicineSearch
              autoFocus
              onSelect={pickMedicine}
              renderNoMatch={(term) => (
                <Button variant="primary" size="small" onClick={() => setCreating({ name: term })}>
                  {term ? `Add "${term}" as new medicine` : 'Add new medicine'}
                </Button>
              )}
            />
          )}
        </Field>

        <div className="form-grid batch-fields">
          <Field label="Batch number">
            <Input ref={batchNoRef} value={form.batch_no} onChange={set('batch_no')} mono />
          </Field>
          <Field label="Quantity" error={errors.quantity} required>
            <Input value={form.quantity} onChange={set('quantity')} inputMode="numeric" />
          </Field>
          <Field label="Purchase price (PKR)" error={errors.purchase_price}>
            <Input value={form.purchase_price} onChange={set('purchase_price')} inputMode="decimal" />
          </Field>
          <Field label="Sale price (PKR)" error={errors.sale_price} required>
            <Input value={form.sale_price} onChange={set('sale_price')} inputMode="decimal" />
          </Field>
          <Field label="Expiry date">
            <Input type="date" value={form.expiry_date} onChange={set('expiry_date')} />
          </Field>
        </div>

        {/* Part of the form, not a message: they describe the values typed and change as they are edited */}
        {warnings.length > 0 && (
          <div className="warnings">
            <Toast tone="warning" inline>
              {warnings.length === 1 ? (
                warnings[0]
              ) : (
                <ul>
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </Toast>
          </div>
        )}

        <div className="form-actions">
          <Button type="submit" variant="primary" loading={saving}>
            {saving ? 'Saving...' : warnings.length ? 'Save anyway' : 'Save batch'}
          </Button>
        </div>
      </Card>

      {medicine && (
        <section className="existing">
          <h2 className="section-title">Current batches — {medicine.name}</h2>
          {batches.length === 0 ? (
            <EmptyState>No batches yet.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th className="num">Quantity</th>
                  <th className="num">Purchase</th>
                  <th className="num">Sale</th>
                  <th>Expiry</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className={rowFlash(b.id)}>
                    <td className="mono">{b.batch_no}</td>
                    <td className="num">{b.quantity}</td>
                    <td className="num">{formatPKR(b.purchase_price)}</td>
                    <td className="num">{formatPKR(b.sale_price)}</td>
                    <td className={`expiry-${expiryStatus(b.expiry_date) ?? 'ok'}`}>{b.expiry_date}</td>
                    <td>{formatLocalDate(b.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      )}

      {/* Rendered outside the batch <form>: the medicine form is its own <form> and cannot nest */}
      {creating && (
        <MedicineForm
          medicine={creating}
          onClose={() => setCreating(null)}
          onSaved={(created) => {
            setCreating(null)
            pickMedicine(created)
          }}
        />
      )}
    </div>
  )
}

// Non-blocking: short-dated stock and below-cost pricing both happen legitimately
function buildWarnings(form) {
  const warnings = []

  const days = daysUntil(form.expiry_date)
  if (days !== null) {
    if (days < 0) warnings.push(`This batch expired ${-days} day${-days === 1 ? '' : 's'} ago.`)
    else if (days === 0) warnings.push('This batch expires today.')
    else if (expiryStatus(form.expiry_date) === 'soon') {
      warnings.push(`This batch expires in ${days} day${days === 1 ? '' : 's'}.`)
    }
  }

  const purchase = form.purchase_price.trim()
  const sale = form.sale_price.trim()
  if (MONEY.test(purchase) && MONEY.test(sale) && Number(sale) < Number(purchase)) {
    warnings.push(
      `Sale price (${formatPKR(sale)}) is below purchase price (${formatPKR(purchase)}).`,
    )
  }

  return warnings
}
