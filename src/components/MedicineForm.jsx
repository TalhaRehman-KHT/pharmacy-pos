import { useState } from 'react'
import { medicines as api } from '../lib/api.js'
import Button from './Button.jsx'
import Field from './Field.jsx'
import Input from './Input.jsx'
import Modal, { ModalActions } from './Modal.jsx'
import Toast from './Toast.jsx'

const EMPTY_FORM = {
  name: '',
  generic_name: '',
  company: '',
  category: '',
  unit: 'tablet',
  barcode: '',
  reorder_level: '10',
}

const UNIT_SUGGESTIONS = ['tablet', 'capsule', 'syrup', 'injection', 'drops', 'cream', 'sachet', 'inhaler']

// Add/edit modal. Pass a row with an id to edit, or a partial object (e.g. { name }) to prefill a new one.
// onSaved receives the saved medicine row.
export default function MedicineForm({ medicine = {}, onClose, onSaved }) {
  const isEdit = Boolean(medicine.id)
  const [form, setForm] = useState(() =>
    Object.fromEntries(
      Object.keys(EMPTY_FORM).map((key) => [
        key,
        medicine[key] == null ? EMPTY_FORM[key] : String(medicine[key]),
      ]),
    ),
  )
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function validate() {
    const next = {}
    if (!form.name.trim()) next.name = 'Name is required.'
    if (!/^\d+$/.test(form.reorder_level.trim())) {
      next.reorder_level = 'Enter a whole number, 0 or more.'
    }
    return next
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return

    const payload = { ...form, reorder_level: Number(form.reorder_level.trim()) }
    setSaving(true)
    setSaveError('')
    try {
      const saved = isEdit ? await api.update(medicine.id, payload) : await api.create(payload)
      onSaved(saved)
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit medicine' : 'Add medicine'}
      as="form"
      onSubmit={handleSubmit}
      noValidate
      onBackdrop={onClose}
      onEscape={onClose}
    >
      {saveError && <Toast tone="error">{saveError}</Toast>}

      <div className="form-grid">
        <Field label="Name" error={errors.name} required wide>
          <Input value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Generic name" wide>
          <Input value={form.generic_name} onChange={set('generic_name')} />
        </Field>
        <Field label="Company">
          <Input value={form.company} onChange={set('company')} />
        </Field>
        <Field label="Category">
          <Input value={form.category} onChange={set('category')} />
        </Field>
        <Field label="Unit">
          <Input value={form.unit} onChange={set('unit')} list="medicine-units" />
          <datalist id="medicine-units">
            {UNIT_SUGGESTIONS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label="Barcode">
          <Input value={form.barcode} onChange={set('barcode')} mono />
        </Field>
        <Field label="Reorder level" error={errors.reorder_level} required>
          <Input value={form.reorder_level} onChange={set('reorder_level')} inputMode="numeric" />
        </Field>
      </div>

      <ModalActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
