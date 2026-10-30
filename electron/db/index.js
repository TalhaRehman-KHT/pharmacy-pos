import { app } from 'electron'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = path.join(__dirname, 'schema.sql')
const MIGRATIONS_DIR = path.join(__dirname, 'migrations')
// Migration files are named like 002_add_column.sql; the leading number is the version
const MIGRATION_FILE = /^(\d+).*\.sql$/i

export let db = null

export function initDb() {
  if (db) return db

  db = new Database(path.join(app.getPath('userData'), 'pharmacy.db'))
  db.pragma('journal_mode = WAL')
  // Off by default in SQLite and scoped to the connection, so set it on every open
  db.pragma('foreign_keys = ON')

  if (!tableExists('settings')) createSchema()
  runMigrations()

  return db
}

export function closeDb() {
  if (!db) return
  db.close()
  db = null
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : null
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value == null ? null : String(value))
}

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
}

function createSchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8')
  db.transaction(() => {
    db.exec(sql)
    setSetting('schema_version', 1)
  })()
}

function runMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return

  const migrations = fs
    .readdirSync(MIGRATIONS_DIR)
    .map((file) => ({ file, match: MIGRATION_FILE.exec(file) }))
    .filter(({ match }) => match)
    .map(({ file, match }) => ({ file, version: Number(match[1]) }))
    .sort((a, b) => a.version - b.version)

  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i].version === migrations[i - 1].version) {
      throw new Error(
        `Duplicate migration version ${migrations[i].version}: ${migrations[i - 1].file} and ${migrations[i].file}`,
      )
    }
  }

  const current = Number(getSetting('schema_version') ?? 0)

  // PRAGMA foreign_keys is a no-op inside a transaction, so migrations cannot toggle it
  for (const { file, version } of migrations.filter((m) => m.version > current)) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      setSetting('schema_version', version)
    })()
  }
}
