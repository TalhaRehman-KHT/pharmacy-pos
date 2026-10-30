import bcrypt from 'bcryptjs'
import { db } from './index.js'
import { clean, toId } from './validate.js'

// Statements are prepared at load, so this module must be imported after initDb() has run

const BCRYPT_COST = 10
const MIN_PASSWORD_LENGTH = 6
const ROLES = ['owner', 'salesman']

// Every column except password_hash. Nothing in this module returns the hash.
const PUBLIC_COLUMNS = 'id, username, full_name, role, is_active, created_at'

const byUsernameStmt = db.prepare(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE username = ?`)
const getStmt = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`)
const listStmt = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY is_active DESC, username`)
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM users')

const insertStmt = db.prepare(`
  INSERT INTO users (username, full_name, password_hash, role, is_active, created_at)
  VALUES (@username, @full_name, @password_hash, @role, 1, @created_at)
`)

const updatePasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
const deactivateStmt = db.prepare('UPDATE users SET is_active = 0 WHERE id = ?')

// Resolves to the user without the hash, or throws the message the login screen shows.
// Unknown user and wrong password are told apart on purpose: one shop, one machine, and staff need to know
// which to fix. Deactivation is only revealed with the right password, so it cannot be probed for.
export async function authenticate(username, password) {
  const name = normalizeUsername(username)
  if (!name || typeof password !== 'string' || password === '') {
    throw new Error('Enter your username and password.')
  }

  const row = byUsernameStmt.get(name)
  if (!row) throw new Error(`There is no account with the username "${name}". Check the spelling.`)
  if (!(await bcrypt.compare(password, row.password_hash))) {
    throw new Error('Wrong password. Try again, or ask the shop owner to reset it.')
  }
  if (!row.is_active) {
    throw new Error('This account has been deactivated. Ask the shop owner if you need access again.')
  }

  delete row.password_hash
  return row
}

export async function create(data) {
  return insertUser(await buildUser(data))
}

export async function updatePassword(id, newPassword) {
  const userId = toId(id, 'user')
  const hash = await hashPassword(newPassword)
  if (updatePasswordStmt.run(hash, userId).changes === 0) throw new Error('User not found.')
  return get(userId)
}

export function deactivate(id) {
  const userId = toId(id, 'user')
  if (deactivateStmt.run(userId).changes === 0) throw new Error('User not found.')
  return get(userId)
}

export function get(id) {
  return getStmt.get(toId(id, 'user')) ?? null
}

export function list() {
  return listStmt.all()
}

// Counts deactivated accounts too: first-run setup is only for a database that has never had a user
export function count() {
  return countStmt.get().n
}

// Validates and hashes, without writing. Split from insertUser so first-run setup can hash outside
// its transaction (bcrypt is async; better-sqlite3 transactions must be synchronous).
export async function buildUser(data = {}) {
  const username = normalizeUsername(data.username)
  if (!username) throw new Error('Username is required.')
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error('Username must be 3 to 32 characters: letters, digits, dot, dash or underscore.')
  }
  const role = data.role ?? 'salesman'
  if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`)

  return {
    username,
    full_name: clean(data.full_name),
    password_hash: await hashPassword(data.password),
    role,
    created_at: new Date().toISOString(),
  }
}

export function insertUser(row) {
  try {
    return get(insertStmt.run(row).lastInsertRowid)
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && err.message.includes('users.username')) {
      throw new Error('That username is already taken.')
    }
    throw err
  }
}

// Exported for db/recovery.js, which sets a password and a new recovery code in one transaction
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  // bcrypt only reads the first 72 bytes; refuse rather than silently ignore the rest
  if (bcrypt.truncates(password)) throw new Error('Password is too long.')
  return bcrypt.hash(password, BCRYPT_COST)
}

// Lower-cased so "Ali" and "ali" cannot become two accounts under the case-sensitive UNIQUE index
function normalizeUsername(value) {
  return clean(value)?.toLowerCase() ?? null
}
