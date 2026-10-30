import { useEffect, useRef, useState } from 'react'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import Field from '../components/Field.jsx'
import Input from '../components/Input.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import RecoveryCode from '../components/RecoveryCode.jsx'
import Toast from '../components/Toast.jsx'
import { auth, recovery } from '../lib/api.js'
import './Auth.css'

const MIN_PASSWORD_LENGTH = 6

// onSignedIn receives { id, username, full_name, role } from the main-process session.
// There is deliberately no way to create an account here: anyone at the counter could make themselves an
// owner and read the takings. The owner is created by first-run setup, staff by the owner in Users.
export default function Login({ onSignedIn }) {
  const [shopName, setShopName] = useState('')
  // Whether to offer "Forgot password?": only once an active owner account exists
  const [canRecover, setCanRecover] = useState(false)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Both are decoration; signing in works the same without them
    auth
      .shopName()
      .then((name) => !cancelled && setShopName(name))
      .catch(() => {})
    recovery
      .available()
      .then((yes) => !cancelled && setCanRecover(yes))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="auth-screen">
      <div className="auth-column">
        {shopName && <p className="auth-shop">{shopName}</p>}

        {recovering ? (
          <ForgotPassword onCancel={() => setRecovering(false)} onSignedIn={onSignedIn} />
        ) : (
          <SignInForm onSignedIn={onSignedIn} />
        )}

        {!recovering && canRecover && (
          <button type="button" className="auth-link" onClick={() => setRecovering(true)}>
            Forgot password?
          </button>
        )}
        <p className="auth-footnote">First time here? The shop owner creates staff accounts from the Users page.</p>
      </div>
    </div>
  )
}

function SignInForm({ onSignedIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const usernameRef = useRef(null)
  const passwordRef = useRef(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username.trim()) {
      setError('Enter your username.')
      usernameRef.current?.focus()
      return
    }
    if (!password) {
      setError('Enter your password.')
      passwordRef.current?.focus()
      return
    }
    setBusy(true)
    setError('')
    try {
      onSignedIn(await auth.login(username, password))
    } catch (err) {
      // The main process words each case: unknown user, wrong password, deactivated account
      setError(err.message)
      // Keep the username, clear the password for the retry
      setPassword('')
      setBusy(false)
      // After the re-render that re-enables the field
      setTimeout(() => passwordRef.current?.focus())
    }
  }

  return (
    <Card as="form" className="auth-card" onSubmit={handleSubmit} noValidate>
      <h1>Sign in</h1>
      <p className="auth-subtitle">Pharmacy POS</p>

      {error && (
        <Toast tone="error" inline>
          {error}
        </Toast>
      )}

      <div className="auth-fields">
        <Field label="Username">
          <Input
            ref={usernameRef}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={busy}
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            ref={passwordRef}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
          />
        </Field>
      </div>

      <div className="auth-actions">
        <Button type="submit" variant="primary" loading={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </Button>
      </div>
    </Card>
  )
}

// Owner only, though nothing here says so: the main process accepts only an owner's username with the
// shop's recovery code, and locks recovery for 15 minutes after 5 failures.
// 'verify': username and code. 'password': the new password, allowed for 10 minutes after verify.
// 'code': the new recovery code that replaced the old one; the owner is already signed in by then.
function ForgotPassword({ onCancel: close, onSignedIn }) {
  const [stage, setStage] = useState('verify')
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // { user, recoveryCode } after the reset
  const [result, setResult] = useState(null)

  async function handleVerify(e) {
    e.preventDefault()
    if (!username.trim() || !code.trim()) {
      setError('Enter the owner username and the recovery code.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await recovery.verify(username, code)
      setCode('')
      setStage('password')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (confirm !== password) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setResult(await recovery.resetPassword(password))
      setStage('code')
    } catch (err) {
      setError(err.message)
      // The grant timed out; the code has to be entered again
      if (/timed out/i.test(err.message)) setStage('verify')
    } finally {
      setBusy(false)
    }
  }

  // Drops the main process's go-ahead too, so a verified code is not left usable at an unattended screen
  function onCancel() {
    recovery.cancel().catch(() => {})
    close()
  }

  const alert = error && (
    <Toast tone="error" inline>
      {error}
    </Toast>
  )

  if (stage === 'code' && result) {
    return (
      <Card className="auth-card">
        <h1>Your new recovery code</h1>
        <p className="auth-subtitle">
          Your password is changed. The old recovery code no longer works; save this one instead.
        </p>
        <RecoveryCode
          code={result.recoveryCode}
          username={result.user.username}
          onDone={() => onSignedIn(result.user)}
        />
      </Card>
    )
  }

  if (stage === 'password') {
    return (
      <Card as="form" className="auth-card" onSubmit={handleReset} noValidate>
        <h1>Set a new password</h1>
        <p className="auth-subtitle">The recovery code is correct. Choose a new password for {username.trim()}.</p>
        {alert}
        <div className="auth-fields">
          <Field label="New password">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              disabled={busy}
            />
          </Field>
          <Field label="Confirm password">
            <PasswordInput
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
          </Field>
        </div>
        <div className="auth-actions">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {busy ? 'Saving...' : 'Set password'}
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card as="form" className="auth-card" onSubmit={handleVerify} noValidate>
      <h1>Forgot password</h1>
      <p className="auth-subtitle">
        For the shop owner. Enter your username and the recovery code you saved when the shop was set up.
        Staff: ask the owner to reset your password.
      </p>
      {alert}
      <div className="auth-fields">
        <Field label="Owner username">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={busy}
          />
        </Field>
        <Field label="Recovery code">
          <Input
            className="mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </Field>
      </div>
      <div className="auth-actions">
        <Button onClick={onCancel} disabled={busy}>
          Back to sign in
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {busy ? 'Checking...' : 'Continue'}
        </Button>
      </div>
    </Card>
  )
}
