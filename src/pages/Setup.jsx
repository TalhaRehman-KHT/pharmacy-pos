import { useState } from 'react'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import Field from '../components/Field.jsx'
import Input from '../components/Input.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import RecoveryCode from '../components/RecoveryCode.jsx'
import Toast from '../components/Toast.jsx'
import { setup } from '../lib/api.js'
import './Auth.css'

const SHOP_FIELDS = {
  shop_name: '',
  shop_address: '',
  shop_phone: '',
  licence_no: '',
  invoice_prefix: 'INV',
}

const OWNER_FIELDS = {
  full_name: '',
  username: '',
  password: '',
  confirm: '',
}

// First-run wizard, shown while no user exists. Step 1 collects the shop details printed on invoices,
// step 2 the owner account. Nothing is saved until the end of step 2, and then both are saved together.
// Step 3 shows the owner's recovery code, which cannot be shown again, and only lets them continue once
// they tick that they saved it. onComplete receives the new owner, already signed in by the main process.
// If the window closes on step 3 the owner is set up but has not seen the code; Settings can make a new one.
export default function Setup({ onComplete }) {
  const [step, setStep] = useState(1)
  const [shop, setShop] = useState(SHOP_FIELDS)
  const [owner, setOwner] = useState(OWNER_FIELDS)
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  // { user, recoveryCode } once the shop and owner are saved
  const [created, setCreated] = useState(null)

  const setShopField = (key) => (e) => setShop((s) => ({ ...s, [key]: e.target.value }))
  const setOwnerField = (key) => (e) => setOwner((o) => ({ ...o, [key]: e.target.value }))

  function validateShop() {
    const next = {}
    if (!shop.shop_name.trim()) next.shop_name = 'Shop name is required.'
    if (!/^[A-Za-z0-9]{1,8}$/.test(shop.invoice_prefix.trim())) {
      next.invoice_prefix = 'Use 1 to 8 letters or digits.'
    }
    return next
  }

  function validateOwner() {
    const next = {}
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(owner.username.trim())) {
      next.username = '3 to 32 characters: letters, digits, dot, dash or underscore.'
    }
    if (owner.password.length < 6) next.password = 'At least 6 characters.'
    else if (owner.confirm !== owner.password) next.confirm = 'Passwords do not match.'
    return next
  }

  function handleNext(e) {
    e.preventDefault()
    const found = validateShop()
    setErrors(found)
    if (Object.keys(found).length === 0) setStep(2)
  }

  async function handleFinish(e) {
    e.preventDefault()
    const found = validateOwner()
    setErrors(found)
    if (Object.keys(found).length) return

    setSaving(true)
    setSaveError('')
    try {
      const account = { full_name: owner.full_name, username: owner.username, password: owner.password }
      setCreated(await setup.complete(shop, account))
      setStep(3)
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
    }
  }

  if (step === 3 && created) {
    return (
      <div className="auth-screen">
        <Card className="auth-card wide">
          <h1>Your recovery code</h1>
          <p className="auth-subtitle">Your shop account is created. Save this code before you continue.</p>
          <p className="auth-step">Step 3 of 3 · Recovery code</p>
          <RecoveryCode
            code={created.recoveryCode}
            username={created.user.username}
            doneLabel="Start using Pharmacy POS"
            onDone={() => onComplete(created.user)}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <Card as="form" className="auth-card wide" onSubmit={step === 1 ? handleNext : handleFinish} noValidate>
        <h1>Set up Pharmacy POS</h1>
        <p className="auth-subtitle">
          {step === 1
            ? 'These details are printed on every invoice.'
            : 'This is your owner account. You sign in with it and add staff accounts from it.'}
        </p>

        {saveError && (
          <Toast tone="error" inline>
            {saveError}
          </Toast>
        )}

        <p className="auth-step">Step {step} of 3 · {step === 1 ? 'Shop details' : 'Owner account'}</p>

        {step === 1 ? (
          <div className="form-grid">
            <Field label="Shop name" error={errors.shop_name} required wide>
              <Input value={shop.shop_name} onChange={setShopField('shop_name')} autoFocus />
            </Field>
            <Field label="Address" wide>
              <Input value={shop.shop_address} onChange={setShopField('shop_address')} />
            </Field>
            <Field label="Phone">
              <Input value={shop.shop_phone} onChange={setShopField('shop_phone')} inputMode="tel" />
            </Field>
            <Field label="Licence number">
              <Input value={shop.licence_no} onChange={setShopField('licence_no')} />
            </Field>
            <Field
              label="Invoice prefix"
              error={errors.invoice_prefix}
              hint={`Invoices are numbered like ${shop.invoice_prefix.trim().toUpperCase() || 'INV'}-20261029-0001`}
              required
            >
              <Input value={shop.invoice_prefix} onChange={setShopField('invoice_prefix')} mono maxLength={8} />
            </Field>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="Full name" wide>
              <Input value={owner.full_name} onChange={setOwnerField('full_name')} autoFocus />
            </Field>
            <Field label="Username" error={errors.username} required wide>
              <Input value={owner.username} onChange={setOwnerField('username')} autoComplete="username" />
            </Field>
            <Field label="Password" error={errors.password} required>
              <PasswordInput
                value={owner.password}
                onChange={setOwnerField('password')}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm password" error={errors.confirm} required>
              <PasswordInput
                value={owner.confirm}
                onChange={setOwnerField('confirm')}
                autoComplete="new-password"
              />
            </Field>
          </div>
        )}

        <div className="auth-actions">
          {step === 2 && (
            <Button
              onClick={() => {
                setErrors({})
                setStep(1)
              }}
              disabled={saving}
            >
              Back
            </Button>
          )}
          <Button type="submit" variant="primary" loading={saving}>
            {step === 1 ? 'Next' : saving ? 'Creating...' : 'Create shop account'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
