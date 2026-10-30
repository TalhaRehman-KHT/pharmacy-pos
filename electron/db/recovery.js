import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { db, getSetting, setSetting } from './index.js'
import { hashPassword } from './users.js'

// Owner password recovery. The owner holds a one-time recovery code, shown when it is made and never again;
// only its bcrypt hash is stored, in settings. There is no other way back into the owner account: no
// security questions, no master password, nothing held by the vendor. A route that works without the owner
// holding something works for anyone who reaches the machine.
// Imports db/users.js, so this module must be imported after initDb() has run.

const BCRYPT_COST = 10
// Crockford base32: no I, L, O or U, so the code survives being read aloud or copied by hand
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
// 16 characters of 5 bits each: 80 bits
const CODE_LENGTH = 16
const MAX_ATTEMPTS = 5
const LOCK_MS = 15 * 60 * 1000

// Kept in settings rather than memory, so restarting the app neither clears a lock nor resets the count
const KEY_HASH = 'recovery_code_hash'
const KEY_CREATED = 'recovery_code_created_at'
const KEY_ATTEMPTS = 'recovery_failed_attempts'
const KEY_LOCKED_UNTIL = 'recovery_locked_until'

const ownerByUsernameStmt = db.prepare(
  "SELECT id, username, full_name, role, is_active FROM users WHERE username = ? AND role = 'owner'",
)
const activeOwnerCountStmt = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND is_active = 1")
const updatePasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
const ownerHashStmt = db.prepare("SELECT password_hash FROM users WHERE id = ? AND role = 'owner' AND is_active = 1")

// XXXX-XXXX-XXXX-XXXX. 256 is a multiple of 32, so masking each byte keeps every character equally likely.
function generateCode() {
  const chars = [...crypto.randomBytes(CODE_LENGTH)].map((b) => ALPHABET[b & 31])
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-')
}

// Accepts what a person types: any case, spaces or dashes, and O, I or L for 0 and 1
function normalizeCode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

// Makes a new code and its hash without storing anything. Split from storeHash so callers can hash
// outside a transaction (bcrypt is async; better-sqlite3 transactions must be synchronous).
// Resolves to { code, hash }; the code goes to the screen once and is never written anywhere.
export async function newCode() {
  const code = generateCode()
  return { code, hash: await bcrypt.hash(normalizeCode(code), BCRYPT_COST) }
}

// Replaces the stored hash, so every earlier code stops working. Call inside the caller's transaction.
export function storeHash(hash) {
  setSetting(KEY_HASH, hash)
  setSetting(KEY_CREATED, new Date().toISOString())
}

// The owner's own "Generate new recovery code" in Settings. Resolves to the new code.
// A signed-in session is not enough: a new code is a credential that takes over the account later, so an
// owner session left open at the counter must not be able to make one. The current password is checked,
// and wrong ones count towards the same lock as wrong recovery codes, so it cannot be guessed by script.
export async function regenerate(ownerId, currentPassword) {
  assertNotLocked()
  const attempts = countAttempt()

  const row = ownerHashStmt.get(ownerId)
  const matches =
    !!row &&
    typeof currentPassword === 'string' &&
    currentPassword !== '' &&
    (await bcrypt.compare(currentPassword, row.password_hash))
  if (!matches) {
    if (attempts >= MAX_ATTEMPTS) throw lockedError(LOCK_MS)
    throw new Error(`That is not the current owner password. ${attemptsLeft(attempts)}`)
  }

  const { code, hash } = await newCode()
  db.transaction(() => {
    storeHash(hash)
    clearAttempts()
  })()
  return code
}

// { hasCode, createdAt } for Settings; an install from before recovery codes has none until one is made
export function status() {
  return { hasCode: !!getSetting(KEY_HASH), createdAt: getSetting(KEY_CREATED) }
}

// Whether the login screen offers "Forgot password?"
export function available() {
  return activeOwnerCountStmt.get().n > 0
}

// Resolves to the owner's id if username and code match, or throws. Every failure, unknown user included,
// gets the same message and counts towards the lock, so neither can be probed.
export async function verify(username, code) {
  assertNotLocked()

  const attempts = countAttempt()

  const hash = getSetting(KEY_HASH)
  const owner = ownerByUsernameStmt.get(String(username ?? '').trim().toLowerCase())
  const normalized = normalizeCode(code)
  const matches =
    !!hash &&
    !!owner &&
    owner.is_active === 1 &&
    normalized.length === CODE_LENGTH &&
    (await bcrypt.compare(normalized, hash))

  if (!matches) {
    if (!hash) throw new Error('No recovery code has been set up for this shop, so the password cannot be recovered.')
    if (attempts >= MAX_ATTEMPTS) throw lockedError(LOCK_MS)
    throw new Error(`The username or recovery code is not correct. ${attemptsLeft(attempts)}`)
  }

  clearAttempts()
  return owner.id
}

// Sets the new password and replaces the recovery code in one transaction, so the old code stops working
// exactly when the new password starts. Resolves to the new code.
export async function resetPassword(ownerId, newPassword) {
  const passwordHash = await hashPassword(newPassword)
  const { code, hash } = await newCode()
  db.transaction(() => {
    if (updatePasswordStmt.run(passwordHash, ownerId).changes === 0) throw new Error('The owner account was not found.')
    storeHash(hash)
    clearAttempts()
  })()
  return code
}

// Counted before the slow bcrypt compare, not after: everything up to the caller's await runs without
// interruption, so calls fired in parallel each see the previous one's count and the lock.
// Returns this attempt's number; the one that reaches MAX_ATTEMPTS sets the lock.
function countAttempt() {
  const attempts = Number(getSetting(KEY_ATTEMPTS) ?? 0) + 1
  db.transaction(() => {
    setSetting(KEY_ATTEMPTS, attempts)
    if (attempts >= MAX_ATTEMPTS) setSetting(KEY_LOCKED_UNTIL, new Date(Date.now() + LOCK_MS).toISOString())
  })()
  return attempts
}

function attemptsLeft(attempts) {
  const left = MAX_ATTEMPTS - attempts
  return `${left} ${left === 1 ? 'attempt' : 'attempts'} left before recovery is locked for 15 minutes.`
}

function assertNotLocked() {
  const until = Date.parse(getSetting(KEY_LOCKED_UNTIL) ?? '')
  if (Number.isNaN(until)) return
  // Capped at the lock length, so a clock that was wrong when the lock was set cannot extend it
  const remaining = Math.min(until - Date.now(), LOCK_MS)
  if (remaining > 0) throw lockedError(remaining)
  db.transaction(() => clearAttempts())()
}

function clearAttempts() {
  setSetting(KEY_ATTEMPTS, 0)
  setSetting(KEY_LOCKED_UNTIL, null)
}

function lockedError(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  return new Error(
    `Too many wrong attempts. Password recovery is locked for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
  )
}
