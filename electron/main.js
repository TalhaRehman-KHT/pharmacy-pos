import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as backup from './backup.js'
import { dataFolderInfo, initDataFolders } from './data-folders.js'
import * as drive from './drive.js'
import { closeDb, getSetting, initDb } from './db/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Set by the electron:dev script; anything else loads the production build
const isDev = process.env.ELECTRON_DEV === 'true'
const DEV_SERVER_URL = 'http://localhost:5173'

// The signed-in user lives here, in the main process, and nowhere the renderer can write to.
// { id, username, full_name, role } or null. The renderer only ever receives a copy.
let sessionUser = null

const currentUserId = () => sessionUser?.id ?? null

// True once the database opened and passed its check; the shutdown backup only runs then, so a damaged
// database is never backed up over the good copies
let dbReady = false

// Set by backup:chooseFile, read by backup:restoreChosen, so the renderer never supplies a path
let chosenRestoreFile = null

// Set by recovery:verify once the username and recovery code matched, read by recovery:resetPassword.
// { ownerId, expiresAt }. Held here, so the renderer has nothing it could forge or replay to skip the code.
let recoveryGrant = null
const RECOVERY_GRANT_MS = 10 * 60 * 1000

// The marker of a restore whose restarted window has not yet drawn; read at startup, cleared once it has
let lastRestore = null

// Set while the app restarts after a restore, so closing its windows neither quits nor backs up
let restarting = false

// The typed confirmation is checked here as well, so nothing can call a restore by accident
const RESTORE_CONFIRMATION = 'RESTORE'
function assertConfirmed(text) {
  if (text !== RESTORE_CONFIRMATION) throw new Error(`Type ${RESTORE_CONFIRMATION} to confirm the restore.`)
}

function createWindow() {
  // app.getName() is package.json productName; keep it instead of index.html's <title>
  const win = new BrowserWindow({
    title: app.getName(),
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  win.on('page-title-updated', (event) => event.preventDefault())

  // Closing the window ends the session, so a reopened window (macOS dock) starts at the login screen
  win.on('closed', () => {
    sessionUser = null
    recoveryGrant = null
  })

  watchWindowLoad(win)

  if (isDev) {
    win.loadURL(DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// How long after the page loads React has to put something in #root before the window counts as blank
const RENDER_CHECK_MS = 8000

// A blank window tells the operator nothing, least of all after a restore, when they cannot tell whether
// their data is gone. Every way the window can fail to show (page not loading, preload failing, the
// renderer crashing, or a script error leaving #root empty) ends in a native dialog instead.
function watchWindowLoad(win) {
  const wc = win.webContents
  let reported = false

  async function fail(reason) {
    if (reported || win.isDestroyed()) return
    reported = true
    console.error('Window failed to load:', reason)
    const { response } = await dialog.showMessageBox(win, {
      type: 'error',
      title: 'The screen did not load',
      message: 'The Pharmacy POS screen failed to load.',
      detail: loadFailureDetail(reason),
      buttons: ['Try again', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (win.isDestroyed()) return
    if (response === 0) {
      reported = false
      wc.reload()
    } else {
      app.quit()
    }
  }

  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED: a load replaced by another, such as a reload
    if (isMainFrame && code !== -3) fail(`${description} (${code}) while loading ${url}`)
  })
  wc.on('preload-error', (_event, _preloadPath, err) => fail(`The preload script failed: ${err.message}`))
  wc.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') fail(`The screen's process stopped (${details.reason}).`)
  })
  wc.on('did-finish-load', () => {
    setTimeout(async () => {
      if (reported || win.isDestroyed()) return
      let drawn = 0
      try {
        drawn = await wc.executeJavaScript("document.getElementById('root')?.childElementCount ?? 0")
      } catch {
        // Counts as not drawn
      }
      if (!drawn) {
        fail('The page loaded but nothing was drawn, usually a script error. Press Ctrl+Shift+I for details.')
      } else if (lastRestore) {
        lastRestore = null
        backup.clearRestoreMarker()
      }
    }, RENDER_CHECK_MS)
  })
}

function loadFailureDetail(reason) {
  // The window is only created after the database opened and passed its check
  const lines = [reason, '', 'The database opened and passed its check.']
  if (lastRestore) lines.push('', ...restoreLines(lastRestore))
  return lines.join('\n')
}

// What the operator needs to know about the restore that preceded this start, and where to undo it
function restoreLines(marker) {
  const lines = [
    `This is the first start after a restore on ${new Date(marker.restored_at).toLocaleString()} from:`,
    marker.source,
  ]
  if (!marker.completed) lines.push('That restore did not complete; the database was left as it was before it.')
  lines.push(
    '',
    marker.safety_copy
      ? `The data as it was before the restore is saved at:\n${marker.safety_copy}`
      : 'There was no database before the restore, so there is no safety copy.',
  )
  return lines
}

// Replaces the database, then restarts. Rejects, with the current database untouched, if the file fails
// validation or the safety copy cannot be made.
async function restoreAndRestart(filePath) {
  await backup.restoreBackup(filePath)
  restartApp()
}

// Starts a new instance with this one's arguments and full environment (ELECTRON_DEV included), so a
// dev-mode restore comes back in dev mode and a packaged one comes back packaged.
// In dev mode this process stays alive, windowless, until the new instance exits: electron:dev runs under
// concurrently -k, which stops Vite as soon as the Electron it started exits, and the restarted window would
// load a dead dev server.
function restartApp() {
  restarting = true
  clearInterval(periodicBackupTimer)
  const args = process.argv.slice(1)

  if (isDev) {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
    child.on('error', (err) => {
      dialog.showErrorBox('Restart failed', `${err.message}\n\nStart the app again yourself.`)
      app.exit(1)
    })
    child.on('exit', (code) => app.exit(code ?? 0))
    for (const win of BrowserWindow.getAllWindows()) win.destroy()
    return
  }

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore',
  })
  // No pid means the spawn failed outright; fall back to Electron's own relaunch
  if (child.pid) child.unref()
  else app.relaunch()
  app.exit(0)
}

// access: 'public' needs no session, 'user' any signed-in user, 'owner' the owner role.
// The renderer also hides what a role cannot use, but this check is the control; hiding is a convenience.
const ACCESS_LEVELS = ['public', 'user', 'owner']

function authorize(access) {
  if (access === 'public') return
  if (!sessionUser) throw new Error('You are signed out. Sign in and try again.')
  if (access === 'owner' && sessionUser.role !== 'owner') {
    throw new Error('Only the owner can do this.')
  }
}

// Handlers return { ok, data } or { ok: false, error } so a thrown error never rejects in the renderer.
// Every channel requires a signed-in user unless registered as 'public'.
function handle(channel, fn, access = 'user') {
  if (!ACCESS_LEVELS.includes(access)) throw new Error(`Unknown access level for ${channel}: ${access}`)
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      authorize(access)
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })
}

function toSessionUser(user) {
  return { id: user.id, username: user.username, full_name: user.full_name, role: user.role }
}

async function registerIpc() {
  // Imported dynamically because the module prepares statements on load and needs an open db
  const users = await import('./db/users.js')
  const setup = await import('./db/setup.js')

  // Public: these are what a signed-out window needs to reach the login or setup screen
  handle('setup:isNeeded', () => setup.isNeeded(), 'public')
  // Signs the new owner straight in. setup.complete refuses once any user exists.
  // Resolves to { user, recoveryCode }; this reply is the only place the first code ever appears.
  handle(
    'setup:complete',
    async (shop, owner) => {
      const { user, recoveryCode } = await setup.complete(shop, owner)
      sessionUser = toSessionUser(user)
      return { user: { ...sessionUser }, recoveryCode }
    },
    'public',
  )

  const recovery = await import('./db/recovery.js')

  // Owner password recovery from the login screen; public, since the owner cannot sign in.
  // verify is rate limited in recovery.js (5 failures lock it for 15 minutes, kept across restarts).
  handle('recovery:available', () => recovery.available(), 'public')
  handle(
    'recovery:verify',
    async (username, code) => {
      recoveryGrant = null
      const ownerId = await recovery.verify(username, code)
      recoveryGrant = { ownerId, expiresAt: Date.now() + RECOVERY_GRANT_MS }
      return true
    },
    'public',
  )
  // Sets the new password, replaces the recovery code and signs the owner in.
  // Resolves to { user, recoveryCode }. A rejected password keeps the grant, so the owner can try another.
  handle(
    'recovery:resetPassword',
    async (newPassword) => {
      const grant = recoveryGrant
      if (!grant || grant.expiresAt < Date.now()) {
        recoveryGrant = null
        throw new Error('Recovery has timed out. Enter your username and recovery code again.')
      }
      // Taken before the await, so a second call fired at the same time cannot use the same grant
      recoveryGrant = null
      let recoveryCode
      try {
        recoveryCode = await recovery.resetPassword(grant.ownerId, newPassword)
      } catch (err) {
        recoveryGrant = grant
        throw err
      }
      sessionUser = toSessionUser(users.get(grant.ownerId))
      return { user: { ...sessionUser }, recoveryCode }
    },
    'public',
  )
  handle(
    'recovery:cancel',
    () => {
      recoveryGrant = null
      return null
    },
    'public',
  )
  handle('recovery:status', () => recovery.status(), 'owner')
  // Needs the current password as well as the owner session; the id comes from the session, never the
  // renderer. The new code is in this reply only; the earlier code stops working.
  handle('recovery:regenerate', (currentPassword) => recovery.regenerate(currentUserId(), currentPassword), 'owner')

  // Shown above the login form; the shop name is printed on every receipt, so it is no secret
  handle('auth:shopName', () => getSetting('shop_name') ?? '', 'public')
  // authenticate throws its own message for an unknown user, a wrong password and a deactivated account
  handle(
    'auth:login',
    async (username, password) => {
      const user = await users.authenticate(username, password)
      sessionUser = toSessionUser(user)
      return { ...sessionUser }
    },
    'public',
  )
  handle(
    'auth:logout',
    () => {
      sessionUser = null
      return null
    },
    'public',
  )
  handle('auth:current', () => (sessionUser ? { ...sessionUser } : null), 'public')

  handle('users:list', () => users.list(), 'owner')
  // The Users screen only adds salesmen; the owner account comes from first-run setup
  handle('users:create', (data) => users.create({ ...data, role: 'salesman' }), 'owner')
  handle('users:resetPassword', (id, newPassword) => users.updatePassword(id, newPassword), 'owner')
  handle(
    'users:deactivate',
    (id) => {
      if (Number(id) === sessionUser.id) throw new Error('You cannot deactivate your own account.')
      return users.deactivate(id)
    },
    'owner',
  )

  const medicines = await import('./db/medicines.js')

  handle('medicines:list', (opts) => medicines.list(opts))
  handle('medicines:get', (id) => medicines.get(id))
  handle('medicines:create', (data) => medicines.create(data))
  handle('medicines:update', (id, data) => medicines.update(id, data))
  handle('medicines:deactivate', (id) => medicines.deactivate(id))

  const batches = await import('./db/batches.js')

  // userId comes from the main-process session, never from the renderer

  handle('batches:listByMedicine', (medicineId) => batches.listByMedicine(medicineId))
  handle('batches:create', (data) => batches.create(data, currentUserId()))
  // Owner only: receiving stock is a salesman's daily work, but changing an existing batch's quantity
  // is where shrinkage would be hidden, so the ledger entry must carry the owner's id
  handle(
    'batches:adjustQuantity',
    (batchId, delta, reason, note) => batches.adjustQuantity(batchId, delta, reason, note, currentUserId()),
    'owner',
  )
  handle('batches:stockSummary', () => batches.stockSummary())

  const sales = await import('./db/sales.js')

  handle('sales:allocate', (medicineId, qty) => sales.allocate(medicineId, qty))
  handle('sales:availableQty', (medicineId) => sales.availableQty(medicineId))
  handle('sales:create', (sale, items, payments) => sales.createSale(sale, items, payments, currentUserId()))

  // Called by the hidden invoice windows (electron/invoice-preload.js)
  handle('invoice:getSale', (saleId) => sales.getSaleForPrint(saleId))

  const print = await import('./print.js')

  handle('print:invoice', (saleId) => print.printInvoice(saleId))
  // Same sale, marked as a duplicate copy; Phase 7's sales history calls this
  handle('print:reprint', (saleId) => print.printInvoice(saleId, { reprint: true }))
  handle('print:listPrinters', () => print.listPrinters())

  const reports = await import('./db/reports.js')

  handle('reports:lowStock', () => reports.lowStock())
  handle('reports:expiring', (days) => reports.expiring(days))
  handle('reports:salesHistory', (range) => reports.salesHistory(range))
  handle('reports:saleDetail', (saleId) => reports.saleDetail(saleId))
  // One channel per dashboard figure, so each card loads and fails on its own
  handle('reports:todaySalesTotal', () => reports.todaySalesTotal())
  handle('reports:todayBillCount', () => reports.todayBillCount())
  handle('reports:lowStockCount', () => reports.lowStockCount())
  handle('reports:expiringCount', (days) => reports.expiringCount(days))
  // Owner only: takings, margin and best sellers are the owner's business figures
  handle('reports:salesSummary', (range) => reports.salesSummary(range), 'owner')
  handle('reports:topSelling', (opts) => reports.topSelling(opts), 'owner')
  handle('reports:grossMargin', (range) => reports.grossMargin(range), 'owner')
  handle('reports:dailyTotals', (range) => reports.dailyTotals(range), 'owner')

  const reportExport = await import('./report-export.js')

  handle('reports:exportCsv', (opts) => reportExport.exportReportCsv(opts), 'owner')

  const settings = await import('./db/settings.js')

  handle('settings:get', () => settings.getAll(), 'owner')
  handle('settings:save', (data) => settings.save(data), 'owner')

  // { root, fallback, reason }: where backups, invoices and reports are written (see data-folders.js)
  handle('dataFolder:info', () => dataFolderInfo(), 'owner')
  handle(
    'dataFolder:open',
    async () => {
      const { root } = dataFolderInfo()
      // openPath resolves to an error message, empty on success
      const error = await shell.openPath(root)
      if (error) throw new Error(`Could not open ${root}: ${error}`)
      return root
    },
    'owner',
  )

  handle(
    'backup:status',
    async () => ({ lastBackupAt: getSetting('last_backup_at'), backups: await backup.listBackups() }),
    'owner',
  )
  handle('backup:create', async () => path.basename(await backup.createBackup()), 'owner')
  // Restores restart the app, so on success the renderer never receives a reply
  handle(
    'backup:restore',
    (name, confirmation) => {
      assertConfirmed(confirmation)
      return restoreAndRestart(backup.backupPath(name))
    },
    'owner',
  )
  // Validates the chosen file before the owner is asked to confirm; null if the dialog was cancelled
  handle(
    'backup:chooseFile',
    async () => {
      chosenRestoreFile = null
      const filePath = await pickBackupFile(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])
      if (!filePath) return null
      const info = await backup.validateBackup(filePath)
      chosenRestoreFile = filePath
      return { ...info, path: filePath }
    },
    'owner',
  )
  handle(
    'backup:restoreChosen',
    (confirmation) => {
      assertConfirmed(confirmation)
      if (!chosenRestoreFile) throw new Error('Choose a backup file first.')
      return restoreAndRestart(chosenRestoreFile)
    },
    'owner',
  )

  // Google Drive, owner only. Every call is started by the owner; nothing uploads in the background.
  // status needs no network: the account comes from Credential Manager.
  handle(
    'drive:status',
    async () => ({ configured: drive.isConfigured(), account: await drive.connectedAccount() }),
    'owner',
  )
  handle('drive:connect', () => drive.authorise(), 'owner')
  handle('drive:disconnect', () => drive.disconnect(), 'owner')
  handle(
    'drive:uploadLatest',
    async () => {
      // Safety copies stay local; only regular backups go to Drive
      const latest = (await backup.listBackups()).find((b) => b.kind === 'backup')
      if (!latest) throw new Error('There is no local backup to upload yet. Click Back up now first.')
      return drive.uploadBackup(backup.backupPath(latest.name))
    },
    'owner',
  )
  handle('drive:list', () => drive.listRemoteBackups(), 'owner')
  // Drive only downloads; the file then takes the same restore path as a local one (safety copy,
  // validation, restart). On success the renderer never receives a reply.
  handle(
    'drive:restore',
    async (fileId, confirmation) => {
      assertConfirmed(confirmation)
      // Fixed name outside the backup naming pattern, so it is never listed or pruned as a local backup
      const downloaded = path.join(backup.backupsDir(), 'drive-download.db.gz')
      await drive.downloadBackup(fileId, downloaded)
      try {
        return await restoreAndRestart(downloaded)
      } catch (err) {
        await fs.rm(downloaded, { force: true })
        throw err
      }
    },
    'owner',
  )
}

async function pickBackupFile(parent) {
  const options = {
    title: 'Restore from backup',
    defaultPath: backup.backupsDir(),
    properties: ['openFile'],
    filters: [
      { name: 'Pharmacy POS backup', extensions: ['gz', 'db'] },
      { name: 'All files', extensions: ['*'] },
    ],
  }
  const { canceled, filePaths } = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return canceled ? null : filePaths[0]
}

// Reached when the database will not open or fails its check, before any window exists. Native dialogs
// only: the renderer, the session and every IPC channel need a working database, so none of them run here.
// Loops until a restore restarts the app or the owner quits.
async function startupRecovery(err) {
  // Closed so the safety copy is a raw copy of the damaged files, not a backup through a broken connection
  try {
    closeDb()
  } catch (closeErr) {
    console.error(closeErr)
  }
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Database error',
      message: 'The pharmacy database could not be opened.',
      detail: [
        String(err.message || err),
        '',
        `You can restore a backup. The current database files are copied to ${path.join(backup.backupsDir(), 'damaged')} first.`,
        ...(lastRestore ? ['', ...restoreLines(lastRestore)] : []),
      ].join('\n'),
      buttons: ['Restore from backup…', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response !== 0) return app.quit()

    const filePath = await pickBackupFile(null)
    if (!filePath) continue

    try {
      const info = await backup.validateBackup(filePath)
      const confirm = await dialog.showMessageBox({
        type: 'warning',
        title: 'Restore backup',
        message: `Replace the current database with ${info.name}?`,
        detail: `Backup dated ${new Date(info.modified).toLocaleString()}. Sales made after it was taken will not be in the restored data.`,
        buttons: ['Restore and restart', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      if (confirm.response !== 0) continue
      await restoreAndRestart(filePath)
    } catch (restoreErr) {
      dialog.showErrorBox('Restore failed', restoreErr.message || String(restoreErr))
    }
  }
}

app.whenReady().then(async () => {
  // First, so startup recovery can already offer the backups folder
  const folders = initDataFolders()
  lastRestore = backup.readRestoreMarker()
  try {
    initDb()
    backup.checkLiveDatabase()
    await registerIpc()
    dbReady = true
    startPeriodicBackup()
  } catch (err) {
    console.error(err)
    await startupRecovery(err)
    return
  }

  createWindow()
  if (folders.fallback) warnDataFolderFallback(folders)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Not blocking: the app works with the userData folders, the owner only needs to know where files went
function warnDataFolderFallback({ root, reason }) {
  const win = BrowserWindow.getAllWindows()[0]
  const options = {
    type: 'warning',
    title: 'Data folder',
    message: 'Backups, invoices and reports cannot be saved in Documents\\Pharmacy POS.',
    detail: `${reason}\n\nThey are being saved here instead:\n${root}\n\nSettings shows this folder and can open it.`,
    noLink: true,
  }
  const shown = win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  shown.catch(console.error)
}

app.on('window-all-closed', () => {
  if (restarting) return
  if (process.platform !== 'darwin') app.quit()
})

// A shutdown backup is lost to a power cut or a Windows shutdown with the app open, both routine at the
// counter, so the app also backs up while it runs. Pruning keeps one per day beyond the 10 newest (see backup.js).
// Measured from last_backup_at rather than a plain 6-hour interval, which restarts with every launch and so
// would never fire if the power goes more often than that. Any backup (manual, shutdown) resets the clock.
const PERIODIC_BACKUP_MS = 6 * 60 * 60 * 1000
const PERIODIC_CHECK_MS = 15 * 60 * 1000
let periodicBackupTimer = null

function startPeriodicBackup() {
  const check = () => {
    // A throw here would be an uncaught exception in the main process; the connection is briefly closed
    // during a restore, so getSetting can fail
    try {
      const last = Date.parse(getSetting('last_backup_at') ?? '')
      const age = Date.now() - last
      // NaN (never backed up) or a clock set backwards counts as due
      if (age >= 0 && age < PERIODIC_BACKUP_MS) return
      backup.createBackup().catch((err) => console.error('Periodic backup failed:', err))
    } catch (err) {
      console.error('Periodic backup check failed:', err)
    }
  }
  check()
  periodicBackupTimer = setInterval(check, PERIODIC_CHECK_MS)
}

// One backup per shutdown. Quitting waits for it; a failed backup is logged and does not block the quit.
// restartApp leaves through app.exit(), which skips this, and the restarting check covers anything else.
let shutdownBackupDone = false
app.on('before-quit', (event) => {
  if (!dbReady || shutdownBackupDone || restarting) return
  event.preventDefault()
  shutdownBackupDone = true
  clearInterval(periodicBackupTimer)
  backup
    .createBackup()
    .catch((err) => console.error('Shutdown backup failed:', err))
    .finally(() => app.quit())
})

app.on('will-quit', closeDb)
