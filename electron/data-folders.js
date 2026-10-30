import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// The folders the owner opens themselves: backups, invoice PDFs and CSV reports, under
// Documents\Pharmacy POS. The live database is not here and must never be: it stays in userData
// (db/index.js), because Documents is often synced by OneDrive, which corrupts a SQLite file in use.
// Nothing here needs the database, so main.js runs it before initDb() and startup recovery can use it.

const ROOT_NAME = 'Pharmacy POS'
const SUBFOLDERS = ['backups', 'invoices', 'reports']
// Folders that lived in userData before this layout; moved once, on the first start that finds them
const MIGRATED = ['backups', 'invoices']
// Scratch files of backup.js (.backup.tmp, .restore.tmp-wal, ...); never worth moving
const TEMP_FILE = /^\.\w+\.tmp(-wal|-shm|-journal)?$/

// { root, fallback, reason }; fallback is true when Documents could not be used and userData is in use
let state = null

// Creates the folders and moves files from the old locations. Never throws: if Documents cannot be used
// the folders are made in userData instead, and the reason is kept for the Settings screen and startup.
export function initDataFolders() {
  const userData = app.getPath('userData')
  try {
    const root = path.join(app.getPath('documents'), ROOT_NAME)
    prepare(root)
    state = { root, fallback: false, reason: null }
  } catch (err) {
    console.error('Documents data folder unavailable, using userData:', err)
    state = { root: userData, fallback: true, reason: err.message || String(err) }
    try {
      prepare(userData)
    } catch (fallbackErr) {
      // Each writer creates its folder again before use; this only leaves the error for that to report
      console.error('Could not prepare the userData folders either:', fallbackErr)
    }
  }

  if (!state.fallback) {
    for (const name of MIGRATED) migrate(path.join(userData, name), path.join(state.root, name))
  }
  return dataFolderInfo()
}

export function dataFolderInfo() {
  if (!state) throw new Error('Data folders are not initialised.')
  return { ...state }
}

export const backupsDir = () => path.join(dataFolderInfo().root, 'backups')
export const invoicesDir = () => path.join(dataFolderInfo().root, 'invoices')
export const reportsDir = () => path.join(dataFolderInfo().root, 'reports')

// Makes the folders and proves each one takes a write; a folder that exists but is read-only (or
// blocked by Windows Controlled Folder Access) would otherwise only fail at the first backup
function prepare(root) {
  for (const name of SUBFOLDERS) {
    const dir = path.join(root, name)
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.write-test-${process.pid}`)
    fs.writeFileSync(probe, '')
    fs.rmSync(probe, { force: true })
  }
}

// Moves every entry of from into to, leaving anything that is already at the destination, and removes
// from once it is empty. A failure is logged and leaves that entry where it was, to be tried next start.
function migrate(from, to) {
  if (path.resolve(from) === path.resolve(to)) return
  let names
  try {
    names = fs.readdirSync(from)
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not read ${from}:`, err)
    return
  }

  for (const name of names) {
    const src = path.join(from, name)
    try {
      if (TEMP_FILE.test(name)) {
        fs.rmSync(src, { force: true })
        continue
      }
      const dest = path.join(to, name)
      if (fs.existsSync(dest)) continue
      moveEntry(src, dest)
    } catch (err) {
      console.error(`Could not move ${src}:`, err)
    }
  }

  try {
    if (fs.readdirSync(from).length === 0) fs.rmdirSync(from)
  } catch (err) {
    console.error(`Could not remove ${from}:`, err)
  }
}

// Documents can be on another drive (folder redirection, OneDrive), where rename fails with EXDEV;
// then copy, and delete the original only after the copy completed
function moveEntry(src, dest) {
  try {
    fs.renameSync(src, dest)
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
    try {
      fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false })
    } catch (copyErr) {
      // A half-copied backup at the destination would be skipped as already moved on the next start
      fs.rmSync(dest, { recursive: true, force: true })
      throw copyErr
    }
    fs.rmSync(src, { recursive: true, force: true })
  }
}
