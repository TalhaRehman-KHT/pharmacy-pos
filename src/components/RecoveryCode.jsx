import { useState } from 'react'
import Button from './Button.jsx'
import './RecoveryCode.css'

// Shows a freshly made owner recovery code, the one time it is ever shown: the main process keeps only its
// hash. Used after first-run setup, after a password recovery and from Settings. onDone stays disabled
// until the owner ticks that they saved the code, since there is no second chance to see it.
export default function RecoveryCode({ code, username, doneLabel = 'Continue', onDone }) {
  const [saved, setSaved] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopyMessage('Copied. Paste it somewhere outside this computer, then clear the clipboard.')
    } catch {
      setCopyMessage('Could not copy. Write the code down or print it instead.')
    }
  }

  return (
    <div className="recovery-code">
      {/* The only part of the window that prints; see RecoveryCode.css */}
      <div className="recovery-sheet">
        <p className="recovery-sheet-title">Pharmacy POS owner recovery code</p>
        {username && <p className="recovery-sheet-user">Username: {username}</p>}
        <p className="recovery-value mono" aria-label="Recovery code">
          {code}
        </p>
        <p className="recovery-sheet-note">
          Use this code with &quot;Forgot password?&quot; on the sign-in screen. It works once; a new code is
          given each time it is used.
        </p>
      </div>

      <p className="recovery-warning">
        Keep this code somewhere safe outside the computer, such as on paper in a locked drawer. It is the only
        way back into the owner account if you forget the password. Nobody else, including the seller of this
        software, can recover it for you.
      </p>

      <div className="recovery-buttons">
        <Button onClick={() => window.print()}>Print</Button>
        <Button onClick={copy}>Copy</Button>
        {copyMessage && <span className="recovery-copy-message">{copyMessage}</span>}
      </div>

      <label className="recovery-confirm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I have saved this code</span>
      </label>

      <div className="recovery-done">
        <Button variant="primary" onClick={onDone} disabled={!saved}>
          {doneLabel}
        </Button>
      </div>
    </div>
  )
}
