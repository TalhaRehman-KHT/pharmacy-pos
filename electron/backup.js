import { app, dialog } from 'electron'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'
import { backupsDir } from './data-folders.js'
import { closeDb, db, setSetting } from './db/index.js'

// Local backups only. Every backup is a gzipped, self-contained SQLite file in the backups data folder
// (Documents\Pharmacy POS\backups, or userData\backups as a fallback; see data-folders.js).
// Does not need an open database at import time, so main.js can use it to recover when initDb() fails.

// Retention: the KEEP_RECENT newest, plus the newest of each local day for the last KEEP_DAYS days.
// Recent ones cover "undo this afternoon"; the daily ones give a history that six-hourly and shutdown
// backups would otherwise push out within days.
const KEEP_RECENT = 10
const KEEP_DAYS = 30
// Safety copies are counted apart: the KEEP_SAFETY newest are kept whatever their age, because a wrong
// restore is often noticed days later. They take no recent or daily slots, and older ones are removed.
const KEEP_SAFETY = 3
// Restoring a file without these would give an app that starts but cannot sell, so it is rejected
const EXPECTED_TABLES = ['users', 'medicines', 'batches', 'sales', 'sale_items', 'payments', 'stock_entries', 'settings']
// pharmacy-2026-10-29-1830.db.gz, pre-restore-2026-10-29-1830-2.db.gz. Also what stops a name from the
// renderer from reaching outside the backups folder.
const BACKUP_FILE = /^(pharmacy|pre-restore)-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.db\.gz$/
const GZIP_MAGIC = [0x1f, 0x8b]

export { backupsDir }
// Same path db/index.js opens
const livePath = () => path.join(app.getPath('userData'), 'pharmacy.db')

// Writes a backup with the backup API, which reads a consistent snapshot through the open connection,
// WAL included. Records the time in settings, prunes old backups and resolves to the file's path.
export function createBackup() {
  return exclusive(async () => {
    const target = await writeBackup('pharmacy')
    setSetting('last_backup_at', new Date().toISOString())
    await pruneBackups()
    return target
  })
}

// One backup or restore at a time. The periodic timer can fire during a manual backup or a restore; they
// share temp files, and a restore closes the connection a backup reads from.
let queue = Promise.resolve()
function exclusive(fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

// Newest first: [{ name, kind: 'backup' | 'pre-restore', created_at (ISO, UTC), size (bytes) }]
export async function listBackups() {
  const dir = backupsDir()
  let names
  try {
    names = await fsp.readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }

  const out = []
  for (const name of names.filter((n) => BACKUP_FILE.test(n))) {
    const stat = await fsp.stat(path.join(dir, name))
    out.push({
      name,
      kind: name.startsWith('pre-restore-') ? 'pre-restore' : 'backup',
      created_at: stat.mtime.toISOString(),
      size: stat.size,
    })
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// Applies the retention rules above; resolves to the names removed.
// Days are local calendar days, the ones the owner thinks in.
export async function pruneBackups() {
  const all = await listBackups() // newest first
  const backups = all.filter((b) => b.kind === 'backup')
  const keep = new Set([
    ...all.filter((b) => b.kind === 'pre-restore').slice(0, KEEP_SAFETY).map((b) => b.name),
    ...backups.slice(0, KEEP_RECENT).map((b) => b.name),
  ])

  const now = new Date()
  const oldestDay = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (KEEP_DAYS - 1)))
  const seenDays = new Set()
  for (const b of backups) {
    const day = dayKey(new Date(b.created_at))
    // Newest first, so the first one seen for a day is that day's last, most complete backup
    if (day >= oldestDay && !seenDays.has(day)) {
      seenDays.add(day)
      keep.add(b.name)
    }
  }

  const removed = all.filter((b) => !keep.has(b.name))
  for (const { name } of removed) await fsp.rm(path.join(backupsDir(), name), { force: true })
  return removed.map((b) => b.name)
}

function dayKey(d) {
  return stamp(d).slice(0, 10)
}

// Resolves a name from listBackups() to its path, refusing anything else
export function backupPath(name) {
  if (typeof name !== 'string' || !BACKUP_FILE.test(name)) throw new Error('Unknown backup.')
  const file = path.join(backupsDir(), name)
  if (!fs.existsSync(file)) throw new Error('That backup no longer exists.')
  return file
}

// Checks a file would restore cleanly without touching the live database. Accepts a .db.gz backup or a
// plain SQLite file. Resolves to { name, size, modified } or rejects with the reason.
export async function validateBackup(filePath) {
  const temp = await tempPath('validate')
  try {
    await extractAndCheck(filePath, temp)
  } finally {
    await removeDbFiles(temp)
  }
  const stat = await fsp.stat(filePath)
  return { name: path.basename(filePath), size: stat.size, modified: stat.mtime.toISOString() }
}

// Run on the live connection at startup, so a damaged database sends the app to recovery instead of
// failing part-way through a sale
export function checkLiveDatabase() {
  checkDatabase(db)
}

// Replaces the live database with filePath. The caller must then restart the app (main.js restartApp).
// 1. Safety copy of the current database, so restoring the wrong file can be undone.
// 2. Validate the file: it must open as SQLite, pass quick_check and have the expected tables.
// 3. Close the connection, swap the file in, write the restore marker.
// Rejects only during 1 and 2, while the current database is untouched and still open. Once the connection
// is closed it always resolves, to the marker, with completed false if the swap failed.
// Works with no open connection too (startup recovery): the safety copy is then a raw file copy.
export function restoreBackup(filePath) {
  return exclusive(() => replaceDatabase(filePath))
}

async function replaceDatabase(filePath) {
  const source = path.resolve(filePath)
  if (!fs.existsSync(source)) throw new Error('The backup file was not found.')

  const safetyCopy = await takeSafetyCopy()

  const temp = await tempPath('restore')
  try {
    await extractAndCheck(source, temp)
  } catch (err) {
    await removeDbFiles(temp)
    throw new Error(`${err.message} Nothing was restored; the current data is unchanged.`)
  }

  // From here the connection is closed, so whatever happens the app restarts rather than run without one
  let completed = true
  try {
    closeDb()
    const live = livePath()
    // A WAL or shared-memory file left beside the new database would be replayed into it and corrupt it
    for (const suffix of ['-wal', '-shm', '-journal']) await fsp.rm(live + suffix, { force: true })
    await fsp.rename(temp, live)
  } catch (err) {
    completed = false
    await removeDbFiles(temp)
    dialog.showErrorBox(
      'Restore failed',
      `${err.message}\n\nThe app will restart.` +
        (safetyCopy ? `\n\nThe database as it was before this restore is saved at:\n${safetyCopy}` : ''),
    )
  }

  const marker = { restored_at: new Date().toISOString(), source, safety_copy: safetyCopy, completed }
  try {
    fs.writeFileSync(markerPath(), JSON.stringify(marker, null, 2))
  } catch (err) {
    console.error('Could not write the restore marker:', err)
  }
  return marker
}

// The marker survives the restart so the next launch can name the safety copy if anything fails. main.js
// clears it only once the window has drawn, so it is still there after a crash or a blank screen.
// { restored_at, source, safety_copy (path or null), completed } or null
export function readRestoreMarker() {
  try {
    return JSON.parse(fs.readFileSync(markerPath(), 'utf8'))
  } catch {
    return null
  }
}

export function clearRestoreMarker() {
  fs.rmSync(markerPath(), { force: true })
}

const markerPath = () => path.join(app.getPath('userData'), 'last-restore.json')

async function writeBackup(prefix) {
  if (!db) throw new Error('The database is not open.')
  const dir = backupsDir()
  await fsp.mkdir(dir, { recursive: true })

  const target = freePath(dir, `${prefix}-${stamp()}`, '.db.gz')
  const temp = await tempPath('backup')
  await removeDbFiles(temp)
  try {
    await db.backup(temp)
    // The copy keeps the source's WAL mode; make it one self-contained file before compressing
    const copy = new Database(temp, { fileMustExist: true })
    try {
      copy.pragma('journal_mode = DELETE')
    } finally {
      copy.close()
    }
    await pipeline(fs.createReadStream(temp), zlib.createGzip(), fs.createWriteStream(target))
  } catch (err) {
    await fsp.rm(target, { force: true })
    throw err
  } finally {
    await removeDbFiles(temp)
  }
  return target
}

// Prefers a proper backup; if the database is too damaged for that, or not open (startup recovery),
// copies the raw files, WAL included, into backups/damaged. If neither works the restore does not go ahead.
async function takeSafetyCopy() {
  if (db) {
    try {
      return await writeBackup('pre-restore')
    } catch (err) {
      console.error('Backup API safety copy failed, copying raw files instead:', err)
    }
  }

  const live = livePath()
  if (!fs.existsSync(live)) return null
  const damagedDir = path.join(backupsDir(), 'damaged')
  await fsp.mkdir(damagedDir, { recursive: true })
  const dest = freePath(damagedDir, `pharmacy-${stamp()}`, '')
  await fsp.mkdir(dest)
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(live + suffix)) await fsp.copyFile(live + suffix, path.join(dest, 'pharmacy.db' + suffix))
  }
  return dest
}

// Produces a plain, DELETE-journal SQLite file at temp from a .db.gz or .db source, then checks it
async function extractAndCheck(source, temp) {
  await removeDbFiles(temp)
  try {
    if (isGzip(source)) {
      await pipeline(fs.createReadStream(source), zlib.createGunzip(), fs.createWriteStream(temp))
    } else {
      // The backup API rather than a copy, so a source with its own WAL file comes over complete
      const src = new Database(source, { readonly: true, fileMustExist: true })
      try {
        await src.backup(temp)
      } finally {
        src.close()
      }
    }

    const conn = new Database(temp, { fileMustExist: true })
    try {
      checkDatabase(conn)
      conn.pragma('journal_mode = DELETE')
    } finally {
      conn.close()
    }
  } catch (err) {
    throw new Error(`This file is not a usable Pharmacy POS backup (${err.message}).`)
  }
}

function checkDatabase(conn) {
  const result = conn.pragma('quick_check', { simple: true })
  if (result !== 'ok') throw new Error(`integrity check failed: ${result}`)
  const tables = new Set(conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all())
  const missing = EXPECTED_TABLES.filter((t) => !tables.has(t))
  if (missing.length) throw new Error(`missing tables: ${missing.join(', ')}`)
}

function isGzip(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(2)
    return fs.readSync(fd, buf, 0, 2, 0) === 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1]
  } finally {
    fs.closeSync(fd)
  }
}

// Beside the live database, not in the backups folder: the final rename onto pharmacy.db must stay on
// one volume, and Documents may be another drive or synced by OneDrive while the file is open
async function tempPath(purpose) {
  const dir = app.getPath('userData')
  await fsp.mkdir(dir, { recursive: true })
  return path.join(dir, `.${purpose}.tmp`)
}

async function removeDbFiles(file) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) await fsp.rm(file + suffix, { force: true })
}

// Local time: the name is for the owner to read, not stored data
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

// Two backups in the same minute get -2, -3, ... rather than overwrite each other
function freePath(dir, base, ext) {
  let file = path.join(dir, base + ext)
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base}-${i}${ext}`)
  return file
}
