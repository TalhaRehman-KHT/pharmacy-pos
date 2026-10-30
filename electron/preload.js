// Preloads run sandboxed, which only supports CommonJS require, not ES module imports
const { contextBridge, ipcRenderer } = require('electron')

// Every method resolves to { ok: true, data } or { ok: false, error }; src/lib/api.js unwraps it
contextBridge.exposeInMainWorld('api', {
  setup: {
    isNeeded: () => ipcRenderer.invoke('setup:isNeeded'),
    complete: (shop, owner) => ipcRenderer.invoke('setup:complete', shop, owner),
  },
  recovery: {
    available: () => ipcRenderer.invoke('recovery:available'),
    verify: (username, code) => ipcRenderer.invoke('recovery:verify', username, code),
    resetPassword: (newPassword) => ipcRenderer.invoke('recovery:resetPassword', newPassword),
    cancel: () => ipcRenderer.invoke('recovery:cancel'),
    status: () => ipcRenderer.invoke('recovery:status'),
    regenerate: (currentPassword) => ipcRenderer.invoke('recovery:regenerate', currentPassword),
  },
  auth: {
    login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    current: () => ipcRenderer.invoke('auth:current'),
    shopName: () => ipcRenderer.invoke('auth:shopName'),
  },
  users: {
    list: () => ipcRenderer.invoke('users:list'),
    create: (data) => ipcRenderer.invoke('users:create', data),
    resetPassword: (id, newPassword) => ipcRenderer.invoke('users:resetPassword', id, newPassword),
    deactivate: (id) => ipcRenderer.invoke('users:deactivate', id),
  },
  medicines: {
    list: (opts) => ipcRenderer.invoke('medicines:list', opts),
    get: (id) => ipcRenderer.invoke('medicines:get', id),
    create: (data) => ipcRenderer.invoke('medicines:create', data),
    update: (id, data) => ipcRenderer.invoke('medicines:update', id, data),
    deactivate: (id) => ipcRenderer.invoke('medicines:deactivate', id),
  },
  batches: {
    listByMedicine: (medicineId) => ipcRenderer.invoke('batches:listByMedicine', medicineId),
    create: (data) => ipcRenderer.invoke('batches:create', data),
    adjustQuantity: (batchId, delta, reason, note) =>
      ipcRenderer.invoke('batches:adjustQuantity', batchId, delta, reason, note),
    stockSummary: () => ipcRenderer.invoke('batches:stockSummary'),
  },
  sales: {
    allocate: (medicineId, qty) => ipcRenderer.invoke('sales:allocate', medicineId, qty),
    availableQty: (medicineId) => ipcRenderer.invoke('sales:availableQty', medicineId),
    create: (sale, items, payments) => ipcRenderer.invoke('sales:create', sale, items, payments),
  },
  print: {
    invoice: (saleId) => ipcRenderer.invoke('print:invoice', saleId),
    reprint: (saleId) => ipcRenderer.invoke('print:reprint', saleId),
    listPrinters: () => ipcRenderer.invoke('print:listPrinters'),
  },
  reports: {
    lowStock: () => ipcRenderer.invoke('reports:lowStock'),
    expiring: (days) => ipcRenderer.invoke('reports:expiring', days),
    salesHistory: (range) => ipcRenderer.invoke('reports:salesHistory', range),
    saleDetail: (saleId) => ipcRenderer.invoke('reports:saleDetail', saleId),
    todaySalesTotal: () => ipcRenderer.invoke('reports:todaySalesTotal'),
    todayBillCount: () => ipcRenderer.invoke('reports:todayBillCount'),
    lowStockCount: () => ipcRenderer.invoke('reports:lowStockCount'),
    expiringCount: (days) => ipcRenderer.invoke('reports:expiringCount', days),
    salesSummary: (range) => ipcRenderer.invoke('reports:salesSummary', range),
    topSelling: (opts) => ipcRenderer.invoke('reports:topSelling', opts),
    grossMargin: (range) => ipcRenderer.invoke('reports:grossMargin', range),
    dailyTotals: (range) => ipcRenderer.invoke('reports:dailyTotals', range),
    exportCsv: (opts) => ipcRenderer.invoke('reports:exportCsv', opts),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data) => ipcRenderer.invoke('settings:save', data),
  },
  dataFolder: {
    info: () => ipcRenderer.invoke('dataFolder:info'),
    open: () => ipcRenderer.invoke('dataFolder:open'),
  },
  backup: {
    status: () => ipcRenderer.invoke('backup:status'),
    create: () => ipcRenderer.invoke('backup:create'),
    restore: (name, confirmation) => ipcRenderer.invoke('backup:restore', name, confirmation),
    chooseFile: () => ipcRenderer.invoke('backup:chooseFile'),
    restoreChosen: (confirmation) => ipcRenderer.invoke('backup:restoreChosen', confirmation),
  },
  drive: {
    status: () => ipcRenderer.invoke('drive:status'),
    connect: () => ipcRenderer.invoke('drive:connect'),
    disconnect: () => ipcRenderer.invoke('drive:disconnect'),
    uploadLatest: () => ipcRenderer.invoke('drive:uploadLatest'),
    list: () => ipcRenderer.invoke('drive:list'),
    restore: (fileId, confirmation) => ipcRenderer.invoke('drive:restore', fileId, confirmation),
  },
})
