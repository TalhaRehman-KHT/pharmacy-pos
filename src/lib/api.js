// Turns the preload's { ok, data, error } envelopes into normal resolve/reject
async function unwrap(promise) {
  const res = await promise
  if (!res?.ok) throw new Error(res?.error || 'Unknown error')
  return res.data
}

// complete resolves to { user, recoveryCode }; the owner is already signed in by the main process
export const setup = {
  isNeeded: () => unwrap(window.api.setup.isNeeded()),
  complete: (shop, owner) => unwrap(window.api.setup.complete(shop, owner)),
}

// Owner password recovery. available, verify and resetPassword need no session: available says whether
// to offer "Forgot password?"; verify checks the username and recovery code (rate limited) and resolves to
// true; resetPassword then sets the new password, signs the owner in and resolves to { user, recoveryCode }
// with a new code that replaces the old one; cancel drops a verified code's go-ahead.
// status ({ hasCode, createdAt }) and regenerate (takes the current password, resolves to the new code)
// are owner only.
export const recovery = {
  available: () => unwrap(window.api.recovery.available()),
  verify: (username, code) => unwrap(window.api.recovery.verify(username, code)),
  resetPassword: (newPassword) => unwrap(window.api.recovery.resetPassword(newPassword)),
  cancel: () => unwrap(window.api.recovery.cancel()),
  status: () => unwrap(window.api.recovery.status()),
  regenerate: (currentPassword) => unwrap(window.api.recovery.regenerate(currentPassword)),
}

// The session is held by the main process; login and current resolve to { id, username, full_name, role }
// (current to null when signed out). The copy kept in React only decides what to show.
// shopName resolves to the shop name from settings ('' if unset) and needs no session.
export const auth = {
  login: (username, password) => unwrap(window.api.auth.login(username, password)),
  logout: () => unwrap(window.api.auth.logout()),
  current: () => unwrap(window.api.auth.current()),
  shopName: () => unwrap(window.api.auth.shopName()),
}

// Owner only; the main process rejects these for a salesman
export const users = {
  list: () => unwrap(window.api.users.list()),
  create: (data) => unwrap(window.api.users.create(data)),
  resetPassword: (id, newPassword) => unwrap(window.api.users.resetPassword(id, newPassword)),
  deactivate: (id) => unwrap(window.api.users.deactivate(id)),
}

export const medicines = {
  list: (opts) => unwrap(window.api.medicines.list(opts)),
  get: (id) => unwrap(window.api.medicines.get(id)),
  create: (data) => unwrap(window.api.medicines.create(data)),
  update: (id, data) => unwrap(window.api.medicines.update(id, data)),
  deactivate: (id) => unwrap(window.api.medicines.deactivate(id)),
}

// adjustQuantity is owner only; the main process rejects it for a salesman
export const batches = {
  listByMedicine: (medicineId) => unwrap(window.api.batches.listByMedicine(medicineId)),
  create: (data) => unwrap(window.api.batches.create(data)),
  adjustQuantity: (batchId, delta, reason, note) =>
    unwrap(window.api.batches.adjustQuantity(batchId, delta, reason, note)),
  stockSummary: () => unwrap(window.api.batches.stockSummary()),
}

export const sales = {
  allocate: (medicineId, qty) => unwrap(window.api.sales.allocate(medicineId, qty)),
  availableQty: (medicineId) => unwrap(window.api.sales.availableQty(medicineId)),
  create: (sale, items, payments) => unwrap(window.api.sales.create(sale, items, payments)),
}

// invoice/reprint resolve to { printed: true, printer } or, with no printer configured, { printed: false, pdfPath }
export const print = {
  invoice: (saleId) => unwrap(window.api.print.invoice(saleId)),
  reprint: (saleId) => unwrap(window.api.print.reprint(saleId)),
  listPrinters: () => unwrap(window.api.print.listPrinters()),
}

// salesHistory takes { from, to } as local YYYY-MM-DD dates, both inclusive; so do salesSummary, grossMargin,
// dailyTotals, and topSelling/exportCsv (plus an optional limit). Those five are owner only.
// exportCsv resolves to { saved: true, filePath } or { saved: false } when the save dialog is cancelled.
export const reports = {
  lowStock: () => unwrap(window.api.reports.lowStock()),
  expiring: (days) => unwrap(window.api.reports.expiring(days)),
  salesHistory: (range) => unwrap(window.api.reports.salesHistory(range)),
  saleDetail: (saleId) => unwrap(window.api.reports.saleDetail(saleId)),
  todaySalesTotal: () => unwrap(window.api.reports.todaySalesTotal()),
  todayBillCount: () => unwrap(window.api.reports.todayBillCount()),
  lowStockCount: () => unwrap(window.api.reports.lowStockCount()),
  expiringCount: (days) => unwrap(window.api.reports.expiringCount(days)),
  salesSummary: (range) => unwrap(window.api.reports.salesSummary(range)),
  topSelling: (opts) => unwrap(window.api.reports.topSelling(opts)),
  grossMargin: (range) => unwrap(window.api.reports.grossMargin(range)),
  dailyTotals: (range) => unwrap(window.api.reports.dailyTotals(range)),
  exportCsv: (opts) => unwrap(window.api.reports.exportCsv(opts)),
}

// Owner only. get resolves to every editable key as a string; save validates, stores and returns the same shape.
export const settings = {
  get: () => unwrap(window.api.settings.get()),
  save: (data) => unwrap(window.api.settings.save(data)),
}

// Owner only. info resolves to { root, fallback, reason }: the folder holding backups, invoices and reports,
// and, when Documents could not be used, true and why. open shows that folder in Explorer.
export const dataFolder = {
  info: () => unwrap(window.api.dataFolder.info()),
  open: () => unwrap(window.api.dataFolder.open()),
}

// Owner only. status resolves to { lastBackupAt (ISO or null), backups: [{ name, kind, created_at, size }] },
// newest first; create to the new file's name. chooseFile opens a file dialog and validates the file,
// resolving to { name, path, size, modified } or null if cancelled. restore and restoreChosen take the typed
// confirmation ('RESTORE') and restart the app on success, so they only ever settle with an error.
export const backup = {
  status: () => unwrap(window.api.backup.status()),
  create: () => unwrap(window.api.backup.create()),
  restore: (name, confirmation) => unwrap(window.api.backup.restore(name, confirmation)),
  chooseFile: () => unwrap(window.api.backup.chooseFile()),
  restoreChosen: (confirmation) => unwrap(window.api.backup.restoreChosen(confirmation)),
}

// Owner only. status resolves to { configured, account (email or null) } without using the network.
// connect opens Google sign-in in the browser and resolves to the email; disconnect to { revoked }, false
// when Google could not be reached and access must be removed in the Google account. uploadLatest resolves
// to { id, name, size, created_at, alreadyUploaded }; list to [{ id, name, size, created_at }], newest first.
// restore takes the typed confirmation and restarts the app on success. Offline, every network call
// rejects with a plain "No internet connection" message.
export const drive = {
  status: () => unwrap(window.api.drive.status()),
  connect: () => unwrap(window.api.drive.connect()),
  disconnect: () => unwrap(window.api.drive.disconnect()),
  uploadLatest: () => unwrap(window.api.drive.uploadLatest()),
  list: () => unwrap(window.api.drive.list()),
  restore: (fileId, confirmation) => unwrap(window.api.drive.restore(fileId, confirmation)),
}
